import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accumulateUsage, type BranchEntry } from "../src/stats.js";

type Usage = NonNullable<NonNullable<BranchEntry["message"]>["usage"]>;

function entry(type: string, role?: string, usage?: Usage): BranchEntry {
	return { type, message: role ? { role, usage } : undefined };
}

describe("accumulateUsage", () => {
	it("sums assistant messages and skips everything else", () => {
		const entries: BranchEntry[] = [
			{ type: "session" },
			entry("message", "user", {
				input: 999,
				output: 999,
				cost: { input: 9, output: 9 },
			}),
			entry("message", "assistant", {
				input: 1000,
				output: 200,
				cacheRead: 3000,
				cacheWrite: 400,
				cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4 },
			}),
			{ type: "compaction", message: undefined },
		];

		assert.deepEqual(accumulateUsage(entries), {
			input: 1000,
			output: 200,
			cacheRead: 3000,
			cacheWrite: 400,
			totalCost: 1,
		});
	});

	it("defaults missing cache and cost fields to zero", () => {
		const totals = accumulateUsage([
			entry("message", "assistant", {
				input: 5,
				output: 6,
				cost: { input: 0.01, output: 0.02 },
			}),
		]);

		assert.deepEqual(totals, {
			input: 5,
			output: 6,
			cacheRead: 0,
			cacheWrite: 0,
			totalCost: 0.03,
		});
	});

	it("skips an assistant entry without usage instead of throwing", () => {
		assert.deepEqual(accumulateUsage([entry("message", "assistant")]), {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalCost: 0,
		});
	});

	it("returns zeros for an empty branch", () => {
		assert.deepEqual(accumulateUsage([]), {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalCost: 0,
		});
	});
});
