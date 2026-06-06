import { input } from "@inquirer/prompts";
import { Command } from "commander";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { validateAccountName } from "../utils/strings";
import { pickAccount, resolveProvider } from "./shared";

/** Rename a saved account, prompting for any missing argument. */
export async function runRename(provider: Provider, from?: string, to?: string): Promise<void> {
  const store = await Store.load();
  const source = from
    ? store.get(provider.id, from)
    : await pickAccount(store, provider, `Rename which ${provider.displayName} account?`);
  if (!source) {
    throw new ToguruError(`No saved ${provider.displayName} account named "${from}".`);
  }

  let target = to?.trim();
  if (!target) {
    target = await input({
      message: `New name for "${source.name}"`,
      validate: validateAccountName,
    });
  } else {
    const valid = validateAccountName(target);
    if (valid !== true) {
      throw new ToguruError(valid);
    }
  }

  await store.rename(provider.id, source.name, target);
  logger.success(`Renamed ${provider.displayName} account "${source.name}" → ${JSON.stringify(target)}.`);
}

export function renameCommand(): Command {
  return new Command("rename")
    .alias("mv")
    .description("Rename a saved account")
    .argument("[provider]", "claude or codex")
    .argument("[old]", "current account name")
    .argument("[new]", "new account name")
    .action(async (providerArg: string | undefined, oldArg: string | undefined, newArg: string | undefined) => {
      const provider = await resolveProvider(providerArg);
      await runRename(provider, oldArg, newArg);
    });
}
