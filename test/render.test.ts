import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { renderFooterLines, thinkingThemeToken, type FooterState } from "../src/render.js";
import { callsWithColor, fakeTheme } from "./fakes.js";

function state(overrides: Partial<FooterState> = {}): FooterState {
	return {
		cwd: "~/x",
		branch: "main",
		sessionName: undefined,
		model: { provider: "anthropic", id: "claude" },
		thinkingLevel: "high",
		totals: { input: 1500, output: 1000, cacheRead: 0, cacheWrite: 0, totalCost: 0 },
		usage: undefined,
		compaction: undefined,
		statuses: [],
		...overrides,
	};
}

function render(overrides: Partial<FooterState> = {}, width = 120) {
	const { theme, calls } = fakeTheme();
	const lines = renderFooterLines(state(overrides), theme, width);
	return { lines, calls, text: lines.map(stripTerminalSequences) };
}

describe("renderFooterLines", () => {
	it("pads the spacer to the full width", () => {
		const { lines, text } = render({}, 120);

		assert.equal(lines.length, 1);
		assert.equal(visibleWidth(lines[0]), 120);
		// left ends with the cost, right starts with the provider tag.
		assert.ok(
			text[0].includes("$0.000" + " ".repeat(55) + "(anthropic) claude • high"),
			text[0],
		);
	});

	it("truncates to the width when the content does not fit", () => {
		const { lines } = render({}, 30);

		assert.equal(lines.length, 1);
		assert.ok(visibleWidth(lines[0]) <= 30, `${visibleWidth(lines[0])} > 30`);
	});

	it("colors the cost by threshold", () => {
		const at = (totalCost: number) => render({ totals: { ...state().totals, totalCost } }).calls;
		const costCall = (totalCost: number) =>
			at(totalCost).filter((call) => call.text.startsWith("$")).at(-1);

		assert.deepEqual(costCall(0), { color: "success", text: "$0.000" });
		assert.deepEqual(costCall(0.999), { color: "success", text: "$0.999" });
		assert.deepEqual(costCall(1), { color: "warning", text: "$1.000" });
		assert.deepEqual(costCall(5), { color: "error", text: "$5.000" });
	});

	it("adds the second line only when statuses exist", () => {
		assert.equal(render({ statuses: [] }).lines.length, 1);
		assert.equal(render({ statuses: new Map<string, string>().values() }).lines.length, 1);

		const { lines, calls } = render({ statuses: ["mcp: on", "x"] });
		assert.equal(lines.length, 2);
		assert.deepEqual(callsWithColor(calls, "dim"), ["(anthropic) ", "mcp: on  x"]);
		assert.equal(stripTerminalSequences(lines[1]), "mcp: on  x");
	});

	it("omits the branch and cache segments when absent", () => {
		const { text, calls } = render({
			branch: null,
			model: undefined,
			totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalCost: 0 },
		});

		assert.ok(!text[0].includes("~/x ("), text[0]);
		assert.ok(text[0].includes("~/x "), text[0]);
		assert.deepEqual(callsWithColor(calls, "warning"), ["|", "?"]);
		assert.ok(!text[0].includes("R"), text[0]);
		assert.ok(!text[0].includes("W"), text[0]);
		assert.ok(!text[0].includes("CH"), text[0]);
	});

	it("renders the branch in parentheses after the cwd", () => {
		const { calls, text } = render({ branch: "main" });

		assert.equal(callsWithColor(calls, "syntaxComment")[0], "~/x (main) ");
		assert.ok(text[0].includes("~/x (main) |"), text[0]);
	});

	it("renders the session name as ' • name' into line 1", () => {
		const { calls, text } = render({ sessionName: "work" });

		assert.equal(callsWithColor(calls, "syntaxComment")[0], "~/x (main) • work ");
		assert.ok(text[0].includes("~/x (main) • work |"), text[0]);
	});

	it("renders '?' when the context percent is unknown but tokens are not", () => {
		const { calls } = render({
			usage: { contextWindow: 100_000, tokens: 1000, percent: null },
			compaction: { reserveTokens: 20_000 },
		});

		assert.ok(callsWithColor(calls, "syntaxComment").includes("?/100.0k ↻"));
	});

	it("wires the context segment through with its own color", () => {
		const { calls, text } = render(
			{
				model: { provider: "p", id: "m" },
				usage: { contextWindow: 100_000, tokens: 40_000, percent: 25 },
				compaction: { enabled: true, reserveTokens: 20_000 },
			},
			200,
		);

		// trigger = 100_000 - 20_000 = 80_000; 40_000 / 80_000 = 0.5 => warning.
		assert.ok(callsWithColor(calls, "warning").includes("25.0%/100.0k ↻"));
		assert.ok(text[0].includes(" | 25.0%/100.0k ↻ | "), text[0]);
	});

	it("includes cache stats when present", () => {
		const { text } = render({
			totals: { input: 1500, output: 1000, cacheRead: 2000, cacheWrite: 300, totalCost: 0 },
		});

		assert.ok(text[0].includes("↑1.5k ↓1.0k R2.0k W300 CH57.1%"), text[0]);
	});

	it("renders the thinking label with its level token", () => {
		const levels: Array<[string | undefined, ThemeColor, string]> = [
			["off", "thinkingOff", " • off"],
			["low", "thinkingLow", " • low"],
			["xhigh", "thinkingXhigh", " • xhigh"],
			[undefined, "dim", ""],
			["unexpected", "dim", " • unexpected"],
		];
		for (const [level, token, label] of levels) {
			assert.equal(thinkingThemeToken(level), token);
			const { calls } = render({ thinkingLevel: level });
			assert.deepEqual(callsWithColor(calls, token).at(-1), label);
		}
	});
});
