import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileActive } from "../src/core/reconcile";
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

/** Provider stub whose "live" credential is whatever we hand it. */
function fakeProvider(live: Credential | null): Provider {
  return {
    id: "codex",
    displayName: "Fake",
    readActive: async () => live,
    writeActive: async () => {},
    describe: (c) => ({
      accountId: (c as { accountId?: string }).accountId,
      email: (c as { email?: string }).email,
    }),
  };
}

describe("reconcileActive", () => {
  test("captures newer credentials for the same account", async () => {
    const store = await Store.load();
    await store.upsert("codex", "work", { accountId: "A", token: "old" });

    const result = await reconcileActive(fakeProvider({ accountId: "A", token: "new" }), store);

    expect(result).toBe("synced");
    expect((await Store.load()).get("codex", "work")?.credential).toEqual({ accountId: "A", token: "new" });
  });

  test("does nothing when live matches the stored profile", async () => {
    const store = await Store.load();
    await store.upsert("codex", "work", { accountId: "A", token: "same" });

    expect(await reconcileActive(fakeProvider({ accountId: "A", token: "same" }), store)).toBe("in-sync");
  });

  test("refuses to overwrite when the live session is a different account", async () => {
    const store = await Store.load();
    await store.upsert("codex", "work", { accountId: "A", token: "old" });

    const result = await reconcileActive(fakeProvider({ accountId: "B", token: "other" }), store);

    expect(result).toBe("drifted");
    expect((await Store.load()).get("codex", "work")?.credential).toEqual({ accountId: "A", token: "old" });
  });

  test("noop when nothing is active or nothing is live", async () => {
    const empty = await Store.load();
    expect(await reconcileActive(fakeProvider({ accountId: "A" }), empty)).toBe("noop");

    const store = await Store.load();
    await store.upsert("codex", "work", { accountId: "A" });
    expect(await reconcileActive(fakeProvider(null), store)).toBe("noop");
  });
});
