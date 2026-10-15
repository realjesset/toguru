import { ink, mark } from "../ui/theme";

/**
 * Tiny logger used across the CLI. Status messages go to stderr so that stdout
 * stays clean for machine-readable (`--json`) output.
 */
export const logger = {
  info(message: string): void {
    process.stderr.write(`${message}\n`);
  },
  success(message: string): void {
    process.stderr.write(`${ink.matcha(mark.flower)} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${ink.yuzu(mark.warn)} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${ink.beni(mark.error)} ${message}\n`);
  },
  hint(message: string): void {
    process.stderr.write(`${ink.sumi(`  ${mark.hint} ${message}`)}\n`);
  },
  /** Print structured data to stdout as formatted JSON. */
  json(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  },
  /** Print plain text to stdout (the actual command result). */
  out(message: string): void {
    process.stdout.write(`${message}\n`);
  },
};
