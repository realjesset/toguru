import pc from "picocolors";

/**
 * Tiny logger used across the CLI. Status messages go to stderr so that stdout
 * stays clean for machine-readable (`--json`) output.
 */
export const logger = {
  info(message: string): void {
    process.stderr.write(`${message}\n`);
  },
  success(message: string): void {
    process.stderr.write(`${pc.green("✔")} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${pc.yellow("⚠")} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${pc.red("✖")} ${message}\n`);
  },
  hint(message: string): void {
    process.stderr.write(`${pc.dim(`  ↳ ${message}`)}\n`);
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
