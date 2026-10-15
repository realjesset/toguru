import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placeLogin, type Prompter } from "../src/core/placement";
import { Store } from "../src/core/store";
import type { Provider } from "../src/providers/types";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toguru-placement-"));
  process.env.TOGURU_HOME = dir;
});

afterEach(async () => {
  delete process.env.TOGURU_HOME;
  await rm(dir, { recursive: true, force: true });
});

/** Identity = `who`, email = `${who}@x.com`. */
const provider: Provider = {
  id: "codex",
  displayName: "Fake",
  aliases: [],
  readActive: async () => null,
  writeActive: async () => {},
  describe: (c) =>
    typeof c.who === "string" ? { identity: c.who, email: `${c.who.toLowerCase()}@x.com` } : {},
};

/** A scripted prompter: answers come from the arrays, in order; asks are recorded. */
function scripted(answers: { names?: string[]; confirms?: boolean[] } = {}, interactive = true) {
  const asked: string[] = [];
  const prompter: Prompter = {
    interactive,
    askName: async (message, suggested) => {
      asked.push(message);
      return answers.names?.shift() ?? suggested;
    },
    confirm: async (message, fallback) => {
      asked.push(message);
      return answers.confirms?.shift() ?? fallback;
    },
  };
  return { prompter, asked };
}

describe("placeLogin", () => {
  test("re-auth that signs in as someone else leaves the profile and places the login on its own", async () => {
    const store = await Store.load();
    await store.upsert("codex", "work", { who: "A", token: "a" }, { activate: true });
    const { prompter } = scripted();

    const placed = await placeLogin(provider, store, { who: "B", token: "b" }, { kind: "login", reauth: store.get("codex", "work") }, prompter);

    expect(placed).toMatchObject({ kind: "saved", name: "b@x.com", created: true, mismatch: { profile: "work", got: "b@x.com" } });
    expect(store.get("codex", "work")?.credential).toEqual({ who: "A", token: "a" });
    expect(store.active("codex")).toBe("b@x.com");
  });

  test("a login with unreadable identity never lands on a legacy profile", async () => {
    const store = await Store.load();
    await store.upsert("codex", "legacy", { token: "old" }, { activate: true });

    const placed = await placeLogin(provider, store, { token: "new" }, { kind: "login" }, scripted({ names: ["fresh"] }).prompter);

    expect(placed).toMatchObject({ kind: "saved", name: "fresh", created: true });
    expect(store.get("codex", "legacy")?.credential).toEqual({ token: "old" });
  });

  test("a login that's already saved updates its profile without asking", async () => {
    const store = await Store.load();
    await store.upsert("codex", "mine", { who: "A", token: "1" });
    const { prompter, asked } = scripted();

    const placed = await placeLogin(provider, store, { who: "A", token: "2" }, { kind: "login" }, prompter);

    expect(placed).toMatchObject({ kind: "saved", name: "mine", created: false });
    expect(asked).toEqual([]);
    expect(store.get("codex", "mine")?.credential).toEqual({ who: "A", token: "2" });
  });

  test("add over a different account: refused without a terminal, asked with one, forced with --force", async () => {
    const store = await Store.load();
    await store.upsert("codex", "slot", { who: "A" });

    await expect(
      placeLogin(provider, store, { who: "B" }, { kind: "add", name: "slot" }, scripted({}, false).prompter),
    ).rejects.toThrow(/different account/);

    const declined = await placeLogin(provider, store, { who: "B" }, { kind: "add", name: "slot" }, scripted({ confirms: [false] }).prompter);
    expect(declined).toEqual({ kind: "declined" });
    expect(store.get("codex", "slot")?.credential).toEqual({ who: "A" });

    await placeLogin(provider, store, { who: "B" }, { kind: "add", name: "slot", force: true }, scripted({}, false).prompter);
    expect(store.get("codex", "slot")?.credential).toEqual({ who: "B" });
  });

  test("rescue saves only when someone agrees, and never marks it active", async () => {
    const store = await Store.load();
    await store.upsert("codex", "other", { who: "Z" }, { activate: true });

    expect(await placeLogin(provider, store, { who: "C" }, { kind: "rescue" }, scripted({}, false).prompter)).toEqual({
      kind: "declined",
    });
    const placed = await placeLogin(provider, store, { who: "C" }, { kind: "rescue" }, scripted({ confirms: [true] }).prompter);

    expect(placed).toMatchObject({ kind: "saved", name: "c@x.com" });
    expect(store.active("codex")).toBe("other");
  });

  test("new names avoid every taken name, even ones held by other logins", async () => {
    const store = await Store.load();
    await store.upsert("codex", "a@x.com", { who: "OTHER" });

    const placed = await placeLogin(provider, store, { who: "A" }, { kind: "login" }, scripted({}, false).prompter);

    expect(placed).toMatchObject({ name: "a@x.com-2" });
  });
});
