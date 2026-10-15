import { Command } from "commander";
import {
  DEFAULT_INTERVAL_MS,
  describeAlert,
  formatInterval,
  keeperStatus,
  type ProviderTick,
  parseInterval,
  runKeeper,
  startKeeper,
  stopKeeper,
} from "../core/keeper";
import { keeperFiles } from "../core/paths";
import { allProviders } from "../providers/registry";
import { relativeTime } from "../ui/format";
import { face, ink, mark } from "../ui/theme";
import { logger } from "../utils/logger";

const DEFAULT_INTERVAL = formatInterval(DEFAULT_INTERVAL_MS);
const KEEPER = ink.lavender("keeper");

/** Glyph + words for one provider's last tick. */
const RESULTS: Record<ProviderTick["result"], string> = {
  captured: ink.green(`${mark.refresh} captured a rotation`),
  adopted: ink.green(`${mark.ok} adopted (switched outside tg)`),
  "in-sync": ink.green(`${mark.ok} in sync`),
  unsaved: ink.yellow(`${mark.warn} live login isn't saved`),
  "logged-out": ink.muted(`${mark.idle} nobody signed in`),
  unstable: ink.yellow(`${mark.soon} mid-login, retrying`),
  error: ink.red(`${mark.error} error`),
};

async function printStatus(json: boolean): Promise<void> {
  const { running, pid, state } = await keeperStatus();
  const now = Date.now();
  const startedAt = running && state.startedAt ? Date.parse(state.startedAt) : undefined;
  if (json) {
    logger.json({
      running,
      pid: running ? pid : undefined,
      startedAt: running ? state.startedAt : undefined,
      uptimeMs: startedAt !== undefined ? now - startedAt : undefined,
      intervalMs: running ? state.intervalMs : undefined,
      lastTickAt: state.lastTickAt,
      lastTick: state.lastTick,
      log: keeperFiles().log,
    });
    return;
  }

  if (running) {
    logger.out(`${ink.green(mark.live)} ${KEEPER} ${ink.bold("on watch")} ${ink.muted(`(pid ${pid})`)} ${face.cheer}`);
    const facts = [
      startedAt !== undefined ? `started ${relativeTime(startedAt, now)}` : undefined,
      state.intervalMs ? `every ${formatInterval(state.intervalMs)}` : undefined,
    ].filter(Boolean);
    if (facts.length > 0) {
      logger.out(ink.muted(`  ${facts.join(" · ")}`));
    }
  } else {
    logger.out(`${ink.muted(mark.idle)} ${KEEPER} ${ink.bold("is not running")} ${ink.muted(face.sleepy)}`);
  }

  const last = state.lastTick;
  if (last) {
    logger.out(ink.muted(`  last tick ${relativeTime(Date.parse(last.at), now)}`));
    const names = new Map(allProviders().map((provider) => [provider.id, provider.displayName]));
    for (const entry of last.providers) {
      const homes = entry.homesCaptured.length > 0 ? ink.muted(` · homes captured: ${entry.homesCaptured.join(", ")}`) : "";
      const detail = entry.detail ? ink.muted(` · ${entry.detail}`) : "";
      logger.out(`${ink.pink(mark.bar)}${ink.bold(names.get(entry.provider) ?? entry.provider)}  ${RESULTS[entry.result]}${detail}${homes}`);
    }
    for (const alert of last.alerts) {
      const color = alert.state === "needs-reauth" ? ink.red : ink.yellow;
      logger.out(`  ${color(mark.warn)} ${describeAlert(alert, now)}`);
    }
  }

  if (!running) {
    logger.hint("Start it with: tg keeper start");
  }
}

export function keeperCommand(): Command {
  const keeper = new Command("keeper").description(
    "Background watcher that captures token rotations and warns before logins end",
  );

  keeper
    .command("start")
    .description("Start the keeper in the background")
    .option("--interval <duration>", "how often to check: 30s, 5m, 1h", DEFAULT_INTERVAL)
    .action(async (opts: { interval: string }) => {
      const intervalMs = parseInterval(opts.interval);
      const { pid, already } = await startKeeper(intervalMs);
      if (already) {
        logger.info(`${ink.blue(mark.live)} The keeper is already on watch ${ink.muted(`(pid ${pid})`)}.`);
        return;
      }
      logger.success(`The keeper is on watch ${ink.muted(`(pid ${pid}, every ${formatInterval(intervalMs)})`)} ${face.cheer}`);
      logger.hint(`Log: ${keeperFiles().log}`);
    });

  keeper
    .command("stop")
    .description("Stop the background watcher")
    .action(async () => {
      if (await stopKeeper()) {
        logger.success(`The keeper is off duty ${face.wave}`);
      } else {
        logger.info(`${ink.muted(mark.idle)} The keeper wasn't running.`);
      }
    });

  keeper
    .command("status")
    .description("Show whether the watcher runs, its last check and any login warnings")
    .option("--json", "output machine-readable JSON", false)
    .action(async (opts: { json: boolean }) => {
      await printStatus(opts.json);
    });

  keeper
    .command("run")
    .description("Run the watcher in the foreground (what `start` launches)")
    .option("--interval <duration>", "how often to check: 30s, 5m, 1h", DEFAULT_INTERVAL)
    .option("--once", "check once and exit", false)
    .option("--no-notify", "don't show desktop notifications")
    .action(async (opts: { interval: string; once: boolean; notify: boolean }) => {
      const intervalMs = parseInterval(opts.interval);
      if (!opts.once) {
        logger.info(`${ink.pink(mark.petal)} Keeper on watch every ${formatInterval(intervalMs)} ${ink.muted("(Ctrl-C to stop)")}`);
      }
      await runKeeper({ intervalMs, once: opts.once, notify: opts.notify });
    });

  return keeper;
}
