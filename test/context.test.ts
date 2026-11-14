import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	renderContextDisplay,
	resolveReserveTokens,
	type CompactionSettings,
} from "../src/context.js";
import { fakeTheme } from "./fakes.js";

const GLOBAL_RESERVE = 20_000;
const BASE: CompactionSettings = { reserveTokens: GLOBAL_RESERVE };

describe("resolveReserveTokens", () => {
	it("prefers the per-model override over the global setting", () => {
		const compaction: CompactionSettings = {
			reserveTokens: GLOBAL_RESERVE,
			modelOverrides: { "p/m": { reserveTokens: 1234 } },
		};

		assert.equal(resolveReserveTokens(compaction, "p/m"), 1234);
	});

	it("falls back to the global reserve", () => {
		const compaction: CompactionSettings = {
			reserveTokens: GLOBAL_RESERVE,
			modelOverrides: { "other/m": { reserveTokens: 1234 } },
		};

		assert.equal(resolveReserveTokens(compaction, "p/m"), GLOBAL_RESERVE);
	});

	it("ignores overrides without a model key and defaults to 16384", () => {
		assert.equal(
			resolveReserveTokens({ modelOverrides: { "p/m": { reserveTokens: 1234 } } }, undefined),
			16384,
		);
		assert.equal(resolveReserveTokens(undefined, "p/m"), 16384);
	});
});

describe("renderContextDisplay", () => {
	function render(
		usage: { contextWindow: number; tokens?: number | null; percent?: number | null },
		compaction: CompactionSettings | undefined = BASE,
		modelKey: string | undefined = undefined,
	) {
		const { theme, calls } = fakeTheme();
		const display = renderContextDisplay(usage, compaction, modelKey, theme);
		return { display, calls };
	}

	it("colors the raw display by ratio to the compaction trigger", () => {
		// contextWindow 100_000 - reserve 20_000 => trigger 80_000.
		assert.deepEqual(render({ contextWindow: 100_000, tokens: 23_999, percent: 25 }).calls, [
			{ color: "syntaxComment", text: "25.0%/100.0k ↻" },
		]);
		assert.deepEqual(render({ contextWindow: 100_000, tokens: 24_000, percent: 25 }).calls, [
			{ color: "success", text: "25.0%/100.0k ↻" },
		]);
		assert.deepEqual(render({ contextWindow: 100_000, tokens: 39_999, percent: 25 }).calls, [
			{ color: "success", text: "25.0%/100.0k ↻" },
		]);
		assert.deepEqual(render({ contextWindow: 100_000, tokens: 40_000, percent: 25 }).calls, [
			{ color: "warning", text: "25.0%/100.0k ↻" },
		]);
		assert.deepEqual(render({ contextWindow: 100_000, tokens: 64_000, percent: 25 }).calls, [
			{ color: "error", text: "25.0%/100.0k ↻" },
		]);
	});

	it("applies a model override when resolving the trigger", () => {
		const compaction: CompactionSettings = {
			reserveTokens: 1000,
			modelOverrides: { "p/m": { reserveTokens: 20_000 } },
		};
		// 64_000 / (100_000 - 20_000) = 0.8 => error (global reserve alone would warn).
		assert.equal(
			render({ contextWindow: 100_000, tokens: 64_000, percent: 25 }, compaction, "p/m").calls[0]
				.color,
			"error",
		);
	});

	it("uses syntaxComment when tokens are unknown after compaction", () => {
		const { calls } = render({ contextWindow: 100_000, tokens: null, percent: null });

		assert.deepEqual(calls, [{ color: "syntaxComment", text: "?/100.0k ↻" }]);
	});

	it("uses error when the window is at or below the reserve", () => {
		assert.equal(render({ contextWindow: 20_000, tokens: 1, percent: 1 }).calls[0].color, "error");
		assert.equal(render({ contextWindow: 10_000, tokens: 1, percent: 1 }).calls[0].color, "error");
	});

	it("omits the auto-compact marker only when compaction is disabled", () => {
		const disabled: CompactionSettings = { ...BASE, enabled: false };
		assert.equal(render({ contextWindow: 100_000, tokens: 0, percent: 0 }, disabled).calls[0].text, "0.0%/100.0k");
		assert.equal(render({ contextWindow: 100_000, tokens: 0, percent: 0 }, { ...BASE, enabled: true }).calls[0].text, "0.0%/100.0k ↻");
		assert.equal(render({ contextWindow: 100_000, tokens: 0, percent: 0 }).calls[0].text, "0.0%/100.0k ↻");
	});
});
