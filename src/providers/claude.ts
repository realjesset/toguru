import {
  claudeConfigFile,
  claudeCredentialsFile,
  claudeDir,
  claudeKeychainAccount,
  claudeKeychainService,
  isMac,
} from "../core/paths";
import { keychainDelete, keychainGet, keychainSet } from "../core/keychain";
import { ToguruError } from "../utils/errors";
import { readJson, writeJson } from "../utils/fs";
import { runInherit } from "../utils/proc";
import { envForSlot } from "./slot";
import type { AccountDescriptor, Credential, LoginOptions, Provider, Slot } from "./types";

interface ClaudeOauthTokens {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  [key: string]: unknown;
}

/**
 * The live token blob (Keychain on macOS, `.credentials.json` elsewhere). Besides
 * the account's `claudeAiOauth` tokens it holds machine-wide entries such as
 * `mcpOAuth` (MCP server logins), which are not part of any one account.
 */
interface ClaudeTokenPayload {
  claudeAiOauth?: ClaudeOauthTokens;
  [key: string]: unknown;
}

/** The identity slice of `~/.claude.json` that Claude Code displays. */
interface ClaudeOauthAccount {
  accountUuid?: string;
  emailAddress?: string;
  organizationUuid?: string;
  organizationName?: string;
  [key: string]: unknown;
}

interface ClaudeConfig {
  oauthAccount?: ClaudeOauthAccount;
  [key: string]: unknown;
}

/**
 * A saved Claude account is two things that must move together:
 * - `credentials`: `{ claudeAiOauth }`, the tokens that authorize API calls.
 * - `account`: the identity slice of `~/.claude.json` (`oauthAccount`) — the
 *   email, uuid and org Claude Code shows.
 */
interface ClaudeCredential {
  credentials: ClaudeTokenPayload;
  account?: ClaudeOauthAccount;
}

/** Read the token payload from wherever this platform keeps it. */
async function readPayload(slot?: Slot): Promise<ClaudeTokenPayload | null> {
  if (!isMac) {
    return readJson<ClaudeTokenPayload>(claudeCredentialsFile(slot));
  }
  const raw = await keychainGet(claudeKeychainService(slot), claudeKeychainAccount());
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as ClaudeTokenPayload;
  } catch {
    return null;
  }
}

/** Write the token payload back to the platform store. */
async function writePayload(payload: ClaudeTokenPayload, slot?: Slot): Promise<void> {
  if (isMac) {
    await keychainSet(claudeKeychainService(slot), JSON.stringify(payload), claudeKeychainAccount());
    return;
  }
  await writeJson(claudeCredentialsFile(slot), payload);
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

/** Set (or, without one, drop) the identity slice, preserving every other key. */
export function withIdentity(config: ClaudeConfig | null, account: ClaudeOauthAccount | undefined): ClaudeConfig {
  const { oauthAccount: _previous, ...rest } = config ?? {};
  return account ? { ...rest, oauthAccount: account } : rest;
}

/**
 * Put an account's tokens into the live payload. Only `claudeAiOauth` belongs
 * to the account; everything else (MCP server logins…) stays as it is live, so
 * switching never rolls those back to an old, already-rotated snapshot.
 */
export function withTokens(live: ClaudeTokenPayload | null, tokens: ClaudeOauthTokens): ClaudeTokenPayload {
  return { ...(live ?? {}), claudeAiOauth: tokens };
}

/**
 * Claude Code (Anthropic). Credentials live in the macOS keychain on Darwin and
 * in `<config dir>/.credentials.json` everywhere else; the signed-in identity
 * lives in `~/.claude.json`. Both travel together as one composite credential
 * so a switch leaves the active tokens and the displayed account in agreement.
 */
export const claudeProvider: Provider = {
  id: "claude",
  displayName: "Claude Code (Anthropic)",
  aliases: ["anthropic", "claude-code"],
  kana: "クロード",
  homes: {
    env: "CLAUDE_CONFIG_DIR",
    command: "claude",
    baseDir: () => claudeDir(),
    shared: ["settings.json", "CLAUDE.md", "commands", "agents", "skills", "plugins", "hooks", "output-styles"],
    clear: ["CLAUDE_SECURESTORAGE_CONFIG_DIR"],
    async prepare(dir: string): Promise<void> {
      // Carry over onboarding/theme state so the home doesn't start from scratch;
      // the account identity is the home's own.
      const target = claudeConfigFile({ dir });
      if (await readJson(target)) {
        return;
      }
      await writeJson(target, withIdentity(await readJson<ClaudeConfig>(claudeConfigFile()), undefined));
    },
    async discard(dir: string): Promise<void> {
      if (isMac) {
        await keychainDelete(claudeKeychainService({ dir }), claudeKeychainAccount());
      }
    },
  },

  async readActive(slot?: Slot): Promise<Credential | null> {
    const payload = await readPayload(slot);
    // A payload holding only MCP logins means nobody is signed in.
    if (!payload?.claudeAiOauth) {
      return null;
    }
    const config = await readJson<ClaudeConfig>(claudeConfigFile(slot));
    const composite: Credential = { credentials: { claudeAiOauth: payload.claudeAiOauth } };
    if (config?.oauthAccount) {
      composite.account = config.oauthAccount;
    }
    return composite;
  },

  async writeActive(credential: Credential, slot?: Slot): Promise<void> {
    const { credentials, account } = asComposite(credential);
    if (!credentials.claudeAiOauth) {
      throw new ToguruError(
        "This saved Claude account has no tokens to restore.",
        "Re-authenticate it with: tg claude auth <name>",
      );
    }
    await writePayload(withTokens(await readPayload(slot), credentials.claudeAiOauth), slot);
    // Restore the identity slice without disturbing the rest of ~/.claude.json.
    // A legacy snapshot without one must not leave the *previous* account's
    // identity next to its tokens: tg would later read the pair as that account.
    const config = await readJson<ClaudeConfig>(claudeConfigFile(slot));
    await writeJson(claudeConfigFile(slot), withIdentity(config, account));
  },

  describe(credential: Credential): AccountDescriptor {
    const { credentials, account } = asComposite(credential);
    const oauth = credentials.claudeAiOauth ?? {};
    const descriptor: AccountDescriptor = { authKind: "oauth" };
    if (account?.emailAddress) {
      descriptor.email = account.emailAddress;
      descriptor.label = account.emailAddress;
    }
    if (typeof account?.accountUuid === "string") {
      descriptor.accountId = account.accountUuid;
      // One person can belong to several orgs, each its own login.
      descriptor.identity = `${account.accountUuid}:${account.organizationUuid ?? ""}`;
    } else if (descriptor.email) {
      descriptor.identity = descriptor.email;
    }
    if (typeof account?.organizationName === "string") {
      descriptor.orgName = account.organizationName;
    }
    if (oauth.subscriptionType) {
      descriptor.plan = oauth.subscriptionType;
    }
    if (typeof oauth.expiresAt === "number") {
      descriptor.expiresAt = oauth.expiresAt;
    }
    if (typeof oauth.refreshTokenExpiresAt === "number") {
      descriptor.refreshExpiresAt = oauth.refreshTokenExpiresAt;
    }
    descriptor.canRefresh = Boolean(oauth.refreshToken);
    return descriptor;
  },

  async login(options?: LoginOptions): Promise<void> {
    const args = ["auth", "login"];
    if (options?.email) {
      // Pre-fill the email on the login page (handy when re-authenticating).
      args.push("--email", options.email);
    }
    await runInherit("claude", args, envForSlot(claudeProvider.homes, options?.slot));
  },
};
