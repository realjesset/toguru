import { input } from "@inquirer/prompts";
import { Command } from "commander";
import { Store } from "../core/store";
import { providers } from "../providers/registry";
import type { Provider } from "../providers/types";
import { MultiAccountError } from "../utils/errors";
import { logger } from "../utils/logger";
import { slugify, validateAccountName } from "../utils/strings";
import { resolveProvider } from "./shared";

/**
 * Log in to a provider through its own OAuth flow and save the resulting session
 * as a macc profile — in one step. This is the easy path: no separate "log in,
 * then `add`" dance.
 *
 * Behaviour by `name`:
 * - omitted  → log in, then prompt for a profile name (defaulting to the email).
 * - existing → re-authenticate that profile in place (e.g. its token went stale)
 *   and pre-fill the email on the login page when the provider supports it.
 * - new      → log in and save under that name.
 *
 * The freshly authenticated profile is always made active.
 */
export async function runAuth(provider: Provider, name?: string): Promise<void> {
  if (!provider.login) {
    throw new MultiAccountError(
      `${provider.displayName} does not support logging in through macc.`,
      `Log in with its own CLI, then run: macc add ${provider.id}`,
    );
  }

  const requested = name?.trim();
  if (requested) {
    const valid = validateAccountName(requested);
    if (valid !== true) {
      throw new MultiAccountError(valid);
    }
  }

  const store = await Store.load();
  const existing = requested ? store.get(provider.id, requested) : undefined;

  if (existing) {
    logger.info(
      `Re-authenticating ${provider.displayName} profile "${existing.name}"${
        existing.label ? ` (${existing.label})` : ""
      }…`,
    );
  } else {
    logger.info(`Logging in to ${provider.displayName}…`);
  }

  // Pre-fill the email when re-authenticating and the provider supports it.
  await provider.login(existing?.label ? { email: existing.label } : undefined);

  const credential = await provider.readActive();
  if (!credential) {
    throw new MultiAccountError(
      `Login finished but no active ${provider.displayName} session was found.`,
      "If the browser flow was cancelled or failed, try again.",
    );
  }

  let target = requested;
  if (!target) {
    const suggested = await provider.suggestLabel?.();
    target = await input({
      message: "Save this account as",
      default: suggested ? slugify(suggested) : undefined,
      validate: validateAccountName,
    });
  }

  const label = await provider.suggestLabel?.();
  const wasExisting = store.has(provider.id, target);
  await store.upsert(provider.id, target, credential, label);
  await store.setActive(provider.id, target);

  const verb = wasExisting ? "Re-authenticated" : "Saved";
  logger.success(
    `${verb} ${provider.displayName} account ${JSON.stringify(target)}${
      label ? ` (${label})` : ""
    } and set it active.`,
  );
}

/**
 * The per-provider command groups: `macc claude …` and `macc codex …`, each
 * exposing `auth [name]`.
 */
export function providerCommands(): Command[] {
  return Object.values(providers).map((provider) => {
    const group = new Command(provider.id).description(`Manage ${provider.displayName} accounts`);
    group
      .command("auth")
      .argument("[name]", "profile to create, or an existing profile to re-authenticate")
      .description(`Log in to ${provider.displayName} and save the session as a profile`)
      .action(async (nameArg: string | undefined) => {
        await runAuth(provider, nameArg);
      });
    return group;
  });
}

/** Top-level `macc auth [provider] [name]`, equivalent to `macc <provider> auth`. */
export function authCommand(): Command {
  return new Command("auth")
    .description("Log in to a provider and save the session as a profile")
    .argument("[provider]", "claude or codex")
    .argument("[name]", "profile to create, or an existing profile to re-authenticate")
    .action(async (providerArg: string | undefined, nameArg: string | undefined) => {
      const provider = await resolveProvider(providerArg);
      await runAuth(provider, nameArg);
    });
}
