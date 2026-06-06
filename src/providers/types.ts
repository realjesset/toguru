/** Supported provider identifiers. */
export type ProviderId = "claude" | "codex";

/**
 * An opaque credential blob. Each provider knows how to read/write its own
 * shape; the store treats it as JSON-serializable data.
 */
export type Credential = Record<string, unknown>;

/** Human-friendly details extracted from a credential, all best-effort. */
export interface AccountDescriptor {
  /** Display label (usually an email address). */
  label?: string;
  /** Email address, when known. */
  email?: string;
  /** Subscription/plan name, when known. */
  plan?: string;
  /** Unix epoch milliseconds when the access token expires, when known. */
  expiresAt?: number;
}

/**
 * A provider integrates one external tool (Claude Code, Codex). It reads and
 * writes that tool's *live* credential location and can describe a credential
 * for display. Implementations must be cross-platform.
 */
export interface Provider {
  readonly id: ProviderId;
  readonly displayName: string;

  /** Read the credential the provider's CLI is currently using, or `null`. */
  readActive(): Promise<Credential | null>;

  /** Overwrite the live credential, activating that account. */
  writeActive(credential: Credential): Promise<void>;

  /** Best-effort, display-only details for a credential. */
  describe(credential: Credential): AccountDescriptor;

  /** Suggest a default label from the current live session, if discoverable. */
  suggestLabel?(): Promise<string | undefined>;

  /** Delegate to the provider's own interactive login flow, when supported. */
  login?(): Promise<void>;
}
