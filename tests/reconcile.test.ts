import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcile } from "../src/core/reconcile";
import { Store } from "../src/core/store";
import type { Credential, Provider } from "../src/providers/types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toguru-reconcile-"));
  process.env.TOGURU_HOME = dir;
});

afterEach(async () => {
  delete process.env.TOGURU_HOME;
  await rm(dir, { recursive: true, force: true });
});

/** Provider stub whose "live" credential is whatever we hand it; identity = `who`. */
function fakeProvider(live: Credential | null): Provider {
  return {
    id: "codex",
    displayName: "Fake",
    aliases: [],
    readActive: async () => live,
    writeActive: async () => {},
    describe: (c) => ({ identity: typeof c.who === "string" ? c.who : undefined }),
  };
}

describe("reconcile", () => {
  test("captures a refreshed token into the matching profile without touching others", async () => {
    const store = await Store.load();
    await store.upsert("codex", "a", { who: "A", token: "old" }, { activate: true });
    await store.upsert("codex", "b", { who: "B", token: "b1" });

    const result = await reconcile(fakeProvider({ who: "A", token: "new" }), store);

    expect(result).toEqual({ kind: "saved", name: "a", captured: true, adopted: false });
    const reloaded = await Store.load();
    expect(reloaded.get("codex", "a")?.credential).toEqual({ who: "A", token: "new" });
    expect(reloaded.get("codex", "b")?.credential).toEqual({ who: "B", token: "b1" });
  });

  test("prefers the active profile when the same login is saved twice", async () => {
    const store = await Store.load();
    await store.upsert("codex", "first", { who: "A", token: "x" });
    await store.upsert("codex", "second", { who: "A", token: "x" }, { activate: true });

    const result = await reconcile(fakeProvider({ who: "A", token: "y" }), store);

    expect(result).toMatchObject({ kind: "saved", name: "second" });
    expect((await Store.load()).get("codex", "first")?.credential).toEqual({ who: "A", token: "x" });
  });

  test("a legacy active snapshot without identity is assumed live and captured", async () => {
    const store = await Store.load();
    await store.upsert("codex", "legacy", { token: "old" }, { activate: true });

    const result = await reconcile(fakeProvider({ who: "A", token: "new" }), store);

    expect(result).toMatchObject({ kind: "saved", name: "legacy", captured: true });
  });

  test("nobody logged in leaves the active marker alone", async () => {
    const store = await Store.load();
    await store.upsert("codex", "a", { who: "A" }, { activate: true });

    expect(await reconcile(fakeProvider(null), store)).toEqual({ kind: "logged-out" });
    expect((await Store.load()).active("codex")).toBe("a");
  });
});
