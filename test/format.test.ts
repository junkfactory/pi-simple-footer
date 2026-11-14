import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fmtTokens, shortCwd } from "../src/format.js";

describe("shortCwd", () => {
	it("replaces the home prefix with '~'", () => {
		assert.equal(shortCwd("/home/me/projects/x", "/home/me"), "~/projects/x");
		assert.equal(shortCwd("/home/me", "/home/me"), "~");
	});

	it("leaves a cwd outside home untouched", () => {
		assert.equal(shortCwd("/srv/x", "/home/me"), "/srv/x");
	});

	// Source quirk kept for parity with colored-footer.ts:
	// `cwd.replace(process.env.HOME || "", "~")`. With HOME unset the search
	// string is empty, so replace() inserts "~" at position 0 instead of
	// leaving the cwd alone.
	it("prefixes '~' to any non-empty cwd when home is undefined", () => {
		assert.equal(shortCwd("/home/me/x", undefined), "~/home/me/x");
	});

	it("returns '~' for an empty cwd when home is undefined", () => {
		assert.equal(shortCwd("", undefined), "~");
	});
});

describe("fmtTokens", () => {
	it("switches to k and M at the boundaries", () => {
		assert.equal(fmtTokens(999), "999");
		assert.equal(fmtTokens(1000), "1.0k");
		assert.equal(fmtTokens(1_000_000), "1.0M");
	});

	// Parity pin, not desired output: 999_999 / 1000 rounds up to "1000.0k"
	// instead of the k -> M rollover. Documented so the source behavior is
	// deliberate, not mistaken for a formatting bug.
	it("pins the 999_999 rounding artifact instead of rolling over", () => {
		assert.equal(fmtTokens(999_999), "1000.0k");
		assert.equal(fmtTokens(1_000_000), "1.0M");
	});
});
