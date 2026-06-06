import { describe, expect, test } from "bun:test";
import { slugify, validateAccountName } from "../src/utils/strings";

describe("slugify", () => {
  test("strips the email domain and lowercases", () => {
    expect(slugify("Alice.Smith@Example.com")).toBe("alice-smith");
  });

  test("collapses non-alphanumeric runs into single dashes", () => {
    expect(slugify("  My  Work__Account!! ")).toBe("my-work-account");
  });
});

describe("validateAccountName", () => {
  test("accepts safe names", () => {
    expect(validateAccountName("work-1.account_2")).toBe(true);
  });

  test("rejects empty and unsafe names", () => {
    expect(validateAccountName("   ")).not.toBe(true);
    expect(validateAccountName("has space")).not.toBe(true);
    expect(validateAccountName("bad/slash")).not.toBe(true);
  });
});
