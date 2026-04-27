import { describe, expect, it, vi } from "vitest";

const runNotifierDaemonMock = vi.fn().mockResolvedValue({ lastScan: null, baselineOnlyOnce: false });

vi.mock("@/lib/notifications/notifier-daemon", () => ({
  runNotifierDaemon: (...args: unknown[]) => runNotifierDaemonMock(...args),
}));

const { parseNotifierCliArgs, runNotifierCli } = await import("@/lib/notifications/notifier-daemon-cli");

describe("notifier-daemon-cli", () => {
  it("throws on unknown argument", () => {
    expect(() => parseNotifierCliArgs(["--unknown"])).toThrow("Unknown argument: --unknown");
  });

  it("parses --once", () => {
    expect(parseNotifierCliArgs(["--once"])).toEqual({ once: true });
  });

  it("parses --interval-ms", () => {
    expect(parseNotifierCliArgs(["--interval-ms", "5000"])).toEqual({ intervalMs: 5000 });
  });

  it("throws on invalid --interval-ms", () => {
    expect(() => parseNotifierCliArgs(["--interval-ms", "bad"])).toThrow("Invalid value for --interval-ms");
    expect(() => parseNotifierCliArgs(["--interval-ms", "0"])).toThrow("Invalid value for --interval-ms");
    expect(() => parseNotifierCliArgs(["--interval-ms"])).toThrow("Missing value for --interval-ms");
  });

  it("accepts pnpm passthrough separator", () => {
    expect(parseNotifierCliArgs(["--once", "--", "--dry-run"])).toEqual({ once: true, dryRun: true });
  });

  it("parses flags together", () => {
    expect(parseNotifierCliArgs(["--once", "--dry-run", "--catch-up", "--interval-ms", "3000"])).toEqual({
      once: true,
      dryRun: true,
      catchUp: true,
      intervalMs: 3000,
    });
  });

  it("runNotifierCli forwards parsed options", async () => {
    const code = await runNotifierCli(["--once", "--dry-run", "--interval-ms", "4000"]);

    expect(code).toBe(0);
    expect(runNotifierDaemonMock).toHaveBeenCalledWith({ once: true, dryRun: true, intervalMs: 4000 });
  });

  it("runNotifierCli returns 1 on parse errors", async () => {
    const code = await runNotifierCli(["--interval-ms", "bad"]);
    expect(code).toBe(1);
  });

  it("runNotifierCli returns 1 on daemon errors", async () => {
    runNotifierDaemonMock.mockRejectedValueOnce(new Error("boom"));
    const code = await runNotifierCli(["--once"]);
    expect(code).toBe(1);
  });
});
