import { describe, expect, test } from "bun:test";
import { validateAccountName } from "../src/utils/strings";

describe("validateAccountName", () => {
  test("accepts safe names, including emails", () => {
    expect(validateAccountName("work-1.account_2")).toBe(true);
    expect(validateAccountName("you@example.com")).toBe(true);
    expect(validateAccountName("me+work@example.com")).toBe(true);
  });

  test("rejects empty and unsafe names", () => {
    expect(validateAccountName("   ")).not.toBe(true);
    expect(validateAccountName("has space")).not.toBe(true);
    expect(validateAccountName("bad/slash")).not.toBe(true);
  });
});
