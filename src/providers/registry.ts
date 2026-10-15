import { providersDir } from "../core/paths";
import { ToguruError } from "../utils/errors";
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import { type DeclaredProviders, loadDeclaredProviders } from "./declared";
import type { Provider, ProviderId } from "./types";

/** Providers that ship with toguru. */
export const builtinProviders: readonly Provider[] = [claudeProvider, codexProvider];

interface Registry extends DeclaredProviders {
  dir: string;
  all: Provider[];
}

let cached: Registry | undefined;

/**
 * Built-ins plus the providers declared in `~/.toguru/providers/*.json`,
 * loaded once per data dir (tests point `TOGURU_HOME` elsewhere).
 */
function registry(): Registry {
  const dir = providersDir();
  if (cached?.dir === dir) {
    return cached;
  }
  const taken = new Set(builtinProviders.flatMap((provider) => [provider.id, ...provider.aliases]));
  const declared = loadDeclaredProviders(dir, taken);
  cached = { dir, ...declared, all: [...builtinProviders, ...declared.providers] };
  return cached;
}

/** Every registered provider, built-ins first. */
export function allProviders(): readonly Provider[] {
  return registry().all;
}

/** Stable list of provider ids. */
export function providerIds(): ProviderId[] {
  return registry().all.map((provider) => provider.id);
}

/** Why declared providers were skipped (bad JSON, clashing ids…). */
export function providerProblems(): readonly string[] {
  return registry().problems;
}

/** True when `value` is a registered provider id. */
export function isProviderId(value: string): boolean {
  return registry().all.some((provider) => provider.id === value);
}

/** Find a provider by id or alias (case-insensitive), or `undefined`. */
export function findProvider(name: string): Provider | undefined {
  const key = name.trim().toLowerCase();
  const all = registry().all;
  return all.find((provider) => provider.id === key) ?? all.find((provider) => provider.aliases.includes(key));
}

/** Resolve a provider by id or alias, throwing a friendly error for unknown names. */
export function getProvider(name: string): Provider {
  const found = findProvider(name);
  if (found) {
    return found;
  }
  const names = registry().all.map((provider) => [provider.id, ...provider.aliases].join("/"));
  throw new ToguruError(
    `Unknown provider "${name}".`,
    `Valid providers are: ${names.join(", ")}. Add your own in ${providersDir()} (see: tg providers).`,
  );
}

/** Look up a provider by exact id (e.g. one recorded in the vault). */
export function providerById(id: ProviderId): Provider {
  const found = registry().all.find((provider) => provider.id === id);
  if (!found) {
    throw new ToguruError(`Unknown provider "${id}".`, `Is its definition still in ${providersDir()}?`);
  }
  return found;
}
