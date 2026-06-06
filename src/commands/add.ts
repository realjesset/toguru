import { confirm, input } from "@inquirer/prompts";
import { Command } from "commander";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { validateAccountName } from "../utils/strings";
import { resolveProvider } from "./shared";

interface AddOptions {
  name?: string;
  label?: string;
  activate?: boolean;
  force?: boolean;
}

/**
 * Capture the provider's *current* live session and save it under a name. This
 * is the building block: log in with the provider's own CLI, then `add` to keep
 * that session around for later switching.
 */
export async function runAdd(provider: Provider, options: AddOptions = {}): Promise<void> {
  const credential = await provider.readActive();
  if (!credential) {
    throw new ToguruError(
      `No active ${provider.displayName} session found.`,
      `Log in with the ${provider.id} CLI first, then run this again.`,
    );
  }

  const suggested = await provider.suggestLabel?.();
  let name = options.name?.trim();
  if (!name) {
    name = await input({
      message: "Name this account",
      default: suggested,
      validate: validateAccountName,
    });
  } else {
    const valid = validateAccountName(name);
    if (valid !== true) {
      throw new ToguruError(valid);
    }
  }

  const store = await Store.load();
  if (store.has(provider.id, name) && !options.force) {
    const overwrite = await confirm({
      message: `Account "${name}" already exists. Overwrite it?`,
      default: false,
    });
    if (!overwrite) {
      logger.warn("Aborted.");
      return;
    }
  }

  const label = options.label ?? suggested;
  await store.upsert(provider.id, name, credential, label);
  if (options.activate) {
    await store.setActive(provider.id, name);
  }

  logger.success(
    `Saved ${provider.displayName} account ${JSON.stringify(name)}${label ? ` (${label})` : ""}.`,
  );
}

export function addCommand(): Command {
  return new Command("add")
    .description("Save the current live session as a named account")
    .argument("[provider]", "claude or codex")
    .argument("[name]", "account name")
    .option("-l, --label <label>", "human-friendly label (e.g. email)")
    .option("--activate", "also set this account as active", false)
    .option("-f, --force", "overwrite an existing account without confirming", false)
    .action(async (providerArg: string | undefined, nameArg: string | undefined, opts: AddOptions) => {
      const provider = await resolveProvider(providerArg);
      await runAdd(provider, { ...opts, name: nameArg ?? opts.name });
    });
}
