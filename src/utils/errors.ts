/**
 * Error type for user-facing, expected failures (bad input, missing session,
 * etc.). The CLI prints `message` and the optional `hint` without a stack
 * trace, whereas any other thrown value is treated as an unexpected bug.
 */
export class MultiAccountError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "MultiAccountError";
    this.hint = hint;
  }
}

/** Type guard for {@link MultiAccountError}. */
export function isMultiAccountError(value: unknown): value is MultiAccountError {
  return value instanceof MultiAccountError;
}
