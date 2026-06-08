# toguru トグル

[![npm version](https://img.shields.io/npm/v/toguru-cli.svg)](https://www.npmjs.com/package/toguru-cli)

> One CLI to swap between multiple **Claude Code** (Anthropic) and **Codex** (OpenAI) accounts.

**toguru** (トグル) is Japanese for *"toggle"* — and that's exactly what it does:
toggle between accounts.

Tired of logging out and back in to switch between your personal and work
Claude/Codex subscriptions? `tg` saves each signed-in session and lets you flip
between them in a second — from a single tool, on macOS, Linux, and Windows.

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

The command is **`tg`** (with `toguru` as a longer-form alias — they're
identical). `tg` isn't a standard Unix/Linux command, so it won't clash with
anything already on your `PATH`.

## Just run `tg`

That's the whole thing — run `tg` with **no arguments** and you drop straight
into the interactive hub: every saved account across Claude and Codex, arrow-key
to one to switch / re-authenticate / rename / remove, or log in to a new one.

```
$ tg

? Accounts — pick one to manage
  Claude Code (Anthropic)
❯   you@example.com [active]
  Codex (OpenAI)
    work@company.com ⚠ re-auth
  ──────────────
  🔑 Log in to a new account
  🚪 Exit
```

No flags to memorize. Everything below is just the same actions as direct
commands, for when you want them.

### Auth status

toguru flags each account's sign-in state — read **locally** from the saved
token, no network calls:

| Tag | Meaning |
| --- | --- |
| *(none)* | Signed in, token still valid |
| `⟳ expired` | Access token expired — the provider refreshes it automatically on next use |
| `⚠ re-auth` | No refresh token — you must log in again (`tg <provider> auth <name>`) |

`tg status` spells this out per active account (e.g. *"✓ signed in (token
expires in 8 hours)"*), and `tg switch` tells you right after switching if the
session it activated has expired or needs re-authentication.

---

## Quick start

```bash
# 1. Log in AND save in one step (opens your browser):
tg claude auth work        # or: tg codex auth work

# 2. Add another account the same way:
tg claude auth personal

# 3. Switch any time:
tg switch claude personal
tg switch claude           # interactive picker
tg                         # …or just run tg and pick

# See where things stand:
tg list
tg status
```

If a saved profile's token goes stale, re-authenticate it **in place** — same
name, fresh session:

```bash
tg claude auth work        # re-runs login and updates the "work" profile
```

Already logged in through the provider's own CLI? You can still snapshot the
current session without re-authenticating: `tg add claude work`.

Profiles default to your **account email** — log in as `you@example.com`
and the profile is named that (just press Enter at the prompt, or pass your own
name).

---

## Commands

| Command | Description |
| --- | --- |
| `tg` / `tg status` | Interactive hub: arrow-key a profile → switch / re-auth / rename / remove (alias: `current`) |
| `tg <provider> auth [name]` | **Log in (or re-authenticate a profile) and save it** — e.g. `tg codex auth` |
| `tg auth [provider] [name]` | Same as above, with the provider as an argument |
| `tg switch [provider] [name]` | Activate a saved account (alias: `use`) |
| `tg add [provider] [name]` | Save the *current* live session as a named account (no re-login) |
| `tg list [provider]` | List saved accounts (alias: `ls`) |
| `tg current [provider]` | Show active account + live-sync status, then open the hub on a TTY (alias: `status`; use `--json` for plain output) |
| `tg rename [provider] [old] [new]` | Rename a saved account (alias: `mv`) |
| `tg remove [provider] [name]` | Forget a saved account (alias: `rm`) |
| `tg export [provider]` | Export accounts as JSON |
| `tg import <file>` | Import accounts from a JSON export |
| `tg update` | Update to the latest version (auto-detects npm/bun/pnpm/yarn) |

`provider` is `claude` or `codex`. Omit any positional argument and you'll be
prompted for it.

### Useful flags

- `tg add --label <email>` — set a custom label; `--activate` to switch to it immediately; `--force` to overwrite.
- `tg list --json` / `tg current --json` — machine-readable output for scripts.
- `tg remove --yes` — skip the confirmation prompt.
- `tg export --out accounts.json` — write to a file; `tg import --overwrite` to replace existing entries.
- `tg update --check` — only report whether a newer version exists; `--pm <npm|bun|pnpm|yarn>` to force the package manager.
- `-v, --version`, `-h, --help` everywhere.

### Updating

```bash
tg update          # checks npm, then updates in place via the manager that installed it
tg update --check  # just tell me if there's a newer version
```

`update` figures out whether toguru was installed with npm, bun, pnpm or yarn
(from where the binary lives) and runs the matching global install. From a source
checkout or `npx`, it prints the manual command instead.

### Examples

```bash
tg add codex --label me@work.com --activate
tg switch codex            # pick interactively
tg list --json | jq '.[0].accounts'
tg export --out backup.json   # ⚠️ contains credentials — keep it private
tg import backup.json
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

## Run from source (Bun)

```bash
bun install
bun run dev -- --help     # run the CLI in dev
bun run build             # produce dist/
bun test                  # run the test suite
```

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
