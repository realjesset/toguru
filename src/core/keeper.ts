import { type ChildProcess, execFile, spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { allProviders } from "../providers/registry";
import type { Provider, Slot } from "../providers/types";
import { relativeTime } from "../ui/format";
import { ToguruError } from "../utils/errors";
import { readJson, writeJson } from "../utils/fs";
import { logger } from "../utils/logger";
import { classifyAuth } from "./auth-status";
import { isLinux, isMac, keeperFiles } from "./paths";
import { captureHome, type LiveState, reconcile } from "./reconcile";
import { Store, type StoredAccount } from "./store";

/**
 * The keeper is a background loop that captures whatever the official CLIs
 * write into their live slots, so a saved profile never misses a
 * refresh-token rotation, and warns before a login's hard deadline. It never
 * refreshes tokens itself: it only watches.
 */

/** A saved profile whose login ends soon or has already ended. */
export interface Alert {
  provider: string;
  name: string;
  state: "reauth-soon" | "needs-reauth";
  /** When the login stops working (epoch ms), when known. */
  deadline?: number;
}

/** What one tick did for one provider. */
export interface ProviderTick {
  provider: string;
  result: "captured" | "adopted" | "in-sync" | "unsaved" | "logged-out" | "unstable" | "error";
  detail?: string;
  /** Home profiles whose snapshot was refreshed from their home dir. */
  homesCaptured: string[];
}

export interface TickReport {
  /** ISO time of the tick. */
  at: string;
  providers: ProviderTick[];
  alerts: Alert[];
}

/** Persisted in `keeperFiles().state`. */
export interface KeeperState {
  pid?: number;
  startedAt?: string;
  intervalMs?: number;
  lastTickAt?: string;
  lastTick?: TickReport;
  /** Alerts already notified (`provider:name:state:deadline`) → ISO time first notified. */
  notified: Record<string, string>;
  /** ISO time `keeperHint` last returned a hint. */
  lastHintAt?: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const MIN_INTERVAL_MS = 30 * SECOND;
export const DEFAULT_INTERVAL_MS = 5 * MINUTE;
/** How long a live slot must stay unchanged before it is captured. */
const SETTLE_MS = 1500;
const HINT_EVERY_MS = 24 * HOUR;
const START_TIMEOUT_MS = 3 * SECOND;
const STOP_TIMEOUT_MS = 3 * SECOND;
const POLL_MS = 50;

const UNITS: Record<string, number> = { ms: 1, s: SECOND, m: MINUTE, h: HOUR };

/** Parse `30s` / `5m` / `1h` / a bare millisecond count; at least 30s. */
export function parseInterval(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(value.trim());
  if (!match?.[1]) {
    throw new ToguruError(`Invalid interval "${value}".`, "Use e.g. 30s, 5m or 1h (a bare number is milliseconds).");
  }
  const ms = Math.round(Number(match[1]) * (UNITS[(match[2] ?? "ms").toLowerCase()] ?? 1));
  if (ms < MIN_INTERVAL_MS) {
    throw new ToguruError(`Interval "${value}" is too short.`, "The keeper checks at most every 30s.");
  }
  return ms;
}

/** `300000` → `5m`, `90000` → `90s`. */
export function formatInterval(ms: number): string {
  if (ms % HOUR === 0) {
    return `${ms / HOUR}h`;
  }
  if (ms % MINUTE === 0) {
    return `${ms / MINUTE}m`;
  }
  return `${Math.round(ms / SECOND)}s`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* --- tick --- */

/** A slot read, serialized for comparison, or why it failed. */
type Reading = { ok: true; json: string } | { ok: false; message: string };

async function readSlot(provider: Provider, slot?: Slot): Promise<Reading> {
  try {
    return { ok: true, json: JSON.stringify(await provider.readActive(slot)) };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

const UNSTABLE = "live login changed while checking (a CLI is mid-login); retrying next tick";

function outcome(state: LiveState): Pick<ProviderTick, "result" | "detail"> {
  switch (state.kind) {
    case "saved":
      return { result: state.captured ? "captured" : state.adopted ? "adopted" : "in-sync", detail: state.name };
    case "unsaved":
      return { result: "unsaved", ...(state.descriptor.email ? { detail: state.descriptor.email } : {}) };
    default:
      return { result: "logged-out" };
  }
}

/**
 * Capture the default slot — only when it read the same before and after the
 * settle wait. CLIs write tokens and identity separately during a login;
 * capturing between the two would file new tokens under the old identity.
 */
async function checkDefault(
  provider: Provider,
  store: Store,
  before: Reading,
): Promise<Pick<ProviderTick, "result" | "detail">> {
  if (!before.ok) {
    return { result: "error", detail: before.message };
  }
  try {
    return await store.transaction(async () => {
      const again = JSON.stringify(await provider.readActive());
      if (again !== before.json) {
        return { result: "unstable", detail: UNSTABLE };
      }
      return outcome(await reconcile(provider, store));
    });
  } catch (error) {
    return { result: "error", detail: messageOf(error) };
  }
}

/** Refresh one home profile's snapshot under the same stability rule. */
async function checkHome(provider: Provider, store: Store, account: StoredAccount, before: Reading): Promise<boolean> {
  if (!before.ok) {
    throw new Error(before.message);
  }
  return store.transaction(async () => {
    const current = store.get(provider.id, account.name);
    if (!current?.home) {
      return false;
    }
    if (JSON.stringify(await provider.readActive({ dir: current.home })) !== before.json) {
      throw new Error("changed while checking; retrying next tick");
    }
    return captureHome(provider, store, current);
  });
}

export interface TickOptions {
  /** How long a slot must stay unchanged before capture (default 1500ms). */
  settleMs?: number;
  /** Clock for auth classification and the report time. */
  now?: number;
  /** Providers to check (default: every registered provider). */
  providers?: readonly Provider[];
}

/**
 * One keeper pass: capture every provider's default slot and account homes
 * into the vault, then list the saved logins that need re-authentication.
 * Failures are reported per provider; it never throws for them.
 */
export async function tick(options: TickOptions = {}): Promise<TickReport> {
  const providers = options.providers ?? allProviders();
  const store = await Store.load();
  const homes = providers.map((provider) => store.list(provider.id).filter((account) => account.home));

  const before = await Promise.all(
    providers.map(async (provider, index) => ({
      live: await readSlot(provider),
      homes: await Promise.all((homes[index] ?? []).map((account) => readSlot(provider, { dir: account.home }))),
    })),
  );
  await sleep(options.settleMs ?? SETTLE_MS);

  const ticks: ProviderTick[] = [];
  for (const [index, provider] of providers.entries()) {
    const seen = before[index];
    if (!seen) {
      continue;
    }
    const main = await checkDefault(provider, store, seen.live);
    const notes = main.detail ? [main.detail] : [];
    const homesCaptured: string[] = [];
    for (const [at, account] of (homes[index] ?? []).entries()) {
      const reading = seen.homes[at] ?? { ok: false, message: "not read" };
      try {
        if (await checkHome(provider, store, account, reading)) {
          homesCaptured.push(account.name);
        }
      } catch (error) {
        notes.push(`home ${account.name}: ${messageOf(error)}`);
      }
    }
    ticks.push({
      provider: provider.id,
      result: main.result,
      ...(notes.length > 0 ? { detail: notes.join("; ") } : {}),
      homesCaptured,
    });
  }

  const now = options.now ?? Date.now();
  const alerts: Alert[] = [];
  for (const provider of providers) {
    for (const account of store.list(provider.id)) {
      const descriptor = provider.describe(account.credential);
      const state = classifyAuth(descriptor, now);
      if (state === "reauth-soon" || state === "needs-reauth") {
        const deadline = descriptor.refreshExpiresAt;
        alerts.push({ provider: provider.id, name: account.name, state, ...(deadline !== undefined ? { deadline } : {}) });
      }
    }
  }
  return { at: new Date(now).toISOString(), providers: ticks, alerts };
}

/* --- state & pid --- */

/** The keeper's persisted state; a missing or unreadable file reads as empty. */
export async function readKeeperState(): Promise<KeeperState> {
  let raw: unknown;
  try {
    raw = await readJson<unknown>(keeperFiles().state);
  } catch {
    raw = null; // corrupt cache: the next write replaces it
  }
  const data = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Partial<KeeperState>) : {};
  const notified: Record<string, string> = {};
  if (data.notified && typeof data.notified === "object") {
    for (const [key, value] of Object.entries(data.notified)) {
      if (typeof value === "string") {
        notified[key] = value;
      }
    }
  }
  return { ...data, notified };
}

async function updateKeeperState(patch: Partial<KeeperState>): Promise<KeeperState> {
  const next = { ...(await readKeeperState()), ...patch };
  await writeJson(keeperFiles().state, next);
  return next;
}

async function readPid(): Promise<number | undefined> {
  try {
    const pid = Number.parseInt(await fs.readFile(keeperFiles().pid, "utf8"), 10);
    return pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether a keeper is running; a stale pid file is removed. */
export async function keeperStatus(): Promise<{ running: boolean; pid?: number; state: KeeperState }> {
  const state = await readKeeperState();
  const pid = await readPid();
  if (pid !== undefined && isAlive(pid)) {
    return { running: true, pid, state };
  }
  await fs.rm(keeperFiles().pid, { force: true });
  return { running: false, state };
}

/** Remove the pid file if it is still ours (sync: runs from signal handlers). */
function releasePid(): void {
  const file = keeperFiles().pid;
  try {
    if (Number.parseInt(readFileSync(file, "utf8"), 10) === process.pid) {
      rmSync(file, { force: true });
    }
  } catch {
    // already gone
  }
}

/* --- notifications --- */

function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Show an OS notification (macOS, or Linux with notify-send); never throws. */
export function notify(title: string, message: string): Promise<void> {
  const command = isMac
    ? { file: "osascript", args: ["-e", `display notification ${quote(message)} with title ${quote(title)}`] }
    : isLinux
      ? { file: "notify-send", args: [title, message] }
      : undefined;
  if (!command) {
    return Promise.resolve();
  }
  const { promise, resolve } = Promise.withResolvers<void>();
  try {
    execFile(command.file, command.args, { timeout: 5000, windowsHide: true }, () => resolve());
  } catch {
    resolve();
  }
  return promise;
}

/** One-sentence description of an alert, with the command that fixes it. */
export function describeAlert(alert: Alert, now: number = Date.now()): string {
  const fix = `tg ${alert.provider} auth ${alert.name}`;
  const display = allProviders().find((provider) => provider.id === alert.provider)?.displayName ?? alert.provider;
  const who = `${display} login "${alert.name}"`;
  if (alert.state === "needs-reauth") {
    return `${who} has ended — log in again: ${fix}`;
  }
  const when = alert.deadline !== undefined ? relativeTime(alert.deadline, now) : "soon";
  return `${who} ends ${when} — log in again before then: ${fix}`;
}

/* --- the loop --- */

/** `2026-10-15T09:00:00.000Z claude:captured(a@x.com) codex:logged-out · ⚠ claude/a reauth-soon` */
function tickLine(report: TickReport): string {
  const parts = report.providers.map((entry) => {
    const homes = entry.homesCaptured.length > 0 ? ` +homes(${entry.homesCaptured.join(",")})` : "";
    const detail = entry.detail ? `(${entry.detail})` : "";
    return `${entry.provider}:${entry.result}${detail}${homes}`;
  });
  const alerts = report.alerts.map((alert) => `⚠ ${alert.provider}/${alert.name} ${alert.state}`);
  return [report.at, parts.join(" "), ...(alerts.length > 0 ? ["·", alerts.join(" ")] : [])].join(" ");
}

async function keeperPass(notifyEnabled: boolean): Promise<void> {
  let report: TickReport;
  try {
    report = await tick();
  } catch (error) {
    logger.out(`${new Date().toISOString()} tick failed: ${messageOf(error)}`);
    return;
  }
  logger.out(tickLine(report));
  const patch: Partial<KeeperState> = { lastTickAt: report.at, lastTick: report };
  if (notifyEnabled) {
    const { notified } = await readKeeperState();
    const next: Record<string, string> = {};
    for (const alert of report.alerts) {
      const key = `${alert.provider}:${alert.name}:${alert.state}:${alert.deadline}`;
      next[key] = notified[key] ?? report.at;
      if (!notified[key]) {
        await notify("toguru keeper", describeAlert(alert, Date.parse(report.at)));
      }
    }
    patch.notified = next;
  }
  await updateKeeperState(patch);
}

/**
 * Run the keeper in the foreground: tick every `intervalMs` until SIGTERM /
 * SIGINT. `once` runs a single tick without claiming the pid file.
 */
export async function runKeeper(options: { intervalMs: number; once?: boolean; notify?: boolean }): Promise<void> {
  const notifyEnabled = options.notify ?? true;
  if (options.once) {
    await keeperPass(notifyEnabled);
    return;
  }
  const status = await keeperStatus();
  if (status.running && status.pid !== process.pid) {
    throw new ToguruError(`The keeper is already running (pid ${status.pid}).`, "Stop it with: tg keeper stop");
  }
  const files = keeperFiles();
  await fs.mkdir(path.dirname(files.pid), { recursive: true });
  try {
    await fs.writeFile(files.pid, `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ToguruError("Another keeper just started.", "Check it with: tg keeper status");
    }
    throw error;
  }
  const exit = () => {
    releasePid();
    process.exit(0);
  };
  process.once("SIGTERM", exit);
  process.once("SIGINT", exit);
  await updateKeeperState({ pid: process.pid, startedAt: new Date().toISOString(), intervalMs: options.intervalMs });
  for (;;) {
    await keeperPass(notifyEnabled);
    await sleep(options.intervalMs);
  }
}

/** Start a detached keeper (or report the running one). */
export async function startKeeper(intervalMs: number): Promise<{ pid: number; already: boolean }> {
  const status = await keeperStatus();
  if (status.running && status.pid !== undefined) {
    return { pid: status.pid, already: true };
  }
  const files = keeperFiles();
  const script = process.argv[1];
  if (!script) {
    throw new ToguruError("Can't tell how tg was launched, so the keeper can't be started.");
  }
  await fs.mkdir(path.dirname(files.log), { recursive: true });
  const log = openSync(files.log, "a");
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [script, "keeper", "run", "--interval", String(intervalMs)], {
      detached: true,
      stdio: ["ignore", log, log],
      env: process.env,
      windowsHide: true,
    });
  } finally {
    closeSync(log);
  }
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", () => {
    exited = true;
  });
  child.unref();
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!exited && Date.now() < deadline) {
    if (child.pid !== undefined && (await readPid()) === child.pid) {
      return { pid: child.pid, already: false };
    }
    await sleep(POLL_MS);
  }
  if (!exited) {
    child.kill();
  }
  throw new ToguruError("The keeper didn't start.", `See its log: ${files.log}`);
}

/** Stop the running keeper; false when none was running. */
export async function stopKeeper(): Promise<boolean> {
  const { running, pid } = await keeperStatus();
  if (!running || pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // exited in the meantime
  }
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(pid) && Date.now() < deadline) {
    await sleep(POLL_MS);
  }
  if (isAlive(pid)) {
    throw new ToguruError(`The keeper (pid ${pid}) didn't stop.`, `Force it with: kill -9 ${pid}`);
  }
  if ((await readPid()) === pid) {
    await fs.rm(keeperFiles().pid, { force: true });
  }
  return true;
}

/**
 * A once-a-day nudge to start the keeper, for commands that touch logins.
 * Undefined while it runs or when a hint was shown in the last 24h.
 */
export async function keeperHint(now: number = Date.now()): Promise<string | undefined> {
  try {
    const { running, state } = await keeperStatus();
    const last = state.lastHintAt ? Date.parse(state.lastHintAt) : Number.NaN;
    if (running || now - last < HINT_EVERY_MS) {
      return undefined;
    }
    await updateKeeperState({ lastHintAt: new Date(now).toISOString() });
    return "tip: `tg keeper start` keeps saved logins captured in the background";
  } catch {
    return undefined; // advisory only: never fail the command that asked
  }
}
