/**
 * Hermetic e2e harness for the `tg` CLI. Every sandbox gets its own HOME,
 * TOGURU_HOME and fake keychain; fake `security` / `claude` / `codex` binaries
 * are first on PATH, so the real keychain and the user's real ~/.claude*,
 * ~/.codex and ~/.toguru are never touched.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dir, "../..");
export const BIN_DIR = path.join(REPO, "tests/e2e/bin");
export const isMac = process.platform === "darwin";
export const KEYCHAIN_SERVICE = "Claude Code-credentials";
/** Keychain account Claude Code (and so toguru) uses: $USER, which the sandbox pins to this. */
export const KEYCHAIN_ACCOUNT = os.userInfo().username;

export type ProviderId = "claude" | "codex";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: Record<string, string | undefined>;
  input?: string;
  timeoutMs?: number;
}

export interface ClaudeOauth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
}
/** Live Claude token payload (keychain item / ~/.claude/.credentials.json). */
export interface ClaudePayload {
  claudeAiOauth?: ClaudeOauth;
  mcpOAuth?: Record<string, { token?: string }>;
  [key: string]: unknown;
}
export interface ClaudeIdentity {
  emailAddress?: string;
  accountUuid?: string;
  organizationUuid?: string;
  organizationName?: string;
}
/** ~/.claude.json */
export interface ClaudeConfig {
  oauthAccount?: ClaudeIdentity;
  [key: string]: unknown;
}
export interface CodexTokens {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  account_id?: string;
}
/** ~/.codex/auth.json */
export interface CodexAuth {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: CodexTokens | null;
  last_refresh?: string;
}
/** A saved credential: the claude composite `{credentials, account}` or a codex auth.json. */
export interface VaultCredential {
  credentials?: ClaudePayload;
  account?: ClaudeIdentity;
  tokens?: CodexTokens | null;
  [key: string]: unknown;
}
export interface VaultAccount {
  name?: string;
  label?: string;
  credential: VaultCredential;
  home?: string;
  addedAt?: string;
  updatedAt?: string;
}
export interface ProviderVault {
  active?: string | null;
  accounts: Record<string, VaultAccount>;
}
/** $TOGURU_HOME/store.json */
export interface Vault {
  version?: number;
  providers: Partial<Record<ProviderId, ProviderVault>>;
}
export interface JwtClaims {
  email?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}
/** Provider-neutral token pair so live/saved comparisons read the same for both providers. */
export interface TokenPair {
  access?: string;
  refresh?: string;
}
/** One provider's slice of `tg list --json` / `tg status --json`. */
export interface ProviderEntry {
  provider?: string;
  active?: string | null;
  accounts?: Array<{ name: string; authState?: string; [key: string]: unknown }>;
  live?: unknown;
  [key: string]: unknown;
}

const REAL_HOME = os.homedir();

/**
 * Unchecked parse: these files are written by tg or the fakes inside the
 * sandbox, and every test asserts on the fields it reads.
 */
