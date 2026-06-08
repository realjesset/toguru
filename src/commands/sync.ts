import { Command } from "commander";
import { reconcileActive } from "../core/reconcile";
import { Store } from "../core/store";
import { getProvider, providerIds, providers } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import { logger } from "../utils/logger";

/**
 * Reconcile each provider's active profile with its live session — capturing any
 * token refresh or in-place re-auth that happened outside tg.
 */
export async function runSync(ids: ProviderId[]): Promise<void> {
  const store = await Store.load();
  for (const id of ids) {
    const provider = providers[id];
    const active = store.active(id);
    const result = await reconcileActive(provider, store);
    switch (result) {
      case "synced":
        logger.success(`${provider.displayName}: captured updated credentials for "${active}".`);
        break;
      case "in-sync":
        logger.info(`${provider.displayName}: "${active}" already up to date.`);
        break;
      case "drifted":
        logger.warn(
          `${provider.displayName}: the live session is a different account than "${active}" — run \`tg add ${id}\` to save it.`,
        );
        break;
      default:
        logger.info(`${provider.displayName}: nothing to sync.`);
        break;
    }
  }
}

export function syncCommand(): Command {
  return new Command("sync")
    .description("Capture credential refreshes / re-auths from the live session into the active profile")
    .argument("[provider]", "limit to claude or codex")
    .action(async (providerArg: string | undefined) => {
      const ids = providerArg ? [getProvider(providerArg).id] : providerIds;
      await runSync(ids);
    });
}
