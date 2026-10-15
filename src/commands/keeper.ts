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
import { ink, kao, mark } from "../ui/theme";
import { logger } from "../utils/logger";

const DEFAULT_INTERVAL = formatInterval(DEFAULT_INTERVAL_MS);
const WATCHMAN = `${ink.fuji("見張り番")} ${ink.sumi("mihariban")}`;

/** Glyph + words for one provider's last tick. */
const RESULTS: Record<ProviderTick["result"], string> = {
  captured: ink.matcha(`${mark.refresh} captured a rotation`),
  adopted: ink.matcha(`${mark.ok} adopted (switched outside tg)`),
  "in-sync": ink.matcha(`${mark.ok} in sync`),
  unsaved: ink.yuzu(`${mark.warn} live login isn't saved`),
  "logged-out": ink.sumi(`${mark.idle} nobody signed in`),
  unstable: ink.yuzu(`${mark.soon} mid-login, retrying`),
  error: ink.beni(`${mark.error} error`),
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
    logger.out(`${ink.matcha(mark.live)} ${WATCHMAN} ${ink.bold("on watch")} ${ink.sumi(`(pid ${pid})`)} ${kao.cheer}`);
    const facts = [
      startedAt !== undefined ? `started ${relativeTime(startedAt, now)}` : undefined,
      state.intervalMs ? `every ${formatInterval(state.intervalMs)}` : undefined,
    ].filter(Boolean);
    if (facts.length > 0) {
      logger.out(ink.sumi(`  ${facts.join(" · ")}`));
    }
  } else {
    logger.out(`${ink.sumi(mark.idle)} ${WATCHMAN} ${ink.bold("is not running")} ${ink.sumi(kao.sleepy)}`);
  }

  const last = state.lastTick;
  if (last) {
    logger.out(ink.sumi(`  last tick ${relativeTime(Date.parse(last.at), now)}`));
    const names = new Map(allProviders().map((provider) => [provider.id, provider.displayName]));
    for (const entry of last.providers) {
      const homes = entry.homesCaptured.length > 0 ? ink.sumi(` · homes captured: ${entry.homesCaptured.join(", ")}`) : "";
      const detail = entry.detail ? ink.sumi(` · ${entry.detail}`) : "";
      logger.out(`${ink.sakura(mark.bar)}${ink.bold(names.get(entry.provider) ?? entry.provider)}  ${RESULTS[entry.result]}${detail}${homes}`);
    }
    for (const alert of last.alerts) {
      const color = alert.state === "needs-reauth" ? ink.beni : ink.yuzu;
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
    .description("Start the 見張り番 (watchman) in the background")
    .option("--interval <duration>", "how often to check: 30s, 5m, 1h", DEFAULT_INTERVAL)
    .action(async (opts: { interval: string }) => {
      const intervalMs = parseInterval(opts.interval);
      const { pid, already } = await startKeeper(intervalMs);
      if (already) {
        logger.info(`${ink.sora(mark.live)} 見張り番 is already on watch ${ink.sumi(`(pid ${pid})`)}.`);
        return;
      }
      logger.success(`見張り番 is on watch ${ink.sumi(`(pid ${pid}, every ${formatInterval(intervalMs)})`)} ${kao.cheer}`);
      logger.hint(`Log: ${keeperFiles().log}`);
    });

  keeper
    .command("stop")
    .description("Stop the background watcher")
    .action(async () => {
      if (await stopKeeper()) {
        logger.success(`見張り番 is off duty ${kao.wave}`);
      } else {
        logger.info(`${ink.sumi(mark.idle)} 見張り番 wasn't running.`);
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
        logger.info(`${ink.sakura(mark.petal)} 見張り番 on watch every ${formatInterval(intervalMs)} ${ink.sumi("(Ctrl-C to stop)")}`);
      }
      await runKeeper({ intervalMs, once: opts.once, notify: opts.notify });
    });

  return keeper;
}
