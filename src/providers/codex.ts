import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { codexAuthFile, codexConfigFile, codexDir } from "../core/paths";
import { ToguruError } from "../utils/errors";
import { readJson, writeJson } from "../utils/fs";
import { decodeJwt } from "../utils/jwt";
import { runInherit } from "../utils/proc";
import { envForSlot } from "./slot";
import type { AccountDescriptor, Credential, LoginOptions, Provider, Slot } from "./types";

interface CodexAuth {
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  } | null;
  last_refresh?: string;
}

function claimString(claims: Record<string, unknown> | null, key: string): string | undefined {
  const value = claims?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Pull identity, plan and expiry out of an auth.json blob. */
function describeCodexAuth(auth: CodexAuth): AccountDescriptor {
  const tokens = auth.tokens ?? undefined;
  if (!tokens && typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY) {
    // An API key has no expiry and no account claims; tell keys apart by hash.
    const digest = createHash("sha256").update(auth.OPENAI_API_KEY).digest("hex").slice(0, 12);
    return { authKind: "api-key", plan: "api key", identity: `api-key:${digest}` };
  }

  const claims = decodeJwt(tokens?.id_token);
  const authClaims = claims?.["https://api.openai.com/auth"];
  const openai = authClaims && typeof authClaims === "object" ? (authClaims as Record<string, unknown>) : null;
  const descriptor: AccountDescriptor = { authKind: "oauth" };
  const email = claimString(claims, "email");
  if (email) {
    descriptor.email = email;
    descriptor.label = email;
  }
  const plan = claimString(openai, "chatgpt_plan_type");
  if (plan) {
    descriptor.plan = plan;
  }
  const accountId = tokens?.account_id ?? claimString(openai, "chatgpt_account_id");
  if (accountId) {
    descriptor.accountId = accountId;
  }
  // The workspace id alone is shared by every member of a team workspace.
  const userId = claimString(openai, "chatgpt_user_id") ?? claimString(openai, "user_id") ?? claimString(claims, "sub");
  if (userId || accountId) {
    descriptor.identity = `${userId ?? ""}:${accountId ?? ""}`;
  } else if (email) {
    descriptor.identity = email;
  }
  // Token expiry comes from the access token's `exp` (seconds), falling back to
  // the id token; refresh capability from the presence of a refresh token.
  const exp = (decodeJwt(tokens?.access_token) ?? claims)?.exp;
  if (typeof exp === "number") {
    descriptor.expiresAt = exp * 1000;
  }
  descriptor.canRefresh = Boolean(tokens?.refresh_token);
  return descriptor;
}

/**
 * Codex can keep credentials in the OS keyring instead of auth.json
 * (`cli_auth_credentials_store = "keyring" | "auto"` in config.toml). toguru
 * swaps auth.json, which Codex would then ignore — refuse loudly instead.
 */
async function assertFileStore(slot?: Slot): Promise<void> {
  let toml: string;
  try {
    toml = await readFile(codexConfigFile(slot), "utf8");
  } catch {
    return;
  }
  // Only top-level keys matter: stop at the first [table].
  const topLevel = toml.split(/^\s*\[/m)[0] ?? "";
  const mode = /^\s*cli_auth_credentials_store\s*=\s*["']([^"']+)["']/m.exec(topLevel)?.[1];
  if (mode && mode !== "file") {
    throw new ToguruError(
      `Codex is set to keep credentials in the OS keyring (cli_auth_credentials_store = "${mode}").`,
      `toguru switches Codex accounts through auth.json. Set cli_auth_credentials_store = "file" in ${codexConfigFile(slot)}, run \`codex login\`, then try again.`,
    );
  }
}

/**
 * Codex (OpenAI). Credentials live in `~/.codex/auth.json` on all platforms
 * (override the directory with `CODEX_HOME`).
 */
export const codexProvider: Provider = {
  id: "codex",
  displayName: "Codex (OpenAI)",
  aliases: ["openai", "gpt", "chatgpt"],
  kana: "コーデックス",
  homes: {
    env: "CODEX_HOME",
    command: "codex",
    baseDir: () => codexDir(),
    shared: ["config.toml", "AGENTS.md", "prompts", "skills", "rules"],
  },

  async readActive(slot?: Slot): Promise<Credential | null> {
    await assertFileStore(slot);
    const auth = await readJson<CodexAuth>(codexAuthFile(slot));
    // `codex logout` can leave an empty shell behind.
    if (!auth || (!auth.tokens && !auth.OPENAI_API_KEY)) {
      return null;
    }
    return auth as Credential;
  },

  async writeActive(credential: Credential, slot?: Slot): Promise<void> {
    await assertFileStore(slot);
    await writeJson(codexAuthFile(slot), credential);
  },

  describe(credential: Credential): AccountDescriptor {
    return describeCodexAuth(credential as CodexAuth);
  },

  async login(options?: LoginOptions): Promise<void> {
    // `codex login` has no email pre-fill flag, so only the slot matters.
    await runInherit("codex", ["login"], envForSlot(codexProvider.homes, options?.slot));
  },
};
