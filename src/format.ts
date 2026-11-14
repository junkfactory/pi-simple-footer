/** Compact token count: 999 -> "999", 1500 -> "1.5k", 1_500_000 -> "1.5M". */
export function fmtTokens(n: number): string {
  return n < 1000
    ? `${n}`
    : n < 1_000_000
      ? `${(n / 1000).toFixed(1)}k`
      : `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Replace the home prefix with "~". When `home` is undefined the original
 * `cwd.replace(process.env.HOME || "", "~")` behavior is preserved, including
 * its quirk of prefixing "~" to any non-empty cwd (empty search string).
 */
export function shortCwd(cwd: string, home?: string): string {
  return cwd.replace(home ?? "", "~");
}
