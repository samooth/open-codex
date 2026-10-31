import http from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import { AgentLoop } from "./agent/agent-loop.js";
import { PluginManager } from "./agent/plugin-manager.js";
import { SkillManager } from "./agent/skill-manager.js";
import { AutoApprovalMode } from "./auto-approval-mode.js";
import { ReviewDecision } from "./agent/review.js";
import { createInputItem } from "./input-utils.js";
import { setSessionId, setCurrentModel } from "./session.js";
import { getAvailableModels } from "./model-utils.js";
import { process_patch } from "./agent/apply-patch.js";
import { approximateTokensUsed } from "./approximate-tokens-used.js";
import OpenAI from "openai";
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
  promptQueue: Array<{
    text: string;
    files: unknown;
    resolve: () => void;
    reject: (err: unknown) => void;
  }>;
  processingPrompts: boolean;
  eventBuffer: Array<{ id: number; type: string; payload: string }>;
  nextEventId: number;
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
  corsOrigin?: string;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(payload);
}

function readBody(
  req: http.IncomingMessage,
  maxBytes: number = 1024 * 1024,
): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Array<Buffer> = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        tooLarge = true;
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) {
        resolve(null);
        return;
      }
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
    req.on("error", () => resolve(tooLarge ? null : {}));
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
  const base =
    data && typeof data === "object" && !Array.isArray(data)
      ? { sessionID: session.id, ...(data as Record<string, unknown>) }
      : { sessionID: session.id };
  const id = session.nextEventId++;
  const payload = `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(base)}\n\n`;
  session.eventBuffer.push({ id, type, payload });
  if (session.eventBuffer.length > 500) {
    session.eventBuffer.splice(0, session.eventBuffer.length - 500);
  }
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
    if (
      typeof item.content === "string" &&
      item.content &&
      session.textStarted
    ) {
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

async function summarizeItems(
  config: AppConfig,
  items: Array<ChatCompletionMessageParam>,
): Promise<string | null> {
  try {
    if (!config.apiKey && config.provider !== "ollama") {
      return null;
    }
    const client = new OpenAI({
      apiKey: config.apiKey || "none",
      baseURL: config.baseURL,
    });
    const text = items
      .map((i) => {
        const content =
          typeof i.content === "string"
            ? i.content
            : Array.isArray(i.content)
              ? i.content
                  .map((c: any) => (c.type === "text" ? c.text : ""))
                  .join(" ")
              : "";
        return `[${i.role}] ${content}`;
      })
      .join("\n")
      .slice(0, 12000);
    const resp = await client.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "Summarize the conversation concisely, preserving key decisions, files changed, and pending tasks.",
        },
        { role: "user", content: text },
      ],
      max_tokens: 400,
    });
    return resp.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
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
    promptQueue: [],
    processingPrompts: false,
    eventBuffer: [],
    nextEventId: 1,
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
    onFileAccess: (path: string) => {
      emit(session, "session.file.access", { path });
      emit(session, "file.accessed", { path });
    },
    onTasksUpdate: (tasks: any[]) => {
      emit(session, "session.tasks", { tasks });
      emit(session, "tasks.updated", { tasks });
    },
    onIndexingStatus: (status: any) => {
      emit(session, "session.indexing", status);
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
      const tool = applyPatch ? "apply_patch" : "shell";
      const resources = applyPatch
        ? [applyPatch.patch]
        : Array.isArray(command)
          ? command
          : [String(command)];
      const payload = {
        id: approvalId,
        sessionID: session.id,
        tool,
        resources,
        command,
        applyPatch,
      };
      for (const type of ["session.approval.requested", "permission.asked"]) {
        emit(session, type, payload);
      }

      return new Promise<CommandConfirmation>((resolve) => {
        session.pendingApprovals.set(approvalId, { resolve });
      });
    },
    onReset: () => {
      session.items = [];
    },
  });

  const restoreId =
    opts?.restoreId ?? opts?.savedId ?? opts?.resume ?? opts?.restore;
  if (restoreId) {
    try {
      let data: { items?: any } | null = null;
      if (typeof restoreId === "string" && restoreId.includes("/")) {
        data = await loadRollout(restoreId);
      } else {
        const rollouts = await loadRollouts();
        const match = rollouts.find(
          (r: any) => r.session?.id === restoreId,
        );
        if (match) {
          data = await loadRollout(match.path);
        }
      }
      if (data && Array.isArray(data.items)) {
        session.items = data.items;
      }
    } catch {
      // ignore restore errors
    }
  }

  session.agentLoop = agentLoop;
  return session;
}

