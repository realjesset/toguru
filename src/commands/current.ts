import { Command } from "commander";
import pc from "picocolors";
import { Store } from "../core/store";
import { getProvider, providerIds, providers } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import { logger } from "../utils/logger";

interface CurrentOptions {
  json?: boolean;
}

/** Stable JSON string for comparing two credential blobs. */
function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

async function describeProvider(store: Store, id: ProviderId) {
  const provider = providers[id];
  const activeName = store.active(id);
  const live = await provider.readActive();
  const stored = activeName ? store.get(id, activeName) : undefined;
  // Whether the live session matches what we believe is active.
  let inSync: boolean | null = null;
  if (stored) {
    inSync = fingerprint(live) === fingerprint(stored.credential);
  }
  return { provider, activeName, live, inSync };
}

/** Show the active account (and live-sync status) for the given providers. */
export async function runCurrent(ids: ProviderId[], options: CurrentOptions = {}): Promise<void> {
  const store = await Store.load();
  const results = await Promise.all(ids.map((id) => describeProvider(store, id)));

  if (options.json) {
    logger.json(
      results.map((r) => ({
        provider: r.provider.id,
        active: r.activeName ?? null,
        loggedIn: r.live !== null,
        inSync: r.inSync,
      })),
    );
    return;
  }

  for (const { provider, activeName, live, inSync } of results) {
    const head = pc.bold(pc.cyan(provider.displayName));
    if (!activeName) {
      const note = live ? pc.dim("(logged in, not saved — run `add`)") : pc.dim("(no active account)");
      logger.out(`${head}: ${note}`);
      continue;
    }
    let status = "";
    if (inSync === false) {
      status = pc.yellow(" (live session differs — run `switch` to re-apply)");
    } else if (!live) {
      status = pc.yellow(" (no live session detected)");
    }
    logger.out(`${head}: ${pc.green(activeName)}${status}`);
  }
}

export function currentCommand(): Command {
  return new Command("current")
    .alias("status")
    .description("Show the active account for each provider")
    .argument("[provider]", "limit to claude or codex")
    .option("--json", "output machine-readable JSON", false)
    .action(async (providerArg: string | undefined, opts: CurrentOptions) => {
      const ids = providerArg ? [getProvider(providerArg).id] : providerIds;
      await runCurrent(ids, opts);
    });
}
