import type { Credential, Provider } from "../providers/types";
import type { Store } from "./store";

export type ReconcileResult =
  | "synced" // live had newer creds for the same account → captured into the profile
  | "in-sync" // live already matches the stored profile
  | "drifted" // live is a different account than the active profile → left alone
  | "noop"; // no active profile, or nothing logged in live

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

function identityKey(provider: Provider, credential: Credential): string | undefined {
  const descriptor = provider.describe(credential);
  return descriptor.accountId ?? descriptor.email;
}

/**
 * Keep the active profile in step with reality. The provider's live location is
 * the source of truth for whatever account is currently signed in, so if it has
 * changed since we last saw it:
 *
 * - **same account** (a token refresh or in-place re-auth) → copy the live
 *   credentials back into the stored profile, so tg never restores a stale token.
 * - **different account** (someone logged in elsewhere without `tg switch`) →
 *   leave the profile untouched and report the drift; clobbering it would lose
 *   the saved account.
 */
export async function reconcileActive(provider: Provider, store: Store): Promise<ReconcileResult> {
  const activeName = store.active(provider.id);
  if (!activeName) {
    return "noop";
  }
  const stored = store.get(provider.id, activeName);
  if (!stored) {
    return "noop";
  }
  const live = await provider.readActive();
  if (!live) {
    return "noop";
  }
  if (fingerprint(live) === fingerprint(stored.credential)) {
    return "in-sync";
  }

  const liveKey = identityKey(provider, live);
  const storedKey = identityKey(provider, stored.credential);
  // Capture when it's clearly the same account, or when identity can't be told
  // apart (in which case the active profile is our best guess for what's live).
  if (!liveKey || !storedKey || liveKey === storedKey) {
    const liveLabel = provider.describe(live).email ?? stored.label;
    await store.upsert(provider.id, activeName, live, liveLabel);
    return "synced";
  }
  return "drifted";
}
