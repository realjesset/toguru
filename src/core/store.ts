import path from "node:path";
import { ToguruError } from "../utils/errors";
import { readJson, writeJson } from "../utils/fs";
import { isProviderId } from "../providers/registry";
import type { Credential, ProviderId } from "../providers/types";
import { withFileLock } from "./lock";
import { storeFile } from "./paths";

/** Current on-disk schema version. */
export const STORE_VERSION = 1;

/** A single saved account for one provider. */
export interface StoredAccount {
  name: string;
  label?: string;
  /**
   * The credential. For a profile with a {@link StoredAccount.home}, the home
   * owns the login and this is a read-only snapshot of it, for display.
   */
  credential: Credential;
  /** Account home (a config dir of its own) that this profile lives in. */
  home?: string;
  addedAt: string;
  updatedAt: string;
}

/** Per-provider slice of the vault. */
export interface ProviderState {
  /**
   * The profile whose credential is currently in the provider's live location,
   * or absent when the live session isn't a saved profile.
   */
  active?: string;
  accounts: Record<string, StoredAccount>;
}

/** The complete on-disk vault shape. */
export interface StoreData {
  version: number;
  providers: Record<ProviderId, ProviderState>;
}

export interface UpsertOptions {
  /** Human-friendly label; keeps the existing one when omitted. */
  label?: string;
  /** Also mark the account active (its credential is the live one). */
  activate?: boolean;
}

/**
 * Dictionary with no prototype, so account names like `constructor` or
 * `__proto__` are plain keys rather than inherited members.
 */
function dict<T>(entries: Iterable<[string, T]> = []): Record<string, T> {
  const out = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) {
    out[key] = value;
  }
  return out;
}

