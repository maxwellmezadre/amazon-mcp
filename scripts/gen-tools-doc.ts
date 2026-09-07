#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { allTools } from "../src/tools/registry.js";

// Renders docs/TOOLS.md from the registry, so the reference cannot drift from
// the schemas the server actually advertises.

type Schema = {
  type?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  anyOf?: Schema[];
  const?: unknown;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
};

function typeOf(schema: Schema): string {
  if (schema.anyOf) {
    const consts = schema.anyOf.map((option) => option.const).filter((value) => value !== undefined);
    if (consts.length === schema.anyOf.length) {
      return consts.map((value) => `\`${String(value)}\``).join(" \\| ");
    }
    return schema.anyOf.map(typeOf).join(" \\| ");
  }
  return schema.type ?? "any";
}

function boundsOf(schema: Schema): string {
  const parts: string[] = [];
  if (schema.minimum !== undefined) parts.push(`≥ ${schema.minimum}`);
  if (schema.maximum !== undefined) parts.push(`≤ ${schema.maximum}`);
  if (schema.minLength !== undefined) parts.push(`mín. ${schema.minLength} chars`);
  if (schema.pattern !== undefined) parts.push(`\`${schema.pattern}\``);
  return parts.join(", ");
}

const lines: string[] = [
  "# Tools",
  "",
  "> Gerado por `bun run docs:tools` a partir de `src/tools/registry.ts`. Não edite à mão.",
  "",
  "| Tool | Escreve? | Para quê |",
  "|---|---|---|",
];

for (const tool of allTools) {
  const summary = tool.description.split(". ")[0] ?? tool.description;
  lines.push(`| \`${tool.name}\` | ${tool.readOnly ? "não" : "sim"} | ${summary}. |`);
}

lines.push(
  "",
  "Tools marcadas com **Escreve? sim** gravam no cache local ou em disco — nunca na sua conta da Amazon.",
  "Com `AMAZON_READ_ONLY=1` elas nem são registradas.",
  "",
);

for (const tool of allTools) {
  const schema = JSON.parse(JSON.stringify(tool.input)) as Schema;
  const required = new Set(schema.required ?? []);
  lines.push(`## \`${tool.name}\``, "", tool.description, "");
  const properties = Object.entries(schema.properties ?? {});
  if (properties.length === 0) {
    lines.push("Sem parâmetros.", "");
    continue;
  }
  lines.push("| Parâmetro | Tipo | Obrigatório | Descrição |", "|---|---|---|---|");
  for (const [name, property] of properties) {
    const bounds = boundsOf(property);
    lines.push(
      `| \`${name}\` | ${typeOf(property)} | ${required.has(name) ? "sim" : "não"} | ` +
        `${property.description ?? ""}${bounds ? ` (${bounds})` : ""} |`,
    );
  }
  lines.push("");
}

const target = join(process.cwd(), "docs", "TOOLS.md");
writeFileSync(target, `${lines.join("\n")}\n`);
console.error(`docs/TOOLS.md gerado com ${allTools.length} tools.`);
