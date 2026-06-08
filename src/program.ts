import { Command } from "commander";
import { addCommand } from "./commands/add";
import { authCommand, providerCommands } from "./commands/auth";
import { currentCommand } from "./commands/current";
import { listCommand } from "./commands/list";
import { removeCommand } from "./commands/remove";
import { renameCommand } from "./commands/rename";
import { switchCommand } from "./commands/switch";
import { syncCommand } from "./commands/sync";
import { exportCommand, importCommand } from "./commands/transfer";
import { updateCommand } from "./commands/update";
import { DESCRIPTION, VERSION } from "./version";

/**
 * Build the fully-wired commander program. Kept separate from the entrypoint so
 * it can be unit-tested and embedded by library consumers.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("toguru")
    .description(DESCRIPTION)
    .version(VERSION, "-v, --version", "print the version number")
    .showHelpAfterError("(add --help for usage)")
    .configureHelp({ showGlobalOptions: true });

  program.addCommand(authCommand());
  program.addCommand(switchCommand());
  program.addCommand(addCommand());
  program.addCommand(listCommand());
  program.addCommand(currentCommand());
  program.addCommand(syncCommand());
  program.addCommand(renameCommand());
  program.addCommand(removeCommand());
  program.addCommand(exportCommand());
  program.addCommand(importCommand());
  program.addCommand(updateCommand());

  // Per-provider command groups: `toguru claude auth`, `toguru codex auth`, …
  for (const command of providerCommands()) {
    program.addCommand(command);
  }

  return program;
}
