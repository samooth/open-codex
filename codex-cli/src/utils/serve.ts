import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { AgentLoop } from "./agent/agent-loop.js";
import { PluginManager } from "./agent/plugin-manager.js";
import { SkillManager } from "./agent/skill-manager.js";
import { AutoApprovalMode } from "./auto-approval-mode.js";
import { ReviewDecision } from "./agent/review.js";
import { createInputItem } from "./input-utils.js";
import { setSessionId, setCurrentModel } from "./session.js";
import {
  loadRollouts,
  loadRollout,
  saveRollout,
  flushRollout,
} from "./storage/save-rollout.js";
import type { AppConfig } from "./config.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import type { CommandConfirmation } from "./agent/types.js";

interface Session {
  id: string;
  directory: string;
  model: string;
  provider?: string;
  agent?: string;
  approvalPolicy: string;
  config: AppConfig;
  createdAt: number;
  items: ChatCompletionMessageParam[];
  clients: Set<http.ServerResponse>;
  running: boolean;
  pluginManager: PluginManager;
  skillManager: SkillManager;
  agentLoop: AgentLoop;
  textStarted: boolean;
  reasoningStarted: boolean;
  prevText: string;
  currentTool: string | null;
  pendingApprovals: Map<
    string,
    { resolve: (value: CommandConfirmation) => void }
  >;
}

export interface ServeOptions {
  config: AppConfig;
  port: number;
  host: string;
  token?: string;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Array<Buffer> = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function isLocalAddress(req: http.IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost"
  );
}

function authorize(
  req: http.IncomingMessage,
  token: string | undefined,
): boolean {
  if (token) {
    const auth = req.headers.authorization ?? "";
    return auth === `Bearer ${token}`;
  }
  return isLocalAddress(req);
}

function emit(session: Session, type: string, data: unknown): void {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of session.clients) {
    try {
      client.write(payload);
    } catch {
      session.clients.delete(client);
    }
  }
}

function parseToolArguments(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function handlePartial(
  session: Session,
  content: string,
  reasoning: string | undefined,
  activeToolName: string | undefined,
  activeToolArguments: Record<string, any> | undefined,
): void {
  if (typeof content === "string") {
    if (content.length > 0) {
      if (!session.textStarted) {
        session.textStarted = true;
        emit(session, "session.text.started", {});
      }
      let delta = content;
      if (content.startsWith(session.prevText)) {
        delta = content.slice(session.prevText.length);
      }
      if (delta) {
        emit(session, "session.text.delta", { delta });
      }
      session.prevText = content;
    } else if (session.textStarted) {
      emit(session, "session.text.ended", {});
      session.textStarted = false;
      session.prevText = "";
    }
  }

  if (reasoning) {
    if (!session.reasoningStarted) {
      session.reasoningStarted = true;
      emit(session, "session.reasoning.started", {});
    }
    emit(session, "session.reasoning.delta", { delta: reasoning });
  }

  if (activeToolName) {
    if (activeToolName !== session.currentTool) {
      session.currentTool = activeToolName;
      const payload = {
        name: activeToolName,
        arguments: activeToolArguments,
      };
      for (const type of [
        "session.tool.input.started",
        "session.tool.started",
      ]) {
        emit(session, type, payload);
      }
    }
  }
}

function handleItem(session: Session, item: ChatCompletionMessageParam): void {
  if (item.role === "assistant") {
    if (typeof item.content === "string" && item.content && session.textStarted) {
      emit(session, "session.text.ended", {});
      session.textStarted = false;
      session.prevText = "";
    }
    const toolCalls = (item as any).tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const payload = {
          id: tc.id,
          name: tc.function?.name,
          arguments: parseToolArguments(tc.function?.arguments),
        };
        for (const type of [
          "session.tool.called",
          "session.tool.input.called",
        ]) {
          emit(session, type, payload);
        }
      }
    }
  }

  if (item.role === "tool") {
    const content = typeof item.content === "string" ? item.content : "";
    let success = true;
    let metadata: any = {};
    let parsed: any = null;
    try {
      parsed = JSON.parse(content);
      if (parsed?.metadata?.exit_code !== undefined) {
        success = parsed.metadata.exit_code === 0;
        metadata = parsed.metadata;
      } else {
        // Streaming/partial tool output without a final exit code: skip.
        return;
      }
    } catch {
      // not json; treat as success
      metadata = {};
    }
    const types = success
      ? ["session.tool.success", "session.tool.input.success"]
      : ["session.tool.failed", "session.tool.input.failed"];
    const payload = {
      tool_call_id: (item as any).tool_call_id,
      name: (item as any).name,
      output: content,
      metadata,
    };
    for (const type of types) {
      emit(session, type, payload);
    }
  }
}

