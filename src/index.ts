/**
 * Public library surface. Import these to drive account management
 * programmatically, or build a custom front-end on top of the same core.
 *
 * @example
 * ```ts
 * import { getProvider, Store, swapLive } from "toguru-cli";
 *
 * const store = await Store.load();
 * await swapLive(getProvider("claude"), store, "work");
 * ```
 */

export { createProgram } from "./program";

// Core
export { Store, STORE_VERSION } from "./core/store";
export type { ProviderState, StoreData, StoredAccount, UpsertOptions } from "./core/store";
export { reconcile, swapLive } from "./core/reconcile";
export type { LiveState, SwapResult } from "./core/reconcile";
export { placeLogin } from "./core/placement";
export type { PlaceIntent, Placement, Prompter } from "./core/placement";
export { classifyAuth } from "./core/auth-status";
export type { AuthState } from "./core/auth-status";
export * as paths from "./core/paths";

// Providers
export { allProviders, findProvider, getProvider, isProviderId, providerIds } from "./providers/registry";
export type { ProviderDefinition } from "./providers/declared";
export type {
  AccountDescriptor,
  Credential,
  HomeSupport,
  Provider,
  ProviderId,
  Slot,
} from "./providers/types";

// Errors
export { isToguruError, ToguruError } from "./utils/errors";
