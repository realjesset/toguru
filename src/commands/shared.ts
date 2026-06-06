import { select } from "@inquirer/prompts";
import pc from "picocolors";
import type { Store, StoredAccount } from "../core/store";
import { getProvider, providerIds, providers } from "../providers/registry";
import type { Provider } from "../providers/types";
import { MultiAccountError } from "../utils/errors";

/**
 * Resolve a provider from an optional argument, prompting interactively when it
 * is omitted.
 */
export async function resolveProvider(id?: string): Promise<Provider> {
  if (id) {
    return getProvider(id);
  }
  const choice = await select<Provider["id"]>({
    message: "Which provider?",
    choices: providerIds.map((pid) => ({
      name: providers[pid].displayName,
      value: pid,
    })),
  });
  return providers[choice];
}

/** Format an account for display: `name (label) [active]`. */
export function formatAccount(account: StoredAccount, activeName?: string): string {
  const parts = [pc.bold(account.name)];
  if (account.label) {
    parts.push(pc.dim(`(${account.label})`));
  }
  if (account.name === activeName) {
    parts.push(pc.green("[active]"));
  }
  return parts.join(" ");
}

/**
 * Prompt the user to pick one of a provider's saved accounts. Throws a friendly
 * error when none exist.
 */
export async function pickAccount(
  store: Store,
  provider: Provider,
  message: string,
): Promise<StoredAccount> {
  const accounts = store.list(provider.id);
  if (accounts.length === 0) {
    throw new MultiAccountError(
      `No saved ${provider.displayName} accounts yet.`,
      `Add one with: multi-account add ${provider.id}`,
    );
  }
  const activeName = store.active(provider.id);
  const name = await select({
    message,
    choices: accounts.map((account) => ({
      name: formatAccount(account, activeName),
      value: account.name,
    })),
  });
  // Selection always corresponds to an existing account.
  return store.get(provider.id, name) as StoredAccount;
}
