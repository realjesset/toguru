import type { HomeSupport, Slot } from "./types";

/**
 * Environment for running a provider's CLI against `slot`: the default slot is
 * the current environment; an account home sets the provider's config-dir env
 * var and clears overrides that would otherwise win over it.
 */
export function envForSlot(homes: HomeSupport | undefined, slot?: Slot): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!homes || slot?.dir === undefined) {
    return env;
  }
  for (const name of homes.clear ?? []) {
    delete env[name];
  }
  env[homes.env] = slot.dir;
  return env;
}
