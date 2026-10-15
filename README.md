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
| Claude Code | macOS Keychain (`Claude Code-credentials`, hash-suffixed per `CLAUDE_CONFIG_DIR`) · `<config dir>/.credentials.json` elsewhere; identity in `~/.claude.json` |
| Codex | `~/.codex/auth.json` (override the dir with `CODEX_HOME`) |

Saved accounts live in `~/.toguru/store.json` (override with
`TOGURU_HOME`), written atomically with `0600` permissions under a lock, so two
`tg` processes never drop each other's updates.

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

❀ トグル toguru v0.1.x
  ↳ アカウント切り替え · account toggle

❀ Pick an account  アカウントを選んでね
 ▍Claude Code (Anthropic)  クロード
❯ ● you@example.com   max  ✓
  ○ work@company.com  team  ◔ re-auth in 2d
 ▍Codex (OpenAI)  コーデックス
  ● me@gmail.com      plus  ✓

  ✚ Log in to a new account  新規ログイン
  ✕ Exit  またね

  ✓ signed in · token renews in 8 hours · re-login due in 27 days
↑↓ move うごく  ·  ⏎ pick えらぶ
```

`●` marks the account that's live right now. The line under the menu describes
the highlighted account. If you're signed in to an account tg hasn't saved yet,
the hub offers to save it. Piped (no TTY), bare `tg` just prints the list.
Colours follow `NO_COLOR` / `FORCE_COLOR`.

No flags to memorize. Everything below is just the same actions as direct
commands, for when you want them.

### Auth status

toguru flags each account's sign-in state — read **locally** from the saved
token, no network calls:

| Tag | Meaning |
| --- | --- |
| `✓` | Signed in, token valid (API keys always are) |
| `⟳ auto-refresh` | Access token expired — the provider refreshes it automatically on next use |
| `◔ re-auth in 2d` | The login itself ends soon. Claude logins have a hard ~30-day limit that token refreshes can't extend |
| `✖ re-auth` | The login has ended (refresh token expired or missing) — sign in again (`tg <provider> auth <name>`) |

`tg status` spells this out for the live account (e.g. *"✓ signed in · token
renews in 8 hours · re-login due in 27 days"*) and counts idle accounts that
need attention. `tg switch` tells you right after switching, and on a terminal
offers to sign in again on the spot when the login has ended.

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

If a saved profile's login ends, re-authenticate it **in place** — same name,
fresh session (Claude pre-fills the email on the login page):

```bash
tg claude auth work        # re-runs login and updates the "work" profile
```

If you sign in as a *different* account than the profile holds, tg leaves the
profile untouched and saves the new login separately.

Already logged in through the provider's own CLI? You can still snapshot the
current session without re-authenticating: `tg add claude work`.

Profiles default to your **account email** — log in as `you@example.com`
and the profile is named that (just press Enter at the prompt, or pass your own
name). The same email in two Claude orgs becomes `you@example.com` and
`you@example.com-2`. Commands that take a profile name also accept its email.

---

## Commands

| Command | Description |
| --- | --- |
| `tg` / `tg status` | Interactive hub: arrow-key a profile → switch / re-auth / rename / remove (alias: `current`) |
| `tg <provider> auth [name]` | **Log in (or re-authenticate a profile) and save it** — e.g. `tg codex auth` (alias: `login`) |
| `tg auth [provider] [name]` | Same as above, with the provider as an argument |
| `tg switch [provider] [name]` | Activate a saved account (alias: `use`) |
| `tg add [provider] [name]` | Save the *current* live session as a named account (no re-login); it becomes the active one |
| `tg list [provider]` | List saved accounts (alias: `ls`) |
| `tg current [provider]` | Show the live account and its auth health, then open the hub on a TTY (alias: `status`; use `--json` for plain output) |
| `tg sync [provider]` | Capture a token refresh / re-auth / outside switch from the live session into the vault |
| `tg rename [provider] [old] [new]` | Rename a saved account (alias: `mv`) |
| `tg remove [provider] [name]` | Forget a saved account (alias: `rm`) |
| `tg export [provider]` | Export accounts as JSON |
| `tg import <file>` | Import accounts from a JSON export |
| `tg home [provider] [name]` | Give a profile its own config dir (`--login` to start one with a fresh login, `--leave` to bring it back) |
| `tg run <provider> <name> [args…]` | Run the CLI as a profile that lives in its own home (`tg run claude work -- --resume`) |
| `tg env <provider> <name>` | Print shell lines pointing this shell at a profile's home: `eval "$(tg env claude work)"` |
| `tg keeper start\|stop\|status\|run` | The background watcher (見張り番) — see below |
| `tg providers` | List providers, including ones you declared (`tg providers init <id>` to start one) |
| `tg update` | Update to the latest version (auto-detects npm/bun/pnpm/yarn) |

`provider` is `claude` (aliases `anthropic`, `claude-code`), `codex`
(aliases `openai`, `gpt`, `chatgpt`) or one you declared, case-insensitive.
Omit any positional argument and you'll be prompted for it on a terminal;
without one, tg fails fast instead of waiting for input.

### Useful flags

- `tg add --label <email>` — set a custom label; `--force` to overwrite a profile holding a different account.
- `tg list --json` / `tg current --json` — machine-readable output for scripts.
- `tg remove --yes` — skip the confirmation prompt (required without a terminal).
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
tg add codex --label me@work.com
tg switch codex            # pick interactively
tg list --json | jq '.[0].accounts'
tg export --out backup.json   # ⚠️ contains credentials — keep it private
tg import backup.json
```

