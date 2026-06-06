/**
 * Public library surface. Import these to drive account management
 * programmatically, or build a custom front-end on top of the same core.
 *
 * @example
 * ```ts
 * import { Store, providers } from "toguru";
 *
 * const store = await Store.load();
 * const claude = providers.claude;
 * const account = store.get("claude", "work");
 * if (account) {
 *   await claude.writeActive(account.credential);
 *   await store.setActive("claude", "work");
 * }
 * ```
 */

export { createProgram } from "./program";

// Core
export { Store, STORE_VERSION } from "./core/store";
export type { ProviderState, StoreData, StoredAccount } from "./core/store";
export * as paths from "./core/paths";

// Providers
export { getProvider, isProviderId, providerIds, providers } from "./providers/registry";
export type {
  AccountDescriptor,
  Credential,
  Provider,
  ProviderId,
} from "./providers/types";

// Errors
export { isToguruError, ToguruError } from "./utils/errors";
