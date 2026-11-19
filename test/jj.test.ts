import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import defaultExtension from "../src/footer.js";
import {
	createJjStore,
	findJjRoot,
	formatJjLabel,
	JJ_TTL_MS,
	parseJjRows,
	type Exec,
} from "../src/jj.js";
import { eventHandler, fakeCtx, fakeFooterData, fakePi, fakeTheme, type FakeExec } from "./fakes.js";

const JJ_STDOUT = "@|qlvu\nB|main|kmqk\n";
const JJ_LABEL = "main·qlvu";

// Pinned copy of the probe argv. --ignore-working-copy is mandatory: without it
// jj snapshots the working copy on every refresh and pollutes `jj op log`.
const JJ_PROBE_ARGV = [
	"--ignore-working-copy",
	"log",
	"-r",
	"@ | latest(::@ & bookmarks())",
	"--no-graph",
	"-T",
	'separate("|", if(current_working_copy,"@","B"), bookmarks, change_id.short(4), if(conflict,"!","")) ++ "\\n"',
];

type ProbeResult = { stdout: string; code: number; killed?: boolean };

/** Lets a macrotask flush the store's fire-and-forget probe. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Flushes a chain that spans several deferred probes: each probe schedules the
 * next from a microtask, so one macrotask is not always enough.
 */
async function flush() {
	for (let i = 0; i < 4; i += 1) await settle();
}

/** TTL control without 30s sleeps; restore in a finally block. */
function skewClock() {
	const realNow = Date.now;
	let offset = 0;
	Date.now = () => realNow() + offset;
	return {
		advance: (ms: number) => {
			offset += ms;
		},
		restore: () => {
			Date.now = realNow;
		},
	};
}

function queued(results: Array<ProbeResult | Error>): Exec {
	return async () => {
		const next = results.shift() ?? { stdout: "", code: 1 };
		if (next instanceof Error) throw next;
		return next;
	};
}

/** Store rooted at /repo (reached from /repo/sub) with recorded calls and renders. */
function storeHarness(exec: Exec, exists = (p: string) => p === "/repo/.jj") {
	const calls: Array<{ command: string; args: string[]; opts: { cwd: string; timeout: number } }> = [];
	let renders = 0;
	const store = createJjStore({
		cwd: () => "/repo/sub",
		exec: async (command, args, opts) => {
			calls.push({ command, args, opts });
			return exec(command, args, opts);
		},
		existsSync: exists,
		onRequestRender: () => (renders += 1),
	});
	return { store, calls, renders: () => renders };
}

async function mountFooter(
	options: {
		cwd?: string;
		branch?: string | null;
		exec?: FakeExec;
		/**
		 * jj discovery walks the real ancestor tree, so the plain-git cases stub it to
		 * "no repo anywhere": otherwise a `.jj` above the fixture path on the host
		 * would flip the footer to the jj arm and fail tests that are not about jj.
		 */
		existsSync?: (path: string) => boolean;
	} = {}
) {
	const { pi, handlers, execCalls } = fakePi({ exec: options.exec });
	defaultExtension(pi, { existsSync: options.existsSync ?? existsSync });
	const { ctx, ui } = fakeCtx({ cwd: options.cwd });
	await eventHandler(handlers, "session_start")({}, ctx);
	const factory = ui.footers[0];
	assert.ok(factory, "footer not installed");
	const { theme } = fakeTheme();
	const { footerData, state } = fakeFooterData({ branch: options.branch });
	let renders = 0;
	const component = factory({ requestRender: () => (renders += 1) }, theme, footerData);
	return {
		component,
		footerState: state,
		renders: () => renders,
		execCalls,
		line: () => stripTerminalSequences(component.render(200)[0] ?? ""),
	};
}