---

## How it works

- **`auth`** delegates to the provider's own login (`claude auth login` /
  `codex login`), then captures the resulting session and saves it as a profile
  — all in one command. Before logging in it captures the session that's being
  replaced, so that account keeps its latest tokens.
- **`add`** reads whatever session your provider CLI currently holds and stores
  a copy under a name you choose. Your live session is left untouched.
- **`switch`** writes a saved credential back into the provider's live location,
  making that account active. On macOS, Claude credentials round-trip through
  the Keychain (fed to `security` on stdin, never in the process list);
  everywhere else they are plain files. For Claude, toguru also restores the
  signed-in identity (`oauthAccount` in `~/.claude.json`) so the displayed
  account, email and org match the active tokens. Only the account's own tokens
  are swapped: machine-wide entries in the same Keychain item (MCP server
  logins) stay as they are. Symlinked config files (dotfile managers) are
  written through, not replaced.
- **`current`** shows which login is live and whether it matches a saved
  profile.

### Why saved accounts used to "expire"

Claude Code and Codex rotate their refresh token every time they refresh:
the old one stops working. A saved profile that misses a rotation holds a dead
token, and switching back to it means logging in again — even though the CLI
itself "just works" while it's the only copy. tg avoids that by capturing
eagerly: whenever it looks at a provider (hub, `status`, `switch`, `auth`,
`sync`), it matches the live login to a saved profile **by identity** (user +
org/workspace) and copies newer tokens into it. That includes logins you
switched to outside tg.

Some expiry is real and nothing local can prevent it: Claude logins carry a
hard deadline (`refreshTokenExpiresAt`, about 30 days after you sign in) that
refreshing doesn't extend. tg shows it (`◔ re-auth in 2d`), the keeper sends a
notification ahead of it, and `tg switch` offers to sign in again when you land
on an ended login.

If the live session is a login tg doesn't have, nothing is marked active and
no profile is touched; `tg switch` offers to save it first (on a terminal), and
the hub shows a **Save the live session** row. Removing the active profile
leaves nothing active, and imports never mark anything active — "active"
always means "this is what's signed in right now".

> **Codex keyring users:** if `~/.codex/config.toml` sets
> `cli_auth_credentials_store = "keyring"` (or `"auto"`), Codex ignores
> `auth.json`, so tg refuses to switch Codex rather than pretend. Set it to
> `"file"` and run `codex login` once.

### The keeper (見張り番)

Capturing only works while tg is running. `tg keeper start` runs a small
background watcher that does the same capture every few minutes (`--interval`,
default 5m, minimum 30s), so a rotation is saved even if something else
overwrites the live session before you next run tg:

