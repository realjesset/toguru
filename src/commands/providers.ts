import path from "node:path";
import { Command } from "commander";
import { providersDir } from "../core/paths";
import { exampleDefinition } from "../providers/declared";
import { allProviders, findProvider, providerProblems } from "../providers/registry";
import { ink, mark, providerHeading } from "../ui/theme";
import { ToguruError } from "../utils/errors";
import { pathExists, writeJson } from "../utils/fs";
import { logger } from "../utils/logger";

/** Show every provider tg knows: built-ins and the ones declared on disk. */
export function runProviders(options: { json?: boolean } = {}): void {
  const providers = allProviders();
  if (options.json) {
    logger.json({
      dir: providersDir(),
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.displayName,
        aliases: provider.aliases,
        source: provider.source ?? "builtin",
        login: Boolean(provider.login),
        homes: provider.homes ? { env: provider.homes.env, command: provider.homes.command } : null,
      })),
      problems: providerProblems(),
    });
    return;
  }
  for (const provider of providers) {
    logger.out(providerHeading(provider));
    const bits = [
      provider.source ? ink.lavender(`declared · ${provider.source}`) : ink.muted("built-in"),
      provider.aliases.length > 0 ? ink.muted(`aliases: ${provider.aliases.join(", ")}`) : "",
      provider.login ? ink.muted("login ✓") : ink.muted("no login (use tg add)"),
      provider.homes ? ink.muted(`homes via ${provider.homes.env}`) : "",
    ].filter(Boolean);
    logger.out(`  ${ink.muted(provider.id)}  ${bits.join(ink.muted("  ·  "))}`);
  }
  logger.out("");
  logger.out(ink.muted(`Declare your own in ${providersDir()}/<id>.json — start one with: tg providers init <id>`));
  for (const problem of providerProblems()) {
    logger.warn(`Skipped: ${problem}`);
  }
}

/** Write a starter definition for a new provider. */
export async function runProvidersInit(id: string): Promise<void> {
  if (findProvider(id)) {
    throw new ToguruError(`A provider named "${id}" already exists.`);
  }
  const file = path.join(providersDir(), `${id}.json`);
  if (await pathExists(file)) {
    throw new ToguruError(`${file} already exists.`);
  }
  await writeJson(file, exampleDefinition(id));
  logger.success(`Wrote ${file}`);
  logger.hint(`Edit "dir", "files", "login" and "fields" to match the CLI, then: tg list ${id}`);
  logger.hint(`Add "dirEnv" (the CLI's config-dir env var) to unlock account homes ${ink.blue(mark.home)}`);
}

export function providersCommand(): Command {
  const command = new Command("providers")
    .description("List providers, including your own declared in ~/.toguru/providers")
    .option("--json", "output machine-readable JSON", false)
    .action((opts: { json?: boolean }) => {
      runProviders(opts);
    });
  command
    .command("init")
    .description("Write a starter definition for a new provider")
    .argument("<id>", "lowercase id, e.g. gemini")
    .action(async (id: string) => {
      await runProvidersInit(id);
    });
  return command;
}
