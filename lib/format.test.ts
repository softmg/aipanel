import { describe, expect, it, vi } from "vitest";
import { formatNumber, formatRelative } from "@/lib/format";

describe("formatNumber", () => {
  it("formats with grouping", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});

describe("formatRelative", () => {
  it("returns dash for null", () => {
    expect(formatRelative(null)).toBe("—");
  });

  it("formats minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
    expect(formatRelative("2026-04-19T11:43:00.000Z")).toBe("17m ago");
    vi.useRealTimers();
  });

  it("formats hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
    expect(formatRelative("2026-04-19T08:00:00.000Z")).toBe("4h ago");
    vi.useRealTimers();
  });

  it("formats days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T12:00:00.000Z"));
    expect(formatRelative("2026-04-16T12:00:00.000Z")).toBe("3d ago");
    vi.useRealTimers();
  });
});
