/**
 * Provider identifier: a built-in (`claude`, `codex`) or the id of a provider
 * declared in `~/.toguru/providers/*.json`. The registry validates it.
 */
export type ProviderId = string;

/**
 * An opaque credential blob. Each provider knows how to read/write its own
 * shape; the store treats it as JSON-serializable data.
 */
export type Credential = Record<string, unknown>;

/**
 * Where a provider's CLI keeps its credential. The default slot is the CLI's
 * normal location (honouring its own env overrides); `dir` points at another
 * config directory instead — an account home (see `tg home`).
 */
export interface Slot {
  dir?: string;
}

/** Options passed to a provider's interactive login flow. */
export interface LoginOptions {
  /** Pre-fill this email on the provider's login page, when supported. */
  email?: string;
  /** Log in to this slot (an account home) instead of the default one. */
  slot?: Slot;
}

/** Human-friendly details extracted from a credential, all best-effort. */
export interface AccountDescriptor {
  /** Display label (usually an email address). */
  label?: string;
  /** Email address, when known. */
  email?: string;
  /** Provider account identifier (uuid / workspace id), for display. */
  accountId?: string;
  /** Organization or workspace name, when known. */
  orgName?: string;
  /**
   * Key that tells two sessions apart: equal identities are the same login
   * (same user *and* same org/workspace). Absent when it can't be determined.
   */
  identity?: string;
  /** Subscription/plan name, when known. */
  plan?: string;
  /** `api-key` sessions never expire and have no refresh token. */
  authKind?: "oauth" | "api-key";
  /** Unix epoch milliseconds when the access token expires, when known. */
  expiresAt?: number;
  /**
   * Unix epoch milliseconds after which the refresh token stops working and a
   * fresh login is required. Refreshing does not extend it.
   */
  refreshExpiresAt?: number;
  /**
   * Whether the credential carries a refresh token (so an expired access token
   * can renew itself). `false` means re-authentication is required.
   */
  canRefresh?: boolean;
}

/** How to run a provider's CLI against an account home. */
export interface HomeSupport {
  /** Env var that points the CLI at a config dir (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). */
  env: string;
  /** The CLI binary `tg run` starts. */
  command: string;
  /** The default config dir, whose `shared` entries homes link to. */
  baseDir(): string;
  /** Entries of the default config dir symlinked into each home (settings, prompts…). */
  shared: readonly string[];
  /** Env vars to clear when running inside a home (they would override `env`). */
  clear?: readonly string[];
  /** Seed a fresh home with non-credential state (e.g. onboarding flags). */
  prepare?(dir: string): Promise<void>;
  /** Delete credentials the home keeps outside its directory (keychain items). */
  discard?(dir: string): Promise<void>;
}

/**
 * A provider integrates one external tool (Claude Code, Codex, or one declared
 * by the user). It reads and writes that tool's credential in a slot and can
 * describe a credential for display. Implementations must be cross-platform.
 */
export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;
  /** Extra names accepted on the command line (e.g. `anthropic`, `gpt`). */
  readonly aliases: readonly string[];
  /** Definition file for user-declared providers; absent for built-ins. */
  readonly source?: string;
  /** Account-home support; absent when the CLI can't be pointed at another dir. */
  readonly homes?: HomeSupport;

  /** Read the credential the provider's CLI is using in `slot`, or `null`. */
  readActive(slot?: Slot): Promise<Credential | null>;

  /** Overwrite the credential in `slot`, activating that account there. */
  writeActive(credential: Credential, slot?: Slot): Promise<void>;

  /** Best-effort, display-only details for a credential. */
  describe(credential: Credential): AccountDescriptor;

  /** Delegate to the provider's own interactive login flow, when supported. */
  login?(options?: LoginOptions): Promise<void>;
}
