import { MultiAccountError } from "../utils/errors";
import { claudeProvider } from "./claude";
import { codexProvider } from "./codex";
import type { Provider, ProviderId } from "./types";

/** All registered providers, keyed by id. */
export const providers: Record<ProviderId, Provider> = {
  claude: claudeProvider,
  codex: codexProvider,
};

/** Stable list of provider ids. */
export const providerIds: ProviderId[] = Object.keys(providers) as ProviderId[];

/** True when `value` is a known provider id. */
export function isProviderId(value: string): value is ProviderId {
  return value === "claude" || value === "codex";
}

/** Resolve a provider by id, throwing a friendly error for unknown ids. */
export function getProvider(id: string): Provider {
  if (isProviderId(id)) {
    return providers[id];
  }
  throw new MultiAccountError(
    `Unknown provider "${id}".`,
    `Valid providers are: ${providerIds.join(", ")}.`,
  );
}
