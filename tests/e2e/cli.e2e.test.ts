/**
 * End-to-end scenarios for the `tg` CLI, run against fake provider CLIs in a
 * throwaway sandbox (see ./harness.ts). Assertions target exit codes, vault /
 * live file state and `--json` output — never pretty text, which is restyled
 * freely (except the non-TTY bare `tg` listing in scenario 12).
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  type CodexAuth,
  cleanupSandboxes,
  emailOf,
  hasKeyDeep,
  type ProviderId,
  providerEntry,
  type RunResult,
  Sandbox,
  tokenPair,
} from "./harness";

// Each `tg` run is a process spawn; per file because the harness module loads once.
setDefaultTimeout(30_000);
afterEach(cleanupSandboxes);

function ok(r: RunResult): RunResult {
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
  return r;
}

/** `tg <provider> auth [name]`, with the fake CLI logging in as `email`. */
function tgAuth(sb: Sandbox, provider: ProviderId, email: string, name?: string, env: Record<string, string> = {}) {
  return sb.run([provider, "auth", ...(name ? [name] : [])], { env: { FAKE_LOGIN_AS: email, ...env } });
}

/** Setup primitive independent of `tg auth`: out-of-band login, then `tg add <provider> <email>`. */
async function saveAs(sb: Sandbox, provider: ProviderId, email: string): Promise<void> {
  sb.fakeLogin(provider, email);
  ok(await sb.run(["add", provider, email]));
}

async function listedAuthState(sb: Sandbox, provider: ProviderId, name: string): Promise<string | undefined> {
  const listed = await sb.json(["list", provider]);
  return providerEntry(listed, provider)?.accounts?.find((a) => a.name === name)?.authState;
}

