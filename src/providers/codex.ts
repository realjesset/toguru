import { codexAuthFile } from "../core/paths";
import { readJson, writeJson } from "../utils/fs";
import { decodeJwt } from "../utils/jwt";
import { runInherit } from "../utils/proc";
import type { AccountDescriptor, Credential, Provider } from "./types";

interface CodexAuth {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

/** Pull email + plan out of the OpenID `id_token` claims. */
function describeAuth(auth: CodexAuth | null): AccountDescriptor {
  const claims = decodeJwt(auth?.tokens?.id_token);
  const descriptor: AccountDescriptor = {};
  if (claims) {
    const email = claims.email;
    if (typeof email === "string") {
      descriptor.email = email;
      descriptor.label = email;
    }
    const auths = claims["https://api.openai.com/auth"];
    if (auths && typeof auths === "object") {
      const plan = (auths as Record<string, unknown>).chatgpt_plan_type;
      if (typeof plan === "string") {
        descriptor.plan = plan;
      }
    }
  }
  // Token expiry comes from the access token's `exp` (seconds), falling back to
  // the id token; refresh capability from the presence of a refresh token.
  const expClaims = decodeJwt(auth?.tokens?.access_token) ?? claims;
  const exp = expClaims?.exp;
  if (typeof exp === "number") {
    descriptor.expiresAt = exp * 1000;
  }
  if (typeof auth?.tokens?.account_id === "string") {
    descriptor.accountId = auth.tokens.account_id;
  }
  descriptor.canRefresh = Boolean(auth?.tokens?.refresh_token);
  return descriptor;
}

/**
 * Codex (OpenAI). Credentials live in `~/.codex/auth.json` on all platforms
 * (override the directory with `CODEX_HOME`).
 */
export const codexProvider: Provider = {
  id: "codex",
  displayName: "Codex (OpenAI)",

  readActive(): Promise<Credential | null> {
    return readJson<Credential>(codexAuthFile());
  },

  async writeActive(credential: Credential): Promise<void> {
    await writeJson(codexAuthFile(), credential);
  },

  describe(credential: Credential): AccountDescriptor {
    return describeAuth(credential as CodexAuth);
  },

  async suggestLabel(): Promise<string | undefined> {
    const auth = await readJson<CodexAuth>(codexAuthFile());
    return describeAuth(auth).email;
  },

  async login(): Promise<void> {
    // `codex login` has no email pre-fill flag, so options are ignored here.
    await runInherit("codex", ["login"]);
  },
};
