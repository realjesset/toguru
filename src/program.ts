import { Command } from "commander";
import { addCommand } from "./commands/add";
import { authCommand, providerCommands } from "./commands/auth";
import { currentCommand } from "./commands/current";
import { envCommand, homeCommand, runCommand } from "./commands/home";
import { keeperCommand } from "./commands/keeper";
import { listCommand } from "./commands/list";
import { providersCommand } from "./commands/providers";
import { removeCommand } from "./commands/remove";
import { renameCommand } from "./commands/rename";
import { switchCommand } from "./commands/switch";
import { syncCommand } from "./commands/sync";
import { exportCommand, importCommand } from "./commands/transfer";
import { updateCommand } from "./commands/update";
import { banner, ink } from "./ui/theme";
import { DESCRIPTION, VERSION } from "./version";

/**
 * Build the fully-wired commander program. Kept separate from the entrypoint so
 * it can be unit-tested and embedded by library consumers.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("tg")
    .description(DESCRIPTION)
    .version(VERSION, "-v, --version", "print the version number")
    .showHelpAfterError(ink.muted("(add --help for usage)"))
    // Lets `tg run claude work --resume` hand `--resume` to claude.
    .enablePositionalOptions()
    .configureHelp({
      showGlobalOptions: true,
      styleTitle: (title) => ink.bold(ink.pink(title)),
      styleSubcommandText: (text) => ink.rose(text),
      styleOptionText: (text) => ink.blue(text),
      styleArgumentText: (text) => ink.lavender(text),
    })
    .addHelpText("before", `${banner()}\n`);

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
  program.addCommand(homeCommand());
  program.addCommand(runCommand());
  program.addCommand(envCommand());
  program.addCommand(keeperCommand());
  program.addCommand(providersCommand());
  program.addCommand(updateCommand());
  // Per-provider command groups: `tg claude auth`, `tg codex auth`, …
  for (const command of providerCommands()) {
    program.addCommand(command);
  }

  return program;
}
