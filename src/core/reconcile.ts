import type { AccountDescriptor, Credential, Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { validateAccountName } from "../utils/strings";
import type { Store, StoredAccount } from "./store";

/** What the provider's live location holds, relative to the vault. */
export type LiveState =
  | { kind: "logged-out" }
  /**
   * A saved profile is live. `captured`: the live credential was newer (a token
   * refresh or re-login) and was copied into the profile. `adopted`: it wasn't
   * marked active (someone switched outside tg) and now is.
   */
  | { kind: "saved"; name: string; captured: boolean; adopted: boolean }
  /** The live session is an account that isn't saved; nothing is active. */
  | { kind: "unsaved"; credential: Credential; descriptor: AccountDescriptor };

/** A snapshot of the live session and the profile it belongs to. */
export interface LiveView {
  credential: Credential | null;
  match: StoredAccount | undefined;
}

/** Profiles that can hold the default slot (account homes own their own). */
function slotProfiles(provider: Provider, store: Store): StoredAccount[] {
  return store.list(provider.id).filter((account) => !account.home);
}

/**
 * The saved profile holding exactly this login (same user and org/workspace),
 * preferring the active one. No guessing: unknown identity matches nothing.
 */
export function findByIdentity(provider: Provider, store: Store, credential: Credential): StoredAccount | undefined {
  const identity = provider.describe(credential).identity;
  if (!identity) {
    return undefined;
  }
  const candidates = slotProfiles(provider, store).filter(
    (account) => provider.describe(account.credential).identity === identity,
  );
  return candidates.find((account) => account.name === store.active(provider.id)) ?? candidates[0];
}

/**
 * Find the profile the default slot's credential belongs to, by identity.
 * When identity can't be read on either side (legacy snapshots), the active
 * profile is assumed to be live — tg wrote it there.
 */
export function matchProfile(provider: Provider, store: Store, credential: Credential): StoredAccount | undefined {
  const exact = findByIdentity(provider, store, credential);
  if (exact) {
    return exact;
  }
  const activeName = store.active(provider.id);
  const active = activeName ? store.get(provider.id, activeName) : undefined;
  if (!active || active.home) {
    return undefined;
  }
  const identity = provider.describe(credential).identity;
  const activeIdentity = provider.describe(active.credential).identity;
  return !identity || !activeIdentity ? active : undefined;
}

/**
 * A free, valid profile name for a credential: its email (or the provider id),
 * suffixed `-2`, `-3`, … when another login already uses that name.
 */
export function suggestName(provider: Provider, store: Store, credential: Credential): string {
  const raw = provider.describe(credential).email ?? provider.id;
  const base = validateAccountName(raw) === true ? raw : raw.replace(/[^a-zA-Z0-9._+@-]/g, "-");
  let name = base;
  for (let n = 2; store.has(provider.id, name); n += 1) {
    name = `${base}-${n}`;
  }
  return name;
}

/** Read the live session and find its profile, without writing anything. */
export async function inspectLive(provider: Provider, store: Store): Promise<LiveView> {
  const credential = await provider.readActive();
  return { credential, match: credential ? matchProfile(provider, store, credential) : undefined };
}

/**
 * Bring the vault in line with the provider's default slot, which is the
 * source of truth for whatever account is signed in right now:
 *
 * - live is a saved login → copy newer tokens into that profile and mark it
 *   active. Providers rotate refresh tokens on every refresh, so a profile that
 *   misses a rotation holds a dead token; capturing eagerly is what keeps saved
 *   accounts from "expiring".
 * - live is a login we don't have → leave every profile alone and clear
 *   `active`, so nothing claims to be live when it isn't.
 * - nobody is logged in → no change.
 */
export async function reconcile(provider: Provider, store: Store): Promise<LiveState> {
  return store.transaction(async () => {
    const { credential, match } = await inspectLive(provider, store);
    if (!credential) {
      return { kind: "logged-out" };
    }
    if (!match) {
      if (store.active(provider.id) !== undefined) {
        await store.setActive(provider.id, undefined);
      }
      return { kind: "unsaved", credential, descriptor: provider.describe(credential) };
    }
    const captured = JSON.stringify(credential) !== JSON.stringify(match.credential);
    const adopted = store.active(provider.id) !== match.name;
    if (captured) {
      const label = match.label ? undefined : provider.describe(credential).email;
      await store.upsert(provider.id, match.name, credential, { label, activate: true });
    } else if (adopted) {
      await store.setActive(provider.id, match.name);
    }
    return { kind: "saved", name: match.name, captured, adopted };
  });
}

/** Outcome of {@link swapLive}. */
export interface SwapResult {
  /** The default slot before the swap (after capturing it). */
  previous: LiveState;
  /** False when the profile was already live, so nothing was written. */
  changed: boolean;
}

/**
 * Make `name` the live account in the provider's default slot — as one
 * transaction: capture the outgoing session, write the profile's credential,
 * mark it active. Nothing (another tg, the keeper) can observe or interleave
 * with a half-written slot, e.g. new tokens beside the old identity.
 */
export async function swapLive(provider: Provider, store: Store, name: string): Promise<SwapResult> {
  return store.transaction(async () => {
    const previous = await reconcile(provider, store);
    const account = store.get(provider.id, name);
    if (!account) {
      throw new ToguruError(`No saved ${provider.displayName} account named "${name}".`);
    }
    if (account.home) {
      throw new ToguruError(
        `"${name}" lives in its own account home, so it isn't switched into the default slot.`,
        `Use it with: tg run ${provider.id} ${name}  (or: eval "$(tg env ${provider.id} ${name})")`,
      );
    }
    if (previous.kind === "saved" && previous.name === name) {
      return { previous, changed: false };
    }
    await provider.writeActive(account.credential);
    await store.setActive(provider.id, name);
    return { previous, changed: true };
  });
}

/**
 * Refresh a home profile's snapshot from its home, where the provider's own
 * CLI keeps the only live copy. Returns whether anything changed.
 */
export async function captureHome(provider: Provider, store: Store, account: StoredAccount): Promise<boolean> {
  if (!account.home) {
    return false;
  }
  const home = account.home;
  return store.transaction(async () => {
    const credential = await provider.readActive({ dir: home });
    const current = store.get(provider.id, account.name);
    if (!credential || !current || JSON.stringify(credential) === JSON.stringify(current.credential)) {
      return false;
    }
    await store.upsert(provider.id, account.name, credential);
    return true;
  });
}
