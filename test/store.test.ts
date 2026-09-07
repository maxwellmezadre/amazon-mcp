import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionError } from "../src/core/errors.js";
import type { Cookie } from "../src/session/jar.js";
import {
  type SessionData,
  createMemorySessionStore,
  createSessionStore,
  decrypt,
  encrypt,
  resolveKey,
} from "../src/session/store.js";

const root = mkdtempSync(join(tmpdir(), "amz-store-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
function paths() {
  const configDir = join(root, `case-${counter++}`);
  return {
    configDir,
    sessionPath: join(configDir, "session.enc"),
    keyPath: join(configDir, "session.key"),
    sessionKey: undefined,
  };
}

const cookies: Cookie[] = [
  {
    name: "at-main",
    value: "super-secret-value",
    domain: ".amazon.com.br",
    path: "/",
    expires: 2_000_000_000,
    httpOnly: true,
    secure: true,
  },
];

const data = (): SessionData => ({
  version: 1,
  cookies,
  userAgent: "Mozilla/5.0 (test)",
  savedAt: 1_757_000_000_000,
});

describe("encrypt/decrypt", () => {
  test("round trips", () => {
    const key = randomBytes(32);
    expect(decrypt(key, encrypt(key, Buffer.from("hello"))).toString()).toBe("hello");
  });

  test("a wrong key fails with SessionError and leaks nothing", () => {
    const blob = encrypt(randomBytes(32), Buffer.from("super-secret-value"));
    let message = "";
    try {
      decrypt(randomBytes(32), blob);
    } catch (error) {
      message = (error as Error).message;
      expect(error).toBeInstanceOf(SessionError);
    }
    expect(message).toContain("AMAZON_SESSION_KEY");
    expect(message).not.toContain("super-secret-value");
  });

  test("rejects a truncated or foreign blob", () => {
    expect(() => decrypt(randomBytes(32), Buffer.from([1, 2, 3]))).toThrow(SessionError);
    const foreign = encrypt(randomBytes(32), Buffer.from("x"));
    foreign[0] = 9;
    expect(() => decrypt(randomBytes(32), foreign)).toThrow(/formato desconhecido/);
  });
});

describe("createSessionStore", () => {
  test("returns null before the first login", () => {
    expect(createSessionStore(paths()).load()).toBeNull();
  });

  test("saves and loads, with 0600 on the session and the key", () => {
    const config = paths();
    const store = createSessionStore(config);
    store.save(data());
    expect(store.load()).toEqual(data());
    expect(statSync(config.sessionPath).mode & 0o777).toBe(0o600);
    expect(statSync(config.keyPath).mode & 0o777).toBe(0o600);
    expect(statSync(config.configDir).mode & 0o777).toBe(0o700);
  });

  test("leaves no .tmp behind (write-then-rename)", () => {
    const config = paths();
    const store = createSessionStore(config);
    store.save(data());
    store.save(data());
    expect(readdirSync(config.configDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("an env key wins over the key file and no key file is created", () => {
    const config = { ...paths(), sessionKey: randomBytes(32).toString("base64") };
    const store = createSessionStore(config);
    store.save(data());
    expect(store.load()?.userAgent).toBe("Mozilla/5.0 (test)");
    expect(existsSync(config.keyPath)).toBe(false);
  });

  test("a session written with another key fails instead of returning garbage", () => {
    const config = { ...paths(), sessionKey: randomBytes(32).toString("base64") };
    createSessionStore(config).save(data());
    const other = createSessionStore({ ...config, sessionKey: randomBytes(32).toString("base64") });
    expect(() => other.load()).toThrow(SessionError);
  });

  test("rejects a malformed key file", () => {
    const config = paths();
    createSessionStore(config).save(data());
    writeFileSync(config.keyPath, "not-base64-32-bytes\n");
    expect(() => createSessionStore(config).load()).toThrow(/base64 de 32 bytes/);
  });

  test("rejects a payload that does not match the schema", () => {
    const config = paths();
    const store = createSessionStore(config);
    store.save(data());
    const key = resolveKey(config, false) as Buffer;
    writeFileSync(config.sessionPath, encrypt(key, Buffer.from(JSON.stringify({ version: 2 }))));
    expect(() => createSessionStore(config).load()).toThrow(/versão não suportada/);
  });

  test("mtime moves on save and clear removes only the session", () => {
    const config = paths();
    const store = createSessionStore(config);
    expect(store.mtimeMs()).toBeNull();
    store.save(data());
    expect(store.mtimeMs()).toBeNumber();
    store.clear();
    expect(store.mtimeMs()).toBeNull();
    expect(existsSync(config.keyPath)).toBe(true);
  });

  test("peekSecrets exposes the cookie values so the logger can redact them", () => {
    const config = paths();
    const store = createSessionStore(config);
    expect(store.peekSecrets()).toEqual([]);
    store.save(data());
    expect(store.peekSecrets()).toEqual(["super-secret-value"]);
  });
});

describe("createMemorySessionStore", () => {
  test("same contract, mtime bumps per save", () => {
    const store = createMemorySessionStore();
    expect(store.load()).toBeNull();
    expect(store.mtimeMs()).toBeNull();
    store.save(data());
    const first = store.mtimeMs();
    store.save(data());
    expect(store.mtimeMs()).toBeGreaterThan(first as number);
    expect(store.peekSecrets()).toEqual(["super-secret-value"]);
  });
});
