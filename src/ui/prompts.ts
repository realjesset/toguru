import { confirm, input, Separator, select } from "@inquirer/prompts";
import type { Prompter } from "../core/placement";
import { ToguruError } from "../utils/errors";
import { ink, mark } from "./theme";

export { Separator };

const ACTION_WORDS: Record<string, string> = {
  navigate: "move",
  select: "pick",
};

const baseTheme = {
  prefix: { idle: ink.pink(mark.petal), done: ink.green(mark.flower) },
  style: {
    answer: ink.pink,
    help: ink.muted,
    // Rows carry their own colours; re-colouring the active one would clash.
    highlight: (text: string) => text,
  },
};

const selectTheme = {
  ...baseTheme,
  icon: { cursor: ink.pink("❯") },
  style: {
    ...baseTheme.style,
    description: (text: string) => `  ${text}`,
    keysHelpTip: (keys: [string, string][]) =>
      ink.muted(keys.map(([key, action]) => `${key} ${ACTION_WORDS[action] ?? action}`).join("  ·  ")),
  },
};

/** True when we can show an interactive prompt (both ends are a terminal). */
export function canPrompt(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/** Fail fast instead of hanging on a prompt nobody can answer. */
function requireTerminal(need: string): void {
  if (!canPrompt()) {
    throw new ToguruError(
      `Missing ${need}, and there's no interactive terminal to ask for it.`,
      "Pass it as an argument instead (see --help).",
    );
  }
}

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
  short?: string;
  /** Shown but not selectable; a string explains why. */
  disabled?: boolean | string;
}

/** Arrow-key picker. `need` names what's being asked for, for non-TTY errors. */
export async function choose<T>(config: {
  message: string;
  choices: ReadonlyArray<Separator | Choice<T>>;
  need: string;
  pageSize?: number;
  default?: T;
}): Promise<T> {
  requireTerminal(config.need);
  const { need: _need, ...options } = config;
  return (await select({ ...options, theme: selectTheme })) as T;
}

/** Free-text prompt; the answer is trimmed. */
export async function ask(config: {
  message: string;
  need: string;
  default?: string;
  validate?: (value: string) => true | string;
}): Promise<string> {
  requireTerminal(config.need);
  const answer = await input({
    message: config.message,
    default: config.default,
    validate: config.validate,
    theme: baseTheme,
  });
  return answer.trim();
}

/** Yes/no prompt. */
export async function agree(config: { message: string; need: string; default: boolean }): Promise<boolean> {
  requireTerminal(config.need);
  return confirm({ message: config.message, default: config.default, theme: baseTheme });
}

/**
 * The {@link Prompter} for this process: asks on a terminal, takes defaults
 * (and lets placement refuse risky choices) when nobody can answer.
 */
export function terminalPrompter(): Prompter {
  const interactive = canPrompt();
  return {
    interactive,
    askName: (message, suggested, validate) =>
      interactive ? ask({ message, need: "a profile name", default: suggested, validate }) : Promise.resolve(suggested),
    confirm: (message, fallback) =>
      interactive ? agree({ message, need: "confirmation", default: fallback }) : Promise.resolve(fallback),
  };
}