function timestamp(): string {
  return new Date().toISOString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate one untrusted account entry, returning a clean copy or `null`.
 * `local` data is this machine's vault; foreign data (an import) loses
 * machine-specific fields like `home`.
 */
function validateAccount(name: string, raw: unknown, local: boolean): StoredAccount | null {
  // A credential is the whole point of an account; drop entries without one.
  if (!isObject(raw) || !isObject(raw.credential)) {
    return null;
  }
  const account: StoredAccount = {
    name,
    credential: raw.credential,
    addedAt: typeof raw.addedAt === "string" ? raw.addedAt : timestamp(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : timestamp(),
  };
  if (typeof raw.label === "string") {
    account.label = raw.label;
  }
  if (local && typeof raw.home === "string") {
    account.home = raw.home;
  }
  return account;
}

/**
 * Normalize one provider slice. `active` survives only if it names an account
 * and the data is local: an export's `active` describes another machine.
 */
function validateState(raw: unknown, local: boolean): ProviderState {
  const accounts = dict<StoredAccount>();
  const source = isObject(raw) && isObject(raw.accounts) ? raw.accounts : {};
  for (const [name, accountRaw] of Object.entries(source)) {
    const account = validateAccount(name, accountRaw, local);
    if (account) {
      accounts[name] = account;
    }
  }
  const state: ProviderState = { accounts };
  const active = isObject(raw) ? raw.active : undefined;
  if (local && typeof active === "string" && accounts[active]) {
    state.active = active;
  }
  return state;
}

/** Parse the vault file, tolerating partial or older files. */
async function readStore(): Promise<StoreData> {
  const file = storeFile();
  const raw = await readJson<unknown>(file);
  if (raw === null) {
    return { version: STORE_VERSION, providers: dict() };
  }
  if (!isObject(raw)) {
    throw new ToguruError(`${file} is not a toguru vault.`, "Fix or move the file aside, then try again.");
  }
  if (typeof raw.version === "number" && raw.version > STORE_VERSION) {
    throw new ToguruError(
      `${file} was written by a newer toguru (schema v${raw.version}).`,
      "Upgrade toguru with: tg update",
    );
  }
  const providers = dict<ProviderState>();
  // Unknown provider slices are kept verbatim-ish so a downgrade never drops them.
  for (const [id, state] of Object.entries(isObject(raw.providers) ? raw.providers : {})) {
    providers[id] = validateState(state, true);
  }
  return { version: STORE_VERSION, providers };
}

function stateIn(data: StoreData, provider: ProviderId): ProviderState {
  let state = data.providers[provider];
  if (!state) {
    state = { accounts: dict() };
    data.providers[provider] = state;
  }
  return state;
}

function requireAccount(state: ProviderState, name: string): StoredAccount {
  const account = state.accounts[name];
  if (!account) {
    throw new ToguruError(`No saved account named "${name}".`);
  }
  return account;
}

/**
 * The account vault. Reads come from the snapshot taken at {@link Store.load};
 * every mutation takes a cross-process lock, re-reads the file, applies the
 * change and writes it back, so concurrent `tg` processes never lose each
 * other's updates. The instance reflects the latest write afterwards.
 */
export class Store {
  private constructor(private data: StoreData) {}

  /** Load the vault from disk, creating an empty one when absent. */
  static async load(): Promise<Store> {
    return new Store(await readStore());
  }

  private mutate<T>(change: (data: StoreData) => T): Promise<T> {
    return this.transaction(async () => {
      const data = await readStore();
      const result = change(data);
      await writeJson(storeFile(), data);
      this.data = data;
      return result;
    });
  }

  /**
   * Run `fn` holding the vault lock, starting from a fresh read of the vault.
   * Mutations inside reuse the lock, so a multi-step change — read the live
   * slot, write it, mark the profile active — is atomic for every other tg
   * process, including the keeper.
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const file = storeFile();
    return withFileLock(path.join(path.dirname(file), "store.lock"), async () => {
      this.data = await readStore();
      return fn();
    });
  }

  /** All accounts for a provider, sorted by name. */
  list(provider: ProviderId): StoredAccount[] {
    const accounts = this.data.providers[provider]?.accounts ?? {};
    return Object.values(accounts).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A single account by name, or `undefined`. */
  get(provider: ProviderId, name: string): StoredAccount | undefined {
    return this.data.providers[provider]?.accounts[name];
  }

  /** Name of the profile that is live for a provider, or `undefined`. */
  active(provider: ProviderId): string | undefined {
    return this.data.providers[provider]?.active;
  }

  /** True when an account with this name exists for the provider. */
  has(provider: ProviderId, name: string): boolean {
    return this.get(provider, name) !== undefined;
  }

  /** Create or update an account. */
  upsert(
    provider: ProviderId,
    name: string,
    credential: Credential,
    options: UpsertOptions = {},
  ): Promise<StoredAccount> {
    return this.mutate((data) => {
      const state = stateIn(data, provider);
      const now = timestamp();
      const existing = state.accounts[name];
      const label = options.label ?? existing?.label;
      const account: StoredAccount = {
        name,
        credential,
        addedAt: existing?.addedAt ?? now,
        updatedAt: now,
        ...(label ? { label } : {}),
        ...(existing?.home ? { home: existing.home } : {}),
      };
      state.accounts[name] = account;
      if (options.activate) {
        state.active = name;
      }
      return account;
    });
  }

  /** Mark an existing account as live, or clear the marker with `undefined`. */
  setActive(provider: ProviderId, name: string | undefined): Promise<void> {
    return this.mutate((data) => {
      const state = stateIn(data, provider);
      if (name === undefined) {
        delete state.active;
        return;
      }
      requireAccount(state, name);
      state.active = name;
    });
  }

  /** Attach a profile to an account home, or detach it with `undefined`. */
  setHome(provider: ProviderId, name: string, home: string | undefined): Promise<void> {
    return this.mutate((data) => {
      const account = requireAccount(stateIn(data, provider), name);
      if (home === undefined) {
        delete account.home;
      } else {
        account.home = home;
      }
      account.updatedAt = timestamp();
    });
  }

  /**
   * Forget an account. Removing the live profile clears `active` rather than
   * pointing it at another account whose credential is *not* live.
   */
  remove(provider: ProviderId, name: string): Promise<void> {
    return this.mutate((data) => {
      const state = stateIn(data, provider);
      requireAccount(state, name);
      delete state.accounts[name];
      if (state.active === name) {
        delete state.active;
      }
    });
  }

  /** Rename an account, preserving its active status. */
  rename(provider: ProviderId, from: string, to: string): Promise<void> {
    return this.mutate((data) => {
      const state = stateIn(data, provider);
      const account = requireAccount(state, from);
      if (from === to) {
        return;
      }
      if (state.accounts[to]) {
        throw new ToguruError(`An account named "${to}" already exists.`);
      }
      account.name = to;
      account.updatedAt = timestamp();
      state.accounts[to] = account;
      delete state.accounts[from];
      if (state.active === from) {
        state.active = to;
      }
    });
  }

  /** Snapshot of the raw data (used by export). */
  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  /**
   * Merge another vault into this one. With `overwrite`, incoming accounts
   * replace existing ones of the same name; otherwise existing ones are kept.
   * Imported accounts never become active: nothing was written live.
   * Returns the number of accounts imported.
   */
  merge(incoming: StoreData, overwrite: boolean): Promise<number> {
    return this.mutate((data) => {
      let imported = 0;
      for (const [providerId, incomingState] of Object.entries(incoming.providers)) {
        if (!incomingState) {
          continue;
        }
        const state = stateIn(data, providerId);
        for (const [name, account] of Object.entries(incomingState.accounts)) {
          const existing = state.accounts[name];
          // A profile living in a home is owned by that home, not by an export.
          if (existing && (!overwrite || existing.home)) {
            continue;
          }
          state.accounts[name] = account;
          imported += 1;
        }
      }
      return imported;
    });
  }
}

/**
 * Validate and normalize untrusted data (e.g. an imported file) into a
 * {@link StoreData}. Unknown providers and malformed accounts are dropped rather
 * than trusted; a structurally invalid payload throws a {@link ToguruError}.
 * `active` markers are dropped too: they describe another machine's live state.
 */
export function validateStoreData(raw: unknown): StoreData {
  if (!isObject(raw)) {
    throw new ToguruError("Not a valid toguru export (expected a JSON object).");
  }
  const version = typeof raw.version === "number" ? raw.version : STORE_VERSION;
  if (version > STORE_VERSION) {
    throw new ToguruError(
      `Export was created by a newer version (schema v${version}).`,
      "Upgrade toguru and try again.",
    );
  }
  if (!isObject(raw.providers)) {
    throw new ToguruError("Not a valid toguru export (missing a `providers` object).");
  }
  const providers: StoreData["providers"] = dict();
  for (const [providerId, state] of Object.entries(raw.providers)) {
    if (isProviderId(providerId) && isObject(state)) {
      providers[providerId] = validateState(state, false);
    }
  }
  return { version: STORE_VERSION, providers };
}
