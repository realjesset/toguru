import { select, Separator } from "@inquirer/prompts";
import { Store } from "../core/store";
import { providerIds, providers } from "../providers/registry";
import type { ProviderId } from "../providers/types";
import { runAuth } from "./auth";
import { runRemove } from "./remove";
import { runRename } from "./rename";
import { formatAccount, resolveProvider } from "./shared";
import { runSwitch } from "./switch";

interface Target {
  provider: ProviderId;
  name: string;
}

type Selection = Target | "login" | "exit";
type AccountAction = "switch" | "reauth" | "rename" | "remove" | "back";

/** Run the chosen action against one profile, prompting for any extra input. */
async function manageOne(target: Target): Promise<void> {
  const provider = providers[target.provider];
  const action = await select<AccountAction>({
    message: `${provider.displayName} · ${target.name}`,
    choices: [
      { name: "Switch to this account", value: "switch" },
      { name: "Re-authenticate (opens browser)", value: "reauth" },
      { name: "Rename", value: "rename" },
      { name: "Remove", value: "remove" },
      { name: "← Back", value: "back" },
    ],
  });

  switch (action) {
    case "switch":
      await runSwitch(provider, target.name);
      return;
    case "reauth":
      await runAuth(provider, target.name);
      return;
    case "rename":
      await runRename(provider, target.name);
      return;
    case "remove":
      await runRemove(provider, target.name);
      return;
    case "back":
      return;
    default:
      return;
  }
}

/**
 * The interactive hub: list every saved profile across both providers and let
 * the user arrow-key to one and act on it (switch / re-auth / rename / remove),
 * or log in to a new account. Loops until the user exits. This backs both the
 * no-argument `macc` invocation and `macc status` on a TTY.
 */
export async function runManage(): Promise<void> {
  for (;;) {
    const store = await Store.load();

    const choices: Array<Separator | { name: string; value: Selection }> = [];
    for (const id of providerIds) {
      choices.push(new Separator(providers[id].displayName));
      const accounts = store.list(id);
      if (accounts.length === 0) {
        choices.push(new Separator("  (no accounts yet)"));
        continue;
      }
      const active = store.active(id);
      for (const account of accounts) {
        choices.push({
          name: `  ${formatAccount(account, active)}`,
          value: { provider: id, name: account.name },
        });
      }
    }
    choices.push(new Separator());
    choices.push({ name: "➕ Log in to a new account", value: "login" });
    choices.push({ name: "Exit", value: "exit" });

    const selection = await select<Selection>({
      message: "Accounts — pick one to manage",
      choices,
      pageSize: 20,
    });

    if (selection === "exit") {
      return;
    }
    if (selection === "login") {
      const provider = await resolveProvider();
      await runAuth(provider);
      continue;
    }
    await manageOne(selection);
  }
}
