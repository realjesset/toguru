import { Command } from "commander";
import { discardHome, homePath, prepareHome, requireHomes } from "../core/homes";
import { placeLogin } from "../core/placement";
import { reconcile } from "../core/reconcile";
import { Store, type StoredAccount } from "../core/store";
import { allProviders } from "../providers/registry";
import type { Provider } from "../providers/types";
import { terminalPrompter } from "../ui/prompts";
import { ink, kao, mark } from "../ui/theme";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { validateAccountName } from "../utils/strings";
import { PROVIDER_ARG, resolveProvider } from "./shared";

export interface AuthOptions {
  /** Start a new profile in its own account home, logging in there. */
  home?: boolean;
}

function requireLogin(provider: Provider): NonNullable<Provider["login"]> {
  if (!provider.login) {
    throw new ToguruError(
      `${provider.displayName} does not support logging in through toguru.`,
      `Log in with its own CLI, then run: tg add ${provider.id}`,
    );
  }
  return provider.login.bind(provider);
}

/** Re-authenticate a profile inside its own home; the home's CLI owns the result. */
async function reauthInHome(provider: Provider, store: Store, account: StoredAccount, home: string): Promise<void> {
  const login = requireLogin(provider);
  const before = provider.describe(account.credential);
  logger.info(`${ink.sakura(mark.petal)} Re-authenticating ${ink.bold(account.name)} in its home…`);
  await login({ ...(before.email ? { email: before.email } : {}), slot: { dir: home } });
  const credential = await provider.readActive({ dir: home });
  if (!credential) {
    throw new ToguruError(`Login finished but ${account.name}'s home has no session.`, "Try again.");
  }
  const fresh = provider.describe(credential);
  await store.upsert(provider.id, account.name, credential, { label: fresh.email });
  if (before.identity && fresh.identity && before.identity !== fresh.identity) {
    logger.warn(`The home of "${account.name}" is now signed in as ${fresh.email ?? "a different account"}.`);
  }
  logger.success(`Re-authenticated ${ink.bold(account.name)} in its home  ${ink.sakura(kao.sparkle)}`);
}

/** Create a new profile by logging in inside a brand-new home. */
async function loginIntoNewHome(provider: Provider, store: Store, name: string): Promise<void> {
  requireHomes(provider);
  const login = requireLogin(provider);
  if (store.has(provider.id, name)) {
    throw new ToguruError(`"${name}" already exists.`, `Move it into a home instead: tg home ${provider.id} ${name}`);
  }
  const dir = homePath(provider, name);
  await prepareHome(provider, dir);
  logger.info(`${ink.sakura(mark.petal)} Logging in to ${provider.displayName} inside a new home for ${ink.bold(name)}…`);
  try {
    await login({ slot: { dir } });
  } catch (error) {
    await discardHome(provider, dir);
    throw error;
  }
  const credential = await provider.readActive({ dir });
  if (!credential) {
    await discardHome(provider, dir);
    throw new ToguruError("Login finished but the new home has no session.", "If the browser flow failed, try again.");
  }
  await store.upsert(provider.id, name, credential, { label: provider.describe(credential).email });
  await store.setHome(provider.id, name, dir);
  logger.success(`Saved ${ink.bold(name)} in its own home  ${ink.sakura(kao.sparkle)}`);
  logger.hint(`Use it with: tg run ${provider.id} ${name}   or: eval "$(tg env ${provider.id} ${name})"`);
}

/**
 * Log in to a provider through its own OAuth flow and save the resulting session
 * as a toguru profile — in one step.
 *
 * Behaviour by `name`:
 * - omitted  → log in; a login that's already saved updates its profile,
 *   otherwise it's saved under a new name (default: the email).
 * - existing → re-authenticate that profile, pre-filling its email (inside its
 *   home when it has one). Signing in as someone else leaves it untouched and
 *   saves that login separately.
 * - new      → log in and save under that name (in a new home with `--home`).
 *
 * A login in the default slot is always made active.
 */
