import { Command } from "commander";
import { classifyAuth } from "../core/auth-status";
import { keeperHint } from "../core/keeper";
import { placeLogin } from "../core/placement";
import { reconcile, swapLive } from "../core/reconcile";
import { Store, type StoredAccount } from "../core/store";
import type { Provider } from "../providers/types";
import { relativeTime } from "../ui/format";
import { agree, canPrompt, terminalPrompter } from "../ui/prompts";
import { face, ink } from "../ui/theme";
import { logger } from "../utils/logger";
import { runAuth } from "./auth";
import { findAccount, PROVIDER_ARG, pickAccount, resolveProvider } from "./shared";

/**
 * Tell the user, right as they switch, whether the account they landed on will
 * keep working — and offer to sign in again when it won't.
 */
async function adviseOnAuth(provider: Provider, account: StoredAccount): Promise<void> {
  const descriptor = provider.describe(account.credential);
  const reauth = `tg ${provider.id} auth ${account.name}`;
  switch (classifyAuth(descriptor)) {
    case "needs-reauth": {
      logger.warn(`This login has ended, so ${provider.displayName} will ask you to sign in.`);
      if (!canPrompt()) {
        logger.hint(`Sign in again with: ${reauth}`);
        return;
      }
      if (await agree({ message: "Sign in again now?", need: "confirmation", default: true })) {
        await runAuth(provider, account.name);
      }
      return;
    }
    case "reauth-soon":
      logger.warn(
        `This login ends ${relativeTime(descriptor.refreshExpiresAt ?? Date.now())} — token refreshes can't extend it.`,
      );
      logger.hint(`Sign in again early with: ${reauth}`);
      return;
    case "expired":
      logger.hint(
        `Its access token expired ${relativeTime(descriptor.expiresAt ?? Date.now())}; ${provider.displayName} renews it on next use.`,
      );
      return;
    default:
      return;
  }
}

/**
 * Activate a saved account by writing its credential to the provider's live
 * location. When `name` is omitted the user picks interactively.
 */
export async function runSwitch(provider: Provider, name?: string): Promise<void> {
  const store = await Store.load();
  // Capture whatever the live session picked up (a token refresh, a re-login)
  // before choosing — and know whether it's a login we'd lose by switching.
  const live = await reconcile(provider, store);
  const account = name
    ? findAccount(store, provider, name)
    : await pickAccount(store, provider, `Switch ${provider.displayName} to`, (candidate) => !candidate.home);

  if (live.kind === "unsaved" && !account.home) {
    const rescued = await placeLogin(provider, store, live.credential, { kind: "rescue" }, terminalPrompter());
    if (rescued.kind === "saved") {
      logger.success(`Saved ${ink.bold(rescued.name)}.`);
    } else {
      logger.warn(`The live session (${live.descriptor.email ?? "an unsaved account"}) isn't saved and is being replaced.`);
      logger.hint(`Next time, save it first with: tg add ${provider.id}`);
    }
  }

  const { changed } = await swapLive(provider, store, account.name);
  if (changed) {
    const label = account.label && account.label !== account.name ? ink.muted(` (${account.label})`) : "";
    logger.success(
      `Switched ${provider.displayName} → ${ink.bold(ink.pink(account.name))}${label}  ${ink.pink(face.sparkle)}`,
    );
  } else {
    logger.info(`${ink.pink("✿")} ${provider.displayName} is already on ${ink.bold(account.name)}.`);
  }
  await adviseOnAuth(provider, store.get(provider.id, account.name) ?? account);
  const hint = await keeperHint();
  if (hint) {
    logger.hint(hint);
  }
}

export function switchCommand(): Command {
  return new Command("switch")
    .alias("use")
    .description("Switch the active account for a provider")
    .argument("[provider]", PROVIDER_ARG)
    .argument("[name]", "account name (or its email) to switch to")
    .action(async (providerArg: string | undefined, nameArg: string | undefined) => {
      const provider = await resolveProvider(providerArg);
      await runSwitch(provider, nameArg);
    });
}
