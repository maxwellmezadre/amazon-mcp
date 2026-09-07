import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// Boots the REAL server over stdio with a throwaway config dir and no session,
// so it proves the transport contract without touching the network.

const dir = mkdtempSync(join(tmpdir(), "amz-mcp-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HANDSHAKE = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

async function talk(requests: unknown[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/bin.ts", "mcp"], {
    env: { ...process.env, AMAZON_CONFIG_DIR: dir, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
  await proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  return {
    stdout,
    stderr,
    messages: stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("mcp server over stdio", () => {
  test("completes the handshake and lists every tool", async () => {
    const { messages, stdout, stderr } = await talk([
      ...HANDSHAKE,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ]);

    const info = (messages[0]?.result as { serverInfo?: { name: string } })?.serverInfo;
    expect(info?.name).toBe("amazon-mcp");

    const tools = (messages[1]?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(allTools.map((tool) => tool.name));

    // stdout belongs to JSON-RPC; diagnostics go to stderr.
    for (const line of stdout.split("\n").filter((l) => l.trim())) {
      expect(line).toStartWith("{");
    }
    expect(stderr).toContain("amazon-mcp pronto");
  }, 30_000);

  test("a failing call becomes isError instead of killing the server", async () => {
    const { messages } = await talk([
      ...HANDSHAKE,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "quem", arguments: {} } },
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
    ]);
    expect((messages[1]?.result as { isError: boolean }).isError).toBe(true);
    // Still answering afterwards.
    expect(messages[2]?.result).toBeDefined();
  }, 30_000);

  test("read-only mode registers exactly the readOnly subset", async () => {
    const { messages } = await talk([...HANDSHAKE, { jsonrpc: "2.0", id: 2, method: "tools/list" }], {
      AMAZON_READ_ONLY: "1",
    });
    const tools = (messages[1]?.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(
      allTools.filter((tool) => tool.readOnly).map((tool) => tool.name),
    );
    expect(tools.some((tool) => tool.name === "sync")).toBe(false);
  }, 30_000);

  test("answers auth_status with no session and never starts a browser", async () => {
    const { messages } = await talk([
      ...HANDSHAKE,
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "auth_status", arguments: {} } },
    ]);
    const text = (messages[1]?.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const status = JSON.parse(text) as Record<string, unknown>;
    expect(status.loggedIn).toBe(false);
    expect(status.hint).toContain("amazon login");
  }, 30_000);
});
