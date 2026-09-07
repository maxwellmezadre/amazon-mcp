#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Builds the binary, puts it on PATH, registers the MCP server with Claude Code
// and installs the skill. Everything it writes is under the user's home.

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipBuild = args.has("--skip-build");
const prefix =
  [...args].find((arg) => arg.startsWith("--prefix="))?.split("=")[1] ??
  join(homedir(), ".local", "bin");
const BIN = join(prefix, "amazon");

const say = (message: string) => console.error(message);
const step = (n: number, message: string) => say(`\n[${n}/4] ${message}`);

step(1, "compilando o binário");
if (skipBuild) say("  pulado (--skip-build)");
else if (dryRun) say("  (dry run) bun run build:binary");
else {
  const proc = Bun.spawn(["bun", "run", "build:binary"], { stdio: ["ignore", "inherit", "inherit"] });
  if ((await proc.exited) !== 0) {
    say("  falhou ao compilar");
    process.exit(1);
  }
}

step(2, `instalando em ${BIN}`);
if (!dryRun) {
  mkdirSync(prefix, { recursive: true });
  copyFileSync(join(process.cwd(), "amazon"), BIN);
  chmodSync(BIN, 0o755);
}
if (!(process.env.PATH ?? "").split(":").includes(prefix)) {
  say(`  aviso: ${prefix} não está no PATH; adicione ao seu shell.`);
}

step(3, "registrando o servidor MCP no Claude Code");
const claudeConfig = join(homedir(), ".claude.json");
if (dryRun) say(`  (dry run) mcpServers.amazon em ${claudeConfig}`);
else {
  let config: Record<string, unknown> = {};
  if (existsSync(claudeConfig)) {
    try {
      config = JSON.parse(readFileSync(claudeConfig, "utf8")) as Record<string, unknown>;
    } catch {
      say("  ~/.claude.json ilegível; abortando para não sobrescrever.");
      process.exit(1);
    }
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  servers.amazon = { type: "stdio", command: BIN, args: ["mcp"], env: {} };
  config.mcpServers = servers;

  // A project-scoped entry with the same name shadows the user one, which is
  // the usual reason a fresh install looks dead.
  for (const project of Object.values((config.projects ?? {}) as Record<string, unknown>)) {
    const scoped = (project as { mcpServers?: Record<string, unknown> }).mcpServers;
    if (scoped && "amazon" in scoped) delete scoped.amazon;
  }
  writeFileSync(claudeConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  chmodSync(claudeConfig, 0o600);
}

step(4, "instalando a skill");
const skillDir = join(homedir(), ".claude", "skills", "amazon-mcp");
if (dryRun) say(`  (dry run) ${skillDir}`);
else {
  mkdirSync(skillDir, { recursive: true });
  for (const file of ["SKILL.md", join("docs", "TOOLS.md")]) {
    if (existsSync(file)) copyFileSync(file, join(skillDir, file.split("/").pop() as string));
  }
}

if (!dryRun && !skipBuild) {
  // Verified from OUTSIDE the repo, so the binary is not quietly resolving
  // source files next to it.
  const proc = Bun.spawn([BIN, "--version"], { cwd: homedir(), stdout: "pipe" });
  const version = (await new Response(proc.stdout).text()).trim();
  say(`\nbinário responde: ${version}`);
}

say("\nPronto. Agora rode:\n  amazon login\n  amazon sync --full");
