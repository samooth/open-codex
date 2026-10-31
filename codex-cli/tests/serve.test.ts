import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createServeServer } from "../src/utils/serve.js";
import { loadConfig } from "../src/utils/config.js";

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let data: any = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe("serve mode", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const config = loadConfig();
    server = createServeServer({
      config,
      port: 0,
      host: "127.0.0.1",
      token: "test-token",
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("requires auth token", async () => {
    const res = await request(port, "GET", "/session");
    expect(res.status).toBe(401);
  });

  it("creates and lists sessions", async () => {
    const created = await request(
      port,
      "POST",
      "/session",
      { directory: process.cwd(), model: "test-model" },
      "test-token",
    );
    expect(created.status).toBe(201);
    expect(created.data.id).toBeTruthy();
    expect(created.data.directory).toBeTruthy();
    expect(created.data.model).toBe("test-model");

    const list = await request(
      port,
      "GET",
      "/session",
      undefined,
      "test-token",
    );
    expect(list.status).toBe(200);
    expect(Array.isArray(list.data)).toBe(true);
    expect(list.data.some((s: any) => s.id === created.data.id)).toBe(true);
  });

  it("gets and moves session", async () => {
    const created = await request(
      port,
      "POST",
      "/session",
      { directory: process.cwd() },
      "test-token",
    );
    const id = created.data.id;
    const details = await request(
      port,
      "GET",
      `/session/${id}`,
      undefined,
      "test-token",
    );
    expect(details.status).toBe(200);
    expect(details.data.id).toBe(id);

    const moved = await request(
      port,
      "POST",
      `/session/${id}/move`,
      { directory: "/tmp" },
      "test-token",
    );
    expect(moved.status).toBe(200);
    expect(moved.data.directory).toContain("tmp");
  });

  it("deletes session", async () => {
    const created = await request(
      port,
      "POST",
      "/session",
      { directory: process.cwd() },
      "test-token",
    );
    const id = created.data.id;
    const del = await request(
      port,
      "DELETE",
      `/session/${id}`,
      undefined,
      "test-token",
    );
    expect(del.status).toBe(200);
    const get = await request(
      port,
      "GET",
      `/session/${id}`,
      undefined,
      "test-token",
    );
    expect(get.status).toBe(404);
  });

  it("config get/patch", async () => {
    const got = await request(port, "GET", "/config", undefined, "test-token");
    expect(got.status).toBe(200);
    const patched = await request(
      port,
      "PATCH",
      "/config",
      { temperature: 0.42 },
      "test-token",
    );
    expect(patched.status).toBe(200);
    expect(patched.data.temperature).toBe(0.42);
  });

  it("model get", async () => {
    const res = await request(port, "GET", "/model", undefined, "test-token");
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("model");
  });

  it("mcp servers global", async () => {
    const res = await request(
      port,
      "GET",
      "/mcp/servers",
      undefined,
      "test-token",
    );
    expect(res.status).toBe(200);
    expect(res.data).toHaveProperty("servers");
  });
});
