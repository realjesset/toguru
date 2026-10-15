import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Slot } from "../providers/types";

/** Current platform flags, computed once. */
export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isLinux = process.platform === "linux";

/** Absolute path to the user's home directory. */
export function homeDir(): string {
  return os.homedir();
}

/** A trimmed, non-empty environment override resolved to an absolute path. */
function envDir(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? path.resolve(value) : undefined;
}

/**
 * Directory where toguru stores its own data (the account vault).
 * Override with the `TOGURU_HOME` environment variable.
 */
export function dataDir(): string {
  return envDir("TOGURU_HOME") ?? path.join(os.homedir(), ".toguru");
}

/** Path to the JSON vault that holds every saved account. */
export function storeFile(): string {
  return path.join(dataDir(), "store.json");
}

/** Where users declare their own providers (`<id>.json`). */
export function providersDir(): string {
  return path.join(dataDir(), "providers");
}

/** Root of the per-profile config dirs (account homes). */
export function homesDir(): string {
  return path.join(dataDir(), "homes");
}

/** Files the background keeper keeps next to the vault. */
export function keeperFiles(): { pid: string; state: string; log: string } {
  const dir = dataDir();
  return {
    pid: path.join(dir, "keeper.pid"),
    state: path.join(dir, "keeper.json"),
    log: path.join(dir, "keeper.log"),
  };
}

/** Expand a leading `~` to the home directory. */
export function expandHome(value: string): string {
  return value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;
}

/* --- Claude Code (Anthropic) live locations --- */

/**
 * The config-dir env Claude Code would see for a slot. An account home acts
 * exactly like `CLAUDE_CONFIG_DIR=<home>` (with the secure-storage override
 * cleared, as `tg run` does).
 */
function claudeEnv(slot?: Slot): { configDir: string | undefined; secure: string | undefined } {
  if (slot?.dir !== undefined) {
    return { configDir: slot.dir, secure: undefined };
  }
  return {
    configDir: process.env.CLAUDE_CONFIG_DIR || undefined,
    secure: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
  };
}

/** Claude Code's config directory (`CLAUDE_CONFIG_DIR`, default `~/.claude`), resolved. */
export function claudeDir(slot?: Slot): string {
  const { configDir } = claudeEnv(slot);
  return configDir ? path.resolve(configDir) : path.join(os.homedir(), ".claude");
}

/** File-based credentials used by Claude Code on Linux/Windows. */
export function claudeCredentialsFile(slot?: Slot): string {
  return path.join(claudeDir(slot), ".credentials.json");
}

/**
 * Claude Code's main config; holds the signed-in account's profile. A legacy
 * `<config dir>/.config.json` wins when present; otherwise `.claude.json` sits
 * in `CLAUDE_CONFIG_DIR` when that is set, else in the home directory.
 */
export function claudeConfigFile(slot?: Slot): string {
  const legacy = path.join(claudeDir(slot), ".config.json");
  if (existsSync(legacy)) {
    return legacy;
  }
  const { configDir } = claudeEnv(slot);
  return configDir ? path.join(path.resolve(configDir), ".claude.json") : path.join(os.homedir(), ".claude.json");
}

/**
 * macOS keychain service Claude Code stores its tokens under. A custom config
 * dir gets its own item, suffixed with the first 8 hex chars of the sha256 of
 * the raw directory string, so several config dirs stay signed in side by side.
 * `CLAUDE_SECURESTORAGE_CONFIG_DIR` overrides the hashed value (empty: no suffix).
 */
export function claudeKeychainService(slot?: Slot): string {
  const { configDir, secure } = claudeEnv(slot);
  // Claude Code hashes the raw (NFC-normalized) string — no resolving or trimming.
  const hashed = (secure ?? configDir ?? "").normalize("NFC");
  const unsuffixed = secure !== undefined ? !secure : !configDir;
  if (unsuffixed) {
    return "Claude Code-credentials";
  }
  return `Claude Code-credentials-${createHash("sha256").update(hashed).digest("hex").slice(0, 8)}`;
}

/** Keychain account Claude Code uses: `$USER` when it is a plain name. */
export function claudeKeychainAccount(): string {
  let user: string;
  try {
    user = process.env.USER || os.userInfo().username;
  } catch {
    return "claude-code-user";
  }
  return /^[a-zA-Z0-9._-]+$/.test(user) ? user : "claude-code-user";
}

/* --- Codex (OpenAI) live locations --- */

/** Codex's home (`CODEX_HOME`, default `~/.codex`), or an account home. */
export function codexDir(slot?: Slot): string {
  return slot?.dir ?? envDir("CODEX_HOME") ?? path.join(os.homedir(), ".codex");
}

/** File-based credentials used by the Codex CLI on every platform. */
export function codexAuthFile(slot?: Slot): string {
  return path.join(codexDir(slot), "auth.json");
}

/** Codex's config, which decides whether credentials live in a file or the keyring. */
export function codexConfigFile(slot?: Slot): string {
  return path.join(codexDir(slot), "config.toml");
}
