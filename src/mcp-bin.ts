#!/usr/bin/env bun
// Entry for the `amazon-mcp` binary: starts the MCP server directly, without a
// subcommand — what an MCP client registers when it does not want the CLI.
import pkg from "../package.json" with { type: "json" };

console.error(`amazon-mcp ${pkg.version}: servidor MCP ainda não implementado (step 006).`);
process.exitCode = 1;