let runQueue: Promise<void> = Promise.resolve();

async function runPromptTask(
  session: Session,
  text: string,
  files: unknown,
): Promise<void> {
  const startedAt = Date.now();
  const previous = runQueue;
  let releaseQueue: () => void = () => {};
  runQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous.catch(() => {});

  session.running = true;
  emit(session, "session.status", { status: "busy" });
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
    const durationMs = Date.now() - startedAt;
    try {
      const usage = approximateTokensUsed(session.model, session.items);
      emit(session, "session.usage", usage);
      emit(session, "session.cost", { cost: usage.cost, total: usage.total });
    } catch {
      // ignore
    }
    emit(session, "session.metrics", { durationMs });
    emit(session, "session.status", { status: "idle" });
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

async function enqueuePrompt(
  session: Session,
  text: string,
  files: unknown,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    session.promptQueue.push({ text, files, resolve, reject });
    void processPromptQueue(session);
  });
}

async function processPromptQueue(session: Session): Promise<void> {
  if (session.processingPrompts) {
    return;
  }
  session.processingPrompts = true;
  while (session.promptQueue.length > 0) {
    const job = session.promptQueue.shift()!;
    try {
      await runPromptTask(session, job.text, job.files);
      job.resolve();
    } catch (err) {
      job.reject(err);
    }
  }
  session.processingPrompts = false;
}

function matchSessionPath(
  pathname: string,
): { id: string; rest: string } | null {
  const m = pathname.match(/^\/session\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1] ?? ""), rest: m[2] ?? "" };
}

