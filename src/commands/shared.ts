import { select } from "@inquirer/prompts";
import pc from "picocolors";
import { authTag, classifyAuth } from "../core/auth-status";
import type { Store, StoredAccount } from "../core/store";
import { getProvider, providerIds, providers } from "../providers/registry";
import type { Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";

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

/** Format an account for display: `name (label) [active] <status>`. */
export function formatAccount(account: StoredAccount, activeName?: string, statusTag?: string): string {
  const parts = [pc.bold(account.name)];
  if (account.label) {
    parts.push(pc.dim(`(${account.label})`));
  }
  if (account.name === activeName) {
    parts.push(pc.green("[active]"));
  }
  if (statusTag) {
    parts.push(statusTag);
  }
  return parts.join(" ");
}

/** Local, no-network auth status tag for an account (empty when nothing to flag). */
export function statusTagFor(provider: Provider, account: StoredAccount): string {
  return authTag(classifyAuth(provider.describe(account.credential)));
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
    throw new ToguruError(
      `No saved ${provider.displayName} accounts yet.`,
      `Add one with: toguru add ${provider.id}`,
    );
  }
  const activeName = store.active(provider.id);
  const name = await select({
    message,
    choices: accounts.map((account) => ({
      name: formatAccount(account, activeName, statusTagFor(provider, account)),
      value: account.name,
    })),
  });
  // Selection always corresponds to an existing account.
  return store.get(provider.id, name) as StoredAccount;
}
