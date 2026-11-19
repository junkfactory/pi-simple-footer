/**
 * jj working-copy label. JJ_PROBE_ARGS must keep `--ignore-working-copy`: without
 * it every footer refresh makes jj auto-snapshot the working copy and pollutes
 * `jj op log`. test/jj.test.ts pins the argv against that.
 */

import { dirname, join } from "node:path";

export type Exec = (
  command: string,
  args: string[],
  opts: { cwd: string; timeout: number }
) => Promise<{ stdout: string; code: number; killed?: boolean }>;

export interface JjStore {
  label(): string | null;
  isJjRepo(): boolean;
  refresh(): void;
  invalidateCwd(): void;
  /** Stop probing: the footer that owned this store is gone. */
  dispose(): void;
}

export const JJ_TTL_MS = 30_000;

const JJ_PROBE_ARGS = [
  "--ignore-working-copy",
  "log",
  "-r",
  "@ | latest(::@ & bookmarks())",
  "--no-graph",
  "-T",
  'separate("|", if(current_working_copy,"@","B"), bookmarks, change_id.short(4), if(conflict,"!","")) ++ "\\n"'
];

/** Cached, single-flight jj label probe for one footer instance. */
export function createJjStore(opts: {
  cwd: () => string;
  exec: Exec;
  existsSync: (p: string) => boolean;
  onRequestRender: () => void;
}): JjStore {
  let detectionCwd: string | null = null;
  let detectedAt = 0;
  let detectionStale = true;
  let root: string | null = null;
  let lastAttemptAt = 0;
  let label: string | null = null;
  let inFlight = false;
  let disposed = false;
  // Bumped whenever the state a started probe describes stops being current, so
  // its result can be recognised as stale and dropped instead of applied.
  let generation = 0;

  // lastAttemptAt 0 means "force": a probe has never run, or was invalidated.
  const isStale = () => Date.now() - lastAttemptAt >= JJ_TTL_MS;

  // Synchronous, spawn-free: the walk only stats `.jj` entries.
  const jjRoot = (): string | null => {
    // After dispose() the owning context may already be stale, and reading
    // ctx.cwd would throw: answer from the last known root.
    if (disposed) return root;
    const cwd = opts.cwd();
    if (
      detectionStale ||
      detectionCwd !== cwd ||
      Date.now() - detectedAt >= JJ_TTL_MS
    ) {
      const next = findJjRoot(cwd, opts.existsSync);
      if (next !== root) {
        // Another repository, or none: the previous label must not leak into it.
        root = next;
        label = null;
        lastAttemptAt = 0;
        generation++;
      }
      detectionCwd = cwd;
      detectedAt = Date.now();
      detectionStale = false;
    }
    return root;
  };

  async function runProbe(rootPath: string, gen: number): Promise<void> {
    let next: string | null = null;
    try {
      const res = await opts.exec("jj", JJ_PROBE_ARGS, {
        cwd: rootPath,
        timeout: 2000
      });
      if (res.code === 0 && res.killed !== true) {
        next = formatJjLabel(parseJjRows(res.stdout));
      }
    } catch {
      // ENOENT (no jj on PATH) or a timeout: keep the last good label.
    }
    inFlight = false;
    // A replaced session must not be probed or rendered into: `opts.cwd()` throws
    // once the extension context goes stale.
    if (disposed) return;
    if (gen === generation) {
      lastAttemptAt = Date.now();
      if (next !== null && next !== label) {
        label = next;
        opts.onRequestRender();
      }
    }
    // An invalidation or a root change during the probe moved the generation, so
    // this result describes stale state: probe again for the current one. Nothing
    // here bumps the generation on its own, so the follow-up cannot loop.
    if (gen !== generation) refresh();
  }

  function refresh(): void {
    if (disposed || inFlight) return;
    const rootPath = jjRoot();
    // Not a jj repo: nothing to probe, and jjRoot() already cleared the label.
    if (rootPath === null || !isStale()) return;
    inFlight = true;
    const gen = generation;
    // pi.exec spawns before its first await, and refresh() runs from the
    // synchronous render() path: defer the call so the fork/exec cannot land
    // inside the frame being painted. The chain must never reject: an unhandled
    // rejection from a microtask has no extension context to report against.
    queueMicrotask(() => {
      // dispose() can land in the same synchronous run as refresh(), before this
      // callback runs: drop the queued probe instead of spawning it.
      if (disposed) {
        inFlight = false;
        return;
      }
      void runProbe(rootPath, gen).catch(() => {});
    });
  }

  return {
    label: () => label,
    isJjRepo: () => jjRoot() !== null,
    invalidateCwd: () => {
      if (disposed) return;
      detectionStale = true;
      // Force the next probe even inside the TTL. When one is in flight, its
      // result describes the pre-invalidation state: drop it and queue a follow-up
      // by moving the generation out from under it.
      lastAttemptAt = 0;
      if (inFlight) generation++;
    },
    refresh,
    dispose: () => {
      disposed = true;
    }
  };
}

/**
 * Label for the bookmark slot: `bookmark·changeId`, `changeId` when the
 * working copy has no bookmark, `!` appended when it is conflicted.
 * Null when the output holds no `@` row (junk/empty output).
 */
export function formatJjLabel(rows: string[][]): string | null {
  const wcIndex = rows.findIndex((row) => row[0] === "@");
  if (wcIndex < 0) return null;
  const wc = rows[wcIndex];
  const conflicted = wc[wc.length - 1] === "!";
  const fields = conflicted ? wc.slice(0, -1) : wc;
  // separate() drops empty args, so the change id sits at index 1 when there
  // is no bookmark and at index 2 when there is one.
  const changeId = fields.length >= 3 ? fields[2] : fields[1];
  const ancestor = rows.find((row) => row[0] === "B");
  const bookmark =
    (fields.length >= 3 ? fields[1] : undefined) ??
    (ancestor && ancestor.length >= 3 ? ancestor[1] : undefined);
  const text = bookmark ? `${bookmark}\u00b7${changeId}` : changeId;
  return conflicted ? `${text}!` : text;
}

export function parseJjRows(stdout: string): string[][] {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("|"));
}

/** First directory at or above cwd that holds a `.jj` entry. */
export function findJjRoot(
  cwd: string,
  existsSync: (p: string) => boolean
): string | null {
  let dir = cwd;
  for (;;) {
    if (existsSync(join(dir, ".jj"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
