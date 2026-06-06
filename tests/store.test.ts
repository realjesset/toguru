import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
  test("first added account becomes active automatically", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "a" }, "alice@x.com");
    expect(store.active("codex")).toBe("alice");
    expect(store.list("codex")).toHaveLength(1);
  });

  test("adding a second account does not change the active one", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "a" });
    await store.upsert("codex", "bob", { token: "b" });
    expect(store.active("codex")).toBe("alice");
    await store.setActive("codex", "bob");
    expect(store.active("codex")).toBe("bob");
  });

  test("removing the active account reassigns active", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "a" });
    await store.upsert("codex", "bob", { token: "b" });
    await store.setActive("codex", "alice");
    await store.remove("codex", "alice");
    expect(store.active("codex")).toBe("bob");
  });

  test("rename preserves active status and rejects collisions", async () => {
    const store = await Store.load();
    await store.upsert("claude", "old", { token: "x" });
    await store.rename("claude", "old", "new");
    expect(store.active("claude")).toBe("new");
    expect(store.get("claude", "old")).toBeUndefined();

    await store.upsert("claude", "other", { token: "y" });
    let collided = false;
    try {
      await store.rename("claude", "other", "new");
    } catch {
      collided = true;
    }
    expect(collided).toBe(true);
  });

  test("persists across reloads", async () => {
    const store = await Store.load();
    await store.upsert("codex", "alice", { token: "a" }, "alice@x.com");

    const reloaded = await Store.load();
    expect(reloaded.get("codex", "alice")?.label).toBe("alice@x.com");
    expect(reloaded.active("codex")).toBe("alice");
  });

  test("merge respects the overwrite flag", async () => {
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

    const skipped = await store.merge(incoming, false);
    expect(skipped).toBe(0);
    expect(store.get("codex", "alice")?.credential).toEqual({ token: "original" });

    const imported = await store.merge(incoming, true);
    expect(imported).toBe(1);
    expect(store.get("codex", "alice")?.credential).toEqual({ token: "updated" });
  });
});

describe("validateStoreData (A5: untrusted import hardening)", () => {
  test("accepts a well-formed export and normalizes it", () => {
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
    expect(data.providers.codex?.active).toBe("alice");
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

  test("ignores an `active` pointer to a dropped account", () => {
    const data = validateStoreData({
      version: 1,
      providers: { codex: { active: "bad", accounts: { bad: { label: "x" } } } },
    });
    expect(data.providers.codex?.active).toBeUndefined();
  });
});
