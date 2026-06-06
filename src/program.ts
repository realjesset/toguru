import { createRequire } from "node:module";
import { Command } from "commander";
import { addCommand } from "./commands/add";
import { authCommand, providerCommands } from "./commands/auth";
import { currentCommand } from "./commands/current";
import { listCommand } from "./commands/list";
import { removeCommand } from "./commands/remove";
import { renameCommand } from "./commands/rename";
import { switchCommand } from "./commands/switch";
import { exportCommand, importCommand } from "./commands/transfer";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string; description: string };

/**
 * Build the fully-wired commander program. Kept separate from the entrypoint so
 * it can be unit-tested and embedded by library consumers.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("multi-account")
    .description(pkg.description)
    .version(pkg.version, "-v, --version", "print the version number")
    .showHelpAfterError("(add --help for usage)")
    .configureHelp({ showGlobalOptions: true });

  program.addCommand(authCommand());
  program.addCommand(switchCommand());
  program.addCommand(addCommand());
  program.addCommand(listCommand());
  program.addCommand(currentCommand());
  program.addCommand(renameCommand());
  program.addCommand(removeCommand());
  program.addCommand(exportCommand());
  program.addCommand(importCommand());

  // Per-provider command groups: `macc claude auth`, `macc codex auth`, …
  for (const command of providerCommands()) {
    program.addCommand(command);
  }

  return program;
}
