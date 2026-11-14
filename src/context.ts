import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { fmtTokens } from "./format.js";

/** Structural view of the compaction settings used by the footer. */
export interface CompactionSettings {
  enabled?: boolean;
  reserveTokens?: number;
  modelOverrides?: Record<string, { reserveTokens?: number } | undefined>;
}

export interface ContextUsage {
  contextWindow: number;
  tokens?: number | null;
  percent?: number | null;
}

export interface ThemeLike {
  fg(color: ThemeColor, text: string): string;
}

/**
 * Mirrors shouldCompact()'s reserve math (compaction.js): per-model override
 * first, then the global setting, then the 16384 default.
 */
export function resolveReserveTokens(
  compaction: CompactionSettings | undefined,
  modelKey?: string
): number {
  return (
    (modelKey !== undefined
      ? compaction?.modelOverrides?.[modelKey]?.reserveTokens
      : undefined) ??
    compaction?.reserveTokens ??
    16384
  );
}

/**
 * Context window segment of the footer line. Color reflects how close context
 * is to the actual auto-compaction trigger:
 * trigger = contextWindow - reserveTokens (mirrors shouldCompact(),
 * compaction.js); muted below 30% of trigger, success at >= 30%, warn at
 * >= 50%, error at >= 80%.
 * " ↻" = auto-compact enabled.
 */
export function renderContextDisplay(
  usage: ContextUsage,
  compaction: CompactionSettings | undefined,
  modelKey: string | undefined,
  theme: ThemeLike
): string {
  const reserve = resolveReserveTokens(compaction, modelKey);
  const triggerTokens = usage.contextWindow - reserve;
  const pct = usage.percent;
  const pctStr = pct != null ? `${pct.toFixed(1)}%` : "?";
  const winStr = fmtTokens(usage.contextWindow);
  const autoCompact = (compaction?.enabled ?? true) ? " ↻" : "";
  const raw = `${pctStr}/${winStr}${autoCompact}`;

  if (usage.tokens == null) {
    // Post-compaction, context size unknown until next assistant reply.
    return theme.fg("syntaxComment", raw);
  }
  if (triggerTokens <= 0) {
    // Window smaller than reserve: compaction would fire immediately.
    return theme.fg("error", raw);
  }
  const ratio = usage.tokens / triggerTokens;
  return ratio >= 0.8
    ? theme.fg("error", raw)
    : ratio >= 0.5
      ? theme.fg("warning", raw)
      : ratio >= 0.3
        ? theme.fg("success", raw)
        : theme.fg("syntaxComment", raw);
}