```bash
tg keeper start            # detaches; logs to ~/.toguru/keeper.log
tg keeper status           # last check, what it captured, logins ending soon
tg keeper stop
tg keeper run --once       # one pass in the foreground (cron-friendly)
```

It never calls a token endpoint itself — the official CLIs keep refreshing their
own sessions, the keeper only watches their files/Keychain and copies what they
write. It waits for a slot to read the same twice before capturing, so a CLI
halfway through a login (new tokens, old identity) is never filed under the
wrong profile. When it isn't running, `tg switch` and the hub remind you once a
day.

### Account homes (no copies at all)

Every copy of a rotating refresh token can go stale; the keeper just keeps the
copies current. An **account home** removes the copy instead: the profile gets
its own config dir (`~/.toguru/homes/<provider>/<name>`), and the provider's CLI
runs against it via `CLAUDE_CONFIG_DIR` / `CODEX_HOME` and keeps the only copy
of that login. Settings (`settings.json`, `CLAUDE.md`, `config.toml`, prompts…)
are symlinked from your normal config dir, so they stay shared.

```bash
tg home claude work                 # move an idle profile into its own home
tg claude auth side --home          # or start one with a fresh login inside it
tg run claude work                  # run claude as "work" (args pass through)
eval "$(tg env claude work)"        # …or point this shell at it
tg home claude work --leave         # bring it back to normal switching
```

Homes also let two accounts run side by side in two terminals. A home profile
isn't switched into the default slot (`tg switch` refuses and tells you how to
run it), and the profile that's live in the default slot can't move into a home
(that would leave two copies of one login) — switch away first.

### Your own providers

Any CLI that keeps its login in files can be added without code. Drop a
definition in `~/.toguru/providers/<id>.json` (`tg providers init <id>` writes a
starter):

```json
{
  "id": "gemini",
  "name": "Gemini CLI (Google)",
  "aliases": ["google"],
  "kana": "ジェミニ",
  "dir": "~/.gemini",
  "files": ["oauth_creds.json", "google_accounts.json"],
  "login": ["gemini"],
  "fields": {
    "email": { "file": "google_accounts.json", "path": "active" },
    "identity": { "file": "oauth_creds.json", "path": "id_token", "jwt": "sub" },
    "expiresAt": { "file": "oauth_creds.json", "path": "expiry_date", "unit": "ms" },
    "refreshToken": { "file": "oauth_creds.json", "path": "refresh_token" }
  }
}
```

The listed `files` (relative to `dir`; the first one means "signed in") are
captured and restored together. `fields` point into them (dot paths; `jwt` reads
a claim from a token; `unit` is `ms`, `s` or `iso`) and power labels, identity
matching and auth status. Add `"dirEnv"` — the CLI's config-dir env var — to
unlock account homes and `tg run`, plus `"shared"` for what homes should link.
Broken definitions are reported (`tg providers`) and skipped; built-ins keep
working.

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
import { getProvider, Store, swapLive } from "toguru-cli";

const store = await Store.load();
// Captures the outgoing session, writes "work" live and marks it active — atomically.
await swapLive(getProvider("claude"), store, "work");
```

Exports: `Store`, `swapLive`, `reconcile`, `placeLogin` (with your own
`Prompter`), `classifyAuth`, `allProviders`, `getProvider`, `findProvider`,
`providerIds`, `ToguruError`, `createProgram`, plus all related types.

---

## Project layout

```
src/
  cli.ts            # executable entrypoint (#!/usr/bin/env node)
  program.ts        # wires commander commands together
  index.ts          # public library surface
  commands/         # one file per command (+ interactive hub, shared prompts)
  providers/        # provider seam: claude, codex, declared (file-set) adapters, registry
  core/             # vault (Store + lock), reconcile/swapLive, placement, homes, keeper, auth status, paths
  ui/               # theme (colours, glyphs, banner), row formatting, prompts (+ terminal Prompter)
  utils/            # fs, jwt, logger, errors, strings, process helpers
tests/              # bun:test unit tests; tests/e2e drives the real CLI against fake claude/codex/security
```

## License

[MIT](./LICENSE)
