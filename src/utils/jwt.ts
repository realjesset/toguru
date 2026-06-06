/**
 * Decode the payload of a JWT without verifying its signature. Codex stores an
 * OpenID `id_token` whose claims (email, plan) are useful as labels. We never
 * trust these tokens for security decisions — only for display.
 */
export function decodeJwt(token: string | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }
  const segments = token.split(".");
  const payload = segments[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
