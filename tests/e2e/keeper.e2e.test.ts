/**
 * End-to-end scenarios for `tg keeper`, run against the fake
 * provider CLIs in a throwaway sandbox (see ./harness.ts).
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { cleanupSandboxes, type RunResult, Sandbox } from "./harness";

// Each `tg` run is a process spawn; per file because the harness module loads once.
setDefaultTimeout(30_000);
afterEach(cleanupSandboxes);

function ok(r: RunResult): RunResult {
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

interface KeeperStatusJson {
  running: boolean;
  pid?: number;
  lastTick?: { providers: Array<{ provider: string; result: string }> };
}

describe("tg keeper e2e", () => {
  for (const provider of ["claude", "codex"] as const) {
    test(`run --once captures a ${provider} rotation into the active profile`, async () => {
      const sb = new Sandbox();
      sb.fakeLogin(provider, "a@x.com");
      ok(await sb.run(["add", provider, "a@x.com"]));
      sb.rotateLive(provider);
      const rotated = sb.liveTokens(provider);
      expect(sb.savedTokens(provider, "a@x.com")).not.toEqual(rotated!);

      ok(await sb.run(["keeper", "run", "--once", "--no-notify"]));

      expect(sb.savedTokens(provider, "a@x.com")).toEqual(rotated!);
      expect(sb.active(provider)).toBe("a@x.com");
      const status = (await sb.json(["keeper", "status"])) as KeeperStatusJson;
      expect(status.running).toBe(false);
      expect(status.lastTick?.providers.find((entry) => entry.provider === provider)?.result).toBe("captured");
    });
  }

  test("start → status shows running → stop → not running, pid file gone", async () => {
    const sb = new Sandbox();
    const pidFile = path.join(sb.toguruHome, "keeper.pid");
    try {
      ok(await sb.run(["keeper", "start", "--interval", "30s"]));
      const running = (await sb.json(["keeper", "status"])) as KeeperStatusJson;
      expect(running.running).toBe(true);
      expect(running.pid).toBeNumber();
      expect(fs.readFileSync(pidFile, "utf8").trim()).toBe(String(running.pid));

      const again = ok(await sb.run(["keeper", "start"]));
      expect(again.stderr).toContain(String(running.pid));

      ok(await sb.run(["keeper", "stop"]));
      const stopped = (await sb.json(["keeper", "status"])) as KeeperStatusJson;
      expect(stopped.running).toBe(false);
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(() => process.kill(running.pid!, 0)).toThrow();
    } finally {
      await sb.run(["keeper", "stop"]);
    }
  });
});
