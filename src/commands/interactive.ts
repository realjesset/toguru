import { select } from "@inquirer/prompts";
import { runAdd } from "./add";
import { runAuth } from "./auth";
import { runCurrent } from "./current";
import { runList } from "./list";
import { runRemove } from "./remove";
import { runRename } from "./rename";
import { runSwitch } from "./switch";
import { resolveProvider } from "./shared";

type Action = "switch" | "auth" | "add" | "list" | "current" | "rename" | "remove";

/**
 * The no-argument experience: pick a provider, then an action. Each action
 * reuses the same logic as its command, so behaviour stays identical.
 */
export async function runInteractive(): Promise<void> {
  const provider = await resolveProvider();

  const action = await select<Action>({
    message: `${provider.displayName} — what would you like to do?`,
    choices: [
      { name: "Switch account", value: "switch" },
      { name: "Log in / re-authenticate (opens browser)", value: "auth" },
      { name: "Save current session", value: "add" },
      { name: "List accounts", value: "list" },
      { name: "Show current account", value: "current" },
      { name: "Rename an account", value: "rename" },
      { name: "Remove an account", value: "remove" },
    ],
  });

  switch (action) {
    case "switch":
      await runSwitch(provider);
      return;
    case "auth":
      await runAuth(provider);
      return;
    case "add":
      await runAdd(provider, { activate: true });
      return;
    case "list":
      await runList([provider.id]);
      return;
    case "current":
      await runCurrent([provider.id]);
      return;
    case "rename":
      await runRename(provider);
      return;
    case "remove":
      await runRemove(provider);
      return;
    default:
      return;
  }
}
