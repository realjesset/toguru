import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, validateStoreData } from "../src/core/store";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toguru-store-"));
  process.env.TOGURU_HOME = dir;
});

afterEach(async () => {
  delete process.env.TOGURU_HOME;
  await rm(dir, { recursive: true, force: true });
});

describe("Store", () => {
  test("an account becomes active only when asked (active means 'live')", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "a" });
    expect(store.active("codex")).toBeUndefined();
    await store.upsert("codex", "bob", { token: "b" }, { activate: true });
    expect(store.active("codex")).toBe("bob");
  });

  test("removing the active account clears active instead of pointing at a non-live one", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "a" }, { activate: true });
    await store.upsert("codex", "bob", { token: "b" });
    await store.remove("codex", "alice");
    expect(store.active("codex")).toBeUndefined();
  });

  test("rename preserves active status and rejects collisions", async () => {
    const store = await Store.load();
    await store.upsert("claude", "old", { token: "x" }, { activate: true });
    await store.rename("claude", "old", "new");
    expect(store.active("claude")).toBe("new");
    expect(store.get("claude", "old")).toBeUndefined();

    await store.upsert("claude", "other", { token: "y" });
    await expect(store.rename("claude", "other", "new")).rejects.toThrow();
  });

  test("names that collide with Object.prototype members are ordinary accounts", async () => {
    const store = await Store.load();
    expect(store.get("codex", "toString")).toBeUndefined();
    expect(store.has("codex", "constructor")).toBe(false);
    await store.upsert("codex", "__proto__", { token: "p" });
    await store.upsert("codex", "constructor", { token: "c" });

    const reloaded = await Store.load();
    expect(reloaded.list("codex").map((a) => a.name)).toEqual(["__proto__", "constructor"]);
    expect(reloaded.get("codex", "__proto__")?.credential).toEqual({ token: "p" });
  });

  test("a mutation re-reads the file, so another process's write survives", async () => {
    const mine = await Store.load();
    const theirs = await Store.load();
    await theirs.upsert("codex", "theirs", { token: "t" });
    await mine.upsert("codex", "mine", { token: "m" });

    expect((await Store.load()).list("codex").map((a) => a.name)).toEqual(["mine", "theirs"]);
  });

  test("refuses a vault written by a newer schema instead of silently rewriting it", async () => {
    await writeFile(join(dir, "store.json"), JSON.stringify({ version: 99, providers: {} }));
    await expect(Store.load()).rejects.toThrow(/newer/);
  });

  test("merge respects the overwrite flag and never marks imports active", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "original" });

    const incoming = {
      version: 1,
      providers: {
        codex: {
          active: "alice",
          accounts: {
            alice: {
              name: "alice",
              credential: { token: "updated" },
              addedAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        },
      },
    };

    expect(await store.merge(incoming, false)).toBe(0);
    expect(store.get("codex", "alice")?.credential).toEqual({ token: "original" });

    expect(await store.merge(incoming, true)).toBe(1);
    expect(store.get("codex", "alice")?.credential).toEqual({ token: "updated" });
    expect(store.active("codex")).toBeUndefined();
  });
});

describe("validateStoreData (untrusted import hardening)", () => {
  test("accepts a well-formed export, dropping its active marker", () => {
    const data = validateStoreData({
      version: 1,
      providers: {
        codex: {
          active: "alice",
          accounts: {
            alice: { name: "alice", credential: { token: "a" }, label: "alice@x.com" },
          },
        },
      },
    });
    expect(data.providers.codex?.accounts.alice?.credential).toEqual({ token: "a" });
    expect(data.providers.codex?.active).toBeUndefined();
  });

  test("rejects non-objects and missing providers", () => {
    expect(() => validateStoreData(null)).toThrow();
    expect(() => validateStoreData("nope")).toThrow();
    expect(() => validateStoreData({ version: 1 })).toThrow();
  });

  test("rejects exports from a newer schema version", () => {
    expect(() => validateStoreData({ version: 999, providers: {} })).toThrow();
  });

  test("drops unknown providers and credential-less accounts", () => {
    const data = validateStoreData({
      version: 1,
      providers: {
        bogus: { accounts: { x: { credential: { t: 1 } } } },
        codex: {
          accounts: {
            good: { credential: { token: "a" } },
            bad: { label: "no credential here" },
          },
        },
      },
    });
    expect(Object.keys(data.providers)).toEqual(["codex"]);
    expect(data.providers.codex?.accounts.good).toBeDefined();
    expect(data.providers.codex?.accounts.bad).toBeUndefined();
  });
});
