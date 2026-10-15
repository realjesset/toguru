import path from "node:path";
import { Command } from "commander";
import { envScript, leaveHome, moveIntoHome, requireHome, requireHomes } from "../core/homes";
import { captureHome } from "../core/reconcile";
import { Store } from "../core/store";
import { envForSlot } from "../providers/slot";
import type { Provider } from "../providers/types";
import { ink, kao } from "../ui/theme";
import { ToguruError } from "../utils/errors";
import { logger } from "../utils/logger";
import { runAttached } from "../utils/proc";
import { runAuth } from "./auth";
import { findAccount, PROVIDER_ARG, pickAccount, resolveProvider } from "./shared";

interface HomeOptions {
  login?: boolean;
  leave?: boolean;
}

/**
 * Give a profile its own account home — a config dir of its own that the
 * provider's CLI runs against — or bring it back (`leave`). With `login`, a new
 * profile is created by signing in inside a fresh home.
 */
export async function runHome(provider: Provider, name?: string, options: HomeOptions = {}): Promise<void> {
  requireHomes(provider);
  if (options.login) {
    if (!name) {
      throw new ToguruError("A new home needs a profile name.", `e.g. tg home ${provider.id} work --login`);
    }
    await runAuth(provider, name, { home: true });
    return;
  }
  const store = await Store.load();
  const account = name
    ? findAccount(store, provider, name)
    : await pickAccount(
        store,
        provider,
        options.leave ? "Which profile should leave its home?" : "Which profile gets its own home?",
        (candidate) => Boolean(candidate.home) === Boolean(options.leave),
      );

  if (options.leave) {
    await leaveHome(provider, store, account);
    logger.success(`${ink.bold(account.name)} left its home; switch to it with tg switch ${provider.id} ${account.name}`);
    return;
  }
  const dir = await moveIntoHome(provider, store, account);
  logger.success(`${ink.bold(account.name)} now lives in its own home  ${ink.sakura(kao.cheer)}`);
  logger.hint(ink.sumi(dir));
  logger.hint(`Run it: tg run ${provider.id} ${account.name}   ·   or in this shell: eval "$(tg env ${provider.id} ${account.name})"`);
}

/** Start the provider's CLI inside a profile's home, returning its exit code. */
export async function runInHome(provider: Provider, name: string, args: string[]): Promise<number> {
  const homes = requireHomes(provider);
  const store = await Store.load();
  const account = findAccount(store, provider, name);
  const dir = requireHome(provider, account);
  const code = await runAttached(homes.command, args, envForSlot(homes, { dir }));
  // Mirror whatever the CLI refreshed while it ran.
  await captureHome(provider, store, account);
  return code;
}

type Shell = "posix" | "fish" | "powershell";

function detectShell(): Shell {
  if (process.platform === "win32") {
    return "powershell";
  }
  return path.basename(process.env.SHELL ?? "") === "fish" ? "fish" : "posix";
}

export function homeCommand(): Command {
  return new Command("home")
    .description("Give a profile its own config dir, so its CLI keeps the only copy of the login")
    .argument("[provider]", PROVIDER_ARG)
    .argument("[name]", "profile to move into (or out of) its own home")
    .option("--login", "create a new profile by logging in inside a fresh home", false)
    .option("--leave", "move the profile back to the vault (switchable again)", false)
    .action(async (providerArg: string | undefined, nameArg: string | undefined, opts: HomeOptions) => {
      const provider = await resolveProvider(providerArg);
      await runHome(provider, nameArg, opts);
    });
}

export function runCommand(): Command {
  return new Command("run")
    .description("Run a provider's CLI as a profile that lives in its own home (e.g. tg run claude work -- --resume)")
    .argument("<provider>", PROVIDER_ARG)
    .argument("<name>", "profile with a home")
    .argument("[args...]", "arguments passed to the CLI")
    .passThroughOptions()
    .allowUnknownOption()
    .action(async (providerArg: string, nameArg: string, args: string[]) => {
      const provider = await resolveProvider(providerArg);
      process.exitCode = await runInHome(provider, nameArg, args);
    });
}

export function envCommand(): Command {
  return new Command("env")
    .description('Print shell lines that point this shell at a profile\'s home: eval "$(tg env claude work)"')
    .argument("<provider>", PROVIDER_ARG)
    .argument("<name>", "profile with a home")
    .option("--shell <shell>", "posix, fish or powershell (default: detected)")
    .action(async (providerArg: string, nameArg: string, opts: { shell?: string }) => {
      const provider = await resolveProvider(providerArg);
      const homes = requireHomes(provider);
      const store = await Store.load();
      const dir = requireHome(provider, findAccount(store, provider, nameArg));
      const shell = opts.shell ?? detectShell();
      if (shell !== "posix" && shell !== "fish" && shell !== "powershell") {
        throw new ToguruError(`Unknown shell "${shell}".`, "Use posix, fish or powershell.");
      }
      logger.out(envScript(homes, dir, shell));
    });
}
