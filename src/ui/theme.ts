import pc from "picocolors";
import type { Provider } from "../providers/types";
import { VERSION } from "../version";

/**
 * Soft 256-colour palette named after Japanese colours. Every tint collapses to
 * plain text when colour is off (NO_COLOR, pipes, CI), via picocolors' check.
 */
function tint(code: number): (text: string) => string {
  return (text) => (pc.isColorSupported ? `\x1b[38;5;${code}m${text}\x1b[39m` : text);
}

export const ink = {
  /** 桜 sakura — the brand pink. */
  sakura: tint(218),
  /** 桃 momo — deeper pink for emphasis. */
  momo: tint(205),
  /** 抹茶 matcha — success. */
  matcha: tint(114),
  /** 空 sora — information. */
  sora: tint(117),
  /** 柚子 yuzu — warnings. */
  yuzu: tint(221),
  /** 紅 beni — errors. */
  beni: tint(203),
  /** 藤 fuji — quiet accents. */
  fuji: tint(183),
  /** 墨 sumi — muted ink. */
  sumi: pc.dim,
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
export const kao = {
  cheer: "٩(◕‿◕)۶",
  sparkle: "(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧",
  wave: "(＾-＾)ノ",
  sad: "(╥﹏╥)",
  sleepy: "(－_－) zzZ",
};

/** `▍Claude Code (Anthropic)  クロード` */
export function providerHeading(provider: Provider): string {
  const kana = provider.kana ? `  ${ink.fuji(provider.kana)}` : "";
  return `${ink.sakura(mark.bar)}${ink.bold(provider.displayName)}${kana}`;
}

/** Two-line masthead for the hub, list and status screens. */
export function banner(): string {
  const title = `${ink.sakura(mark.petal)} ${ink.bold(ink.momo("トグル"))} ${ink.bold("toguru")} ${ink.sumi(`v${VERSION}`)}`;
  const tagline = ink.sumi(`  ${mark.hint} アカウント切り替え · account toggle`);
  return `${title}\n${tagline}`;
}
