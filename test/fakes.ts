import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ReadonlyFooterDataProvider,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import type { CompactionSettings, ContextUsage, ThemeLike } from "../src/context.js";
import type { BranchEntry } from "../src/stats.js";

export type ThemeCall = { color: ThemeColor; text: string };

/**
 * Records every fg() call and returns an ANSI-wrapped marker. The wrapper has
 * zero visible width, so layout/truncation assertions see only the text.
 */
export function fakeTheme() {
	const calls: ThemeCall[] = [];
	const theme: ThemeLike = {
		fg(color, text) {
			calls.push({ color, text });
			return `\x1b[1m${text}\x1b[0m`;
		},
	};
	return { theme, calls };
}

/** Calls made for `color`, in order. */
export function callsWithColor(calls: ThemeCall[], color: ThemeColor): string[] {
	return calls.filter((call) => call.color === color).map((call) => call.text);
}

export type FakeFooterDataOptions = {
	branch?: string | null;
	statuses?: Array<[string, string]>;
};

export function fakeFooterData(options: FakeFooterDataOptions = {}) {
	const statuses = new Map(options.statuses ?? []);
	const listeners = new Set<() => void>();
	const state = { branch: options.branch ?? null, listeners };
	const footerData: ReadonlyFooterDataProvider = {
		getGitBranch: () => state.branch,
		getExtensionStatuses: () => statuses,
		getAvailableProviderCount: () => 0,
		onBranchChange(callback) {
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
			};
		},
	};
	return { footerData, statuses, state };
}

export type FakeCtxOptions = {
	cwd?: string;
	branch?: BranchEntry[];
	contextUsage?: ContextUsage;
	thinkingLevel?: string;
	model?: { provider: string; id: string };
};

export type FooterFactory = (
	tui: { requestRender(): void },
	theme: ThemeLike,
	footerData: ReadonlyFooterDataProvider,
) => { render(width: number): string[]; invalidate(): void; dispose?(): void };

export type FakeUiState = {
	footers: Array<FooterFactory | undefined>;
};

export function fakeCtx(options: FakeCtxOptions = {}) {
	const ui: FakeUiState = { footers: [] };
	const ctx = {
		cwd: options.cwd ?? "~/x",
		thinkingLevel: options.thinkingLevel,
		model: options.model,
		sessionManager: { getBranch: () => options.branch ?? [] },
		getContextUsage: () => options.contextUsage,
		ui: {
			setFooter(factory: FooterFactory | undefined) {
				ui.footers.push(factory);
			},
		},
	};
	return { ctx: ctx as unknown as ExtensionContext, ui };
}

export type FakeHandler = (event: unknown, ctx: ExtensionContext) => unknown;

export type FakeCommand = {
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
};

export type FakePiOptions = {
	sessionName?: string;
	compaction?: CompactionSettings;
};

export function fakePi(options: FakePiOptions = {}) {
	const handlers = new Map<string, FakeHandler>();
	const commands = new Map<string, FakeCommand>();
	const state = { sessionName: options.sessionName, compaction: options.compaction };
	const pi = {
		on(event: string, handler: FakeHandler) {
			handlers.set(event, handler);
			return () => {
				handlers.delete(event);
			};
		},
		registerCommand(name: string, command: FakeCommand) {
			commands.set(name, command);
		},
		getSettings() {
			return { compaction: state.compaction };
		},
		getSessionName() {
			return state.sessionName;
		},
	};
	return { pi: pi as unknown as ExtensionAPI, handlers, commands, state };
}

export function eventHandler(handlers: Map<string, FakeHandler>, event: string): FakeHandler {
	const handler = handlers.get(event);
	if (!handler) throw new Error(`no ${event} handler registered`);
	return handler;
}
