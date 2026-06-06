import { Command } from "commander";
import type { Provider } from "../providers/types";
import { MultiAccountError } from "../utils/errors";
import { logger } from "../utils/logger";
import { runAdd } from "./add";
import { resolveProvider } from "./shared";

/**
 * Delegate to the provider's own login flow (when it has one), then capture the
 * resulting session as a saved account. Providers without an automated login
 * get a helpful pointer instead.
 */
export async function runLogin(provider: Provider, name?: string): Promise<void> {
  if (!provider.login) {
    throw new MultiAccountError(
      `${provider.displayName} has no automated login.`,
      `Log in with its own CLI, then run: multi-account add ${provider.id}`,
    );
  }
  logger.info(`Starting ${provider.displayName} login…`);
  await provider.login();
  await runAdd(provider, { name, activate: true });
}

export function loginCommand(): Command {
  return new Command("login")
    .description("Run a provider's login flow, then save the new session")
    .argument("[provider]", "claude or codex")
    .argument("[name]", "account name to save the session as")
    .action(async (providerArg: string | undefined, nameArg: string | undefined) => {
      const provider = await resolveProvider(providerArg);
      await runLogin(provider, nameArg);
    });
}
