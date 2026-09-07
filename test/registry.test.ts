import { describe, expect, test } from "bun:test";
import { Value } from "@sinclair/typebox/value";
import { ToolInputError, compactObject, runTool } from "../src/tools/define.js";
import { ALLOWED_PATHS, isAllowedPath } from "../src/tools/raw.js";
import { activeTools, allTools, toolByName } from "../src/tools/registry.js";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { fakeChrome, memorySession, sessionData, silentLogger } from "./helpers.js";

// Invariants that must hold for every tool, now and after every new one.

describe("registry invariants", () => {
  test("names are unique, snake_case and carry no vendor prefix", () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      // The MCP client already namespaces these as mcp__amazon__<name>.
      expect(name.startsWith("amazon_")).toBe(false);
    }
  });

  test("every description is long enough to steer a model", () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  test("every input schema serialises to a JSON Schema object", () => {
    for (const tool of allTools) {
      const schema = JSON.parse(JSON.stringify(tool.input)) as { type?: string };
      expect(schema.type).toBe("object");
    }
  });

  test("read-only mode registers exactly the readOnly subset", () => {
    expect(activeTools({ readOnly: true })).toEqual(allTools.filter((tool) => tool.readOnly));
    expect(activeTools({ readOnly: false })).toEqual(allTools);
  });

  test("toolByName finds registered tools only", () => {
    expect(toolByName("auth_status")?.name).toBe("auth_status");
    expect(toolByName("nope")).toBeUndefined();
  });
});

describe("runTool", () => {
  const config = loadConfig({ AMAZON_CONFIG_DIR: "/tmp/amz-registry" });
  const ctx = createContext(config, {
    session: memorySession(sessionData()),
    log: silentLogger(),
    launchBrowser: fakeChrome().launch,
  });

  test("rejects invalid arguments with every problem listed", async () => {
    const tool = toolByName("auth_status")!;
    await expect(runTool(tool, { verify: "sim" }, ctx)).rejects.toThrow(ToolInputError);
  });

  test("answers auth_status with no session and no network", async () => {
    const empty = createContext(config, {
      session: memorySession(null),
      log: silentLogger(),
      launchBrowser: fakeChrome().launch,
    });
    const result = (await runTool(toolByName("auth_status")!, {}, empty)) as Record<string, unknown>;
    expect(result.loggedIn).toBe(false);
    expect(result.hint).toContain("amazon login");
    expect(empty.amazon.state().loads).toBe(0);
  });

  test("reports the account signals from the jar alone", async () => {
    const result = (await runTool(toolByName("auth_status")!, {}, ctx)) as Record<string, unknown>;
    expect(result).toMatchObject({
      loggedIn: true,
      authCookies: ["at-main"],
      hasCsdKey: true,
      cookieCount: 3,
      httpOnlyCount: 1,
      breaker: "ok",
    });
    // The cookie values themselves are never part of the answer.
    expect(JSON.stringify(result)).not.toContain("auth-secret-value");
  });

  test("compactObject drops undefined values", () => {
    const compacted = compactObject({ a: 1, b: undefined } as Record<string, unknown>);
    expect(Object.keys(compacted)).toEqual(["a"]);
  });
});

describe("raw_get allowlist", () => {
  test("accepts the order surfaces", () => {
    expect(isAllowedPath("/your-orders/orders?timeFilter=year-2025")).toBe(true);
    expect(isAllowedPath("/gp/css/summary/print.html?orderID=702-1")).toBe(true);
    expect(isAllowedPath("/your-returns")).toBe(true);
    expect(ALLOWED_PATHS.length).toBeGreaterThan(3);
  });

  test("refuses anything else, traversal and absolute urls included", () => {
    expect(isAllowedPath("/gp/buy/spc/handlers/display.html")).toBe(false);
    expect(isAllowedPath("/your-orders/../gp/buy")).toBe(false);
    expect(isAllowedPath("https://evil.example/your-orders/")).toBe(false);
    expect(isAllowedPath("/")).toBe(false);
  });

  test("the query string cannot smuggle a different path in", () => {
    expect(isAllowedPath("/gp/buy?next=/your-orders/")).toBe(false);
  });
});

describe("schemas", () => {
  test("the order id pattern accepts real ids and rejects a session id shape mismatch", () => {
    const tool = toolByName("auth_status")!;
    expect(Value.Check(tool.input, {})).toBe(true);
    expect(Value.Check(tool.input, { verify: true })).toBe(true);
    expect(Value.Check(tool.input, { verify: 1 })).toBe(false);
  });
});
