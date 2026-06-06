#!/usr/bin/env node
import { runManage } from "./commands/manage";
import { createProgram } from "./program";
import { isMultiAccountError } from "./utils/errors";
import { logger } from "./utils/logger";

async function main(argv: string[]): Promise<void> {
  const args = argv.slice(2);
  // No subcommand → interactive management hub.
  if (args.length === 0) {
    await runManage();
    return;
  }
  const program = createProgram();
  await program.parseAsync(argv);
}

function isExitPrompt(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "ExitPromptError"
  );
}

main(process.argv).catch((error: unknown) => {
  if (isExitPrompt(error)) {
    logger.info("Cancelled.");
    process.exit(130);
  }
  if (isMultiAccountError(error)) {
    logger.error(error.message);
    if (error.hint) {
      logger.hint(error.hint);
    }
    process.exit(1);
  }
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
