/**
 * End-to-end scenarios for account homes (`tg home` / `tg run` / `tg env`) and
 * user-declared providers, against the fake CLIs in a throwaway sandbox.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type CodexAuth, cleanupSandboxes, isMac, KEYCHAIN_ACCOUNT, type RunResult, Sandbox, tokenPair } from "./harness";

// Each `tg` run is a process spawn; per file because the harness module loads once.
setDefaultTimeout(30_000);
afterEach(cleanupSandboxes);

function ok(r: RunResult): RunResult {
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

async function saveCodex(sb: Sandbox, email: string): Promise<void> {
  sb.fakeLogin("codex", email);
  ok(await sb.run(["add", "codex", email]));
}

function homeAuth(dir: string): CodexAuth {
  return JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8")) as CodexAuth;
}

describe("account homes", () => {
  test("moving a profile into a home hands its login to the home, and tg follows it there", async () => {
    const sb = new Sandbox();
    fs.mkdirSync(sb.p(".codex"), { recursive: true });
    fs.writeFileSync(sb.p(".codex", "config.toml"), 'model = "gpt-5"\n');
    await saveCodex(sb, "a@x.com");
    await saveCodex(sb, "b@x.com"); // b is live; a is idle and may move
    const aTokens = sb.savedTokens("codex", "a@x.com");

    ok(await sb.run(["home", "codex", "a@x.com"]));
    const home = sb.account("codex", "a@x.com")?.home;
    expect(home).toBeString();
    expect(tokenPair("codex", homeAuth(home!))).toEqual(aTokens!);
    // Settings are shared with the default config dir, not copied.
    expect(fs.readlinkSync(path.join(home!, "config.toml"))).toBe(sb.p(".codex", "config.toml"));
    // The default slot is untouched.
    expect(sb.liveEmail("codex")).toBe("b@x.com");

    // A home profile isn't switched into the default slot.
    const refused = await sb.run(["switch", "codex", "a@x.com"]);
    expect(refused.code).toBe(1);
    expect(sb.liveEmail("codex")).toBe("b@x.com");

    // `tg run` starts the CLI pointed at the home and passes its exit code through.
    const ran = await sb.run(["run", "codex", "a@x.com", "print-home", "3"]);
    expect(ran.code).toBe(3);
    expect(ran.stdout.trim()).toBe(home!);

    // `tg env` prints the same pointer for eval.
    const env = ok(await sb.run(["env", "codex", "a@x.com", "--shell", "posix"]));
    expect(env.stdout.trim()).toBe(`export CODEX_HOME='${home}'`);

    // The CLI refreshes inside the home; tg mirrors it on the next look.
    const auth = homeAuth(home!);
    auth.tokens = { ...auth.tokens, refresh_token: "rt_rotated_in_home" };
    fs.writeFileSync(path.join(home!, "auth.json"), JSON.stringify(auth));
    ok(await sb.run(["sync", "codex"]));
    expect(sb.savedTokens("codex", "a@x.com")?.refresh).toBe("rt_rotated_in_home");

    // Leaving the home captures first, then deletes the home: one copy remains.
    ok(await sb.run(["home", "codex", "a@x.com", "--leave"]));
    expect(sb.account("codex", "a@x.com")?.home).toBeUndefined();
    expect(sb.savedTokens("codex", "a@x.com")?.refresh).toBe("rt_rotated_in_home");
    expect(fs.existsSync(home!)).toBe(false);
  });

  test("the live profile can't move into a home (two copies of one login)", async () => {
    const sb = new Sandbox();
    await saveCodex(sb, "a@x.com");
    const r = await sb.run(["home", "codex", "a@x.com"]);
    expect(r.code).toBe(1);
    expect(sb.account("codex", "a@x.com")?.home).toBeUndefined();
  });

  test("auth --home logs in inside a fresh home, leaving the default slot alone", async () => {
    const sb = new Sandbox();
    await saveCodex(sb, "a@x.com");
    const liveBefore = sb.liveTokens("codex");

    ok(await sb.run(["codex", "auth", "side", "--home"], { env: { FAKE_LOGIN_AS: "side@x.com" } }));
    const home = sb.account("codex", "side")?.home;
    expect(home).toBeString();
    expect(tokenPair("codex", homeAuth(home!))).toEqual(sb.savedTokens("codex", "side")!);
    expect(sb.liveTokens("codex")).toEqual(liveBefore!);
    expect(sb.active("codex")).toBe("a@x.com");
  });

  test("a Claude home gets its own keychain item / credentials file and identity", async () => {
    const sb = new Sandbox();
    sb.fakeLogin("claude", "main@x.com");
    ok(await sb.run(["add", "claude", "main@x.com"]));
    const liveBefore = sb.liveClaudePayload();

    ok(await sb.run(["claude", "auth", "work", "--home"], { env: { FAKE_LOGIN_AS: "work@x.com" } }));
    const home = sb.account("claude", "work")?.home;
    expect(home).toBeString();
    if (isMac) {
      const suffix = createHash("sha256").update(home!).digest("hex").slice(0, 8);
      const raw = sb.readKeychain()[`Claude Code-credentials-${suffix}|${KEYCHAIN_ACCOUNT}`];
      expect(raw).toBeString();
    } else {
      expect(fs.existsSync(path.join(home!, ".credentials.json"))).toBe(true);
    }
    const homeConfig = JSON.parse(fs.readFileSync(path.join(home!, ".claude.json"), "utf8"));
    expect(homeConfig.oauthAccount.emailAddress).toBe("work@x.com");
    expect(sb.liveClaudePayload()).toEqual(liveBefore!);
    expect(sb.liveEmail("claude")).toBe("main@x.com");

    const ran = await sb.run(["run", "claude", "work", "print-config-dir"]);
    expect(ran.stdout.trim()).toBe(home!);

    // Removing the profile takes its home (and keychain item) with it.
    ok(await sb.run(["remove", "claude", "work", "--yes"]));
    expect(fs.existsSync(home!)).toBe(false);
    if (isMac) {
      expect(Object.keys(sb.readKeychain()).filter((key) => key.includes("credentials-"))).toEqual([]);
    }
  });
});

describe("declared providers", () => {
  function declare(sb: Sandbox, definition: Record<string, unknown>, file = "fake.json"): void {
    fs.mkdirSync(path.join(sb.toguruHome, "providers"), { recursive: true });
    fs.writeFileSync(path.join(sb.toguruHome, "providers", file), JSON.stringify(definition));
  }

  function signIn(sb: Sandbox, email: string, refresh: string): void {
    fs.mkdirSync(sb.p(".fakecli"), { recursive: true });
    fs.writeFileSync(sb.p(".fakecli", "creds.json"), JSON.stringify({ email, refresh_token: refresh, expiry: Date.now() + 3_600_000 }));
    fs.writeFileSync(sb.p(".fakecli", "note.txt"), `hello ${email}`);
  }

  const definition = {
    id: "fakecli",
    name: "Fake CLI",
    aliases: ["fc"],
    dir: "~/.fakecli",
    files: ["creds.json", "note.txt"],
    fields: {
      email: { file: "creds.json", path: "email" },
      expiresAt: { file: "creds.json", path: "expiry", unit: "ms" },
      refreshToken: { file: "creds.json", path: "refresh_token" },
    },
  };

  test("a declared provider saves, lists and switches like a built-in", async () => {
    const sb = new Sandbox();
    declare(sb, definition);
    signIn(sb, "one@x.com", "r1");
    ok(await sb.run(["add", "fc", "one"]));
    signIn(sb, "two@x.com", "r2");
    ok(await sb.run(["add", "fakecli", "two"]));

    ok(await sb.run(["switch", "fakecli", "one"]));
    expect(JSON.parse(fs.readFileSync(sb.p(".fakecli", "creds.json"), "utf8")).email).toBe("one@x.com");
    expect(fs.readFileSync(sb.p(".fakecli", "note.txt"), "utf8")).toBe("hello one@x.com");

    const listed = (await sb.json(["list", "fakecli"])) as Array<{ provider: string; accounts: Array<{ name: string; email?: string; authState: string }> }>;
    expect(listed[0]?.provider).toBe("fakecli");
    expect(listed[0]?.accounts.map((a) => [a.name, a.email, a.authState])).toEqual([
      ["one", "one@x.com", "valid"],
      ["two", "two@x.com", "valid"],
    ]);
  });

  test("a broken definition is reported and skipped; built-ins keep working", async () => {
    const sb = new Sandbox();
    declare(sb, { ...definition, id: "gpt" }, "clash.json");
    declare(sb, definition);
    const providers = (await sb.json(["providers"])) as { providers: Array<{ id: string }>; problems: string[] };
    expect(providers.providers.map((p) => p.id)).toEqual(["claude", "codex", "fakecli"]);
    expect(providers.problems.join("\n")).toContain("clash.json");
    ok(await sb.run(["list", "codex", "--json"]));
  });

  test("tg providers init writes a starter definition that loads", async () => {
    const sb = new Sandbox();
    ok(await sb.run(["providers", "init", "gemini"]));
    const providers = (await sb.json(["providers"])) as { providers: Array<{ id: string }>; problems: string[] };
    expect(providers.providers.map((p) => p.id)).toContain("gemini");
    expect(providers.problems).toEqual([]);
  });
});