function handleLoading(session: Session, loading: boolean): void {
  if (loading) {
    emit(session, "session.step.started", {});
  } else {
    emit(session, "session.step.ended", {});
  }
}

async function createSession(
  opts: any,
  baseConfig: AppConfig,
): Promise<Session> {
  const directory = opts?.directory
    ? path.resolve(String(opts.directory))
    : process.cwd();
  const model = opts?.model ? String(opts.model) : baseConfig.model;
  const provider = opts?.provider ? String(opts.provider) : baseConfig.provider;
  const agent = opts?.agent ? String(opts.agent) : undefined;
  const approvalPolicy =
    opts?.approvalPolicy ??
    opts?.approvalMode ??
    baseConfig.approvalMode ??
    AutoApprovalMode.FULL_AUTO;

  const config: AppConfig = {
    ...baseConfig,
    model,
    provider: provider ?? baseConfig.provider,
    approvalMode: approvalPolicy as any,
  };

  const pluginManager = new PluginManager();
  await pluginManager.loadPlugins(config.plugins);

  const skillSearchPaths = config.skills?.paths?.length
    ? config.skills.paths
    : SkillManager.getDefaultSearchPaths(directory);
  const skillManager = new SkillManager(pluginManager, skillSearchPaths);
  await skillManager.loadSkills();

  const session: Session = {
    id: randomUUID(),
    directory,
    model,
    provider,
    agent,
    approvalPolicy: String(approvalPolicy),
    config,
    createdAt: Date.now(),
    items: [],
    clients: new Set(),
    running: false,
    pluginManager,
    skillManager,
    agentLoop: null as any,
    textStarted: false,
    reasoningStarted: false,
    prevText: "",
    currentTool: null,
    pendingApprovals: new Map(),
  };

  const agentLoop = new AgentLoop({
    model,
    config,
    instructions: config.instructions,
    approvalPolicy: approvalPolicy as any,
    pluginManager,
    onItem: (item: ChatCompletionMessageParam) => {
      session.items.push(item);
      handleItem(session, item);
    },
    onPartialUpdate: (
      content: string,
      reasoning?: string,
      activeToolName?: string,
      activeToolArguments?: Record<string, any>,
    ) => {
      handlePartial(
        session,
        content,
        reasoning,
        activeToolName,
        activeToolArguments,
      );
    },
    onLoading: (loading: boolean) => {
      handleLoading(session, loading);
    },
    getCommandConfirmation: async (
      command: Array<string>,
      applyPatch: any,
    ): Promise<CommandConfirmation> => {
      // Auto-approve everything in full-auto mode.
      if (approvalPolicy === AutoApprovalMode.FULL_AUTO) {
        return { review: ReviewDecision.YES };
      }

      const approvalId = randomUUID();
      emit(session, "session.approval.requested", {
        id: approvalId,
        command,
        applyPatch,
      });

      return new Promise<CommandConfirmation>((resolve) => {
        session.pendingApprovals.set(approvalId, { resolve });
      });
    },
    onReset: () => {
      session.items = [];
    },
  });

  session.agentLoop = agentLoop;
  return session;
}

let runQueue: Promise<void> = Promise.resolve();

async function runPrompt(
  session: Session,
  text: string,
  files: unknown,
): Promise<void> {
  if (session.running) {
    throw new Error("session is busy");
  }

  const previous = runQueue;
  let releaseQueue: () => void = () => {};
  runQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous.catch(() => {});

  session.running = true;
  session.textStarted = false;
  session.reasoningStarted = false;
  session.prevText = "";
  session.currentTool = null;

  const imagePaths: Array<string> = [];
  let promptText = text ?? "";
  if (Array.isArray(files)) {
    for (const f of files) {
      const p =
        typeof f === "string"
          ? f
          : f && typeof f === "object" && "path" in f
            ? String((f as any).path)
            : "";
      if (!p) continue;
      if (/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(p)) {
        imagePaths.push(p);
      } else {
        try {
          const resolved = path.isAbsolute(p)
            ? p
            : path.resolve(session.directory, p);
          const content = fs.readFileSync(resolved, "utf8");
          promptText += `\n\n--- ${p} ---\n${content}\n---`;
        } catch {
          // ignore unreadable files
        }
      }
    }
  }

  const inputItem = await createInputItem(promptText, imagePaths);
  const prevItems = [...session.items];

  const prevCwd = process.cwd();
  process.chdir(session.directory);
  try {
    await session.agentLoop.run([inputItem], prevItems);
  } catch (err) {
    emit(session, "session.error", { message: String(err) });
  } finally {
    process.chdir(prevCwd);
    session.running = false;
    if (session.items.length > 0) {
      try {
        setSessionId(session.id);
        setCurrentModel(session.model);
        saveRollout(session.items);
        await flushRollout();
      } catch {
        // ignore persistence errors
      }
    }
    emit(session, "session.idle", {});
    releaseQueue();
  }
}

