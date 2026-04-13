/** Pad a string to a column width (space-padded, right side). Slices if longer. */
export const pad = (s: string, n: number): string => {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
};

/** Format a 20-wide progress bar with percentage and label. */
export const formatProgressBar = (pct: number, label: string): string => {
  const clamped = Math.max(0, Math.min(1, pct));
  const bars = Math.round(clamped * 20);
  const bar = "#".repeat(bars) + "-".repeat(20 - bars);
  return `[${bar}] ${Math.round(clamped * 100)
    .toString()
    .padStart(3, " ")}%  ${label.slice(0, 60)}`;
};
