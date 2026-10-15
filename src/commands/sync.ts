import { Command } from "commander";
import { captureHome, type LiveState, reconcile } from "../core/reconcile";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { ink } from "../ui/theme";
import { isToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { PROVIDER_ARG, providersFor } from "./shared";

/**
 * Reconcile each provider's live session (and every account home) with the
 * vault — capturing any token refresh, in-place re-auth or outside switch that
 * happened without tg.
 */
export async function runSync(providers: readonly Provider[]): Promise<void> {
  const store = await Store.load();
  for (const provider of providers) {
    const head = `${provider.displayName}:`;
    let state: LiveState;
    try {
      state = await reconcile(provider, store);
    } catch (error) {
      if (!isToguruError(error)) {
        throw error;
      }
      logger.error(`${head} ${error.message}`);
      if (error.hint) {
        logger.hint(error.hint);
      }
      process.exitCode = 1;
      continue;
    }
    switch (state.kind) {
      case "saved": {
        const name = ink.bold(state.name);
        if (state.adopted) {
          logger.success(`${head} ${name} is live (switched outside tg) — marked active.`);
        } else if (state.captured) {
          logger.success(`${head} captured a fresh token for ${name}.`);
        } else {
          logger.info(`${ink.muted("·")} ${head} ${name} already up to date.`);
        }
        break;
      }
      case "unsaved":
        logger.warn(`${head} signed in as ${state.descriptor.email ?? "an account"} that isn't saved.`);
        logger.hint(`Save it with: tg add ${provider.id}`);
        break;
      default:
        logger.info(`${ink.muted("·")} ${head} nobody is signed in.`);
        break;
    }
    for (const account of store.list(provider.id).filter((candidate) => candidate.home)) {
      if (await captureHome(provider, store, account)) {
        logger.success(`${head} captured a fresh token from ${ink.bold(account.name)}'s home.`);
      }
    }
  }
}

export function syncCommand(): Command {
  return new Command("sync")
    .description("Capture token refreshes / re-auths from live sessions and homes into the vault")
    .argument("[provider]", `limit to one ${PROVIDER_ARG}`)
    .action(async (providerArg: string | undefined) => {
      await runSync(providersFor(providerArg));
    });
}
