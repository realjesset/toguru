import { confirm } from "@inquirer/prompts";
import { Command } from "commander";
import { Store, type StoredAccount } from "../core/store";
import type { Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { pickAccount, resolveProvider } from "./shared";

interface RemoveOptions {
  yes?: boolean;
}

/**
 * Delete a saved account from the vault. This never touches the provider's live
 * session — it only forgets the stored copy.
 */
export async function runRemove(provider: Provider, name?: string, options: RemoveOptions = {}): Promise<void> {
  const store = await Store.load();
  let account: StoredAccount;
  if (name) {
    const found = store.get(provider.id, name);
    if (!found) {
      throw new ToguruError(`No saved ${provider.displayName} account named "${name}".`);
    }
    account = found;
  } else {
    account = await pickAccount(store, provider, `Remove which ${provider.displayName} account?`);
  }

  if (!options.yes) {
    const ok = await confirm({
      message: `Delete saved account "${account.name}"? (your live session is untouched)`,
      default: false,
    });
    if (!ok) {
      logger.warn("Aborted.");
      return;
    }
  }

  await store.remove(provider.id, account.name);
  logger.success(`Removed ${provider.displayName} account ${JSON.stringify(account.name)}.`);
}

export function removeCommand(): Command {
  return new Command("remove")
    .alias("rm")
    .description("Forget a saved account (does not log you out)")
    .argument("[provider]", "claude or codex")
    .argument("[name]", "account name to remove")
    .option("-y, --yes", "skip the confirmation prompt", false)
    .action(async (providerArg: string | undefined, nameArg: string | undefined, opts: RemoveOptions) => {
      const provider = await resolveProvider(providerArg);
      await runRemove(provider, nameArg, opts);
    });
}
