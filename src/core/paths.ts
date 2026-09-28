import os from "node:os";
import path from "node:path";

/** Current platform flags, computed once. */
export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isLinux = process.platform === "linux";

/** Absolute path to the user's home directory. */
export function homeDir(): string {
  return os.homedir();
}

/**
 * Directory where toguru stores its own data (the account vault).
 * Override with the `TOGURU_HOME` environment variable.
 */
export function dataDir(): string {
  const override = process.env.TOGURU_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".toguru");
}

/** Path to the JSON vault that holds every saved account. */
export function storeFile(): string {
  return path.join(dataDir(), "store.json");
}

/* --- Claude Code (Anthropic) live locations --- */

export function claudeDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".claude");
}

/** File-based credentials used by Claude Code on Linux/Windows. */
export function claudeCredentialsFile(): string {
  return path.join(claudeDir(), ".credentials.json");
}

/**
 * Claude Code's main config; holds the signed-in account's profile.
 * With `CLAUDE_CONFIG_DIR` set, it lives inside that directory alongside the
 * credentials; otherwise it sits at `~/.claude.json`.
 */
export function claudeConfigFile(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (override) {
    return path.join(path.resolve(override), ".claude.json");
  }
  return path.join(os.homedir(), ".claude.json");
}

/* --- Codex (OpenAI) live locations --- */

export function codexDir(): string {
  const override = process.env.CODEX_HOME?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), ".codex");
}

/** File-based credentials used by the Codex CLI on every platform. */
export function codexAuthFile(): string {
  return path.join(codexDir(), "auth.json");
}
