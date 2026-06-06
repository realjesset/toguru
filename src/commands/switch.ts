import { Command } from "commander";
import { Store, type StoredAccount } from "../core/store";
import type { Provider } from "../providers/types";
import { MultiAccountError } from "../utils/errors";
import { logger } from "../utils/logger";
import { pickAccount, resolveProvider } from "./shared";

/**
 * Activate a saved account by writing its credential to the provider's live
 * location. When `name` is omitted the user picks interactively.
 */
export async function runSwitch(provider: Provider, name?: string): Promise<void> {
  const store = await Store.load();
  let account: StoredAccount;
  if (name) {
    const found = store.get(provider.id, name);
    if (!found) {
      throw new MultiAccountError(
        `No saved ${provider.displayName} account named "${name}".`,
        `See your accounts with: multi-account list ${provider.id}`,
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
