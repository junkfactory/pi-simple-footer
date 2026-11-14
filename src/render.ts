import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  renderContextDisplay,
  type CompactionSettings,
  type ContextUsage,
  type ThemeLike
} from "./context.js";
import { fmtTokens } from "./format.js";
import type { UsageTotals } from "./stats.js";

/** Everything the footer renders, gathered from the extension context. */
export interface FooterState {
  /** Home-shortened cwd (see shortCwd). */
  cwd: string;
  branch: string | null;
  sessionName: string | undefined;
  model: { provider: string; id: string } | undefined;
  thinkingLevel: string | undefined;
  totals: UsageTotals;
  usage: ContextUsage | undefined;
  compaction: CompactionSettings | undefined;
  statuses: Iterable<string>;
}

/** Theme token for a thinking level; unset/unknown falls back to dim. */
export function thinkingThemeToken(level: string | undefined): ThemeColor {
  switch (level) {
    case "off":
      return "thinkingOff";
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    default:
      return "dim";
  }
}

/** Renders the footer lines for `width` (same layout and colors as the source). */
export function renderFooterLines(
  state: FooterState,
  theme: ThemeLike,
  width: number
): string[] {
  const { input, output, cacheRead, cacheWrite, totalCost } = state.totals;

  // --- Stats, without cost ---
  const stats: string[] = [`↑${fmtTokens(input)}`, `↓${fmtTokens(output)}`];
  if (cacheRead) stats.push(`R${fmtTokens(cacheRead)}`);
  if (cacheWrite) stats.push(`W${fmtTokens(cacheWrite)}`);
  if (cacheRead + input > 0) {
    const pct = ((cacheRead / (cacheRead + input)) * 100).toFixed(1);
    stats.push(`CH${pct}%`);
  }

  // Cost with dynamic color.
  const costColor =
    totalCost >= 5 ? "error" : totalCost >= 1 ? "warning" : "success";
  const costStr = theme.fg(costColor, `$${totalCost.toFixed(3)}`);

  // Context window stays outside the syntaxComment-wrapped stats so its own
  // color survives.
  const modelKey = state.model
    ? `${state.model.provider}/${state.model.id}`
    : undefined;
  const contextDisplay = state.usage
    ? renderContextDisplay(state.usage, state.compaction, modelKey, theme)
    : "";

  // CWD + branch + session name + yellow separator.
  const branchStr = state.branch ? ` (${state.branch})` : "";
  const sessionStr = state.sessionName ? ` • ${state.sessionName}` : "";

  const line1Left =
    theme.fg("syntaxComment", state.cwd + branchStr + sessionStr + " ") +
    theme.fg("warning", "|") +
    theme.fg("syntaxComment", " " + stats.join(" ")) +
    (contextDisplay ? " " + theme.fg("warning", "|") + " " + contextDisplay : "") +
    theme.fg("mdListBullet", " | ") +
    costStr;

  // Right side: (provider) model (yellow) + thinking (color-coded).
  const providerTag = state.model?.provider
    ? `(${state.model.provider}) `
    : "";
  const modelName = state.model?.id || "?";
  const thinkingLabel = state.thinkingLevel ? ` \u2022 ${state.thinkingLevel}` : "";

  const line1Right =
    theme.fg("dim", providerTag) +
    theme.fg("warning", modelName) +
    theme.fg(thinkingThemeToken(state.thinkingLevel), thinkingLabel);

  // Second line: extension statuses (MCP).
  const line2 = [...state.statuses].join("  ");

  // Layout
  const spacer = " ".repeat(
    Math.max(1, width - visibleWidth(line1Left) - visibleWidth(line1Right))
  );
  const line1 = truncateToWidth(line1Left + spacer + line1Right, width);

  return line2 ? [line1, theme.fg("dim", line2)] : [line1];
}
