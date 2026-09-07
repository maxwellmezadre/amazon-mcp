import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";

// loadConfig takes `env` as a parameter so tests never touch process.env.
const base = { AMAZON_CONFIG_DIR: "/tmp/amz-test" };

describe("loadConfig defaults", () => {
  test("derives every path from the config dir", () => {
    const config = loadConfig(base);
    expect(config.configDir).toBe("/tmp/amz-test");
    expect(config.sessionPath).toBe("/tmp/amz-test/session.enc");
    expect(config.keyPath).toBe("/tmp/amz-test/session.key");
    expect(config.dbPath).toBe("/tmp/amz-test/cache.db");
    expect(config.browserProfileDir).toBe("/tmp/amz-test/browser-profile");
  });

  test("falls back to ~/.config/amazon-mcp", () => {
    const config = loadConfig({});
    expect(config.configDir).toBe(join(homedir(), ".config", "amazon-mcp"));
    expect(config.exportDir).toBe(join(homedir(), "Downloads", "amazon-export"));
  });

  test("expands a leading ~/ (MCP configs are JSON, not shell)", () => {
    const config = loadConfig({ AMAZON_CONFIG_DIR: "~/amz", AMAZON_EXPORT_DIR: "~/out" });
    expect(config.configDir).toBe(join(homedir(), "amz"));
    expect(config.exportDir).toBe(join(homedir(), "out"));
  });

  test("browses at human speed and waits for the decryption by default", () => {
    const config = loadConfig(base);
    expect(config.minIntervalMs).toBe(2000);
    expect(config.jitterMs).toBe(2000);
    expect(config.pageTimeoutMs).toBe(45_000);
    expect(config.csdTimeoutMs).toBe(20_000);
    expect(config.headless).toBe(true);
    expect(config.browserChannel).toBe("chrome");
  });

  test("keeps the Brazilian fingerprint: base url, locale and timezone", () => {
    const config = loadConfig(base);
    expect(config.baseUrl).toBe("https://www.amazon.com.br");
    expect(config.locale).toBe("pt-BR");
    expect(config.timezone).toBe("America/Sao_Paulo");
  });
});

describe("loadConfig readers", () => {
  test("accepts every boolean spelling", () => {
    for (const raw of ["1", "true", "yes", "on", "TRUE", "On"]) {
      expect(loadConfig({ ...base, AMAZON_READ_ONLY: raw }).readOnly).toBe(true);
    }
    for (const raw of ["0", "false", "no", "off"]) {
      expect(loadConfig({ ...base, AMAZON_HEADLESS: raw }).headless).toBe(false);
    }
  });

  test("strips trailing slashes from the base url", () => {
    expect(loadConfig({ ...base, AMAZON_BASE_URL: "https://amazon.example//" }).baseUrl).toBe(
      "https://amazon.example",
    );
  });

  test("treats an empty value as absent", () => {
    expect(loadConfig({ ...base, AMAZON_LOG_FILE: "   " }).logFile).toBeUndefined();
  });

  test("lowercases enums and rejects unknown ones", () => {
    expect(loadConfig({ ...base, AMAZON_IMPORT_BROWSER: "Arc" }).importBrowser).toBe("arc");
    expect(() => loadConfig({ ...base, AMAZON_BROWSER_CHANNEL: "safari" })).toThrow(ConfigError);
  });
});

describe("loadConfig failures", () => {
  test("reports every problem at once, not just the first", () => {
    let problems: string[] = [];
    try {
      loadConfig({
        ...base,
        AMAZON_READ_ONLY: "maybe",
        AMAZON_MIN_INTERVAL_MS: "-5",
        AMAZON_BASE_URL: "ftp://amazon.example",
        AMAZON_SESSION_KEY: "dG9vLXNob3J0",
      });
    } catch (error) {
      problems = (error as ConfigError).problems;
    }
    expect(problems).toHaveLength(4);
    expect(problems.join("\n")).toContain("AMAZON_READ_ONLY");
    expect(problems.join("\n")).toContain("AMAZON_MIN_INTERVAL_MS");
    expect(problems.join("\n")).toContain("AMAZON_BASE_URL");
    expect(problems.join("\n")).toContain("openssl rand -base64 32");
  });

  test("rejects a session key that is not 32 bytes", () => {
    const ok = Buffer.alloc(32, 7).toString("base64");
    expect(loadConfig({ ...base, AMAZON_SESSION_KEY: ok }).sessionKey).toBe(ok);
    expect(() =>
      loadConfig({ ...base, AMAZON_SESSION_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow(/32 bytes/);
  });
});