/** A probe after a good label must keep it, not throw, and not retry within the TTL. */
async function expectFailureKeepsLabel(failure: ProbeResult | Error) {
	const clock = skewClock();
	try {
		const h = storeHarness(queued([{ stdout: JJ_STDOUT, code: 0 }, failure]));
		h.store.refresh();
		await settle();
		clock.advance(JJ_TTL_MS);
		assert.doesNotThrow(() => h.store.refresh());
		await settle();

		assert.equal(h.store.label(), JJ_LABEL);
		assert.equal(h.renders(), 1);
		h.store.refresh();
		await settle();
		// The probe above completed, so the cache is fresh again: this refresh must
		// not spawn. Asserting before the flush would pass even with no TTL gate.
		assert.equal(h.calls.length, 2);
	} finally {
		clock.restore();
	}
}

describe("formatJjLabel", () => {
	it("joins the ancestor bookmark with the change id", () => {
		assert.equal(formatJjLabel([["@", "qlvu"], ["B", "main", "kmqk"]]), JJ_LABEL);
	});

	it("prefers a bookmark on the working-copy row", () => {
		assert.equal(formatJjLabel([["@", "main", "kmqk"], ["B", "other", "zzzz"]]), "main·kmqk");
	});

	it("appends ! to a conflicted working copy", () => {
		assert.equal(formatJjLabel([["@", "main", "kmqk", "!"], ["B", "main", "kmqk"]]), "main·kmqk!");
		// Real shape for a conflicted working copy without a bookmark.
		assert.equal(formatJjLabel([["@", "qlvu", "!"]]), "qlvu!");
	});

	it("falls back to the change id without a bookmark row", () => {
		assert.equal(formatJjLabel([["@", "qlvu"]]), "qlvu");
	});

	it("returns null without a working-copy row", () => {
		assert.equal(formatJjLabel([]), null);
		assert.equal(formatJjLabel([["B", "main", "kmqk"]]), null);
	});
});

describe("parseJjRows", () => {
	it("splits lines on | and drops the trailing empty line", () => {
		assert.deepEqual(parseJjRows(JJ_STDOUT), [
			["@", "qlvu"],
			["B", "main", "kmqk"],
		]);
	});
});

describe("findJjRoot", () => {
	it("walks up from a subdirectory to the .jj holder, else null", () => {
		const exists = (p: string) => p === "/a/b/.jj";
		assert.equal(findJjRoot("/a/b/c", exists), "/a/b");
		assert.equal(findJjRoot("/a/b/c", () => false), null);
	});
});

