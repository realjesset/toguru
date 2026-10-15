import { keeperStatus } from "../core/keeper";
import type { Store, StoredAccount } from "../core/store";
import { allProviders, getProvider } from "../providers/registry";
import type { Provider } from "../providers/types";
import { accountRow, nameWidth } from "../ui/format";
import { choose } from "../ui/prompts";
import { ink, mark, providerHeading } from "../ui/theme";
import { ToguruError } from "../utils/errors";

/** Argument help for provider positionals. */
export const PROVIDER_ARG = "provider (claude | codex | a declared one — see `tg providers`)";

/** One line about the background keeper, for the hub and status. */
export async function keeperLine(): Promise<string> {
  const { running, pid } = await keeperStatus();
  return running
    ? ink.sumi(`  ${ink.matcha(mark.ok)} 見張り番 keeper is watching (pid ${pid})`)
    : ink.sumi(`  ${mark.idle} 見張り番 keeper is off — tg keeper start`);
}

/**
 * Resolve a provider from an optional argument (id or alias), prompting
 * interactively when it is omitted.
 */
export async function resolveProvider(name?: string): Promise<Provider> {
  if (name) {
    return getProvider(name);
  }
  return choose({
    message: "Which provider?  どれ？",
    need: "a provider",
    choices: allProviders().map((provider) => ({
      name: providerHeading(provider),
      value: provider,
      short: provider.displayName,
    })),
  });
}

/** Providers named by an optional argument: that one, or all of them. */
export function providersFor(name: string | undefined): readonly Provider[] {
  return name ? [getProvider(name)] : allProviders();
}

/**
 * Find a saved account by name — or by its label/email when exactly one
 * account matches, since names and emails are easy to mix up.
 */
export function findAccount(store: Store, provider: Provider, query: string): StoredAccount {
  const exact = store.get(provider.id, query);
  if (exact) {
    return exact;
  }
  const wanted = query.toLowerCase();
  const matches = store
    .list(provider.id)
    .filter(
      (account) =>
        account.label?.toLowerCase() === wanted ||
        provider.describe(account.credential).email?.toLowerCase() === wanted,
    );
  const [only] = matches;
  if (only && matches.length === 1) {
    return only;
  }
  throw new ToguruError(
    `No saved ${provider.displayName} account named "${query}".`,
    `See your accounts with: tg list ${provider.id}`,
  );
}

/**
 * Prompt the user to pick one of a provider's saved accounts. Throws a friendly
 * error when none exist.
 */
export async function pickAccount(
  store: Store,
  provider: Provider,
  message: string,
  filter: (account: StoredAccount) => boolean = () => true,
): Promise<StoredAccount> {
  const accounts = store.list(provider.id).filter(filter);
  if (accounts.length === 0) {
    throw new ToguruError(
      `No saved ${provider.displayName} accounts to pick from.`,
      `Log in and save one with: tg ${provider.id} auth`,
    );
  }
  const active = store.active(provider.id);
  const width = nameWidth(accounts);
  const name = await choose({
    message,
    need: "an account name",
    choices: accounts.map((account) => ({
      name: accountRow(provider, account, { live: account.name === active, width }),
      value: account.name,
      short: account.name,
    })),
  });
  // Selection always corresponds to an existing account.
  return store.get(provider.id, name) as StoredAccount;
}
