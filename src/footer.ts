/**
 * Custom Footer — styled status bar matching default Pi layout
 * Installed on every session start.
 */

import { existsSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider
} from "@earendil-works/pi-coding-agent";
import type { ThemeLike } from "./context.js";
import { shortCwd } from "./format.js";
import { createJjStore } from "./jj.js";
import { renderFooterLines } from "./render.js";
import { accumulateUsage } from "./stats.js";

/** pi reports `.git/HEAD` as "detached" in a colocated jj repo. */
function detachedToNull(branch: string | null): string | null {
  return branch === "detached" ? null : branch;
}

/** Filesystem seam: tests stub it so jj discovery cannot depend on the host tree. */
export interface FooterDeps {
  existsSync(path: string): boolean;
}

// NOTE: the per-event `ctx` passed to handlers lacks getSettings()/getSessionName()
// at runtime (only command contexts have them) — use the ExtensionAPI `pi` instead.
function createFooter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  exists: (path: string) => boolean
) {
  return (
    tui: { requestRender(): void },
    theme: ThemeLike,
    footerData: ReadonlyFooterDataProvider
  ) => {
    // The store owns the session-lifetime guard: dispose() stops it from probing
    // or rendering once pi replaces the session (/new, /resume, /fork, /reload).
    const jj = createJjStore({
      cwd: () => ctx.cwd,
      exec: (command, args, opts) => pi.exec(command, args, opts),
      existsSync: exists,
      onRequestRender: () => tui.requestRender()
    });
    jj.refresh();
    const unsub = footerData.onBranchChange(() => {
      jj.invalidateCwd();
      jj.refresh();
      tui.requestRender();
    });
    return {
      dispose: () => {
        unsub();
        jj.dispose();
      },
      invalidate() {},
      render(width: number): string[] {
        jj.refresh();
        const usage = ctx.getContextUsage();
        return renderFooterLines(
          {
            cwd: shortCwd(ctx.cwd, process.env.HOME || undefined),
            // Inside a jj repo the jj label is the only branch value shown: until a
            // probe succeeds the slot is omitted rather than falling back to a git
            // branch, which jj moves independently of HEAD. Outside a jj repo
            // nothing changes, so the git name renders exactly as before.
            branch: jj.isJjRepo()
              ? jj.label()
              : detachedToNull(footerData.getGitBranch()),
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

export default function (pi: ExtensionAPI, deps: FooterDeps = { existsSync }) {
  // Re-install on every session start: pi restores the built-in footer on session
  // replacement (/new, /resume, /fork, /reload) and then re-fires session_start.
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setFooter(createFooter(pi, ctx, deps.existsSync));
  });
}
