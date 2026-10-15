import type { Credential, Provider } from "../providers/types";
import { ToguruError } from "../utils/errors";
import { validateAccountName } from "../utils/strings";
import { findByIdentity, suggestName } from "./reconcile";
import type { Store, StoredAccount } from "./store";

/**
 * How placement asks the user things. The terminal adapter prompts; the
 * non-interactive one takes defaults, and placement refuses risky choices
 * (overwriting another account) instead of guessing.
 */
export interface Prompter {
  readonly interactive: boolean;
  askName(message: string, suggested: string, validate: (value: string) => true | string): Promise<string>;
  confirm(message: string, fallback: boolean): Promise<boolean>;
}

/** Why a login is being placed. */
export type PlaceIntent =
  /** `tg add [name]`: capture the live session under a name. */
  | { kind: "add"; name?: string; label?: string; force?: boolean }
  /** After a login. `reauth`: the profile being re-authenticated; `name`: a new profile's name. */
  | { kind: "login"; name?: string; reauth?: StoredAccount }
  /** The live session isn't saved and is about to be replaced by a switch. */
  | { kind: "rescue" };

/** A re-auth that signed in as someone else; the profile was left untouched. */
export interface ReauthMismatch {
  profile: string;
  expected?: string;
  got?: string;
}

export type Placement =
  | {
      kind: "saved";
      name: string;
      created: boolean;
      label?: string;
      /** The same login is also saved under this other name. */
      alsoSavedAs?: string;
      mismatch?: ReauthMismatch;
    }
  | { kind: "declined" };

/** Validator for a *new* profile name: well-formed and not already taken. */
export function freeName(store: Store, provider: Provider): (value: string) => true | string {
  return (value) => {
    const valid = validateAccountName(value);
    if (valid !== true) {
      return valid;
    }
    return store.has(provider.id, value.trim()) ? `"${value.trim()}" is already taken.` : true;
  };
}

function requireValidName(name: string): string {
  const trimmed = name.trim();
  const valid = validateAccountName(trimmed);
  if (valid !== true) {
    throw new ToguruError(valid);
  }
  return trimmed;
}

/**
 * Decide which profile a login belongs in and save it there. The rules:
 *
 * - A login already saved (same user + org/workspace) updates its profile.
 * - A new login gets a name: the requested one, else its email (`-2`, `-3`…
 *   when taken), confirmed on a terminal.
 * - Re-authenticating a profile but signing in as someone else never
 *   overwrites that profile; the new login is placed on its own.
 * - Overwriting a profile that holds a different account needs `--force` or a
 *   yes on a terminal.
 *
 * Saved logins are marked active except when rescuing a session that's about
 * to be switched away from.
 */
export async function placeLogin(
  provider: Provider,
  store: Store,
  credential: Credential,
  intent: PlaceIntent,
  prompter: Prompter,
): Promise<Placement> {
  const fresh = provider.describe(credential);
  const match = findByIdentity(provider, store, credential);
  const newName = (message: string): Promise<string> => {
    const suggested = suggestName(provider, store, credential);
    return prompter.interactive ? prompter.askName(message, suggested, freeName(store, provider)) : Promise.resolve(suggested);
  };

  let target: string;
  let label = fresh.email;
  let mismatch: ReauthMismatch | undefined;
  let activate = true;

  switch (intent.kind) {
    case "add": {
      target = intent.name ? requireValidName(intent.name) : (match?.name ?? (await newName("Name this account")));
      label = intent.label ?? fresh.email;
      const existing = store.get(provider.id, target);
      if (existing?.home) {
        throw new ToguruError(
          `"${target}" lives in its own account home; the live session can't be saved over it.`,
          "Pick another name.",
        );
      }
      const otherLogin = existing && provider.describe(existing.credential).identity !== fresh.identity;
      if (otherLogin && !intent.force) {
        if (!prompter.interactive) {
          throw new ToguruError(`"${target}" holds a different account.`, "Pass --force to overwrite it.");
        }
        if (!(await prompter.confirm(`"${target}" holds a different account. Overwrite it?`, false))) {
          return { kind: "declined" };
        }
      }
      break;
    }
    case "login": {
      const { reauth } = intent;
      const before = reauth ? provider.describe(reauth.credential) : undefined;
      const switchedLogin = before?.identity && fresh.identity && before.identity !== fresh.identity;
      if (reauth && switchedLogin) {
        mismatch = { profile: reauth.name, expected: before?.email ?? reauth.label, got: fresh.email };
        target = match?.name ?? (await newName("Save this account as"));
      } else if (reauth) {
        target = reauth.name;
      } else {
        target = intent.name ? requireValidName(intent.name) : (match?.name ?? (await newName("Save this account as")));
      }
      break;
    }
    case "rescue": {
      const who = fresh.email ?? "an unsaved account";
      if (!prompter.interactive) {
        return { kind: "declined" };
      }
      if (!(await prompter.confirm(`The live session (${who}) isn't saved. Save it before switching?`, true))) {
        return { kind: "declined" };
      }
      target = await newName("Save it as");
      activate = false;
      break;
    }
  }

  const created = !store.has(provider.id, target);
  await store.upsert(provider.id, target, credential, { label, activate });
  return {
    kind: "saved",
    name: target,
    created,
    ...(label ? { label } : {}),
    ...(match && match.name !== target ? { alsoSavedAs: match.name } : {}),
    ...(mismatch ? { mismatch } : {}),
  };
}
