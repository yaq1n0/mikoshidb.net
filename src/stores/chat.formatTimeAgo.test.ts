import { describe, expect, it } from "vitest";
import { formatTimeAgo } from "@/stores/chat";

const NOW = 1_700_000_000_000;

describe("formatTimeAgo", () => {
  it("reports 'just now' for diffs under 30s", () => {
    expect(formatTimeAgo(NOW - 10_000, NOW)).toBe("just now");
    expect(formatTimeAgo(NOW, NOW)).toBe("just now");
  });

  it("reports seconds for 30s <= diff < 60s", () => {
    expect(formatTimeAgo(NOW - 45_000, NOW)).toBe("45 seconds ago");
  });

  it("rounds 90s to '2 minutes ago'", () => {
    expect(formatTimeAgo(NOW - 90_000, NOW)).toBe("2 minutes ago");
  });

  it("uses singular 'minute' vs plural 'minutes'", () => {
    expect(formatTimeAgo(NOW - 60_000, NOW)).toBe("1 minute ago");
    expect(formatTimeAgo(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago");
  });

  it("singular and plural for hours", () => {
    expect(formatTimeAgo(NOW - 60 * 60_000, NOW)).toBe("1 hour ago");
    expect(formatTimeAgo(NOW - 2 * 60 * 60_000, NOW)).toBe("2 hours ago");
  });

  it("singular and plural for days", () => {
    expect(formatTimeAgo(NOW - 24 * 60 * 60_000, NOW)).toBe("1 day ago");
    expect(formatTimeAgo(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe("3 days ago");
  });

  it("clamps negative diffs (future thenMs) to 'just now'", () => {
    expect(formatTimeAgo(NOW + 60_000, NOW)).toBe("just now");
  });
});
