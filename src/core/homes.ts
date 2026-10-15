import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { HomeSupport, Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { homesDir } from "./paths";
import { captureHome } from "./reconcile";
import type { Store, StoredAccount } from "./store";

/** The provider's home support, or a friendly error when it has none. */
export function requireHomes(provider: Provider): HomeSupport {
  if (!provider.homes) {
    throw new ToguruError(
      `${provider.displayName} can't be pointed at another config dir, so it can't have account homes.`,
      provider.source ? `Add "dirEnv" to ${provider.source} if its CLI supports one.` : undefined,
    );
  }
  return provider.homes;
}

/** Where a profile's home lives: `~/.toguru/homes/<provider>/<name>`. */
export function homePath(provider: Provider, name: string): string {
  return path.join(homesDir(), provider.id, name);
}

/** A profile that lives in a home, or a friendly error. */
export function requireHome(provider: Provider, account: StoredAccount): string {
  if (!account.home) {
    throw new ToguruError(
      `"${account.name}" doesn't have an account home yet.`,
      `Give it one with: tg home ${provider.id} ${account.name}`,
    );
  }
  return account.home;
}

/**
 * Create the directory for a home: the provider's non-credential state
 * (settings, prompts…) linked from its default config dir, plus whatever the
 * provider seeds a fresh config dir with.
 */
export async function prepareHome(provider: Provider, dir: string): Promise<void> {
  const homes = requireHomes(provider);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const base = homes.baseDir();
  for (const entry of homes.shared) {
    const source = path.join(base, entry);
    const target = path.join(dir, entry);
    if (existsSync(source) && !existsSync(target)) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.symlink(source, target);
    }
  }
  await homes.prepare?.(dir);
}

/**
 * Move a saved profile into its own home. Its credential is written into the
 * home once; from then on the provider's CLI (run with `tg run` / `tg env`)
 * owns that login and keeps it fresh, and the vault only mirrors it.
 *
 * Refused while the profile is live in the default slot: both copies would
 * share one refresh-token family and the first refresh would kill the other.
 */
export async function moveIntoHome(provider: Provider, store: Store, account: StoredAccount): Promise<string> {
  requireHomes(provider);
  if (account.home) {
    return account.home;
  }
  if (store.active(provider.id) === account.name) {
    throw new ToguruError(
      `"${account.name}" is live in ${provider.displayName}'s default slot, so moving it would leave two copies of one login.`,
      `Switch the default slot to another account first, or start the home with a fresh login: tg home ${provider.id} <new-name> --login`,
    );
  }
  const dir = homePath(provider, account.name);
  await prepareHome(provider, dir);
  await provider.writeActive(account.credential, { dir });
  await store.setHome(provider.id, account.name, dir);
  return dir;
}

/**
 * Bring a home profile back into the vault-only model: capture its newest
 * credential, then delete the home and the credentials it kept, so exactly one
 * copy of the login remains.
 */
export async function leaveHome(provider: Provider, store: Store, account: StoredAccount): Promise<void> {
  const dir = requireHome(provider, account);
  await captureHome(provider, store, account);
  await store.setHome(provider.id, account.name, undefined);
  await discardHome(provider, dir);
}

/** Delete a home directory and any credential it kept elsewhere. */
export async function discardHome(provider: Provider, dir: string): Promise<void> {
  await provider.homes?.discard?.(dir);
  // Only ever delete inside our own homes directory.
  const root = path.resolve(homesDir());
  if (path.resolve(dir).startsWith(root + path.sep)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Shell lines that point the current shell at a home (`eval "$(tg env …)"`). */
export function envScript(homes: HomeSupport, dir: string, shell: "posix" | "fish" | "powershell"): string {
  const clear = homes.clear ?? [];
  switch (shell) {
    case "fish":
      return [...clear.map((name) => `set -e ${name}`), `set -gx ${homes.env} ${quote(dir)}`].join("\n");
    case "powershell":
      return [
        ...clear.map((name) => `Remove-Item Env:${name} -ErrorAction SilentlyContinue`),
        `$env:${homes.env} = "${dir.replaceAll('"', '`"')}"`,
      ].join("\n");
    default:
      return [...clear.map((name) => `unset ${name}`), `export ${homes.env}=${quote(dir)}`].join("\n");
  }
}
