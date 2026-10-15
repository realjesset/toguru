import type { AccountDescriptor } from "../providers/types";

/**
 * Auth state we can determine *locally*, without contacting any provider:
 * - `valid`        — usable now.
 * - `reauth-soon`  — usable, but the login itself ends within
 *                    {@link REAUTH_WARNING_MS}; refreshing can't extend it.
 * - `expired`      — access token expired, but the credential can still refresh
 *                    itself, so the provider's CLI renews it on next use.
 * - `needs-reauth` — the credential can't recover on its own (no refresh token,
 *                    or the refresh token itself expired); log in again.
 * - `unknown`      — no expiry information was readable.
 */
export type AuthState = "valid" | "reauth-soon" | "expired" | "needs-reauth" | "unknown";

/** Matches the window in which Claude Code itself starts nagging. */
export const REAUTH_WARNING_MS = 3 * 86_400_000;

export function classifyAuth(descriptor: AccountDescriptor, now: number = Date.now()): AuthState {
  if (descriptor.authKind === "api-key") {
    return "valid";
  }
  if (descriptor.canRefresh === false) {
    return "needs-reauth";
  }
  const hardStop = descriptor.refreshExpiresAt;
  if (typeof hardStop === "number" && hardStop <= now) {
    return "needs-reauth";
  }
  if (typeof hardStop === "number" && hardStop - now <= REAUTH_WARNING_MS) {
    return "reauth-soon";
  }
  if (typeof descriptor.expiresAt === "number") {
    return descriptor.expiresAt <= now ? "expired" : "valid";
  }
  return typeof hardStop === "number" ? "valid" : "unknown";
}
