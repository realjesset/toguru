import { describe, expect, test } from "bun:test";
import { classifyAuth, relativeTime } from "../src/core/auth-status";

const NOW = 1_780_000_000_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("classifyAuth", () => {
  test("valid when the token expires in the future", () => {
    expect(classifyAuth({ expiresAt: NOW + HOUR, canRefresh: true }, NOW)).toBe("valid");
  });

  test("expired when expiry has passed but it can still refresh", () => {
    expect(classifyAuth({ expiresAt: NOW - HOUR, canRefresh: true }, NOW)).toBe("expired");
  });

  test("needs-reauth when there is no refresh token, regardless of expiry", () => {
    expect(classifyAuth({ expiresAt: NOW + DAY, canRefresh: false }, NOW)).toBe("needs-reauth");
    expect(classifyAuth({ expiresAt: NOW - DAY, canRefresh: false }, NOW)).toBe("needs-reauth");
  });

  test("unknown when there is no expiry and refresh capability is unspecified", () => {
    expect(classifyAuth({}, NOW)).toBe("unknown");
    expect(classifyAuth({ plan: "max" }, NOW)).toBe("unknown");
  });
});

describe("relativeTime", () => {
  test("formats future and past", () => {
    expect(relativeTime(NOW + 7 * HOUR, NOW)).toContain("7 hours");
    expect(relativeTime(NOW - 2 * DAY, NOW)).toContain("2 days");
    expect(relativeTime(NOW + 7 * HOUR, NOW).startsWith("in")).toBe(true);
    expect(relativeTime(NOW - 2 * DAY, NOW).endsWith("ago")).toBe(true);
  });
});
