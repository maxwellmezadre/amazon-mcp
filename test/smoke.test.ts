import { expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };

// Harness sanity: the package stays ESM and the version stays semver, so the
// static import in bin.ts keeps working inside the compiled binary.
test("package is esm with a semver version", () => {
  expect(pkg.type).toBe("module");
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test("both binaries are declared", () => {
  expect(Object.keys(pkg.bin).sort()).toEqual(["amazon", "amazon-mcp"]);
});

// The browser is mandatory on every read (the order cards are encrypted in the
// HTML and only the page's own JavaScript decrypts them), so playwright-core is
// a plain dependency here, unlike in the sibling projects.
test("playwright-core is a required dependency, not optional", () => {
  expect(pkg.dependencies["playwright-core"]).toBeString();
  expect(pkg).not.toHaveProperty("optionalDependencies");
});
