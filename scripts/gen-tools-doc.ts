#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// docs/TOOLS.md is generated from the registry so the reference can never drift
// from the schemas the server advertises. Run it whenever a tool changes:
// `bun run docs:tools`.

type Schema = {
  type?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  pattern?: string;
};

function typeOf(schema: Schema): string {
  if (schema.anyOf) {
    const literals = schema.anyOf.filter((option) => option.const !== undefined);
    if (literals.length === schema.anyOf.length) {
      return literals.map((option) => `\`${String(option.const)}\``).join(" \\| ");
    }
    return schema.anyOf.map(typeOf).join(" \\| ");
  }
  const bounds: string[] = [];
  if (schema.minimum !== undefined) bounds.push(`≥ ${schema.minimum}`);
  if (schema.maximum !== undefined) bounds.push(`≤ ${schema.maximum}`);
  if (schema.minLength !== undefined) bounds.push(`min ${schema.minLength} chars`);
  if (schema.pattern) bounds.push(`\`${schema.pattern}\``);
  return `${schema.type ?? "any"}${bounds.length > 0 ? ` (${bounds.join(", ")})` : ""}`;
}

const escape = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function render(): string {
  const writers = allTools.filter((tool) => !tool.readOnly).length;
  const lines: string[] = [
    "# Tools",
    "",
    "> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.",
    "",
    `O servidor expõe ${allTools.length} tools. Com \`AMAZON_READ_ONLY=1\` as ${writers} que ` +
      "escrevem algo (sessão, cache, arquivo) não são registradas. Nenhuma tool escreve na conta " +
      "da Amazon.",
    "",
    "| Tool | Escreve | O que faz |",
    "| --- | --- | --- |",
  ];
  for (const tool of allTools) {
    const summary = tool.description.split(". ")[0] ?? tool.description;
    lines.push(
      `| [\`${tool.name}\`](#${tool.name}) | ${tool.readOnly ? "não" : "sim"} | ${escape(summary)}. |`,
    );
  }

  for (const tool of allTools) {
    const schema = JSON.parse(JSON.stringify(tool.input)) as Schema;
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    lines.push("", `## \`${tool.name}\``, "", tool.description, "");
    lines.push(`Escreve em disco ou no cache: ${tool.readOnly ? "não" : "sim"}.`, "");
    if (Object.keys(properties).length === 0) {
      lines.push("Sem parâmetros.");
      continue;
    }
    lines.push("| Parâmetro | Tipo | Obrigatório | Descrição |", "| --- | --- | --- | --- |");
    for (const [name, property] of Object.entries(properties)) {
      lines.push(
        `| \`${name}\` | ${typeOf(property)} | ${required.has(name) ? "sim" : "não"} | ${escape(property.description ?? "")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

const target = join(import.meta.dir, "..", "docs", "TOOLS.md");
writeFileSync(target, render());
console.error(`docs/TOOLS.md gerado (${allTools.length} tools).`);
