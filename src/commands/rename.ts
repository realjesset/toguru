import { Command } from "commander";
import { freeName } from "../core/placement";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { ask } from "../ui/prompts";
import { ink } from "../ui/theme";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { validateAccountName } from "../utils/strings";
import { findAccount, PROVIDER_ARG, pickAccount, resolveProvider } from "./shared";

/** Rename a saved account, prompting for any missing argument. */
export async function runRename(provider: Provider, from?: string, to?: string): Promise<void> {
  const store = await Store.load();
  const source = from
    ? findAccount(store, provider, from)
    : await pickAccount(store, provider, `Rename which ${provider.displayName} account?`);

  let target = to?.trim();
  if (!target) {
    target = await ask({
      message: `New name for "${source.name}"`,
      need: "the new name",
      validate: freeName(store, provider),
    });
  } else {
    const valid = validateAccountName(target);
    if (valid !== true) {
      throw new ToguruError(valid);
    }
  }
  if (target === source.name) {
    logger.info(`"${source.name}" already has that name.`);
    return;
  }

  await store.rename(provider.id, source.name, target);
  logger.success(`Renamed ${provider.displayName} account ${source.name} → ${ink.bold(target)}.`);
}

export function renameCommand(): Command {
  return new Command("rename")
    .alias("mv")
    .description("Rename a saved account")
    .argument("[provider]", PROVIDER_ARG)
    .argument("[old]", "current account name")
    .argument("[new]", "new account name")
    .action(async (providerArg: string | undefined, oldArg: string | undefined, newArg: string | undefined) => {
      const provider = await resolveProvider(providerArg);
      await runRename(provider, oldArg, newArg);
    });
}
