#!/usr/bin/env node
import { runList } from "./commands/list";
import { runManage } from "./commands/manage";
import { createProgram } from "./program";
import { allProviders } from "./providers/registry";
import { canPrompt } from "./ui/prompts";
import { face, ink } from "./ui/theme";
import { isToguruError } from "./utils/errors";
import { logger } from "./utils/logger";

async function main(argv: string[]): Promise<void> {
  // No subcommand → the interactive hub, or a plain listing when piped.
  if (argv.length <= 2) {
    await (canPrompt() ? runManage() : runList(allProviders()));
    return;
  }
  await createProgram().parseAsync(argv);
}

main(process.argv).catch((error: unknown) => {
  if (error instanceof Error && error.name === "ExitPromptError") {
    logger.info(ink.muted(`bye ${face.wave}`));
    process.exit(130);
  }
  if (isToguruError(error)) {
    logger.error(error.message);
    if (error.hint) {
      logger.hint(error.hint);
    }
    process.exit(1);
  }
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
