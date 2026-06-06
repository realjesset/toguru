/**
 * Validate a user-supplied account name. Returns `true` or an error message.
 * Names default to the account's email, so `@` and `+` are allowed.
 */
export function validateAccountName(value: string): true | string {
  const name = value.trim();
  if (!name) {
    return "Name cannot be empty.";
  }
  if (!/^[a-zA-Z0-9._+@-]+$/.test(name)) {
    return "Use only letters, numbers and . _ + @ - (no spaces).";
  }
  return true;
}
