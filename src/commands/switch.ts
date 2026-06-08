import { Command } from "commander";
import { classifyAuth, relativeTime } from "../core/auth-status";
import { reconcileActive } from "../core/reconcile";
import { Store, type StoredAccount } from "../core/store";
import type { Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { pickAccount, resolveProvider } from "./shared";

/**
 * Activate a saved account by writing its credential to the provider's live
 * location. When `name` is omitted the user picks interactively.
 */
export async function runSwitch(provider: Provider, name?: string): Promise<void> {
  const store = await Store.load();
  // Before leaving the current account, capture any refresh / re-auth it picked
  // up while it was live — otherwise switching back would restore a stale token.
  await reconcileActive(provider, store);
  let account: StoredAccount;
  if (name) {
    const found = store.get(provider.id, name);
    if (!found) {
      throw new ToguruError(
        `No saved ${provider.displayName} account named "${name}".`,
        `See your accounts with: toguru list ${provider.id}`,
      );
    }
    account = found;
  } else {
    account = await pickAccount(store, provider, `Switch ${provider.displayName} to`);
  }

  if (store.active(provider.id) === account.name) {
    logger.info(`${provider.displayName} is already on "${account.name}".`);
    // Still re-write the credential in case the live file drifted.
  }

  await provider.writeActive(account.credential);
  await store.setActive(provider.id, account.name);
  logger.success(
    `Switched ${provider.displayName} to ${JSON.stringify(account.name)}${
      account.label ? ` (${account.label})` : ""
    }.`,
  );

  // Let the user know whether the session they just activated is usable.
  const descriptor = provider.describe(account.credential);
  const state = classifyAuth(descriptor);
  const reauth = `tg ${provider.id} auth ${account.name}`;
  if (state === "needs-reauth") {
    logger.warn(`This saved session can't refresh itself — run \`${reauth}\` to re-authenticate.`);
  } else if (state === "expired") {
    const when = descriptor.expiresAt ? ` (expired ${relativeTime(descriptor.expiresAt)})` : "";
    logger.info(
      `Its token has expired${when}; ${provider.displayName} will refresh it automatically. Run \`${reauth}\` if you're asked to log in.`,
    );
  }
}

export function switchCommand(): Command {
  return new Command("switch")
    .alias("use")
    .description("Switch the active account for a provider")
    .argument("[provider]", "claude or codex")
    .argument("[name]", "account name to switch to")
    .action(async (providerArg: string | undefined, nameArg: string | undefined) => {
      const provider = await resolveProvider(providerArg);
      await runSwitch(provider, nameArg);
    });
}
