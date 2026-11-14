export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalCost: number;
}

/** Structural view of a session branch entry (only what stats needs). */
export interface BranchEntry {
  type: string;
  message?: {
    role: string;
    usage?: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
      };
    };
  };
}

export function accumulateUsage(entries: Iterable<BranchEntry>): UsageTotals {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let totalCost = 0;

  for (const e of entries) {
    if (e.type === "message" && e.message?.role === "assistant") {
      const m = e.message;
      // Assistant messages always carry usage; the optional marker only keeps
      // the structural type honest.
      if (!m.usage) continue;
      input += m.usage.input;
      output += m.usage.output;
      cacheRead += m.usage.cacheRead || 0;
      cacheWrite += m.usage.cacheWrite || 0;
      totalCost +=
        m.usage.cost.input +
        m.usage.cost.output +
        (m.usage.cost.cacheRead || 0) +
        (m.usage.cost.cacheWrite || 0);
    }
  }

  return { input, output, cacheRead, cacheWrite, totalCost };
}
