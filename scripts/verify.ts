#!/usr/bin/env bun
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// The real gate, and what CI runs: type-check, tests, and then black-box checks
// against a REAL MCP server over stdio with a throwaway config dir and no
// session, so nothing here touches the network or the user's account. Every
// check is a promise the project makes, not a coverage number.

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.error(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
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
): Promise<{ responses: Record<string, unknown>[]; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", "run", "src/bin.ts", "mcp"], {
    env: { ...process.env, ...env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(requests.map((request) => JSON.stringify(request)).join("\n") + "\n");
  await proc.stdin.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const responses = stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { responses, stdout, stderr };
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

const callTool = (id: number, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

console.error("amazon-mcp: verificação\n");

console.error("estático");
check((await run(["bunx", "tsc", "--noEmit"])) === 0, "tsc --noEmit");
check((await run(["bun", "test"])) === 0, "bun test");

const dir = mkdtempSync(join(tmpdir(), "amazon-verify-"));
try {
  console.error("\nservidor MCP (sem sessão, sem rede)");
  const env = { AMAZON_CONFIG_DIR: dir, AMAZON_EXPORT_DIR: join(dir, "out") };

  const { responses, stdout, stderr } = await talk(
    [
      ...handshake,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      callTool(3, "auth_status"),
      callTool(4, "nao_existe"),
      // A write surface (the cart), a read page outside the order surfaces, a
      // traversal that would land on the cart, and a schema violation.
      callTool(5, "raw_get", { path: "/gp/cart/view.html" }),
      callTool(6, "raw_get", { path: "/gp/help/customer/display.html" }),
      callTool(7, "raw_get", { path: "/your-orders/../gp/cart/view.html" }),
      callTool(8, "list_orders", { limit: -1 }),
      { jsonrpc: "2.0", id: 9, method: "tools/list" },
    ],
    env,
  );

  check(
    stdout.split("\n").filter((line) => line.trim()).every((line) => line.startsWith("{")),
    "stdout é 100% JSON-RPC",
  );
  check(stderr.trim().length > 0 && !stderr.includes('"jsonrpc"'), "logs saem no stderr");

  const listed = responses.find((response) => response.id === 2);
  const tools = ((listed?.result as { tools?: unknown[] })?.tools ?? []) as Array<
    Record<string, unknown>
  >;
  check(tools.length === allTools.length, "tools/list bate com o registry", `${tools.length} tools`);
  check(
    tools.every((tool) => (tool.inputSchema as { type?: string })?.type === "object"),
    "todo inputSchema é um objeto JSON Schema",
  );
  check(
    tools.every((tool) => String(tool.description).length > 40),
    "toda descrição é longa o bastante para guiar um modelo",
  );

  const status = responses.find((response) => response.id === 3);
  const statusText = JSON.stringify(status?.result ?? {});
  check(
    status?.result !== undefined && (status.result as { isError?: boolean }).isError !== true,
    "auth_status responde sem sessão e sem rede",
  );
  check(!/"value"\s*:/.test(statusText) && !/"cookies"\s*:/.test(statusText), "auth_status não vaza cookie");

  for (const [id, label] of [
    [4, "tool desconhecida vira isError"],
    [5, "raw_get recusa uma superfície de escrita"],
    [6, "raw_get recusa caminho fora da allowlist"],
    [7, "raw_get recusa `..` no caminho"],
    [8, "argumento inválido vira isError"],
  ] as const) {
    const response = responses.find((item) => item.id === id);
    check((response?.result as { isError?: boolean })?.isError === true, label);
  }

  check(responses.find((response) => response.id === 9) !== undefined, "o servidor segue vivo após os erros");

  console.error("\nmodo somente leitura");
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
    "registra exatamente o subconjunto readOnly",
    `${names.length} de ${allTools.length}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.error(failures === 0 ? "\ntudo certo" : `\n${failures} verificação(ões) falharam`);
process.exitCode = failures === 0 ? 0 : 1;
