import { Command } from "commander";
import { loadConfig } from "../config.js";
import { type Ctx, createContext } from "../context.js";
import type { ToolDef } from "../tools/define.js";
import { compactObject, runTool } from "../tools/define.js";
import { activeTools, allTools } from "../tools/registry.js";

// The CLI is a thin argv → tool-args mapper. Every command goes through the
// same `runTool` the MCP server uses, and both resolve from the same registry,
// so the two surfaces cannot drift.

function resolveTool(readOnly: boolean, name: string): ToolDef {
  const tool = activeTools({ readOnly }).find((candidate) => candidate.name === name);
  if (tool) return tool;
  const exists = allTools.some((candidate) => candidate.name === name);
  throw new Error(
    exists
      ? `Comando indisponível em modo somente leitura: ${name}`
      : `Tool não encontrada: ${name}`,
  );
}

const value = (input: unknown): string =>
  input === null || input === undefined
    ? ""
    : typeof input === "object"
      ? JSON.stringify(input)
      : String(input);

export function formatHuman(result: unknown): string {
  if (result === null || typeof result !== "object") return String(result);
  if (Array.isArray(result)) return result.map(value).join("\n");
  return Object.entries(result)
    .map(([key, item]) => `${key}: ${value(item)}`)
    .join("\n");
}

/** Fixed-width table, no dependency. Columns are [header, accessor]. */
export function printTable<T>(rows: T[], columns: Array<[string, (row: T) => string]>): string {
  if (rows.length === 0) return "(nenhum resultado)";
  const header = columns.map(([name]) => name);
  const body = rows.map((row) => columns.map(([, get]) => get(row)));
  const widths = header.map((name, index) =>
    Math.max(name.length, ...body.map((cells) => (cells[index] ?? "").length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(header), line(widths.map((width) => "-".repeat(width))), ...body.map(line)].join(
    "\n",
  );
}

export const brl = (money: { amount: number; currency: string } | null | undefined): string =>
  money ? `${money.currency} ${money.amount.toFixed(2)}` : "-";

type InvokeOptions = { json: boolean; format?: (result: unknown) => string };

async function withContext<T>(fn: (ctx: Ctx) => Promise<T> | T): Promise<T> {
  const ctx = createContext(loadConfig());
  try {
    return await fn(ctx);
  } finally {
    await ctx.dispose();
  }
}

async function write(text: string): Promise<void> {
  // Await the write: a large result piped to a slow reader is truncated when
  // the process exits before stdout drains.
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${text}\n`, (error) => (error ? reject(error) : resolve()));
  });
}

async function invoke(
  toolName: string,
  args: Record<string, unknown>,
  options: InvokeOptions,
): Promise<void> {
  try {
    await withContext(async (ctx) => {
      const tool = resolveTool(ctx.config.readOnly, toolName);
      const result = await runTool(tool, compactObject(args), ctx);
      await write(
        options.json ? JSON.stringify(result, null, 2) : (options.format ?? formatHuman)(result),
      );
    });
  } catch (error) {
    // stdout stays the result channel; diagnostics go to stderr.
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

export async function runCli(argv: string[], version: string): Promise<void> {
  const program = new Command();
  program
    .name("amazon")
    .description("Histórico de compras da Amazon.com.br: CLI + servidor MCP")
    .version(version);

  /** Every command gets --json, so scripting never depends on the table layout. */
  const command = (signature: string) =>
    program.command(signature).option("--json", "saída em JSON puro");

  command("status")
    .description("Mostra o estado da sessão salva (sem rede por padrão)")
    .option("--verify", "abre 1 página para confirmar que a Amazon aceita a sessão")
    .action((options) =>
      invoke("auth_status", { verify: options.verify }, { json: Boolean(options.json) }),
    );

  command("raw <path>")
    .description("Abre uma página de pedidos e devolve o HTML já descriptografado")
    .option("--ready <selector>", "seletor CSS que prova que a página terminou de carregar")
    .option("--max-bytes <n>", "corta o HTML neste tamanho", Number)
    .action((path, options) =>
      invoke(
        "raw_get",
        { path, ready_selector: options.ready, max_bytes: options.maxBytes },
        { json: Boolean(options.json) },
      ),
    );

  program
    .command("mcp")
    .description("Inicia o servidor MCP no stdio")
    .action(async () => {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer(createContext(loadConfig()), version);
    });

  await program.parseAsync(argv);
}