describe("createJjStore", () => {
	it("probes jj with the pinned argv from the repo root", async () => {
		const h = storeHarness(queued([{ stdout: JJ_STDOUT, code: 0 }]));
		h.store.refresh();
		await settle();

		assert.equal(h.store.label(), JJ_LABEL);
		assert.equal(h.calls[0].command, "jj");
		assert.equal(h.calls[0].args[0], "--ignore-working-copy");
		assert.deepEqual(h.calls[0].args, JJ_PROBE_ARGV);
		assert.equal(h.calls[0].opts.cwd, "/repo");
	});

	it("keeps the label on a nonzero exit", async () => {
		// The failing probe reports a different label: applying its output would
		// change it, so this really tests the exit-code check.
		await expectFailureKeepsLabel({ stdout: "@|zzzz\n", code: 1 });
	});

	it("keeps the label when the probe rejects with ENOENT", async () => {
		await expectFailureKeepsLabel(new Error("spawn jj ENOENT"));
	});

	it("keeps the label when the probe is killed", async () => {
		await expectFailureKeepsLabel({ stdout: "@|zzzz\n", code: 0, killed: true });
	});

	it("keeps the label when the output does not parse", async () => {
		await expectFailureKeepsLabel({ stdout: "not a revset error\n", code: 0 });
	});

	it("defers the probe out of the synchronous refresh frame", async () => {
		const h = storeHarness(queued([{ stdout: JJ_STDOUT, code: 0 }]));
		h.store.refresh();
		// pi.exec spawns before its first await, and render() calls refresh(): the
		// fork/exec must land on a later macrotask, not inside the paint.
		assert.equal(h.calls.length, 0);
		await settle();
		assert.equal(h.calls.length, 1);
	});

	it("runs a single probe for concurrent refreshes", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		const h = storeHarness(async () => {
			await pending;
			return { stdout: JJ_STDOUT, code: 0 };
		});

		h.store.refresh();
		h.store.refresh();
		await settle();
		assert.equal(h.calls.length, 1);
		release?.();
		await settle();
		assert.equal(h.store.label(), JJ_LABEL);
	});

	it("re-probes on invalidateCwd inside the TTL", async () => {
		const h = storeHarness(
			queued([
				{ stdout: JJ_STDOUT, code: 0 },
				{ stdout: "@|zzzz\n", code: 0 },
			]),
		);
		h.store.refresh();
		await settle();
		assert.equal(h.store.label(), JJ_LABEL);

		// A branch-change event must be acted on at once, not after the TTL backstop.
		h.store.invalidateCwd();
		h.store.refresh();
		await settle();
		assert.equal(h.calls.length, 2);
		assert.equal(h.store.label(), "zzzz");
	});

	it("probes again after an invalidation that lands during a probe", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		const h = storeHarness(async () => {
			calls += 1;
			await pending;
			return calls === 1 ? { stdout: JJ_STDOUT, code: 0 } : { stdout: "@|zzzz\n", code: 0 };
		});

		h.store.refresh();
		await settle();
		h.store.invalidateCwd();
		release?.();
		await flush();
		// The in-flight result described the pre-invalidation state, so it was
		// dropped and a follow-up probe read the current one.
		assert.equal(h.calls.length, 2);
		assert.equal(h.store.label(), "zzzz");
	});

	it("applies nothing and probes no more after dispose", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		let stale = false;
		let calls = 0;
		let renders = 0;
		const store = createJjStore({
			cwd: () => {
				if (stale) throw new Error("ctx stale");
				return "/repo/sub";
			},
			exec: async () => {
				calls += 1;
				await pending;
				return { stdout: JJ_STDOUT, code: 0 };
			},
			existsSync: (p) => p === "/repo/.jj",
			onRequestRender: () => {
				renders += 1;
			},
		});

		store.refresh();
		await settle(); // one probe in flight; no invalidation, so its result is current
		stale = true; // pi replaced the session, making ctx.cwd throw
		store.dispose();
		release?.();
		await flush();

		// label/renders stay untouched only because the probe tail checks disposed.
		assert.equal(calls, 1, "a disposed store must not probe again");
		assert.equal(renders, 0);
		assert.equal(store.label(), null);
		assert.doesNotThrow(() => store.isJjRepo());
		assert.equal(store.isJjRepo(), true);
		assert.doesNotThrow(() => store.invalidateCwd());
		assert.equal(calls, 1);
	});

	it("does not spawn a probe queued in the same run as dispose", async () => {
		let calls = 0;
		const store = createJjStore({
			cwd: () => "/repo/sub",
			exec: async () => {
				calls += 1;
				return { stdout: JJ_STDOUT, code: 0 };
			},
			existsSync: (p) => p === "/repo/.jj",
			onRequestRender: () => {},
		});

		store.refresh();
		store.dispose(); // same synchronous run: the queued microtask must not spawn
		await settle();

		assert.equal(calls, 0);
		assert.equal(store.label(), null);
	});

	it("swallows a stale-context throw in the follow-up probe", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		let stale = false;
		let calls = 0;
		const store = createJjStore({
			cwd: () => {
				if (stale) throw new Error("ctx stale");
				return "/repo/sub";
			},
			exec: async () => {
				calls += 1;
				await pending;
				return { stdout: JJ_STDOUT, code: 0 };
			},
			existsSync: (p) => p === "/repo/.jj",
			onRequestRender: () => {},
		});

		store.refresh();
		await settle();
		store.invalidateCwd(); // forces a follow-up probe when this one settles
		stale = true; // and the session is replaced before the follow-up can read cwd
		release?.();
		await flush();

		// The follow-up throws inside runProbe's tail. Without the deferred chain's
		// catch this surfaces as an unhandled rejection, which node:test reports too.
		assert.equal(calls, 1);
		assert.equal(store.label(), null);
	});

	it("notices a .jj that appears during the session", async () => {
		let hasJj = false;
		const probed: string[] = [];
		const store = createJjStore({
			cwd: () => "/repo/sub",
			exec: async (_command, _args, opts) => {
				probed.push(opts.cwd);
				return { stdout: JJ_STDOUT, code: 0 };
			},
			existsSync: (p) => hasJj && p === "/repo/.jj",
			onRequestRender: () => {},
		});
		store.refresh();
		await settle();
		assert.deepEqual(probed, [], "not a jj repo yet");

		hasJj = true;
		store.refresh();
		await settle();
		assert.deepEqual(probed, [], "the negative detection is cached for the TTL");

		// A branch change re-runs the upward check, so the new repo is probed at once.
		store.invalidateCwd();
		store.refresh();
		await settle();
		assert.deepEqual(probed, ["/repo"]);
	});

	it("probes a newly entered repo even inside the TTL", async () => {
		let cwd = "/repo/sub";
		const probed: string[] = [];
		const store = createJjStore({
			cwd: () => cwd,
			exec: async (_command, _args, opts) => {
				probed.push(opts.cwd);
				return { stdout: JJ_STDOUT, code: 0 };
			},
			existsSync: (p) => p === "/repo/.jj" || p === "/other/.jj",
			onRequestRender: () => {},
		});
		store.refresh();
		await settle();

		cwd = "/other/sub";
		store.refresh(); // no clock skew: only the root change can force this probe
		await settle();
		assert.deepEqual(probed, ["/repo", "/other"]);
	});

	it("does not label a new repo with an in-flight probe of the old one", async () => {
		let cwd = "/repo/sub";
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => (release = resolve));
		let calls = 0;
		const store = createJjStore({
			cwd: () => cwd,
			exec: async () => {
				calls += 1;
				if (calls === 1) await pending;
				return calls === 1
					? { stdout: JJ_STDOUT, code: 0 }
					: { stdout: "@|zzzz\n", code: 0 };
			},
			existsSync: (p) => p === "/repo/.jj" || p === "/other/.jj",
			onRequestRender: () => {},
		});
		store.refresh();
		await settle(); // the /repo probe is in flight
		cwd = "/other/sub";
		assert.equal(store.isJjRepo(), true); // the render path moves the root
		release?.();
		await flush();

		assert.equal(store.label(), "zzzz", "the old repo's label must not be applied");
		assert.equal(calls, 2, "the new repo must be probed");
	});

	it("drops the label when the cwd leaves the jj repo", async () => {
		let cwd = "/repo/sub";
		const probed: string[] = [];
		const store = createJjStore({
			cwd: () => cwd,
			exec: async (_command, _args, opts) => {
				probed.push(opts.cwd);
				return { stdout: JJ_STDOUT, code: 0 };
			},
			existsSync: (p) => p === "/repo/.jj",
			onRequestRender: () => {},
		});
		store.refresh();
		await settle();
		assert.equal(store.label(), JJ_LABEL);

		cwd = "/elsewhere";
		store.refresh();
		await settle();
		assert.equal(store.label(), null);
		assert.equal(store.isJjRepo(), false);
		assert.deepEqual(probed, ["/repo"]);
	});

	it("renders only when the label changes", async () => {
		const clock = skewClock();
		try {
			const h = storeHarness(
				queued([
					{ stdout: JJ_STDOUT, code: 0 },
					{ stdout: JJ_STDOUT, code: 0 },
					{ stdout: "@|zzzz\n", code: 0 },
				]),
			);
			h.store.refresh();
			await settle();
			assert.equal(h.renders(), 1);

			clock.advance(JJ_TTL_MS);
			h.store.refresh();
			await settle();
			assert.equal(h.renders(), 1);

			clock.advance(JJ_TTL_MS);
			h.store.refresh();
			await settle();
			assert.equal(h.renders(), 2);
			assert.equal(h.store.label(), "zzzz");
		} finally {
			clock.restore();
		}
	});
});

