import { describe, expect, test } from "bun:test";
import { claudeProvider, withIdentity } from "../src/providers/claude";
import type { Credential } from "../src/providers/types";

describe("claudeProvider.describe (A1: identity travels with the credential)", () => {
  test("derives email/label from the identity slice and plan from the token", () => {
    const credential: Credential = {
      credentials: { claudeAiOauth: { subscriptionType: "max", expiresAt: 123 } },
      account: { emailAddress: "me@work.com", accountUuid: "u1" },
    };
    const out = claudeProvider.describe(credential);
    expect(out.email).toBe("me@work.com");
    expect(out.label).toBe("me@work.com");
    expect(out.plan).toBe("max");
    expect(out.expiresAt).toBe(123);
  });

  test("still reads legacy credentials (bare token payload, no identity)", () => {
    const legacy: Credential = { claudeAiOauth: { subscriptionType: "pro" } };
    const out = claudeProvider.describe(legacy);
    expect(out.plan).toBe("pro");
    expect(out.email).toBeUndefined();
  });
});

describe("withIdentity", () => {
  test("replaces oauthAccount while preserving every other config key", () => {
    const config = { numStartups: 7, oauthAccount: { emailAddress: "old@x.com" }, theme: "dark" };
    const merged = withIdentity(config, { emailAddress: "new@x.com", accountUuid: "u2" });
    expect(merged.oauthAccount).toEqual({ emailAddress: "new@x.com", accountUuid: "u2" });
    expect(merged.numStartups).toBe(7);
    expect(merged.theme).toBe("dark");
  });

  test("works when there is no existing config", () => {
    expect(withIdentity(null, { emailAddress: "a@b.com" })).toEqual({
      oauthAccount: { emailAddress: "a@b.com" },
    });
  });
});
