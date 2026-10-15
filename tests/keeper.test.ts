import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keeperHint, keeperStatus, parseInterval, tick } from "../src/core/keeper";
import { Store } from "../src/core/store";
import type { AccountDescriptor, Credential, Provider } from "../src/providers/types";
import { ToguruError } from "../src/utils/errors";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "toguru-keeper-"));
  process.env.TOGURU_HOME = dir;
});

afterEach(async () => {
  delete process.env.TOGURU_HOME;
  await rm(dir, { recursive: true, force: true });
});

/**
 * Provider stub: each `readActive` call returns the next credential in `reads`
 * (the last one repeats); identity = `who`, and `dead: true` can't refresh.
 */
function fakeProvider(...reads: Array<Credential | null | Error>): Provider {
  let call = 0;
  return {
    id: "codex",
    displayName: "Fake",
    aliases: [],
    readActive: async () => {
      const next = reads[Math.min(call++, reads.length - 1)] ?? null;
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
    writeActive: async () => {},
    describe: (c): AccountDescriptor => ({
      identity: typeof c.who === "string" ? c.who : undefined,
      ...(c.dead ? { canRefresh: false } : {}),
    }),
  };
}

describe("parseInterval", () => {
  test("accepts units and bare milliseconds at or above 30s", () => {
    expect(parseInterval("30s")).toBe(30_000);
    expect(parseInterval("5m")).toBe(300_000);
    expect(parseInterval("1h")).toBe(3_600_000);
    expect(parseInterval("30000")).toBe(30_000);
    expect(parseInterval("1.5m")).toBe(90_000);
  });

  test("rejects anything shorter than 30s or unparseable", () => {
    expect(() => parseInterval("29s")).toThrow(ToguruError);
    expect(() => parseInterval("29999")).toThrow(ToguruError);
    expect(() => parseInterval("soon")).toThrow(ToguruError);
    expect(() => parseInterval("")).toThrow(ToguruError);
  });
});

describe("tick", () => {
  test("skips a slot that changes between reads (a CLI is mid-login)", async () => {
    const store = await Store.load();
    await store.upsert("codex", "a", { who: "A", token: "old" }, { activate: true });

    const report = await tick({
      settleMs: 0,
      providers: [fakeProvider({ who: "A", token: "half" }, { who: "B", token: "new" })],
    });

    expect(report.providers).toEqual([
      { provider: "codex", result: "unstable", detail: expect.any(String), homesCaptured: [] },
    ]);
    expect((await Store.load()).get("codex", "a")?.credential).toEqual({ who: "A", token: "old" });
  });

  test("captures a stable rotation into the matching profile", async () => {
    const store = await Store.load();
    await store.upsert("codex", "a", { who: "A", token: "old" }, { activate: true });

    const report = await tick({ settleMs: 0, providers: [fakeProvider({ who: "A", token: "new" })] });

    expect(report.providers).toEqual([{ provider: "codex", result: "captured", detail: "a", homesCaptured: [] }]);
    expect((await Store.load()).get("codex", "a")?.credential).toEqual({ who: "A", token: "new" });
    expect(report.alerts).toEqual([]);
  });

  test("alerts for a saved profile that needs a fresh login", async () => {
    const store = await Store.load();
    await store.upsert("codex", "a", { who: "A" }, { activate: true });
    await store.upsert("codex", "gone", { who: "G", dead: true });

    const report = await tick({ settleMs: 0, providers: [fakeProvider({ who: "A" })] });

    expect(report.providers[0]?.result).toBe("in-sync");
    expect(report.alerts).toEqual([{ provider: "codex", name: "gone", state: "needs-reauth" }]);
  });

  test("reports a provider failure instead of throwing", async () => {
    const report = await tick({
      settleMs: 0,
      providers: [fakeProvider(new ToguruError("Codex keeps its login in the OS keyring."))],
    });

    expect(report.providers).toEqual([
      { provider: "codex", result: "error", detail: "Codex keeps its login in the OS keyring.", homesCaptured: [] },
    ]);
  });
});

describe("keeperHint", () => {
  test("nudges at most once a day while the keeper isn't running", async () => {
    const now = Date.parse("2026-10-15T09:00:00Z");
    expect((await keeperStatus()).running).toBe(false);
    expect(await keeperHint(now)).toContain("tg keeper start");
    expect(await keeperHint(now + 3_600_000)).toBeUndefined();
    expect(await keeperHint(now + 25 * 3_600_000)).toContain("tg keeper start");
  });
});
