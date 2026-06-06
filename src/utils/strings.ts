/** Turn an arbitrary label (e.g. an email) into a safe account slug. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/@.*/, "") // drop the domain part of emails
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Validate a user-supplied account name. Returns `true` or an error message. */
export function validateAccountName(value: string): true | string {
  const name = value.trim();
  if (!name) {
    return "Name cannot be empty.";
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return "Use only letters, numbers, dots, dashes and underscores.";
  }
  return true;
}
