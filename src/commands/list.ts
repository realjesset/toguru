import { Command } from "commander";
import { classifyAuth } from "../core/auth-status";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { accountRow, nameWidth } from "../ui/format";
import { ink, providerHeading } from "../ui/theme";
import { logger } from "../utils/logger";
import { PROVIDER_ARG, providersFor } from "./shared";

interface ListOptions {
  json?: boolean;
}

/** Render the saved accounts for the given providers. */
export async function runList(providers: readonly Provider[], options: ListOptions = {}): Promise<void> {
  const store = await Store.load();

  if (options.json) {
    const payload = providers.map((provider) => ({
      provider: provider.id,
      active: store.active(provider.id) ?? null,
      accounts: store.list(provider.id).map((account) => {
        const descriptor = provider.describe(account.credential);
        return {
          name: account.name,
          label: account.label ?? null,
          active: account.name === store.active(provider.id),
          home: account.home ?? null,
          ...descriptor,
          authState: classifyAuth(descriptor),
          addedAt: account.addedAt,
          updatedAt: account.updatedAt,
        };
      }),
    }));
    logger.json(payload);
    return;
  }

  for (const provider of providers) {
    const accounts = store.list(provider.id);
    const active = store.active(provider.id);
    logger.out(providerHeading(provider));
    if (accounts.length === 0) {
      logger.out(ink.sumi(`  まだありません · no accounts yet — tg ${provider.id} auth`));
    }
    const width = nameWidth(accounts);
    for (const account of accounts) {
      logger.out(`  ${accountRow(provider, account, { live: account.name === active, width })}`);
    }
    logger.out("");
  }
}

export function listCommand(): Command {
  return new Command("list")
    .alias("ls")
    .description("List saved accounts")
    .argument("[provider]", `limit to one ${PROVIDER_ARG}`)
    .option("--json", "output machine-readable JSON", false)
    .action(async (providerArg: string | undefined, opts: ListOptions) => {
      await runList(providersFor(providerArg), opts);
    });
}
