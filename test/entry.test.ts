import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import defaultExtension from "../src/footer.js";
import {
	callsWithColor,
	eventHandler,
	fakeCtx,
	fakeFooterData,
	fakePi,
	fakeTheme,
	type FakeHandler,
} from "./fakes.js";

async function sessionStart(handlers: Map<string, FakeHandler>, ctx: Parameters<FakeHandler>[1]) {
	await eventHandler(handlers, "session_start")({}, ctx);
}

describe("footer entry", () => {
	it("installs the footer once on session start", async () => {
		const { pi, handlers } = fakePi();
		defaultExtension(pi);
		const { ctx, ui } = fakeCtx();

		await sessionStart(handlers, ctx);

		assert.equal(ui.footers.length, 1);
		assert.equal(typeof ui.footers[0], "function");
	});

	it("re-installs the footer on a second session start", async () => {
		const { pi, handlers } = fakePi();
		defaultExtension(pi);
		const { ctx, ui } = fakeCtx();

		await sessionStart(handlers, ctx);
		// pi restores the built-in footer on session replacement (/new, /resume, /fork, /reload)
		ctx.ui.setFooter(undefined);
		await sessionStart(handlers, ctx);

		assert.equal(ui.footers.length, 3);
		assert.equal(typeof ui.footers.at(-1), "function");
	});

	it("registers no /footer command", () => {
		const { pi, commands } = fakePi();
		defaultExtension(pi);

		assert.deepEqual([...commands.keys()], []);
	});

	it("wires branch changes to requestRender and disposes the subscription", async () => {
		const { pi, handlers } = fakePi();
		defaultExtension(pi);
		const { ctx, ui } = fakeCtx({ cwd: "/x", branch: [] });
		await sessionStart(handlers, ctx);

		const factory = ui.footers[0];
		assert.ok(factory);
		const { theme } = fakeTheme();
		const { footerData, state } = fakeFooterData({ branch: "main" });
		let renders = 0;
		const component = factory({ requestRender: () => (renders += 1) }, theme, footerData);

		assert.deepEqual(component.render(80).length, 1);
		for (const listener of state.listeners) listener();
		assert.equal(renders, 1);
		component.dispose?.();
		assert.equal(state.listeners.size, 0);
	});

	// End-to-end wiring check: every value footer.ts:29-40 feeds the renderer
	// (shortCwd, footerData.getGitBranch(), pi.getSessionName(), ctx.model,
	// ctx.thinkingLevel, accumulateUsage over ctx.sessionManager.getBranch(),
	// the usage-gated compaction settings, and footerData.getExtensionStatuses())
	// must reach the rendered lines.
	it("renders the wired context through render()", async () => {
		const home = process.env.HOME ?? "";
		const { pi, handlers } = fakePi({
			sessionName: "work",
			compaction: { enabled: true, reserveTokens: 20_000 },
		});
		// jj discovery walks the real ancestor tree, so stub it away: this case is
		// about the plain-git wiring, and a `.jj` above $HOME must not flip the
		// footer to the jj arm.
		defaultExtension(pi, { existsSync: () => false });
		const { ctx, ui } = fakeCtx({
			// HOME-relative either way: shortCwd() yields "~/projects/demo"
			// whether or not HOME is set.
			cwd: `${home}/projects/demo`,
			model: { provider: "anthropic", id: "claude-sonnet" },
			thinkingLevel: "high",
			contextUsage: { contextWindow: 100_000, tokens: 40_000, percent: 25 },
			branch: [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 1000,
							output: 500,
							cost: { input: 0.001, output: 0.002 },
						},
					},
				},
			],
		});
		await sessionStart(handlers, ctx);

		const factory = ui.footers[0];
		assert.ok(factory);
		const { theme, calls } = fakeTheme();
		const { footerData } = fakeFooterData({
			branch: "main",
			statuses: [["mcp", "ctx7 ready"]],
		});
		const lines = factory({ requestRender: () => {} }, theme, footerData).render(200);
		const text = stripTerminalSequences(lines[0]);
		const line2 = stripTerminalSequences(lines[1] ?? "");

		assert.ok(text.startsWith("~/projects/demo"), text);
		assert.ok(text.includes("(main) • work "), text);
		assert.ok(text.includes("↑1.0k ↓500"), text);
		assert.ok(text.includes("$0.003"), text);
		assert.ok(text.includes("(anthropic) claude-sonnet • high"), text);
		assert.ok(text.includes(" | 25.0%/100.0k ↻ | "), text);
		assert.equal(line2, "ctx7 ready");

		// The colors pin the wiring too: " • high" uses the thinking token, and
		// warning (not syntaxComment) on the context segment depends on the
		// compaction reserve: 40k/80k = 0.5, versus 0.478 with the 16384 default.
		assert.deepEqual(callsWithColor(calls, "thinkingHigh"), [" • high"]);
		assert.ok(callsWithColor(calls, "warning").includes("25.0%/100.0k ↻"), text);
	});
});
