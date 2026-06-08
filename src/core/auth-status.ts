import pc from "picocolors";
import type { AccountDescriptor } from "../providers/types";

/**
 * Auth state we can determine *locally*, without contacting any provider:
 * - `valid`        — the token's expiry is in the future.
 * - `expired`      — expiry passed, but the credential can still refresh itself,
 *                    so the provider's CLI will silently renew it on next use.
 * - `needs-reauth` — the credential has no refresh token, so it cannot recover
 *                    on its own; the user must log in again.
 * - `unknown`      — no expiry information was readable.
 */
export type AuthState = "valid" | "expired" | "needs-reauth" | "unknown";

export function classifyAuth(descriptor: AccountDescriptor, now: number = Date.now()): AuthState {
  if (descriptor.canRefresh === false) {
    return "needs-reauth";
  }
  if (typeof descriptor.expiresAt === "number") {
    return descriptor.expiresAt <= now ? "expired" : "valid";
  }
  return "unknown";
}

/** Compact coloured tag for menus and lists. Empty for the quiet states. */
export function authTag(state: AuthState): string {
  switch (state) {
    case "expired":
      return pc.yellow("⟳ expired");
    case "needs-reauth":
      return pc.red("⚠ re-auth");
    default:
      return "";
  }
}

/** A human, one-line description for status output. */
export function authSummary(
  state: AuthState,
  expiresAt: number | undefined,
  now: number = Date.now(),
): string {
  switch (state) {
    case "valid":
      return pc.green(`✓ signed in${expiresAt ? ` (token expires ${relativeTime(expiresAt, now)})` : ""}`);
    case "expired":
      return pc.yellow(
        `⟳ token expired${expiresAt ? ` ${relativeTime(expiresAt, now)}` : ""} — refreshes automatically`,
      );
    case "needs-reauth":
      return pc.red("⚠ re-authentication needed (no refresh token)");
    default:
      return pc.dim("· auth status unknown");
  }
}

/** Short relative time like "in 7 hours" / "2 days ago". */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = timestamp - now;
  const abs = Math.abs(diff);
  const day = 86_400_000;
  const hour = 3_600_000;
  const minute = 60_000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs >= day) {
    return rtf.format(Math.round(diff / day), "day");
  }
  if (abs >= hour) {
    return rtf.format(Math.round(diff / hour), "hour");
  }
  return rtf.format(Math.round(diff / minute), "minute");
}
