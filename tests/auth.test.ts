import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuth } from "../src/commands/auth";
import { Store } from "../src/core/store";
import type { Credential, LoginOptions, Provider } from "../src/providers/types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toguru-auth-"));
  process.env.TOGURU_HOME = dir;
});

afterEach(async () => {
  delete process.env.TOGURU_HOME;
  await rm(dir, { recursive: true, force: true });
});

/** A provider stub that records login calls instead of doing real OAuth. */
function fakeProvider(config: {
  credential: Credential;
  label?: string;
  onLogin?: (options?: LoginOptions) => void;
}): Provider {
  return {
    id: "codex",
    displayName: "Fake",
    readActive: async () => config.credential,
    writeActive: async () => {},
    describe: () => ({}),
    suggestLabel: async () => config.label,
    login: async (options) => config.onLogin?.(options),
  };
}

describe("runAuth", () => {
  test("logs in and saves a brand-new profile as active", async () => {
    const provider = fakeProvider({ credential: { token: "fresh" }, label: "me@x.com" });
    await runAuth(provider, "work");

    const store = await Store.load();
    expect(store.get("codex", "work")?.credential).toEqual({ token: "fresh" });
    expect(store.get("codex", "work")?.label).toBe("me@x.com");
    expect(store.active("codex")).toBe("work");
  });

  test("re-authenticates an existing profile in place and pre-fills its email", async () => {
    const seed = await Store.load();
    await seed.upsert("codex", "work", { token: "stale" }, "me@x.com");
    // Make a different profile active to prove re-auth re-activates "work".
    await seed.upsert("codex", "other", { token: "x" });
    await seed.setActive("codex", "other");

    let loginEmail: string | undefined;
    const provider = fakeProvider({
      credential: { token: "renewed" },
      label: "me@x.com",
      onLogin: (options) => {
        loginEmail = options?.email;
      },
    });

    await runAuth(provider, "work");

    // The stale profile's email was offered to the login page.
    expect(loginEmail).toBe("me@x.com");

    const store = await Store.load();
    expect(store.get("codex", "work")?.credential).toEqual({ token: "renewed" });
    expect(store.active("codex")).toBe("work");
    // No duplicate profile was created.
    expect(store.list("codex")).toHaveLength(2);
  });

  test("rejects providers without a login flow", async () => {
    const provider = fakeProvider({ credential: { token: "x" } });
    delete (provider as { login?: unknown }).login;

    let failed = false;
    try {
      await runAuth(provider, "work");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
