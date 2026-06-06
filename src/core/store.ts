import { MultiAccountError } from "../utils/errors";
import { readJson, writeJson } from "../utils/fs";
import type { Credential, ProviderId } from "../providers/types";
import { storeFile } from "./paths";

/** Current on-disk schema version. */
export const STORE_VERSION = 1;

/** A single saved account for one provider. */
export interface StoredAccount {
  name: string;
  label?: string;
  credential: Credential;
  addedAt: string;
  updatedAt: string;
}

/** Per-provider slice of the vault. */
export interface ProviderState {
  active?: string;
  accounts: Record<string, StoredAccount>;
}

/** The complete on-disk vault shape. */
export interface StoreData {
  version: number;
  providers: Partial<Record<ProviderId, ProviderState>>;
}

function emptyStore(): StoreData {
  return { version: STORE_VERSION, providers: {} };
}

function timestamp(): string {
  return new Date().toISOString();
}

/**
 * In-memory, persistence-backed view of the account vault. Load once, mutate
 * through the methods (each persists atomically), and the same instance stays
 * current.
 */
export class Store {
  private constructor(private readonly data: StoreData) {}

  /** Load the vault from disk, creating an empty one when absent. */
  static async load(): Promise<Store> {
    const data = await readJson<StoreData>(storeFile());
    if (!data) {
      return new Store(emptyStore());
    }
    // Normalize partially-written or older files defensively.
    if (typeof data.version !== "number") {
      data.version = STORE_VERSION;
    }
    if (!data.providers || typeof data.providers !== "object") {
      data.providers = {};
    }
    return new Store(data);
  }

  private state(provider: ProviderId): ProviderState {
    let state = this.data.providers[provider];
    if (!state) {
      state = { accounts: {} };
      this.data.providers[provider] = state;
    }
    return state;
  }

  private save(): Promise<void> {
    return writeJson(storeFile(), this.data);
  }

  /** All accounts for a provider, sorted by name. */
  list(provider: ProviderId): StoredAccount[] {
    return Object.values(this.state(provider).accounts).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** A single account by name, or `undefined`. */
  get(provider: ProviderId, name: string): StoredAccount | undefined {
    return this.state(provider).accounts[name];
  }

  /** Name of the active account for a provider, or `undefined`. */
  active(provider: ProviderId): string | undefined {
    return this.state(provider).active;
  }

  /** True when at least one account exists for the provider. */
  has(provider: ProviderId, name: string): boolean {
    return Boolean(this.state(provider).accounts[name]);
  }

  /** Create or update an account, defaulting it active when it is the first. */
  async upsert(
    provider: ProviderId,
    name: string,
    credential: Credential,
    label?: string,
  ): Promise<StoredAccount> {
    const state = this.state(provider);
    const now = timestamp();
    const existing = state.accounts[name];
    const account: StoredAccount = {
      name,
      credential,
      addedAt: existing?.addedAt ?? now,
      updatedAt: now,
      ...(label ? { label } : existing?.label ? { label: existing.label } : {}),
    };
    state.accounts[name] = account;
    if (!state.active) {
      state.active = name;
    }
    await this.save();
    return account;
  }

  /** Mark an existing account as active. */
  async setActive(provider: ProviderId, name: string): Promise<void> {
    const state = this.state(provider);
    if (!state.accounts[name]) {
      throw new MultiAccountError(`No saved account named "${name}".`);
    }
    state.active = name;
    await this.save();
  }

  /** Remove an account, reassigning `active` when needed. */
  async remove(provider: ProviderId, name: string): Promise<void> {
    const state = this.state(provider);
    if (!state.accounts[name]) {
      throw new MultiAccountError(`No saved account named "${name}".`);
    }
    delete state.accounts[name];
    if (state.active === name) {
      state.active = Object.keys(state.accounts)[0];
    }
    await this.save();
  }

  /** Rename an account, preserving its active status. */
  async rename(provider: ProviderId, from: string, to: string): Promise<void> {
    const state = this.state(provider);
    const account = state.accounts[from];
    if (!account) {
      throw new MultiAccountError(`No saved account named "${from}".`);
    }
    if (state.accounts[to]) {
      throw new MultiAccountError(`An account named "${to}" already exists.`);
    }
    account.name = to;
    account.updatedAt = timestamp();
    state.accounts[to] = account;
    delete state.accounts[from];
    if (state.active === from) {
      state.active = to;
    }
    await this.save();
  }

  /** Snapshot of the raw data (used by export). */
  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  /**
   * Merge another vault into this one. With `overwrite`, incoming accounts
   * replace existing ones of the same name; otherwise existing ones are kept.
   * Returns the number of accounts imported.
   */
  async merge(incoming: StoreData, overwrite: boolean): Promise<number> {
    let imported = 0;
    for (const [providerId, incomingState] of Object.entries(incoming.providers)) {
      if (!incomingState) {
        continue;
      }
      const state = this.state(providerId as ProviderId);
      for (const [name, account] of Object.entries(incomingState.accounts)) {
        if (state.accounts[name] && !overwrite) {
          continue;
        }
        state.accounts[name] = account;
        imported += 1;
      }
      if (!state.active && incomingState.active) {
        state.active = incomingState.active;
      }
    }
    await this.save();
    return imported;
  }
}
