import { claudeConfigFile, claudeCredentialsFile, isMac } from "../core/paths";
import { keychainGet, keychainSet } from "../core/keychain";
import { readJson, writeJson } from "../utils/fs";
import { runInherit } from "../utils/proc";
import type { AccountDescriptor, Credential, LoginOptions, Provider } from "./types";

/** macOS keychain service name written by Claude Code. */
const KEYCHAIN_SERVICE = "Claude Code-credentials";

interface ClaudeCredential {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    subscriptionType?: string;
  };
}

interface ClaudeConfig {
  oauthAccount?: {
    emailAddress?: string;
  };
}

/**
 * Claude Code (Anthropic). Credentials live in the macOS keychain on Darwin and
 * in `~/.claude/.credentials.json` everywhere else. The signed-in email is kept
 * separately in `~/.claude.json` and is only used to suggest a label.
 */
export const claudeProvider: Provider = {
  id: "claude",
  displayName: "Claude Code (Anthropic)",

  async readActive(): Promise<Credential | null> {
    if (isMac) {
      const raw = await keychainGet(KEYCHAIN_SERVICE);
      if (!raw) {
        return null;
      }
      try {
        return JSON.parse(raw) as Credential;
      } catch {
        return null;
      }
    }
    return readJson<Credential>(claudeCredentialsFile());
  },

  async writeActive(credential: Credential): Promise<void> {
    if (isMac) {
      await keychainSet(KEYCHAIN_SERVICE, JSON.stringify(credential));
      return;
    }
    await writeJson(claudeCredentialsFile(), credential);
  },

  describe(credential: Credential): AccountDescriptor {
    const oauth = (credential as ClaudeCredential).claudeAiOauth ?? {};
    const descriptor: AccountDescriptor = {};
    if (oauth.subscriptionType) {
      descriptor.plan = oauth.subscriptionType;
    }
    if (typeof oauth.expiresAt === "number") {
      descriptor.expiresAt = oauth.expiresAt;
    }
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
