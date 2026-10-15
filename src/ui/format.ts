import { type AuthState, classifyAuth } from "../core/auth-status";
import type { StoredAccount } from "../core/store";
import type { AccountDescriptor, Provider } from "../providers/types";
import { ink, mark } from "./theme";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Short relative time like "in 7 hours" / "2 days ago". */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = timestamp - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs >= DAY) {
    return rtf.format(Math.round(diff / DAY), "day");
  }
  if (abs >= HOUR) {
    return rtf.format(Math.round(diff / HOUR), "hour");
  }
  return rtf.format(Math.round(diff / MINUTE), "minute");
}

/** Compact span for tight rows: `15m`, `7h`, `2d`. */
function shortSpan(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= DAY) {
    return `${Math.round(abs / DAY)}d`;
  }
  if (abs >= HOUR) {
    return `${Math.round(abs / HOUR)}h`;
  }
  return `${Math.max(1, Math.round(abs / MINUTE))}m`;
}

/** Compact, coloured auth badge for menus and lists. */
export function authBadge(state: AuthState, descriptor: AccountDescriptor, now: number = Date.now()): string {
  switch (state) {
    case "valid":
      return ink.matcha(mark.ok);
    case "reauth-soon":
      return ink.yuzu(`${mark.soon} re-auth in ${shortSpan((descriptor.refreshExpiresAt ?? now) - now)}`);
    case "expired":
      return ink.sumi(`${mark.refresh} auto-refresh`);
    case "needs-reauth":
      return `${ink.beni(`${mark.error} re-auth`)} ${ink.sumi("要ログイン")}`;
    default:
      return "";
  }
}

/** A sentence about an account's auth state, for status output. */
export function authSummary(state: AuthState, descriptor: AccountDescriptor, now: number = Date.now()): string {
  const { expiresAt, refreshExpiresAt } = descriptor;
  switch (state) {
    case "valid": {
      if (descriptor.authKind === "api-key") {
        return ink.matcha(`${mark.ok} API key — never expires`);
      }
      const renews = expiresAt ? ink.sumi(` · token renews ${relativeTime(expiresAt, now)}`) : "";
      const until = refreshExpiresAt ? ink.sumi(` · re-login due ${relativeTime(refreshExpiresAt, now)}`) : "";
      return `${ink.matcha(`${mark.ok} signed in`)}${renews}${until}`;
    }
    case "reauth-soon":
      return ink.yuzu(
        `${mark.soon} login ends ${relativeTime(refreshExpiresAt ?? now, now)} — refreshing can't extend it, sign in again`,
      );
    case "expired":
      return ink.sora(
        `${mark.refresh} token expired ${relativeTime(expiresAt ?? now, now)} — renews itself on next use`,
      );
    case "needs-reauth": {
      const why =
        refreshExpiresAt !== undefined && refreshExpiresAt <= now
          ? `login ended ${relativeTime(refreshExpiresAt, now)}`
          : "no refresh token";
      return ink.beni(`${mark.error} signed out (${why}) — sign in again`);
    }
    default:
      return ink.sumi("· auth status unknown");
  }
}

/** Plan, org and label/email bits that aren't already the account's name. */
export function accountMeta(account: StoredAccount, descriptor: AccountDescriptor): string {
  const bits: string[] = [];
  if (descriptor.plan) {
    bits.push(descriptor.plan);
  }
  // Personal Claude orgs are named after the email; skip that noise.
  const org = descriptor.orgName;
  if (org && !(descriptor.email && org.includes(descriptor.email))) {
    bits.push(org);
  }
  const who = account.label ?? descriptor.email;
  if (who && who !== account.name) {
    bits.push(who);
  }
  return bits.join(" · ");
}

/**
 * `● name   plan · org   ✓`, with the name padded to `width` columns. `●` is
 * the default slot's live account, `⌂` a profile living in its own home.
 */
export function accountRow(
  provider: Provider,
  account: StoredAccount,
  options: { live: boolean; width: number; now?: number },
): string {
  const now = options.now ?? Date.now();
  const descriptor = provider.describe(account.credential);
  const marker = account.home ? ink.sora(mark.home) : options.live ? ink.sakura(mark.live) : ink.sumi(mark.idle);
  const name = options.live ? ink.bold(account.name) : account.name;
  const pad = " ".repeat(Math.max(0, options.width - account.name.length));
  const meta = accountMeta(account, descriptor);
  const badge = authBadge(classifyAuth(descriptor, now), descriptor, now);
  return [`${marker} ${name}${pad}`, meta ? ink.sumi(meta) : "", badge].filter(Boolean).join("  ");
}

/** Column width that fits every account name in a list. */
export function nameWidth(accounts: readonly StoredAccount[]): number {
  return accounts.reduce((width, account) => Math.max(width, account.name.length), 0);
}
