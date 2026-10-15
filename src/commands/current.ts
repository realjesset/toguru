import { Command } from "commander";
import { classifyAuth } from "../core/auth-status";
import { captureHome, inspectLive, type LiveState, reconcile } from "../core/reconcile";
import { Store } from "../core/store";
import type { Provider } from "../providers/types";
import { accountRow, authSummary } from "../ui/format";
import { canPrompt } from "../ui/prompts";
import { banner, ink, mark, providerHeading } from "../ui/theme";
import { isToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { runManage } from "./manage";
import { keeperLine, PROVIDER_ARG, providersFor } from "./shared";

interface CurrentOptions {
  json?: boolean;
}

/** Machine-readable status for one provider. A pure read: nothing is written. */
async function statusJson(store: Store, provider: Provider) {
  const activeName = store.active(provider.id) ?? null;
  try {
    const { credential, match } = await inspectLive(provider, store);
    const stored = activeName ? store.get(provider.id, activeName) : undefined;
    const source = credential ?? stored?.credential;
    const descriptor = source ? provider.describe(source) : undefined;
    return {
      provider: provider.id,
      active: activeName,
      loggedIn: credential !== null,
      inSync: credential
        ? match?.name === activeName && JSON.stringify(credential) === JSON.stringify(match?.credential)
        : null,
      authState: descriptor ? classifyAuth(descriptor) : null,
      expiresAt: descriptor?.expiresAt ?? null,
      refreshExpiresAt: descriptor?.refreshExpiresAt ?? null,
      live: credential
        ? { email: descriptor?.email ?? null, saved: match !== undefined, name: match?.name ?? null }
        : null,
      homes: store
        .list(provider.id)
        .filter((account) => account.home)
        .map((account) => ({ name: account.name, home: account.home })),
    };
  } catch (error) {
    if (!isToguruError(error)) {
      throw error;
    }
    return { provider: provider.id, active: activeName, error: error.message };
  }
}

/** Human status for one provider, after reconciling it with the live session. */
async function printStatus(store: Store, provider: Provider): Promise<void> {
  logger.out(providerHeading(provider));
  let state: LiveState;
  try {
    state = await reconcile(provider, store);
  } catch (error) {
    if (!isToguruError(error)) {
      throw error;
    }
    logger.out(`  ${ink.red(mark.error)} ${error.message}`);
    if (error.hint) {
      logger.out(ink.muted(`    ${mark.hint} ${error.hint}`));
    }
    return;
  }

  if (state.kind === "logged-out") {
    logger.out(ink.muted(`  ${mark.idle} nobody signed in`));
  } else if (state.kind === "unsaved") {
    const { descriptor } = state;
    logger.out(`  ${ink.yellow(mark.live)} ${ink.bold(descriptor.email ?? "unknown account")} ${ink.muted("· live, not saved yet")}`);
    logger.out(`    ${authSummary(classifyAuth(descriptor), descriptor)}`);
    logger.out(ink.muted(`    ${mark.hint} save it: tg add ${provider.id}`));
  } else {
    const account = store.get(provider.id, state.name);
    if (account) {
      const descriptor = provider.describe(account.credential);
      const auth = classifyAuth(descriptor);
      logger.out(`  ${accountRow(provider, account, { live: true, width: 0 })}`);
      logger.out(`    ${authSummary(auth, descriptor)}`);
      if (state.adopted) {
        logger.out(ink.muted(`    ${mark.refresh} switched outside tg — now marked active`));
      } else if (state.captured) {
        logger.out(ink.muted(`    ${mark.refresh} captured a fresh token from the live session`));
      }
      if (auth === "needs-reauth" || auth === "reauth-soon") {
        logger.out(ink.muted(`    ${mark.hint} sign in again: tg ${provider.id} auth ${account.name}`));
      }
    }
  }

  // Account homes are live too, each in its own config dir.
  for (const account of store.list(provider.id).filter((candidate) => candidate.home)) {
    await captureHome(provider, store, account);
    const fresh = store.get(provider.id, account.name) ?? account;
    const descriptor = provider.describe(fresh.credential);
    logger.out(`  ${accountRow(provider, fresh, { live: false, width: 0 })} ${ink.muted("· own home")}`);
    logger.out(`    ${authSummary(classifyAuth(descriptor), descriptor)}`);
  }

  // One line about the rest, so problems with idle accounts aren't hidden.
  const others = store
    .list(provider.id)
    .filter((account) => !account.home && (state.kind !== "saved" || account.name !== state.name));
  if (others.length > 0) {
    const stale = others.filter((account) => classifyAuth(provider.describe(account.credential)) === "needs-reauth");
    const note = stale.length > 0 ? ink.red(` · ${stale.length} need${stale.length === 1 ? "s" : ""} re-auth`) : "";
    logger.out(ink.muted(`    + ${others.length} more saved${note}`));
  }
}

/** Show the live account (and auth health) for the given providers. */
export async function runCurrent(providers: readonly Provider[], options: CurrentOptions = {}): Promise<void> {
  const store = await Store.load();
  if (options.json) {
    const rows = [];
    for (const provider of providers) {
      rows.push(await statusJson(store, provider));
    }
    logger.json(rows);
    return;
  }
  logger.out(`${banner()}\n${await keeperLine()}\n`);
  for (const [index, provider] of providers.entries()) {
    if (index > 0) {
      logger.out("");
    }
    await printStatus(store, provider);
  }
}

export function currentCommand(): Command {
  return new Command("current")
    .alias("status")
    .description("Show the live account for each provider (then open the hub on a terminal)")
    .argument("[provider]", `limit to one ${PROVIDER_ARG}`)
    .option("--json", "output machine-readable JSON", false)
    .action(async (providerArg: string | undefined, opts: CurrentOptions) => {
      await runCurrent(providersFor(providerArg), opts);
      if (!opts.json && canPrompt()) {
        logger.out("");
        await runManage({ banner: false });
      }
    });
}
