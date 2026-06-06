# toguru トグル

[![npm version](https://img.shields.io/npm/v/toguru-cli.svg)](https://www.npmjs.com/package/toguru-cli)

> One CLI to swap between multiple **Claude Code** (Anthropic) and **Codex** (OpenAI) accounts.

**toguru** (トグル) is Japanese for *"toggle"* — and that's exactly what it does:
toggle between accounts.

Tired of logging out and back in to switch between your personal and work
Claude/Codex subscriptions? `toguru` saves each signed-in session and
lets you flip between them in a second — from a single tool, on macOS, Linux,
and Windows.

It is a thin, safe layer over the credentials your existing CLIs already write:

| Provider | Live credential location |
| --- | --- |
| Claude Code | macOS Keychain (`Claude Code-credentials`) · `~/.claude/.credentials.json` elsewhere |
| Codex | `~/.codex/auth.json` (override the dir with `CODEX_HOME`) |

Saved accounts live in `~/.toguru/store.json` (override with
`TOGURU_HOME`), written atomically with `0600` permissions.

---

## Install

```bash
# with bun
bun add -g toguru-cli

# or npm / pnpm
npm install -g toguru-cli
```

This exposes two commands: `toguru` and the short alias `tg`.

### Run from source (Bun)

```bash
bun install
bun run dev -- --help     # run the CLI in dev
bun run build             # produce dist/
bun test                  # run the test suite
```

---

## Quick start

```bash
# 1. Log in AND save in one step (opens your browser):
toguru claude auth work        # or: toguru codex auth work

# 2. Add another account the same way:
toguru claude auth personal

# 3. Switch any time:
toguru switch claude personal
toguru switch claude           # interactive picker

# See where things stand:
toguru list
toguru current
```

If a saved profile's token goes stale, re-authenticate it **in place** — same
name, fresh session:

```bash
toguru claude auth work        # re-runs login and updates the "work" profile
```

Already logged in through the provider's own CLI? You can still snapshot the
current session without re-authenticating: `toguru add claude work`.

Profiles default to your **account email** — log in as `you@example.com`
and the profile is named that (just press Enter at the prompt, or pass your own
name).

Run `toguru` (or `toguru status`) with no arguments for the **interactive hub**:
arrow-key through every saved profile across both providers and pick one to
switch / re-authenticate / rename / remove — or log in to a new account.

```
Codex (OpenAI)
❯ you@example.com (you@example.com) [active]
  work@company.com (work@company.com)
──────────────
➕ Log in to a new account
Exit
```

---

## Commands

| Command | Description |
| --- | --- |
| `toguru` / `toguru status` | Interactive hub: arrow-key a profile → switch / re-auth / rename / remove (alias: `current`) |
| `toguru <provider> auth [name]` | **Log in (or re-authenticate a profile) and save it** — e.g. `toguru codex auth` |
| `toguru auth [provider] [name]` | Same as above, with the provider as an argument |
| `toguru switch [provider] [name]` | Activate a saved account (alias: `use`) |
| `toguru add [provider] [name]` | Save the *current* live session as a named account (no re-login) |
| `toguru list [provider]` | List saved accounts (alias: `ls`) |
| `toguru current [provider]` | Show active account + live-sync status, then open the hub on a TTY (alias: `status`; use `--json` for plain output) |
| `toguru rename [provider] [old] [new]` | Rename a saved account (alias: `mv`) |
| `toguru remove [provider] [name]` | Forget a saved account (alias: `rm`) |
| `toguru export [provider]` | Export accounts as JSON |
| `toguru import <file>` | Import accounts from a JSON export |

`provider` is `claude` or `codex`. Omit any positional argument and you'll be
prompted for it.

### Useful flags

- `toguru add --label <email>` — set a custom label; `--activate` to switch to it immediately; `--force` to overwrite.
- `toguru list --json` / `toguru current --json` — machine-readable output for scripts.
- `toguru remove --yes` — skip the confirmation prompt.
- `toguru export --out accounts.json` — write to a file; `toguru import --overwrite` to replace existing entries.
- `-v, --version`, `-h, --help` everywhere.

### Examples

```bash
toguru add codex --label me@work.com --activate
toguru switch codex            # pick interactively
toguru list --json | jq '.[0].accounts'
toguru export --out backup.json   # ⚠️ contains credentials — keep it private
toguru import backup.json
```

---

## How it works

- **`auth`** delegates to the provider's own login (`claude auth login` /
  `codex login`), then captures the resulting session and saves it as a profile
  — all in one command. Re-authenticating an existing profile overwrites it in
  place (and, for Claude, pre-fills the profile's email on the login page). Note
  that the account you end up with is whichever one you sign into in the browser.
- **`add`** reads whatever session your provider CLI currently holds and stores
  a copy under a name you choose. Your live session is left untouched.
- **`switch`** writes a saved credential back into the provider's live location,
  making that account active. On macOS, Claude credentials round-trip through
  the Keychain; everywhere else they are plain files. For Claude, toguru also
  restores the signed-in identity (`oauthAccount` in `~/.claude.json`) so the
  displayed account, email and org match the active tokens — not just the
  credentials.
- **`current`** compares the live session against what it last activated and
  warns if they have drifted (e.g. a token was refreshed by the provider).

Nothing ever calls a remote API. Labels and plan names shown for Codex are
parsed locally from the (unverified) `id_token` purely for display.

> ⚠️ **Security:** saved accounts and exports contain real OAuth tokens. The
> vault is created with `0600` permissions; treat exports as secrets.

---

## Use as a library

The CLI is built on a small, typed core you can drive directly:

```ts
import { Store, providers } from "toguru-cli";

const store = await Store.load();
const account = store.get("claude", "work");
if (account) {
  await providers.claude.writeActive(account.credential);
  await store.setActive("claude", "work");
}
```

Exports: `Store`, `providers`, `getProvider`, `providerIds`, `ToguruError`,
`createProgram`, plus all related types.

---

## Project layout

```
src/
  cli.ts            # executable entrypoint (#!/usr/bin/env node)
  program.ts        # wires commander commands together
  index.ts          # public library surface
  commands/         # one file per command (+ interactive menu, shared prompts)
  providers/        # provider abstraction + claude/codex implementations
  core/             # paths, keychain, account vault (Store)
  utils/            # fs, jwt, logger, errors, strings, process helpers
tests/              # bun:test unit tests
```

## License

[MIT](./LICENSE)
