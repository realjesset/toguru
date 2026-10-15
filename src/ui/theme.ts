import pc from "picocolors";
import type { Provider } from "../providers/types";
import { VERSION } from "../version";

/**
 * Soft 256-colour palette. Every tint collapses to plain text when colour is
 * off (NO_COLOR, pipes, CI), via picocolors' check.
 */
function tint(code: number): (text: string) => string {
  return (text) => (pc.isColorSupported ? `\x1b[38;5;${code}m${text}\x1b[39m` : text);
}

export const ink = {
  /** The brand pink. */
  pink: tint(218),
  /** Deeper pink for emphasis. */
  rose: tint(205),
  /** Success. */
  green: tint(114),
  /** Information. */
  blue: tint(117),
  /** Warnings. */
  yellow: tint(221),
  /** Errors. */
  red: tint(203),
  /** Quiet accents. */
  lavender: tint(183),
  muted: pc.dim,
  bold: pc.bold,
};

export const mark = {
  live: "●",
  idle: "○",
  ok: "✓",
  warn: "⚠",
  error: "✖",
  flower: "✿",
  petal: "❀",
  hint: "↳",
  refresh: "⟳",
  soon: "◔",
  bar: "▍",
  home: "⌂",
};

/** Little faces for the moments that deserve one. */
export const face = {
  cheer: "٩(◕‿◕)۶",
  sparkle: "(◕‿◕)✧",
  wave: "(^-^)/",
  sad: "(╥﹏╥)",
  sleepy: "(-_-) zzZ",
};

/** `▍Claude Code (Anthropic)` */
export function providerHeading(provider: Provider): string {
  return `${ink.pink(mark.bar)}${ink.bold(provider.displayName)}`;
}

/** Two-line masthead for the hub, list and status screens. */
export function banner(): string {
  const title = `${ink.pink(mark.petal)} ${ink.bold(ink.rose("toguru"))} ${ink.muted(`v${VERSION}`)}`;
  const tagline = ink.muted(`  ${mark.hint} account switcher for Claude, Codex & more`);
  return `${title}\n${tagline}`;
}