function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Write JSON through symlinks (like the real CLIs), atomically. */
function writeJsonFile(file: string, data: unknown): void {
  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function fakeJwt(claims: JwtClaims): string {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url(claims)}.fake-sig`;
}

export function decodeJwt(token: string | undefined): JwtClaims | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as JwtClaims;
  } catch {
    return null;
  }
}

/** Token pair of a claude payload, or of a codex auth / saved credential. */
export function tokenPair(provider: ProviderId, source: ClaudePayload | VaultCredential | CodexAuth | null | undefined): TokenPair | undefined {
  if (!source) return undefined;
  if (provider === "claude") {
    const oauth = (source as ClaudePayload).claudeAiOauth;
    return oauth ? { access: oauth.accessToken, refresh: oauth.refreshToken } : undefined;
  }
  const tokens = (source as CodexAuth).tokens;
  return tokens ? { access: tokens.access_token, refresh: tokens.refresh_token } : undefined;
}

/** Email bound to a saved credential (claude identity slice or codex id_token). */
export function emailOf(provider: ProviderId, credential: VaultCredential | CodexAuth | undefined): string | undefined {
  if (provider === "claude") return (credential as VaultCredential | undefined)?.account?.emailAddress;
  return decodeJwt(credential?.tokens?.id_token ?? undefined)?.email;
}

/** True when any nested key of `value` is named `key`. */
export function hasKeyDeep(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((child) => hasKeyDeep(child, key));
}

/** Find one provider's entry in `--json` output shaped as `[{provider}]`, `{providers: [...]}` or `{providers: {id: ...}}`. */
export function providerEntry(json: unknown, provider: ProviderId): ProviderEntry | undefined {
  if (!json || typeof json !== "object") return undefined;
  const list = Array.isArray(json) ? json : "providers" in json ? json.providers : json;
  if (Array.isArray(list)) {
    return list.find((e): e is ProviderEntry => !!e && typeof e === "object" && e.provider === provider);
  }
  if (list && typeof list === "object" && provider in list) {
    return (list as Record<string, ProviderEntry>)[provider];
  }
  return undefined;
}

const sandboxes: Sandbox[] = [];

export class Sandbox {
  readonly root: string;
  readonly home: string;
  readonly toguruHome: string;
  readonly keychainFile: string;
  readonly env: Record<string, string>;

  constructor() {
    this.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tg-e2e-")));
    this.home = path.join(this.root, "home");
    this.toguruHome = path.join(this.home, ".toguru");
    this.keychainFile = path.join(this.root, "keychain.json");
    fs.mkdirSync(this.home, { recursive: true });

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    for (const k of ["CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR", "CODEX_HOME", "TOGURU_HOME", "FORCE_COLOR"]) {
      delete env[k];
    }
    for (const k of Object.keys(env)) if (k.startsWith("FAKE_")) delete env[k];
    Object.assign(env, {
      HOME: this.home,
      USERPROFILE: this.home,
      USER: KEYCHAIN_ACCOUNT,
      TOGURU_HOME: this.toguruHome,
      FAKE_KEYCHAIN: this.keychainFile,
      PATH: `${BIN_DIR}${path.delimiter}${process.env.PATH ?? ""}`,
      NO_COLOR: "1",
    });
    this.env = env;
    this.assertHermetic(env);
    sandboxes.push(this);
  }

  private assertHermetic(env: Record<string, string | undefined>): void {
    const inside = (p: string | undefined) => !!p && path.resolve(p).startsWith(this.root + path.sep);
    if (!inside(env.HOME) || !inside(env.TOGURU_HOME) || !inside(env.FAKE_KEYCHAIN) || env.HOME === REAL_HOME) {
      throw new Error(`e2e harness: refusing to run outside the sandbox (HOME=${env.HOME})`);
    }
    if (env.CODEX_HOME && !inside(env.CODEX_HOME)) {
      throw new Error(`e2e harness: CODEX_HOME escapes the sandbox (${env.CODEX_HOME})`);
    }
    if (!env.PATH?.startsWith(BIN_DIR + path.delimiter)) {
      throw new Error("e2e harness: fake bin dir must be first on PATH");
    }
  }

  private mergedEnv(extra?: Record<string, string | undefined>): Record<string, string> {
    const env = { ...this.env };
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    this.assertHermetic(env);
    return env;
  }

  p(...segments: string[]): string {
    return path.join(this.home, ...segments);
  }

  get vaultFile(): string {
    return path.join(this.toguruHome, "store.json");
  }
  get claudeConfigFile(): string {
    return this.p(".claude.json");
  }
  get claudeCredentialsFile(): string {
    return this.p(".claude", ".credentials.json");
  }
  get codexAuthFile(): string {
    return this.p(".codex", "auth.json");
  }

  /**
   * Run `tg` (bun src/cli.ts, or node dist/cli.js with E2E_DIST=1).
   * stdin is a pipe, never a TTY.
   */
  run(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    const env = this.mergedEnv(opts.env);
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const [cmd, entry] =
      process.env.E2E_DIST === "1"
        ? ["node", path.join(REPO, "dist/cli.js")]
        : [process.execPath, path.join(REPO, "src/cli.ts")];
    const { promise, resolve, reject } = Promise.withResolvers<RunResult>();
    const child = spawn(cmd, [entry, ...args], { cwd: this.root, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(
            `tg ${args.join(" ")} timed out after ${timeoutMs}ms (killed)\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
          ),
        );
        return;
      }
      resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr });
    });
    child.stdin.on("error", () => {});
    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
    return promise;
  }

  /** Run `tg ... --json` and parse stdout; throws with context when it isn't JSON. */
  async json(args: string[], opts?: RunOptions): Promise<unknown> {
    const result = await this.run([...args, "--json"], opts);
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(
        `tg ${args.join(" ")} --json produced non-JSON (exit ${result.code})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }
  }

  /* --- vault --- */

  readVault(): Vault | null {
    return readJsonFile<Vault>(this.vaultFile);
  }
  writeVault(data: Vault): void {
    writeJsonFile(this.vaultFile, data);
  }
  accounts(provider: ProviderId): Record<string, VaultAccount> {
    return this.readVault()?.providers?.[provider]?.accounts ?? {};
  }
  accountNames(provider: ProviderId): string[] {
    return Object.keys(this.accounts(provider)).sort();
  }
  account(provider: ProviderId, name: string): VaultAccount | undefined {
    const accounts = this.accounts(provider);
    return Object.hasOwn(accounts, name) ? accounts[name] : undefined;
  }
  savedTokens(provider: ProviderId, name: string): TokenPair | undefined {
    const credential = this.account(provider, name)?.credential;
    return tokenPair(provider, provider === "claude" ? credential?.credentials : credential);
  }
  active(provider: ProviderId): string | null {
    return this.readVault()?.providers?.[provider]?.active ?? null;
  }
  /** Find the saved account whose identity email matches. */
  accountByEmail(provider: ProviderId, email: string): [string, VaultAccount] | undefined {
    return Object.entries(this.accounts(provider)).find(([, acc]) => emailOf(provider, acc.credential) === email);
  }

  /* --- fake keychain --- */

  readKeychain(): Record<string, string> {
    return readJsonFile<Record<string, string>>(this.keychainFile) ?? {};
  }
  writeKeychain(data: Record<string, string>): void {
    writeJsonFile(this.keychainFile, data);
  }

  /* --- live provider state --- */

  readClaudeConfig(): ClaudeConfig | null {
    return readJsonFile<ClaudeConfig>(this.claudeConfigFile);
  }
  writeClaudeConfig(data: ClaudeConfig): void {
    writeJsonFile(this.claudeConfigFile, data);
  }
  readClaudeCredentialsFile(): ClaudePayload | null {
    return readJsonFile<ClaudePayload>(this.claudeCredentialsFile);
  }
  writeClaudeCredentialsFile(data: ClaudePayload): void {
    writeJsonFile(this.claudeCredentialsFile, data);
  }
  readCodexAuth(): CodexAuth | null {
    return readJsonFile<CodexAuth>(this.codexAuthFile);
  }
  writeCodexAuth(data: CodexAuth): void {
    writeJsonFile(this.codexAuthFile, data);
  }

  /** Live Claude token payload: fake keychain on darwin, credentials file elsewhere. */
  liveClaudePayload(): ClaudePayload | null {
    if (!isMac) return this.readClaudeCredentialsFile();
    const raw = this.readKeychain()[`${KEYCHAIN_SERVICE}|${KEYCHAIN_ACCOUNT}`];
    return raw === undefined ? null : (JSON.parse(raw) as ClaudePayload);
  }
  writeLiveClaudePayload(payload: ClaudePayload): void {
    if (!isMac) {
      this.writeClaudeCredentialsFile(payload);
      return;
    }
    const keychain = this.readKeychain();
    keychain[`${KEYCHAIN_SERVICE}|${KEYCHAIN_ACCOUNT}`] = JSON.stringify(payload);
    this.writeKeychain(keychain);
  }

  liveTokens(provider: ProviderId): TokenPair | undefined {
    return tokenPair(provider, provider === "claude" ? this.liveClaudePayload() : this.readCodexAuth());
  }
  liveEmail(provider: ProviderId): string | undefined {
    if (provider === "claude") return this.readClaudeConfig()?.oauthAccount?.emailAddress;
    return decodeJwt(this.readCodexAuth()?.tokens?.id_token)?.email;
  }

  /** Simulate the CLI's own token refresh: new access+refresh tokens, later expiry, same identity. */
  rotateLive(provider: ProviderId): void {
    const tag = randomBytes(12).toString("hex");
    if (provider === "claude") {
      const payload = this.liveClaudePayload();
      if (!payload?.claudeAiOauth) throw new Error("rotateLive(claude): no live claude session");
      const now = Date.now();
      payload.claudeAiOauth = {
        ...payload.claudeAiOauth,
        accessToken: `sk-ant-oat01-rotated-${tag}`,
        refreshToken: `sk-ant-ort01-rotated-${tag}`,
        expiresAt: now + 9 * 3_600_000,
        refreshTokenExpiresAt: now + 31 * 86_400_000,
      };
      this.writeLiveClaudePayload(payload);
      return;
    }
    const auth = this.readCodexAuth();
    if (!auth?.tokens) throw new Error("rotateLive(codex): no live codex token session");
    const now = Math.floor(Date.now() / 1000);
    const idClaims = decodeJwt(auth.tokens.id_token) ?? {};
    const accessClaims = decodeJwt(auth.tokens.access_token) ?? {};
    auth.tokens = {
      ...auth.tokens,
      id_token: fakeJwt({ ...idClaims, iat: now, exp: now + 3600 }),
      access_token: fakeJwt({ ...accessClaims, iat: now, exp: now + 11 * 86_400, jti: tag }),
      refresh_token: `rt_rotated_${tag}`,
    };
    auth.last_refresh = new Date().toISOString();
    this.writeCodexAuth(auth);
  }

  /** Run the fake provider CLI's login directly (out-of-band, not through tg). */
  fakeLogin(provider: ProviderId, email: string, extraEnv: Record<string, string | undefined> = {}): void {
    const env = this.mergedEnv({ FAKE_LOGIN_AS: email, ...extraEnv });
    const args = provider === "claude" ? ["auth", "login"] : ["login"];
    const result = spawnSync(path.join(BIN_DIR, provider), args, { env, cwd: this.root, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`fake ${provider} login failed (${result.status}): ${result.stderr}`);
    }
  }

  /** The `--email` the fake claude login last received ("" when none). */
  lastClaudeLoginEmail(): string | null {
    try {
      return fs.readFileSync(this.p(".fake-claude-last-email"), "utf8");
    } catch {
      return null;
    }
  }

  cleanup(): void {
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

/** Remove every sandbox created so far; call from afterEach. */
export function cleanupSandboxes(): void {
  for (const sb of sandboxes.splice(0)) sb.cleanup();
}

