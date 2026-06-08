import { Command } from "commander";
import pc from "picocolors";
import { authSummary, classifyAuth } from "../core/auth-status";
import { reconcileActive } from "../core/reconcile";
import { Store } from "../core/store";
import { getProvider, providerIds, providers } from "../providers/registry";
import type { AccountDescriptor, ProviderId } from "../providers/types";
import { logger } from "../utils/logger";
import { runManage } from "./manage";

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
  let descriptor: AccountDescriptor | null = null;
  if (stored) {
    inSync = fingerprint(live) === fingerprint(stored.credential);
    descriptor = provider.describe(stored.credential);
  }
  return { provider, activeName, live, inSync, descriptor };
}

/** Show the active account (and live-sync status) for the given providers. */
export async function runCurrent(ids: ProviderId[], options: CurrentOptions = {}): Promise<void> {
  const store = await Store.load();
  // Pull in any live refresh / re-auth first (skip for --json, which should be
  // a pure read for scripts).
  if (!options.json) {
    for (const id of ids) {
      await reconcileActive(providers[id], store);
    }
  }
  const results = await Promise.all(ids.map((id) => describeProvider(store, id)));

  if (options.json) {
    logger.json(
      results.map((r) => ({
        provider: r.provider.id,
        active: r.activeName ?? null,
        loggedIn: r.live !== null,
        inSync: r.inSync,
        authState: r.descriptor ? classifyAuth(r.descriptor) : null,
        expiresAt: r.descriptor?.expiresAt ?? null,
      })),
    );
    return;
  }

  for (const { provider, activeName, live, inSync, descriptor } of results) {
    const head = pc.bold(pc.cyan(provider.displayName));
    if (!activeName) {
      const note = live ? pc.dim("(logged in, not saved — run `add`)") : pc.dim("(no active account)");
      logger.out(`${head}: ${note}`);
      continue;
    }
    let status = "";
    if (inSync === false) {
      // Same-account drift was already auto-synced above, so a remaining
      // mismatch means the live session is a *different* account.
      status = pc.yellow(" (live session is a different account — run `tg add` to save it)");
    } else if (!live) {
      status = pc.yellow(" (no live session detected)");
    }
    logger.out(`${head}: ${pc.green(activeName)}${status}`);
    if (descriptor) {
      logger.out(`  ${authSummary(classifyAuth(descriptor), descriptor.expiresAt)}`);
    }
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
      // On an interactive terminal, drop into the management hub.
      const interactive = !opts.json && Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
      if (interactive) {
        logger.out("");
        await runManage();
      }
    });
}
