#!/usr/bin/env bun
// Static JSON import: the bundler embeds the version, so it also works in the
// compiled binary (`bun build --compile`), where there is no package.json next
// to the executable.
import pkg from "../package.json" with { type: "json" };

// Lazy import per mode keeps the cold start low: the MCP server never loads the
// CLI (commander) and vice versa. `mcp` is the fast path; everything else goes
// to the CLI.
const arg = process.argv[2];

if (arg === "--version" || arg === "-V") {
  // Scaffold shortcut: the CLI does not exist yet.
  console.log(pkg.version);
} else if (arg === "mcp") {
  console.error("amazon-mcp: servidor MCP ainda não implementado (step 006).");
  process.exitCode = 1;
} else {
  console.error("amazon: CLI ainda não implementado (step 006).");
  process.exitCode = 1;
}
