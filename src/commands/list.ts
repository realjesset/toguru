import { Command } from "commander";
import pc from "picocolors";
import { Store } from "../core/store";
import { getProvider, providerIds, providers } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import { logger } from "../utils/logger";
import { formatAccount } from "./shared";

interface ListOptions {
  json?: boolean;
}

function describePlan(providerId: ProviderId, account: { credential: Record<string, unknown> }): string {
  const descriptor = providers[providerId].describe(account.credential);
  const bits: string[] = [];
  if (descriptor.plan) {
    bits.push(descriptor.plan);
  }
  if (descriptor.email && descriptor.email !== "") {
    bits.push(descriptor.email);
  }
  return bits.join(" · ");
}

/** Render the saved accounts for one or all providers. */
export async function runList(providerIdsToShow: ProviderId[], options: ListOptions = {}): Promise<void> {
  const store = await Store.load();

  if (options.json) {
    const payload = providerIdsToShow.map((id) => ({
      provider: id,
      active: store.active(id) ?? null,
      accounts: store.list(id).map((account) => ({
        name: account.name,
        label: account.label ?? null,
        active: account.name === store.active(id),
        ...providers[id].describe(account.credential),
        addedAt: account.addedAt,
        updatedAt: account.updatedAt,
      })),
    }));
    logger.json(payload);
    return;
  }

  for (const id of providerIdsToShow) {
    const accounts = store.list(id);
    const activeName = store.active(id);
    logger.out(pc.bold(pc.cyan(providers[id].displayName)));
    if (accounts.length === 0) {
      logger.out(pc.dim("  (no accounts — run `multi-account add`)"));
    } else {
      for (const account of accounts) {
        const meta = describePlan(id, account);
        logger.out(`  ${formatAccount(account, activeName)}${meta ? pc.dim(`  ${meta}`) : ""}`);
      }
    }
    logger.out("");
  }
}

export function listCommand(): Command {
  return new Command("list")
    .alias("ls")
    .description("List saved accounts")
    .argument("[provider]", "limit to claude or codex")
    .option("--json", "output machine-readable JSON", false)
    .action(async (providerArg: string | undefined, opts: ListOptions) => {
      const ids = providerArg ? [getProvider(providerArg).id] : providerIds;
      await runList(ids, opts);
    });
}