export function createServeServer(options: ServeOptions): http.Server {
  const sessions = new Map<string, Session>();
  const rateLimits = new Map<string, { count: number; reset: number }>();
  const baseConfig: AppConfig = { ...options.config };
  let currentModel = baseConfig.model;
  let currentProvider = baseConfig.provider;
  let currentVariant = (baseConfig as any).modelVariant as string | undefined;
  let currentAgent = "default";

  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader(
        "Access-Control-Allow-Origin",
        options.corsOrigin || process.env["OPEN_CODEX_CORS_ORIGIN"] || "*",
      );
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

      // Simple per-IP rate limiting (120 req/min).
      const ip = req.socket.remoteAddress ?? "unknown";
      const now = Date.now();
      let rl = rateLimits.get(ip);
      if (!rl || now > rl.reset) {
        rl = { count: 0, reset: now + 60000 };
        rateLimits.set(ip, rl);
      }
      rl.count += 1;
      if (rl.count > 120) {
        sendJson(res, 429, { error: "rate limit exceeded" });
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
      let pathname = url.pathname;
      if (pathname === "/v1") {
        pathname = "/";
      } else if (pathname.startsWith("/v1/")) {
        pathname = pathname.slice(3);
      }
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
          const match = rollouts.find((r: any) => r.session?.id === body.id);
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
            emit(session, "session.updated", {
              directory: session.directory,
            });
            emit(session, "session.moved", {
              directory: session.directory,
            });
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
          const text = body?.text ?? body?.prompt ?? "";
          const files = body?.files;
          const wait =
            body?.wait !== false &&
            url.searchParams.get("wait") !== "false" &&
            url.searchParams.get("async") !== "true";
          const task = enqueuePrompt(session, String(text), files);
          if (wait) {
            try {
              await task;
              sendJson(res, 200, { ok: true, id: session.id });
            } catch (err) {
              sendJson(res, 500, { error: String(err) });
            }
            return;
          }
          task.catch(() => {});
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
          const payload = {
            id: approvalId,
            sessionID: session.id,
            decision,
            review: decision,
          };
          for (const type of [
            "session.approval.resolved",
            "permission.replied",
          ]) {
            emit(session, type, payload);
          }
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

        // GET /session/:id/mcp
        if (sm.rest === "/mcp" && method === "GET") {
          const mcp = session.agentLoop.getMcpManager();
          sendJson(res, 200, {
            servers: mcp.getServerNames(),
            tools: mcp.getToolNames(),
            definitions: mcp.getAllDefinitions(),
          });
          return;
        }

        // POST /session/:id/mcp/connect
        if (sm.rest === "/mcp/connect" && method === "POST") {
          const body = await readBody(req);
          const servers =
            body?.servers && typeof body.servers === "object"
              ? body.servers
              : (session.config.mcpServers ?? baseConfig.mcpServers ?? {});
          const mcp = session.agentLoop.getMcpManager();
          try {
            await mcp.connectServers(servers);
          } catch (err) {
            sendJson(res, 200, {
              ok: false,
              error: String(err),
              servers: mcp.getServerNames(),
              tools: mcp.getToolNames(),
            });
            return;
          }
          // update config
          session.config.mcpServers = servers;
          sendJson(res, 200, {
            ok: true,
            servers: mcp.getServerNames(),
            tools: mcp.getToolNames(),
          });
          return;
        }

        // POST /session/:id/mcp/call
        if (sm.rest === "/mcp/call" && method === "POST") {
          const body = await readBody(req);
          const name = body?.name ?? body?.tool;
          if (!name) {
            sendJson(res, 400, { error: "name required" });
            return;
          }
          const mcp = session.agentLoop.getMcpManager();
          try {
            const result = await mcp.callTool(
              String(name),
              body?.arguments ?? body?.args ?? {},
            );
            sendJson(res, 200, { result });
          } catch (err) {
            sendJson(res, 400, { error: String(err) });
          }
          return;
        }

        // POST /session/:id/patch
        if (sm.rest === "/patch" && method === "POST") {
          const body = await readBody(req);
          const patch = body?.patch ?? body?.text;
          if (!patch) {
            sendJson(res, 400, { error: "patch required" });
            return;
          }
          const cwd = session.directory;
          const openFn = (p: string) =>
            fs.readFileSync(path.resolve(cwd, p), "utf8");
          const writeFn = (p: string, c: string) =>
            writeFileSync(path.resolve(cwd, p), c, "utf8");
          const removeFn = (p: string) => {
            const rp = path.resolve(cwd, p);
            if (fs.existsSync(rp)) unlinkSync(rp);
          };
          const mkdirFn = (d: string) =>
            mkdirSync(path.resolve(cwd, d), { recursive: true });
          try {
            const result = process_patch(
              String(patch),
              openFn,
              writeFn,
              removeFn,
              mkdirFn,
            );
            emit(session, "session.patch.applied", result);
            sendJson(res, result.success ? 200 : 400, result);
          } catch (err) {
            sendJson(res, 400, { error: String(err) });
          }
          return;
        }

        // POST /session/:id/file/write
        if (sm.rest === "/file/write" && method === "POST") {
          const body = await readBody(req);
          const p = body?.path;
          if (!p) {
            sendJson(res, 400, { error: "path required" });
            return;
          }
          const resolved = path.resolve(session.directory, String(p));
          try {
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(resolved, String(body?.content ?? ""), "utf8");
            emit(session, "session.file.written", { path: p });
            sendJson(res, 200, { ok: true, path: p });
          } catch (err) {
            sendJson(res, 400, { error: String(err) });
          }
          return;
        }

        // POST /session/:id/compact
        if (sm.rest === "/compact" && method === "POST") {
          const body = await readBody(req);
          const keep = Number(body?.keep ?? 20);
          const useSummary = body?.summary === true;
          const systemItems = session.items.filter((i) => i.role === "system");
          const otherItems = session.items.filter((i) => i.role !== "system");
          let removed = 0;
          if (useSummary) {
            const summary = await summarizeItems(session.config, session.items);
            if (summary) {
              session.items = [
                ...systemItems,
                {
                  role: "assistant",
                  content: `Conversation summary:\\n${summary}`,
                },
              ];
              removed = otherItems.length;
            } else {
              const trimmed = otherItems.slice(-Math.max(1, keep));
              session.items = [...systemItems, ...trimmed];
              removed = otherItems.length - trimmed.length;
            }
          } else {
            const trimmed = otherItems.slice(-Math.max(1, keep));
            session.items = [...systemItems, ...trimmed];
            removed = otherItems.length - trimmed.length;
          }
          emit(session, "session.compacted", {
            items: session.items.length,
            removed,
            summary: useSummary,
          });
          sendJson(res, 200, {
            ok: true,
            items: session.items.length,
            removed,
          });
          return;
        }

        // GET /session/:id/events (SSE)
        if (sm.rest === "/events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          });
          session.clients.add(res);

          const lastEventId = req.headers["last-event-id"];
          const lastId = lastEventId ? parseInt(String(lastEventId), 10) : 0;
          if (lastId > 0) {
            for (const ev of session.eventBuffer) {
              if (ev.id > lastId) {
                try {
                  res.write(ev.payload);
                } catch {
                  // ignore
                }
              }
            }
          } else {
            res.write(
              `event: connected\ndata: ${JSON.stringify({ id: session.id })}\n\n`,
            );
          }

          const heartbeat = setInterval(() => {
            try {
              res.write(`: heartbeat\n\n`);
            } catch {
              clearInterval(heartbeat);
              session.clients.delete(res);
            }
          }, 15000);

          req.on("close", () => {
            clearInterval(heartbeat);
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
          variant: currentVariant,
        });
        return;
      }

      // GET /models
      if (pathname === "/models" && method === "GET") {
        const provider = url.searchParams.get("provider") || currentProvider;
        const cfg: AppConfig = {
          ...baseConfig,
          provider: provider ?? baseConfig.provider,
        };
        try {
          const models = await getAvailableModels(cfg);
          sendJson(res, 200, { provider, models });
        } catch (err) {
          sendJson(res, 200, { provider, models: [], error: String(err) });
        }
        return;
      }

      // POST /model
      if (pathname === "/model" && method === "POST") {
        const body = await readBody(req);
        if (body?.model) currentModel = String(body.model);
        if (body?.provider) currentProvider = String(body.provider);
        if (body?.variant !== undefined) currentVariant = String(body.variant);
        baseConfig.model = currentModel;
        if (currentProvider) baseConfig.provider = currentProvider;
        (baseConfig as any).modelVariant = currentVariant;
        sendJson(res, 200, {
          model: currentModel,
          provider: currentProvider,
          variant: currentVariant,
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

      // GET /mcp/servers
      if (pathname === "/mcp/servers" && method === "GET") {
        sendJson(res, 200, {
          servers: baseConfig.mcpServers ?? {},
        });
        return;
      }

      // GET /mcp (alias)
      if (pathname === "/mcp" && method === "GET") {
        sendJson(res, 200, {
          servers: baseConfig.mcpServers ?? {},
        });
        return;
      }

      // GET /openapi.json
      if (pathname === "/openapi.json" && method === "GET") {
        sendJson(res, 200, {
          openapi: "3.0.0",
          info: { title: "open-codex serve API", version: "1" },
          paths: {
            "/session": {
              get: { summary: "List sessions" },
              post: { summary: "Create session" },
            },
            "/session/{id}": {
              get: { summary: "Get session" },
              delete: { summary: "Delete session" },
            },
            "/session/{id}/move": { post: { summary: "Move session" } },
            "/session/{id}/prompt": { post: { summary: "Run a turn" } },
            "/session/{id}/interrupt": { post: { summary: "Interrupt" } },
            "/session/{id}/approve": { post: { summary: "Approve permission" } },
            "/session/{id}/events": { get: { summary: "SSE events" } },
            "/session/{id}/compact": { post: { summary: "Compact session" } },
            "/session/{id}/patch": { post: { summary: "Apply patch" } },
            "/session/{id}/mcp": { get: { summary: "MCP status" } },
            "/config": {
              get: { summary: "Get config" },
              patch: { summary: "Patch config" },
            },
            "/model": {
              get: { summary: "Get model" },
              post: { summary: "Set model" },
            },
            "/models": { get: { summary: "List models" } },
            "/agent": {
              get: { summary: "Get agent" },
              post: { summary: "Set agent" },
            },
            "/file/list": { get: { summary: "List files" } },
            "/file/read": { get: { summary: "Read file" } },
            "/file/write": { post: { summary: "Write file" } },
            "/apply_patch": { post: { summary: "Apply patch" } },
            "/vcs/status": { get: { summary: "VCS status" } },
            "/vcs/diff": { get: { summary: "VCS diff" } },
            "/sessions/saved": { get: { summary: "List saved sessions" } },
            "/session/restore": { post: { summary: "Restore session" } },
            "/mcp": { get: { summary: "MCP servers" } },
            "/mcp/servers": { get: { summary: "MCP servers" } },
            "/openapi.json": { get: { summary: "OpenAPI spec" } },
          },
        });
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

      // POST /file/write
      if (pathname === "/file/write" && method === "POST") {
        const body = await readBody(req);
        const p = body?.path;
        if (!p) {
          sendJson(res, 400, { error: "path required" });
          return;
        }
        const resolved = path.resolve(process.cwd(), String(p));
        try {
          const dir = path.dirname(resolved);
          if (!fs.existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(resolved, String(body?.content ?? ""), "utf8");
          sendJson(res, 200, { ok: true, path: p });
        } catch (err) {
          sendJson(res, 400, { error: String(err) });
        }
        return;
      }

      // POST /apply_patch
      if (pathname === "/apply_patch" && method === "POST") {
        const body = await readBody(req);
        const patch = body?.patch ?? body?.text;
        if (!patch) {
          sendJson(res, 400, { error: "patch required" });
          return;
        }
        const cwd = body?.directory ? path.resolve(String(body.directory)) : process.cwd();
        const openFn = (p: string) =>
          fs.readFileSync(path.resolve(cwd, p), "utf8");
        const writeFn = (p: string, c: string) =>
          writeFileSync(path.resolve(cwd, p), c, "utf8");
        const removeFn = (p: string) => {
          const rp = path.resolve(cwd, p);
          if (fs.existsSync(rp)) unlinkSync(rp);
        };
        const mkdirFn = (d: string) => mkdirSync(path.resolve(cwd, d), { recursive: true });
        try {
          const result = process_patch(
            String(patch),
            openFn,
            writeFn,
            removeFn,
            mkdirFn,
          );
          sendJson(res, result.success ? 200 : 400, result);
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

  server.timeout = 0;
  server.keepAliveTimeout = 65000;
  return server;
}

export async function runServeMode(options: ServeOptions): Promise<void> {
  const server = createServeServer(options);
  await new Promise<void>(() => {
    server.listen(options.port, options.host, () => {
      // eslint-disable-next-line no-console
      console.log(
        `open-codex serve listening on http://${options.host}:${options.port}`,
      );
      // keep running
    });
  });
}