export async function runAuth(provider: Provider, name?: string, options: AuthOptions = {}): Promise<void> {
  const login = requireLogin(provider);
  const requested = name?.trim();
  if (requested) {
    const valid = validateAccountName(requested);
    if (valid !== true) {
      throw new ToguruError(valid);
    }
  }

  const store = await Store.load();
  const existing = requested ? store.get(provider.id, requested) : undefined;
  if (existing?.home) {
    await reauthInHome(provider, store, existing, existing.home);
    return;
  }
  if (options.home) {
    if (!requested) {
      throw new ToguruError("A new home needs a profile name.", `e.g. tg ${provider.id} auth work --home`);
    }
    await loginIntoNewHome(provider, store, requested);
    return;
  }

  // Logging in replaces the live session; capture any refresh it picked up
  // first, or that profile is left holding an already-rotated token.
  await reconcile(provider, store);
  const reauth = existing ? store.get(provider.id, existing.name) : undefined;
  logger.info(
    reauth
      ? `${ink.sakura(mark.petal)} Re-authenticating ${provider.displayName} profile ${ink.bold(reauth.name)}…`
      : `${ink.sakura(mark.petal)} Logging in to ${provider.displayName}…`,
  );
  const email = reauth ? (provider.describe(reauth.credential).email ?? reauth.label) : undefined;
  await login(email ? { email } : undefined);

  const credential = await provider.readActive();
  if (!credential) {
    throw new ToguruError(
      `Login finished but no active ${provider.displayName} session was found.`,
      "If the browser flow was cancelled or failed, try again.",
    );
  }
  const placed = await placeLogin(
    provider,
    store,
    credential,
    { kind: "login", ...(requested && !reauth ? { name: requested } : {}), ...(reauth ? { reauth } : {}) },
    terminalPrompter(),
  );
  if (placed.kind === "declined") {
    logger.warn("Not saved.");
    return;
  }
  if (placed.mismatch) {
    logger.warn(
      `You signed in as ${placed.mismatch.got ?? "a different account"}, not ${placed.mismatch.expected ?? placed.mismatch.profile} — "${placed.mismatch.profile}" was left as it was.`,
    );
  }
  const verb = placed.created ? "Saved" : "Re-authenticated";
  const shown = placed.label && placed.label !== placed.name ? ` (${placed.label})` : "";
  logger.success(
    `${verb} ${provider.displayName} account ${ink.bold(placed.name)}${shown} — it's live now  ${ink.sakura(kao.sparkle)}`,
  );
}

/**
 * The per-provider command groups: `tg claude …`, `tg codex …` and one per
 * declared provider (plus aliases such as `tg anthropic`, `tg gpt`), each
 * exposing `auth [name]`.
 */
export function providerCommands(): Command[] {
  return allProviders().map((provider) => {
    const group = new Command(provider.id)
      .aliases([...provider.aliases])
      .description(`Manage ${provider.displayName} accounts`);
    group
      .command("auth")
      .alias("login")
      .argument("[name]", "profile to create, or an existing profile to re-authenticate")
      .option("--home", "create the profile in its own account home (see: tg home)", false)
      .description(`Log in to ${provider.displayName} and save the session as a profile`)
      .action(async (nameArg: string | undefined, opts: AuthOptions) => {
        await runAuth(provider, nameArg, opts);
      });
    return group;
  });
}

/** Top-level `tg auth [provider] [name]`, equivalent to `tg <provider> auth`. */
export function authCommand(): Command {
  return new Command("auth")
    .alias("login")
    .description("Log in to a provider and save the session as a profile")
    .argument("[provider]", PROVIDER_ARG)
    .argument("[name]", "profile to create, or an existing profile to re-authenticate")
    .option("--home", "create the profile in its own account home (see: tg home)", false)
    .action(async (providerArg: string | undefined, nameArg: string | undefined, opts: AuthOptions) => {
      const provider = await resolveProvider(providerArg);
      await runAuth(provider, nameArg, opts);
    });
}