describe("tg e2e", () => {
  for (const provider of ["claude", "codex"] as const) {
    test(`1. ${provider} auth (non-TTY) saves the session under its email and activates it`, async () => {
      const sb = new Sandbox();
      ok(await tgAuth(sb, provider, "a@x.com"));
      expect(sb.accountNames(provider)).toEqual(["a@x.com"]);
      expect(sb.active(provider)).toBe("a@x.com");
      expect(sb.liveTokens(provider)?.access).toBeString();
      expect(sb.savedTokens(provider, "a@x.com")).toEqual(sb.liveTokens(provider)!);
    });
  }

  test("2. rotation is captured into the active profile before a new login", async () => {
    const sb = new Sandbox();
    ok(await tgAuth(sb, "claude", "a@x.com"));
    sb.rotateLive("claude");
    const rotated = sb.liveTokens("claude");
    ok(await tgAuth(sb, "claude", "b@x.com"));
    expect(sb.savedTokens("claude", "a@x.com")).toEqual(rotated!);
    expect(sb.savedTokens("claude", "b@x.com")).toEqual(sb.liveTokens("claude")!);
    expect(sb.active("claude")).toBe("b@x.com");
  });

  test("3. switch writes tokens + identity and preserves unrelated ~/.claude.json keys", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "claude", "b@x.com");
    sb.writeClaudeConfig({ ...sb.readClaudeConfig(), theme: "dark", projects: { "/w": { allowedTools: ["x"] } } });
    const aTokens = sb.savedTokens("claude", "a@x.com");
    expect(aTokens?.access).toBeString();
    ok(await sb.run(["switch", "claude", "a@x.com"]));
    expect(sb.liveTokens("claude")).toEqual(aTokens!);
    const config = sb.readClaudeConfig();
    expect(config?.oauthAccount?.emailAddress).toBe("a@x.com");
    expect(config?.theme).toBe("dark");
    expect(config?.projects).toEqual({ "/w": { allowedTools: ["x"] } });
    expect(sb.active("claude")).toBe("a@x.com");
  });

  test("4. switch preserves live mcpOAuth; captured snapshots carry no mcpOAuth", async () => {
    const sb = new Sandbox();
    sb.writeLiveClaudePayload({ mcpOAuth: { srv: { token: "OLD" } } });
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "claude", "b@x.com");
    // Legacy snapshot: A was captured together with an (old) mcpOAuth blob.
    const vault = sb.readVault();
    const aCredentials = vault?.providers.claude?.accounts["a@x.com"]?.credential.credentials;
    if (!vault || !aCredentials) throw new Error("expected a saved claude credential for a@x.com");
    aCredentials.mcpOAuth = { srv: { token: "OLD" } };
    sb.writeVault(vault);

    const changedAt = new Date().toISOString();
    sb.writeLiveClaudePayload({ ...sb.liveClaudePayload(), mcpOAuth: { srv: { token: "NEW" } } });
    ok(await sb.run(["switch", "claude", "a@x.com"]));
    expect(sb.liveClaudePayload()?.mcpOAuth?.srv?.token).toBe("NEW");

    ok(await sb.run(["add", "claude", "snap"]));
    expect(sb.account("claude", "snap")).toBeDefined();
    const capturedAfter = Object.entries(sb.accounts("claude"))
      .filter(([name, account]) => name === "snap" || (account.updatedAt ?? "") > changedAt)
      .map(([name, account]) => ({ name, hasMcpOAuth: hasKeyDeep(account.credential, "mcpOAuth") }));
    expect(capturedAfter).toEqual(capturedAfter.map(({ name }) => ({ name, hasMcpOAuth: false })));
  });

  test("5. switching away captures the outgoing profile's rotated tokens", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "claude", "b@x.com");
    ok(await sb.run(["switch", "claude", "a@x.com"]));
    expect(sb.active("claude")).toBe("a@x.com");
    sb.rotateLive("claude");
    const rotated = sb.liveTokens("claude");
    ok(await sb.run(["switch", "claude", "b@x.com"]));
    expect(sb.savedTokens("claude", "a@x.com")).toEqual(rotated!);
    expect(sb.liveEmail("claude")).toBe("b@x.com");
  });

  test("6. sync adopts an out-of-band login of a saved account; unsaved live clears active", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "claude", "b@x.com");
    ok(await sb.run(["switch", "claude", "a@x.com"]));
    const aBefore = sb.account("claude", "a@x.com");

    sb.fakeLogin("claude", "b@x.com");
    sb.rotateLive("claude");
    ok(await sb.run(["sync"]));
    expect(sb.savedTokens("claude", "b@x.com")).toEqual(sb.liveTokens("claude")!);
    expect(sb.active("claude")).toBe("b@x.com");
    expect(sb.account("claude", "a@x.com")).toEqual(aBefore!);

    const accountsBefore = sb.accounts("claude");
    sb.fakeLogin("claude", "c@x.com");
    ok(await sb.run(["sync"]));
    expect(sb.accounts("claude")).toEqual(accountsBefore);
    expect(sb.active("claude")).toBeNull();

    const status = await sb.json(["status"]);
    expect(providerEntry(status, "claude")?.live).toMatchObject({ email: "c@x.com", saved: false, name: null });
  });

  test("7. removing the active profile leaves active null and the live session untouched", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "claude", "b@x.com");
    ok(await sb.run(["switch", "claude", "b@x.com"]));
    const livePayload = sb.liveClaudePayload();
    const liveConfig = sb.readClaudeConfig();
    ok(await sb.run(["remove", "claude", "b@x.com", "--yes"]));
    expect(sb.account("claude", "b@x.com")).toBeUndefined();
    expect(sb.account("claude", "a@x.com")).toBeDefined();
    expect(sb.active("claude")).toBeNull();
    expect(sb.liveClaudePayload()).toEqual(livePayload!);
    expect(sb.readClaudeConfig()).toEqual(liveConfig!);
  });

  test("8. prototype-ish profile names are ordinary names", async () => {
    const sb = new Sandbox();
    sb.fakeLogin("codex", "a@x.com");
    ok(await sb.run(["add", "codex", "constructor"]));
    ok(await sb.run(["add", "codex", "toString"]));
    const listed = await sb.json(["list", "codex"]);
    const names = providerEntry(listed, "codex")?.accounts?.map((a) => a.name);
    expect(names).toContain("constructor");
    expect(names).toContain("toString");

    const vaultBefore = fs.readFileSync(sb.vaultFile, "utf8");
    const r = await sb.run(["switch", "codex", "hasOwnProperty"]);
    expect(r.code).toBe(1);
    expect(fs.readFileSync(sb.vaultFile, "utf8")).toBe(vaultBefore);
  });

  test("9. a codex API-key session is not flagged needs-reauth", async () => {
    const sb = new Sandbox();
    sb.fakeLogin("codex", "a@x.com", { FAKE_CODEX_APIKEY: "1" });
    ok(await sb.run(["add", "codex", "key"]));
    const state = await listedAuthState(sb, "codex", "key");
    expect(state).toBeString();
    expect(state).not.toBe("needs-reauth");
  });

  test("10. claude snapshot with an expired refresh token is needs-reauth", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    const patchOauth = (patch: { expiresAt?: number; refreshTokenExpiresAt?: number }) => {
      const vault = sb.readVault();
      const oauth = vault?.providers.claude?.accounts["a@x.com"]?.credential.credentials?.claudeAiOauth;
      if (!vault || !oauth) throw new Error("expected a saved claude oauth payload for a@x.com");
      Object.assign(oauth, patch);
      sb.writeVault(vault);
    };

    patchOauth({ refreshTokenExpiresAt: Date.now() - 60_000 });
    expect(await listedAuthState(sb, "claude", "a@x.com")).toBe("needs-reauth");

    patchOauth({ expiresAt: 0, refreshTokenExpiresAt: Date.now() - 60_000 });
    expect(await listedAuthState(sb, "claude", "a@x.com")).toBe("needs-reauth");
  });

  test("11. corrupt store.json fails cleanly, naming the file, without a stack trace", async () => {
    const sb = new Sandbox();
    fs.mkdirSync(sb.toguruHome, { recursive: true });
    fs.writeFileSync(sb.vaultFile, "{not json");
    const r = await sb.run(["list"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(sb.vaultFile);
    expect(r.stderr).not.toMatch(/^\s+at /m);
  });

  test("12. non-TTY: pickers fail fast; bare tg lists accounts", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "codex", "c@x.com");

    const r = await sb.run(["switch", "claude"], { timeoutMs: 5_000 });
    expect(r.code).not.toBe(0);

    const bare = await sb.run([], { timeoutMs: 5_000 });
    expect(bare.code).toBe(0);
    expect(bare.stdout).toContain("a@x.com");
    expect(bare.stdout).toContain("c@x.com");
  });

  test("13. provider aliases resolve case-insensitively", async () => {
    const sb = new Sandbox();
    const cases: Array<[string, ProviderId]> = [
      ["anthropic", "claude"],
      ["CLAUDE", "claude"],
      ["gpt", "codex"],
      ["openai", "codex"],
    ];
    const resolved: Record<string, unknown> = {};
    for (const [alias] of cases) {
      const r = await sb.run(["list", alias, "--json"]);
      try {
        const json: unknown = JSON.parse(r.stdout);
        resolved[alias] = (["claude", "codex"] as const).filter((id) => providerEntry(json, id));
      } catch {
        resolved[alias] = `exit ${r.code}: ${r.stderr.trim()}`;
      }
    }
    expect(resolved).toEqual(Object.fromEntries(cases.map(([alias, id]) => [alias, [id]])));
  });

  test("14. symlinked ~/.claude.json and ~/.codex/auth.json stay symlinks across a switch", async () => {
    const sb = new Sandbox();
    const dotfiles = sb.p("dotfiles");
    const claudeTarget = path.join(dotfiles, "claude.json");
    const codexTarget = path.join(dotfiles, "codex-auth.json");
    fs.mkdirSync(dotfiles, { recursive: true });
    fs.mkdirSync(sb.p(".codex"), { recursive: true });
    fs.writeFileSync(claudeTarget, JSON.stringify({ theme: "dark" }));
    fs.writeFileSync(codexTarget, "{}");
    fs.symlinkSync(claudeTarget, sb.claudeConfigFile);
    fs.symlinkSync(codexTarget, sb.codexAuthFile);

    for (const provider of ["claude", "codex"] as const) {
      await saveAs(sb, provider, "a@x.com");
      await saveAs(sb, provider, "b@x.com");
      ok(await sb.run(["switch", provider, "a@x.com"]));
    }

    expect(fs.lstatSync(sb.claudeConfigFile).isSymbolicLink()).toBe(true);
    expect(fs.lstatSync(sb.codexAuthFile).isSymbolicLink()).toBe(true);
    const claudeConfig = sb.readClaudeConfig();
    expect(claudeConfig?.oauthAccount?.emailAddress).toBe("a@x.com");
    expect(claudeConfig?.theme).toBe("dark");
    const codexAuth = JSON.parse(fs.readFileSync(codexTarget, "utf8")) as CodexAuth;
    expect(emailOf("codex", codexAuth)).toBe("a@x.com");
    expect(tokenPair("codex", codexAuth)).toEqual(sb.savedTokens("codex", "a@x.com")!);
  });

  test("15. export tightens an existing file to 0600; import never marks accounts active", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    await saveAs(sb, "codex", "a@x.com");
    const out = path.join(sb.root, "out.json");
    fs.writeFileSync(out, "");
    fs.chmodSync(out, 0o644);
    ok(await sb.run(["export", "-o", out]));
    if (process.platform !== "win32") {
      expect((fs.statSync(out).mode & 0o777).toString(8)).toBe("600");
    }

    const fresh = new Sandbox();
    ok(await fresh.run(["import", out]));
    expect(fresh.accountNames("claude")).toEqual(["a@x.com"]);
    expect(fresh.accountNames("codex")).toEqual(["a@x.com"]);
    expect(fresh.active("claude")).toBeNull();
    expect(fresh.active("codex")).toBeNull();
  });

  test("16. re-auth of a named profile as a different identity never overwrites it", async () => {
    const sb = new Sandbox();
    ok(await tgAuth(sb, "claude", "a@x.com", "work"));
    const workBefore = sb.savedTokens("claude", "work");
    expect(workBefore?.access).toBeString();

    const r = await tgAuth(sb, "claude", "b@x.com", "work");
    expect(sb.lastClaudeLoginEmail()).toBe("a@x.com");
    expect(r.code).toBe(0);
    expect(sb.savedTokens("claude", "work")).toEqual(workBefore!);
    expect(emailOf("claude", sb.account("claude", "work")?.credential)).toBe("a@x.com");
    const [bName] = sb.accountByEmail("claude", "b@x.com") ?? [];
    expect(bName).toBeString();
    expect(sb.savedTokens("claude", bName!)).toEqual(sb.liveTokens("claude")!);
    expect(sb.active("claude")).toBe(bName!);
  });

  test("17. unnamed auth matching a saved identity updates that profile", async () => {
    const sb = new Sandbox();
    sb.fakeLogin("claude", "a@x.com");
    ok(await sb.run(["add", "claude", "work"]));
    ok(await tgAuth(sb, "claude", "a@x.com"));
    expect(sb.accountNames("claude")).toEqual(["work"]);
    expect(sb.savedTokens("claude", "work")).toEqual(sb.liveTokens("claude")!);
    expect(sb.active("claude")).toBe("work");
  });

  test("18. same email in two orgs yields two distinct profiles", async () => {
    const sb = new Sandbox();
    ok(await tgAuth(sb, "claude", "a@x.com", undefined, { FAKE_ORG_UUID: "org-1" }));
    ok(await tgAuth(sb, "claude", "a@x.com", undefined, { FAKE_ORG_UUID: "org-2" }));
    expect(sb.accountNames("claude")).toEqual(["a@x.com", "a@x.com-2"]);
    const orgs = ["a@x.com", "a@x.com-2"].map(
      (name) => sb.account("claude", name)?.credential.account?.organizationUuid,
    );
    expect(orgs).toEqual(["org-1", "org-2"]);
  });

  test("19. concurrent adds all land in the vault", async () => {
    const sb = new Sandbox();
    sb.fakeLogin("codex", "a@x.com");
    const names = Array.from({ length: 8 }, (_, i) => `n${i + 1}`);
    const results = await Promise.all(names.map((name) => sb.run(["add", "codex", name])));
    expect(results.map((r) => r.code)).toEqual(names.map(() => 0));
    expect(sb.accountNames("codex")).toEqual(names);
  });

  test("20. Codex on the OS keyring is refused loudly instead of swapping an ignored auth.json", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "codex", "a@x.com");
    fs.writeFileSync(sb.p(".codex", "config.toml"), 'cli_auth_credentials_store = "keyring"\n\n[mcp_servers.x]\ncommand = "x"\n');
    const liveBefore = fs.readFileSync(sb.codexAuthFile, "utf8");

    const r = await sb.run(["switch", "codex", "a@x.com"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("cli_auth_credentials_store");
    expect(fs.readFileSync(sb.codexAuthFile, "utf8")).toBe(liveBefore);

    const status = await sb.json(["status"]);
    expect(providerEntry(status, "codex")).toMatchObject({ provider: "codex", error: expect.any(String) });
    expect(providerEntry(status, "claude")).toBeDefined();
  });

  test("21. switching away from an unsaved live login without a TTY still switches", async () => {
    const sb = new Sandbox();
    await saveAs(sb, "claude", "a@x.com");
    sb.fakeLogin("claude", "c@x.com");
    ok(await sb.run(["switch", "claude", "a@x.com"]));
    expect(sb.liveEmail("claude")).toBe("a@x.com");
    expect(sb.active("claude")).toBe("a@x.com");
    expect(sb.accountNames("claude")).toEqual(["a@x.com"]);
  });

  test("22. switch accepts a profile's email when its name differs", async () => {
    const sb = new Sandbox();
    sb.fakeLogin("codex", "a@x.com");
    ok(await sb.run(["add", "codex", "work"]));
    sb.fakeLogin("codex", "b@x.com");
    ok(await sb.run(["add", "codex", "home"]));
    ok(await sb.run(["switch", "codex", "a@x.com"]));
    expect(sb.active("codex")).toBe("work");
    expect(sb.liveEmail("codex")).toBe("a@x.com");
  });
});