describe("footer jj branch slot", () => {
	it("keeps the git branch outside a jj repo", async () => {
		const { line, execCalls } = await mountFooter({ cwd: "/x", branch: "main", existsSync: () => false });
		const text = line();
		assert.ok(text.includes("(main)"), text);
		// The jj separator never appears on the plain-git path, and nothing spawned.
		assert.ok(!text.includes("\u00b7"), text);
		assert.equal(execCalls.length, 0);
	});

	it("hides pi's detached label outside a jj repo too", async () => {
		// Plan decision 5 (Variant A): "detached" carries no information anywhere,
		// so the slot is omitted rather than shown, in plain git as well as in jj.
		const { line } = await mountFooter({ cwd: "/x", branch: "detached", existsSync: () => false });
		assert.ok(!line().includes("(detached)"), line());
	});

	it("shows bookmark·changeId instead of (detached) inside a jj repo", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-simple-footer-jj-"));
		try {
			mkdirSync(join(dir, ".jj"));
			const { line, execCalls } = await mountFooter({
				cwd: dir,
				branch: "detached",
				exec: () => ({ stdout: JJ_STDOUT, code: 0 }),
			});
			line(); // starts the probe from the render path
			await settle();

			assert.ok(line().includes(`(${JJ_LABEL})`), line());
			assert.ok(!line().includes("(detached)"), line());
			assert.equal(execCalls.length, 1);
			assert.equal(execCalls[0].args[0], "--ignore-working-copy");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("omits the slot in a jj repo whose probe has not succeeded", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-simple-footer-jj-"));
		try {
			mkdirSync(join(dir, ".jj"));
			// fakePi's default exec stub fails, so the probe never yields a label. An
			// attached git HEAD must not leak into the slot as a fallback.
			const { line } = await mountFooter({ cwd: dir, branch: "feature" });
			line();
			await settle();
			const text = line();
			assert.ok(!text.includes("(feature)"), text);
			assert.ok(!text.includes("(detached)"), text);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("re-probes on a branch change inside the TTL", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-simple-footer-jj-"));
		try {
			mkdirSync(join(dir, ".jj"));
			const { component, footerState, execCalls } = await mountFooter({
				cwd: dir,
				branch: "detached",
				exec: () => ({ stdout: JJ_STDOUT, code: 0 }),
			});
			component.render(200);
			await settle();
			assert.equal(execCalls.length, 1);

			// No clock was skewed, so this is the event-driven half of the design:
			// acting on a branch change cannot wait for the 30 s TTL backstop.
			for (const listener of footerState.listeners) listener();
			await settle();
			assert.equal(execCalls.length, 2);
			assert.ok(stripTerminalSequences(component.render(200)[0] ?? "").includes(`(${JJ_LABEL})`));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("stops rendering once the footer is disposed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-simple-footer-jj-"));
		try {
			mkdirSync(join(dir, ".jj"));
			let release: (() => void) | undefined;
			const pending = new Promise<void>((resolve) => (release = resolve));
			const { component, renders } = await mountFooter({
				cwd: dir,
				branch: "detached",
				exec: async () => {
					await pending;
					return { stdout: JJ_STDOUT, code: 0 };
				},
			});
			await settle();
			component.dispose?.();
			release?.();
			await flush();
			assert.equal(renders(), 0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