function matchSessionPath(pathname: string): { id: string; rest: string } | null {
  const m = pathname.match(/^\/session\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1] ?? ""), rest: m[2] ?? "" };
}

export async function runServeMode(options: ServeOptions): Promise<void> {
  const sessions = new Map<string, Session>();
  const baseConfig: AppConfig = { ...options.config };
  let currentModel = baseConfig.model;
  let currentProvider = baseConfig.provider;
  let currentAgent = "default";

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,PATCH,DELETE,OPTIONS",
      );
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.end();
        return;
      }

      if (!authorize(req, options.token)) {
        sendJson(res, options.token ? 401 : 403, {
          error: "unauthorized",
        });
        return;
      }

      const url = new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      );
      const pathname = url.pathname;
      const method = req.method ?? "GET";

      // GET /session
      if (pathname === "/session" && method === "GET") {
        const list = Array.from(sessions.values()).map((s) => ({
          id: s.id,
          directory: s.directory,
          model: s.model,
          running: s.running,
          createdAt: s.createdAt,
        }));
        sendJson(res, 200, list);
        return;
      }

      // POST /session
      if (pathname === "/session" && method === "POST") {
        const body = await readBody(req);
        const session = await createSession(body, baseConfig);
        sessions.set(session.id, session);
        sendJson(res, 201, {
          id: session.id,
          directory: session.directory,
          model: session.model,
        });
        return;
      }

      // GET /sessions/saved
      if (pathname === "/sessions/saved" && method === "GET") {
        const rollouts = await loadRollouts();
        sendJson(res, 200, rollouts);
        return;
      }

      // POST /session/restore
      if (pathname === "/session/restore" && method === "POST") {
        const body = await readBody(req);
        let data: { session?: any; items?: any } | null = null;
        if (body?.path) {
          data = await loadRollout(String(body.path));
        } else if (body?.id) {
          const rollouts = await loadRollouts();
          const match = rollouts.find(
            (r: any) => r.session?.id === body.id,
          );
          if (match) {
            data = await loadRollout(match.path);
          }
        }
        if (!data) {
          sendJson(res, 404, { error: "saved session not found" });
          return;
        }
        const restored = await createSession(
          {
            directory: body?.directory ?? process.cwd(),
            model: data.session?.model ?? baseConfig.model,
            provider: data.session?.provider,
          },
          baseConfig,
        );
        restored.items = Array.isArray(data.items) ? data.items : [];
        sessions.set(restored.id, restored);
        sendJson(res, 201, {
          id: restored.id,
          directory: restored.directory,
          model: restored.model,
        });
        return;
      }

      // /session/:id...
      const sm = matchSessionPath(pathname);
      if (sm) {
        const session = sessions.get(sm.id);
        if (!session) {
          sendJson(res, 404, { error: "session not found" });
          return;
        }

        // GET /session/:id
        if (sm.rest === "" && method === "GET") {
          sendJson(res, 200, {
            id: session.id,
            directory: session.directory,
            model: session.model,
            provider: session.provider,
            agent: session.agent ?? currentAgent,
            approvalPolicy: session.approvalPolicy,
            running: session.running,
            createdAt: session.createdAt,
            items: session.items,
          });
          return;
        }

        // DELETE /session/:id
        if (sm.rest === "" && method === "DELETE") {
          try {
            session.agentLoop.terminate();
          } catch {
            // ignore
          }
          try {
            await session.pluginManager.disposeAll();
            await session.skillManager.disposeAll();
          } catch {
            // ignore
          }
          sessions.delete(session.id);
          for (const c of session.clients) {
            try {
              c.end();
            } catch {
              // ignore
            }
          }
          session.clients.clear();
          sendJson(res, 200, { ok: true });
          return;
        }

        // POST /session/:id/move
        if (sm.rest === "/move" && method === "POST") {
          const body = await readBody(req);
          if (body?.directory) {
            session.directory = path.resolve(String(body.directory));
          }
          sendJson(res, 200, {
            id: session.id,
            directory: session.directory,
            model: session.model,
          });
          return;
        }

        // POST /session/:id/prompt
        if (sm.rest === "/prompt" && method === "POST") {
          const body = await readBody(req);
          if (session.running) {
            sendJson(res, 409, { error: "session is busy" });
            return;
          }
          const text = body?.text ?? body?.prompt ?? "";
          const files = body?.files;
          // fire and forget
          runPrompt(session, String(text), files).catch(() => {});
          sendJson(res, 202, { ok: true, id: session.id });
          return;
        }

        // POST /session/:id/interrupt
        if (sm.rest === "/interrupt" && method === "POST") {
          try {
            session.agentLoop.cancel();
          } catch {
            // ignore
          }
          sendJson(res, 200, { ok: true });
          return;
        }

        // POST /session/:id/approve
        if (sm.rest === "/approve" && method === "POST") {
          const body = await readBody(req);
          const approvalId = String(
            body?.approvalId ?? body?.id ?? body?.approval_id ?? "",
          );
          const pending = session.pendingApprovals.get(approvalId);
          if (!pending) {
            sendJson(res, 404, { error: "approval not found" });
            return;
          }
          const decision = String(
            body?.decision ?? body?.review ?? "no",
          ).toLowerCase();
          let review = ReviewDecision.NO_CONTINUE;
          if (
            decision === "yes" ||
            decision === "approve" ||
            decision === "approved" ||
            decision === "true"
          ) {
            review = ReviewDecision.YES;
          } else if (decision === "always") {
            review = ReviewDecision.ALWAYS;
          } else if (decision === "no_exit" || decision === "no-exit") {
            review = ReviewDecision.NO_EXIT;
          }
          pending.resolve({ review });
          session.pendingApprovals.delete(approvalId);
          emit(session, "session.approval.resolved", {
            id: approvalId,
            decision,
          });
          sendJson(res, 200, { ok: true });
          return;
        }

        // POST /session/:id/save
        if (sm.rest === "/save" && method === "POST") {
          if (session.items.length > 0) {
            setSessionId(session.id);
            setCurrentModel(session.model);
            saveRollout(session.items);
            await flushRollout();
          }
          sendJson(res, 200, { ok: true });
          return;
        }

        // GET /session/:id/events (SSE)
        if (sm.rest === "/events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          session.clients.add(res);
          res.write(`event: connected\ndata: ${JSON.stringify({ id: session.id })}\n\n`);
          req.on("close", () => {
            session.clients.delete(res);
          });
          return;
        }

        sendJson(res, 404, { error: "not found" });
        return;
      }

      // GET /config
      if (pathname === "/config" && method === "GET") {
        sendJson(res, 200, baseConfig);
        return;
      }

      // PATCH /config
      if (pathname === "/config" && method === "PATCH") {
        const body = await readBody(req);
        if (body && typeof body === "object") {
          Object.assign(baseConfig, body);
        }
        sendJson(res, 200, baseConfig);
        return;
      }

      // GET /model
      if (pathname === "/model" && method === "GET") {
        sendJson(res, 200, {
          model: currentModel,
          provider: currentProvider,
        });
        return;
      }

      // POST /model
      if (pathname === "/model" && method === "POST") {
        const body = await readBody(req);
        if (body?.model) currentModel = String(body.model);
        if (body?.provider) currentProvider = String(body.provider);
        baseConfig.model = currentModel;
        if (currentProvider) baseConfig.provider = currentProvider;
        sendJson(res, 200, {
          model: currentModel,
          provider: currentProvider,
        });
        return;
      }

      // GET /agent
      if (pathname === "/agent" && method === "GET") {
        sendJson(res, 200, { agent: currentAgent });
        return;
      }

      // POST /agent
      if (pathname === "/agent" && method === "POST") {
        const body = await readBody(req);
        if (body?.agent) currentAgent = String(body.agent);
        sendJson(res, 200, { agent: currentAgent });
        return;
      }

      // Files
      if (pathname === "/file/list" && method === "GET") {
        const dir = url.searchParams.get("path") || ".";
        const resolved = path.resolve(process.cwd(), dir);
        try {
          const entries = fs.readdirSync(resolved, { withFileTypes: true });
          sendJson(
            res,
            200,
            entries.map((e) => ({
              name: e.name,
              isDirectory: e.isDirectory(),
            })),
          );
        } catch (err) {
          sendJson(res, 400, { error: String(err) });
        }
        return;
      }

      if (pathname === "/file/read" && method === "GET") {
        const p = url.searchParams.get("path");
        if (!p) {
          sendJson(res, 400, { error: "path required" });
          return;
        }
        const resolved = path.resolve(process.cwd(), p);
        try {
          const content = fs.readFileSync(resolved, "utf8");
          sendJson(res, 200, { path: p, content });
        } catch (err) {
          sendJson(res, 400, { error: String(err) });
        }
        return;
      }

      // VCS
      if (pathname === "/vcs/status" && method === "GET") {
        const r = spawnSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        });
        sendJson(res, 200, { status: r.stdout ?? "", error: r.stderr ?? "" });
        return;
      }

      if (pathname === "/vcs/diff" && method === "GET") {
        const p = url.searchParams.get("path");
        const args = p ? ["diff", "--", p] : ["diff"];
        const r = spawnSync("git", args, { encoding: "utf8" });
        sendJson(res, 200, { diff: r.stdout ?? "", error: r.stderr ?? "" });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
  });

  server.listen(options.port, options.host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `open-codex serve listening on http://${options.host}:${options.port}`,
    );
  });

  // Keep process alive.
  await new Promise<void>(() => {});
}