import { Command } from "commander";
import { placeLogin } from "../core/placement";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { terminalPrompter } from "../ui/prompts";
import { face, ink } from "../ui/theme";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { PROVIDER_ARG, resolveProvider } from "./shared";

interface AddOptions {
  label?: string;
  force?: boolean;
}

/**
 * Capture the provider's *current* live session and save it under a name. The
 * saved profile becomes active, since its credential is the live one. Without
 * a name, a login that's already saved updates its existing profile.
 */
export async function runAdd(provider: Provider, name?: string, options: AddOptions = {}): Promise<void> {
  const credential = await provider.readActive();
  if (!credential) {
    throw new ToguruError(
      `No active ${provider.displayName} session found.`,
      `Log in with the ${provider.id} CLI first, or let tg do it: tg ${provider.id} auth`,
    );
  }
  const store = await Store.load();
  const placed = await placeLogin(
    provider,
    store,
    credential,
    { kind: "add", ...(name ? { name } : {}), ...options },
    terminalPrompter(),
  );
  if (placed.kind === "declined") {
    logger.warn("Aborted.");
    return;
  }
  const shown = placed.label && placed.label !== placed.name ? ` (${placed.label})` : "";
  logger.success(`Saved ${provider.displayName} account ${ink.bold(placed.name)}${shown}  ${ink.pink(face.cheer)}`);
  if (placed.alsoSavedAs) {
    logger.hint(`The same login is also saved as "${placed.alsoSavedAs}".`);
  }
}

export function addCommand(): Command {
  return new Command("add")
    .description("Save the current live session as a named account")
    .argument("[provider]", PROVIDER_ARG)
    .argument("[name]", "account name (default: the account's email)")
    .option("-l, --label <label>", "human-friendly label (e.g. email)")
    .option("-f, --force", "overwrite an existing account without confirming", false)
    .action(async (providerArg: string | undefined, nameArg: string | undefined, opts: AddOptions) => {
      const provider = await resolveProvider(providerArg);
      await runAdd(provider, nameArg, opts);
    });
}
