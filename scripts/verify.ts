#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// The real gate, and what CI runs: type-check, tests, and then black-box checks
// against a REAL MCP server over stdio with a throwaway config dir and no
// session — so nothing here touches the network or the user's account.

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.error(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

async function run(command: string[], env: Record<string, string> = {}): Promise<number> {
  const proc = Bun.spawn(command, { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  return proc.exited;
}

/** Speaks JSON-RPC to the server and returns one response per request id. */
async function talk(
  requests: unknown[],
  env: Record<string, string>,
): Promise<{ responses: Record<string, unknown>[]; stdout: string }> {
  const proc = Bun.spawn(["bun", "run", "src/bin.ts", "mcp"], {
    env: { ...process.env, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(requests.map((request) => JSON.stringify(request)).join("\n") + "\n");
  await proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  const responses = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { responses, stdout };
}

const handshake = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "verify", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

console.error("amazon-mcp — verificação\n");

console.error("tipos");
check((await run(["bunx", "tsc", "--noEmit"])) === 0, "tsc --noEmit");

console.error("\ntestes");
check((await run(["bun", "test"])) === 0, "bun test");

const dir = mkdtempSync(join(tmpdir(), "amazon-verify-"));
try {
  console.error("\nservidor MCP (sem sessão, sem rede)");
  const env = { AMAZON_CONFIG_DIR: dir, AMAZON_EXPORT_DIR: join(dir, "out") };

  const { responses, stdout } = await talk(
    [
      ...handshake,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "auth_status", arguments: {} } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nao_existe", arguments: {} } },
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "raw_get", arguments: { path: "/gp/buy/spc/handlers/display.html" } },
      },
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "list_orders", arguments: { limit: -1 } },
      },
      { jsonrpc: "2.0", id: 7, method: "tools/list" },
    ],
    env,
  );

  check(
    stdout.split("\n").filter((line) => line.trim()).every((line) => line.startsWith("{")),
    "stdout é 100% JSON-RPC",
  );

  const listed = responses.find((response) => response.id === 2);
  const tools = ((listed?.result as { tools?: unknown[] })?.tools ?? []) as Array<
    Record<string, unknown>
  >;
  check(tools.length === allTools.length, "tools/list == registry", `${tools.length} tools`);
  check(
    tools.every((tool) => (tool.inputSchema as { type?: string })?.type === "object"),
    "todo inputSchema é um objeto JSON Schema",
  );
  check(
    tools.every((tool) => String(tool.description).length > 40),
    "toda descrição orienta o modelo",
  );

  const status = responses.find((response) => response.id === 3);
  const statusText = JSON.stringify(status?.result ?? {});
  check(status?.result !== undefined, "auth_status responde sem sessão e sem rede");
  check(!statusText.includes("at-acbbr") || !statusText.includes("Mozilla/5.0 (fake"), "auth_status não vaza valor de cookie");

  for (const [id, label] of [
    [4, "tool desconhecida vira isError"],
    [5, "raw_get recusa caminho fora da allowlist"],
    [6, "argumento inválido vira isError"],
  ] as const) {
    const response = responses.find((item) => item.id === id);
    check((response?.result as { isError?: boolean })?.isError === true, label);
  }

  check(responses.find((response) => response.id === 7) !== undefined, "o servidor segue vivo após os erros");

  const readOnly = await talk([...handshake, { jsonrpc: "2.0", id: 2, method: "tools/list" }], {
    ...env,
    AMAZON_READ_ONLY: "1",
  });
  const names = (
    ((readOnly.responses.find((r) => r.id === 2)?.result as { tools?: Array<{ name: string }> })
      ?.tools ?? [])
  ).map((tool) => tool.name);
  check(
    JSON.stringify(names) === JSON.stringify(allTools.filter((t) => t.readOnly).map((t) => t.name)),
    "modo somente leitura registra exatamente o subconjunto readOnly",
    `${names.length} tools`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.error(failures === 0 ? "\ntudo certo" : `\n${failures} verificação(ões) falharam`);
process.exitCode = failures === 0 ? 0 : 1;
