/**
 * Custom Footer — styled status bar matching default Pi layout
 * Installed on every session start.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider
} from "@earendil-works/pi-coding-agent";
import type { ThemeLike } from "./context.js";
import { shortCwd } from "./format.js";
import { renderFooterLines } from "./render.js";
import { accumulateUsage } from "./stats.js";

// NOTE: the per-event `ctx` passed to handlers lacks getSettings()/getSessionName()
// at runtime (only command contexts have them) — use the ExtensionAPI `pi` instead.
function createFooter(pi: ExtensionAPI, ctx: ExtensionContext) {
  return (
    tui: { requestRender(): void },
    theme: ThemeLike,
    footerData: ReadonlyFooterDataProvider
  ) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());
    return {
      dispose: unsub,
      invalidate() {},
      render(width: number): string[] {
        const usage = ctx.getContextUsage();
        return renderFooterLines(
          {
            cwd: shortCwd(ctx.cwd, process.env.HOME || undefined),
            branch: footerData.getGitBranch(),
            sessionName: pi.getSessionName(),
            model: ctx.model,
            thinkingLevel: ctx.thinkingLevel,
            totals: accumulateUsage(ctx.sessionManager.getBranch()),
            usage,
            compaction: usage ? pi.getSettings().compaction : undefined,
            statuses: footerData.getExtensionStatuses().values()
          },
          theme,
          width
        );
      }
    };
  };
}

export default function (pi: ExtensionAPI) {
  // Re-install on every session start: pi restores the built-in footer on session
  // replacement (/new, /resume, /fork, /reload) and then re-fires session_start.
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter(createFooter(pi, ctx));
  });
}
