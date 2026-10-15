import { Command } from "commander";
import { discardHome } from "../core/homes";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { agree } from "../ui/prompts";
import { ink } from "../ui/theme";
import { logger } from "../utils/logger";
import { findAccount, PROVIDER_ARG, pickAccount, resolveProvider } from "./shared";

interface RemoveOptions {
  yes?: boolean;
}

/**
 * Delete a saved account from the vault. This never touches the provider's
 * default live session — it only forgets the stored copy. A profile that lives
 * in its own home takes the home (and its login) with it.
 */
export async function runRemove(provider: Provider, name?: string, options: RemoveOptions = {}): Promise<void> {
  const store = await Store.load();
  const account = name
    ? findAccount(store, provider, name)
    : await pickAccount(store, provider, `Remove which ${provider.displayName} account?`);

  if (!options.yes) {
    const ok = await agree({
      message: account.home
        ? `Forget "${account.name}" and delete its home (that login goes with it)?`
        : `Forget "${account.name}"? (your live session is untouched)`,
      need: "confirmation (pass --yes)",
      default: false,
    });
    if (!ok) {
      logger.warn("Aborted.");
      return;
    }
  }

  const wasLive = store.active(provider.id) === account.name;
  await store.remove(provider.id, account.name);
  if (account.home) {
    await discardHome(provider, account.home);
  }
  logger.success(`Removed ${provider.displayName} account ${ink.bold(account.name)}. さようなら`);
  if (wasLive) {
    logger.hint(`${provider.displayName} is still signed in as it; save it again any time with: tg add ${provider.id}`);
  }
}

export function removeCommand(): Command {
  return new Command("remove")
    .alias("rm")
    .description("Forget a saved account (does not log you out)")
    .argument("[provider]", PROVIDER_ARG)
    .argument("[name]", "account name to remove")
    .option("-y, --yes", "skip the confirmation prompt", false)
    .action(async (providerArg: string | undefined, nameArg: string | undefined, opts: RemoveOptions) => {
      const provider = await resolveProvider(providerArg);
      await runRemove(provider, nameArg, opts);
    });
}
