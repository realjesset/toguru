import { claudeConfigFile, claudeCredentialsFile, isMac } from "../core/paths";
import { keychainGet, keychainSet } from "../core/keychain";
import { readJson, writeJson } from "../utils/fs";
import { runInherit } from "../utils/proc";
import type { AccountDescriptor, Credential, LoginOptions, Provider } from "./types";

/** macOS keychain service name written by Claude Code. */
const KEYCHAIN_SERVICE = "Claude Code-credentials";

/** The token blob (Keychain on macOS, `.credentials.json` elsewhere). */
interface ClaudeTokenPayload {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
  };
}

/** The identity slice of `~/.claude.json` that Claude Code displays. */
interface ClaudeOauthAccount {
  accountUuid?: string;
  emailAddress?: string;
  [key: string]: unknown;
}

interface ClaudeConfig {
  oauthAccount?: ClaudeOauthAccount;
  [key: string]: unknown;
}

/**
 * A Claude account is two things that must move together:
 * - `credentials`: the token payload that authorizes API calls.
 * - `account`: the identity slice of `~/.claude.json` (`oauthAccount`) — the
 *   email + uuid Claude Code shows. Swapping only the tokens leaves the
 *   displayed identity (and our label suggestion) pointing at the old account.
 */
interface ClaudeCredential {
  credentials: ClaudeTokenPayload;
  account?: ClaudeOauthAccount;
}

/** Read the token payload from wherever this platform keeps it. */
async function readPayload(): Promise<ClaudeTokenPayload | null> {
  if (isMac) {
    const raw = await keychainGet(KEYCHAIN_SERVICE);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as ClaudeTokenPayload;
    } catch {
      return null;
    }
  }
  return readJson<ClaudeTokenPayload>(claudeCredentialsFile());
}

/** Write the token payload back to the platform store. */
async function writePayload(payload: ClaudeTokenPayload): Promise<void> {
  if (isMac) {
    await keychainSet(KEYCHAIN_SERVICE, JSON.stringify(payload));
    return;
  }
  await writeJson(claudeCredentialsFile(), payload);
}

/**
 * Coerce a stored credential into the composite shape. Accepts legacy entries
 * that stored the bare token payload (before identity was bundled in).
 */
function asComposite(credential: Credential): ClaudeCredential {
  const maybe = credential as Partial<ClaudeCredential>;
  if (maybe.credentials && typeof maybe.credentials === "object") {
    return maybe.account
      ? { credentials: maybe.credentials, account: maybe.account }
      : { credentials: maybe.credentials };
  }
  // Legacy: the whole blob was the token payload.
  return { credentials: credential as ClaudeTokenPayload };
}

/** Merge an identity slice into a config, preserving every other key. */
export function withIdentity(config: ClaudeConfig | null, account: ClaudeOauthAccount): ClaudeConfig {
  return { ...(config ?? {}), oauthAccount: account };
}

/**
 * Claude Code (Anthropic). Credentials live in the macOS keychain on Darwin and
 * in `~/.claude/.credentials.json` everywhere else; the signed-in identity lives
 * in `~/.claude.json`. Both travel together as one composite credential so a
 * switch leaves the active tokens and the displayed account in agreement.
 */
export const claudeProvider: Provider = {
  id: "claude",
  displayName: "Claude Code (Anthropic)",

  async readActive(): Promise<Credential | null> {
    const credentials = await readPayload();
    if (!credentials) {
      return null;
    }
    const config = await readJson<ClaudeConfig>(claudeConfigFile());
    const composite: Credential = { credentials };
    if (config?.oauthAccount) {
      composite.account = config.oauthAccount;
    }
    return composite;
  },

  async writeActive(credential: Credential): Promise<void> {
    const { credentials, account } = asComposite(credential);
    await writePayload(credentials);
    if (account) {
      // Restore the identity slice without disturbing the rest of ~/.claude.json.
      const config = await readJson<ClaudeConfig>(claudeConfigFile());
      await writeJson(claudeConfigFile(), withIdentity(config, account));
    }
  },

  describe(credential: Credential): AccountDescriptor {
    const { credentials, account } = asComposite(credential);
    const oauth = credentials.claudeAiOauth ?? {};
    const descriptor: AccountDescriptor = {};
    if (account?.emailAddress) {
      descriptor.email = account.emailAddress;
      descriptor.label = account.emailAddress;
    }
    if (oauth.subscriptionType) {
      descriptor.plan = oauth.subscriptionType;
    }
    if (typeof oauth.expiresAt === "number") {
      descriptor.expiresAt = oauth.expiresAt;
    }
    descriptor.canRefresh = Boolean(oauth.refreshToken);
    return descriptor;
  },

  async suggestLabel(): Promise<string | undefined> {
    const config = await readJson<ClaudeConfig>(claudeConfigFile());
    return config?.oauthAccount?.emailAddress;
  },

  async login(options?: LoginOptions): Promise<void> {
    const args = ["auth", "login"];
    if (options?.email) {
      // Pre-fill the email on the login page (handy when re-authenticating).
      args.push("--email", options.email);
    }
    await runInherit("claude", args);
  },
};
