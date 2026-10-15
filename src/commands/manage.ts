import { classifyAuth } from "../core/auth-status";
import { keeperHint } from "../core/keeper";
import { captureHome, type LiveState, reconcile } from "../core/reconcile";
import { Store } from "../core/store";
import { allProviders, providerById, providerProblems } from "../providers/registry";
import type { Provider } from "../providers/types";
import { accountRow, authSummary, nameWidth } from "../ui/format";
import { type Choice, choose, Separator } from "../ui/prompts";
import { banner, face, ink, providerHeading } from "../ui/theme";
import { isToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { runAdd } from "./add";
import { runAuth } from "./auth";
import { runHome, runInHome } from "./home";
import { runRemove } from "./remove";
import { runRename } from "./rename";
import { keeperLine, resolveProvider } from "./shared";
import { runSwitch } from "./switch";

type Selection =
  | { kind: "account"; provider: string; name: string }
  | { kind: "save"; provider: string }
  | { kind: "login" }
  | { kind: "exit" };

type AccountAction = "switch" | "run" | "reauth" | "home" | "leave" | "rename" | "remove" | "back";

/** Run the chosen action against one profile, prompting for any extra input. */
async function manageOne(provider: Provider, name: string): Promise<void> {
  const store = await Store.load();
  const account = store.get(provider.id, name);
  if (!account) {
    return;
  }
  const live = store.active(provider.id) === name;
  const homeChoices: Array<Choice<AccountAction>> = account.home
    ? [
        { name: `${ink.pink("▶")} Run ${provider.homes?.command ?? provider.id} in its home`, value: "run", short: "run" },
        { name: `${ink.blue("⌂")} Leave its home (back to switching)`, value: "leave", short: "leave home" },
      ]
    : provider.homes
      ? [
          {
            name: `${ink.blue("⌂")} Move into its own home (no more copies)`,
            value: "home",
            short: "move home",
            disabled: live ? "(live now — switch away first)" : false,
          },
        ]
      : [];
  const action = await choose<AccountAction>({
    message: `${provider.displayName} · ${ink.bold(name)}`,
    need: "an action",
    choices: [
      // The live profile is already switched to; a home profile isn't switched at all.
      ...(account.home || live
        ? []
        : [{ name: `${ink.pink("⇄")} Switch to this account`, value: "switch" as const, short: "switch" }]),
      { name: `${ink.blue("⟳")} Re-authenticate (opens browser)`, value: "reauth", short: "re-auth" },
      ...homeChoices,
      { name: `${ink.lavender("✎")} Rename`, value: "rename", short: "rename" },
      { name: `${ink.red("✖")} Remove`, value: "remove", short: "remove" },
      { name: `${ink.muted("←")} Back`, value: "back", short: "back" },
    ],
  });

  switch (action) {
    case "switch":
      await runSwitch(provider, name);
      return;
    case "run":
      await runInHome(provider, name, []);
      return;
    case "home":
      await runHome(provider, name);
      return;
    case "leave":
      await runHome(provider, name, { leave: true });
      return;
    case "reauth":
      await runAuth(provider, name);
      return;
    case "rename":
      await runRename(provider, name);
      return;
    case "remove":
      await runRemove(provider, name);
      return;
    default:
      return;
  }
}

/** Menu rows for one provider: its accounts, plus a "save" row for an unsaved live login. */
async function providerChoices(store: Store, provider: Provider): Promise<Array<Separator | Choice<Selection>>> {
  const rows: Array<Separator | Choice<Selection>> = [new Separator(providerHeading(provider))];
  // Capture any refresh / outside switch first, so the hub reflects reality.
  let live: LiveState;
  try {
    live = await reconcile(provider, store);
    for (const account of store.list(provider.id).filter((candidate) => candidate.home)) {
      await captureHome(provider, store, account);
    }
  } catch (error) {
    if (!isToguruError(error)) {
      throw error;
    }
    rows.push(new Separator(ink.red(`  ✖ ${error.message}`)));
    return rows;
  }

  const accounts = store.list(provider.id);
  const active = store.active(provider.id);
  const width = nameWidth(accounts);
  for (const account of accounts) {
    const descriptor = provider.describe(account.credential);
    rows.push({
      name: accountRow(provider, account, { live: account.name === active, width }),
      value: { kind: "account", provider: provider.id, name: account.name },
      short: account.name,
      description: `${authSummary(classifyAuth(descriptor), descriptor)}${account.home ? ink.muted(" · lives in its own home") : ""}`,
    });
  }
  if (live.kind === "unsaved") {
    rows.push({
      name: ink.yellow(`✚ Save the live session${live.descriptor.email ? ` (${live.descriptor.email})` : ""}`),
      value: { kind: "save", provider: provider.id },
      short: "save",
      description: ink.muted("Signed in, but not saved in tg yet — save it so switching away doesn't lose it."),
    });
  } else if (accounts.length === 0) {
    rows.push(new Separator(ink.muted("  no accounts yet")));
  }
  return rows;
}

/**
 * The interactive hub: every saved profile across all providers; arrow-key to
 * one and act on it (switch / run in its home / re-auth / rename / remove),
 * save an unsaved live session, or log in to a new account. Loops until the
 * user exits. This backs both the no-argument `tg` invocation and `tg status`
 * on a TTY.
 */
export async function runManage(options: { banner?: boolean } = {}): Promise<void> {
  if (options.banner !== false) {
    logger.out(`${banner()}\n${await keeperLine()}\n`);
  }
  for (const problem of providerProblems()) {
    logger.warn(`Skipped a provider definition — ${problem}`);
  }
  for (;;) {
    const store = await Store.load();
    const choices: Array<Separator | Choice<Selection>> = [];
    for (const provider of allProviders()) {
      choices.push(...(await providerChoices(store, provider)));
    }
    choices.push(new Separator(" "));
    choices.push({
      name: `${ink.pink("✚")} Log in to a new account`,
      value: { kind: "login" },
      short: "log in",
    });
    choices.push({ name: `${ink.muted("✕")} Exit`, value: { kind: "exit" }, short: "exit" });

    const selection = await choose<Selection>({
      message: "Pick an account",
      need: "a selection",
      choices,
      pageSize: 20,
    });
    if (selection.kind === "exit") {
      const hint = await keeperHint();
      if (hint) {
        logger.hint(hint);
      }
      logger.out(ink.muted(`bye ${face.wave}`));
      return;
    }
    try {
      if (selection.kind === "login") {
        await runAuth(await resolveProvider());
      } else if (selection.kind === "save") {
        await runAdd(providerById(selection.provider));
      } else {
        await manageOne(providerById(selection.provider), selection.name);
      }
    } catch (error) {
      // Keep the hub open on expected failures (cancelled login, bad name…).
      if (!isToguruError(error)) {
        throw error;
      }
      logger.error(error.message);
      if (error.hint) {
        logger.hint(error.hint);
      }
    }
    logger.out("");
  }
}
