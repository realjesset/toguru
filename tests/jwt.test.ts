import { describe, expect, test } from "bun:test";
import { decodeJwt } from "../src/utils/jwt";

function makeToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${body}.signature`;
}

describe("decodeJwt", () => {
  test("decodes the payload of a valid token", () => {
    const token = makeToken({ email: "a@b.com", plan: "pro" });
    expect(decodeJwt(token)).toEqual({ email: "a@b.com", plan: "pro" });
  });

  test("handles values whose base64 contains +/ characters", () => {
    // ">>>" encodes to base64 with a '+' that must be url-decoded back.
    const token = makeToken({ note: ">>>???" });
    expect(decodeJwt(token)).toEqual({ note: ">>>???" });
  });

  test("returns null for undefined, malformed, or non-object payloads", () => {
    expect(decodeJwt(undefined)).toBeNull();
    expect(decodeJwt("not-a-jwt")).toBeNull();
    expect(decodeJwt("a.b.c")).toBeNull(); // "b" is not valid JSON
    expect(decodeJwt("a..c")).toBeNull();
  });
});
