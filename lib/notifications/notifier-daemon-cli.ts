import { runNotifierDaemon, type NotifierDaemonOptions } from "@/lib/notifications/notifier-daemon";

export type ParsedNotifierCliArgs = NotifierDaemonOptions;

function usage(): string {
  return [
    "Usage: tsx scripts/aipanel-notifier.ts [--once] [--interval-ms <number>] [--catch-up] [--dry-run]",
    "",
    "Options:",
    "  --once                 Run one scan and exit",
    "  --interval-ms <n>      Poll interval in milliseconds (default: 3000)",
    "  --catch-up             Send notifications newer than cursor on first scan",
    "  --dry-run              Do not send Telegram messages",
  ].join("\n");
}

export function parseNotifierCliArgs(argv: string[]): ParsedNotifierCliArgs {
  const parsed: ParsedNotifierCliArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--once") {
      parsed.once = true;
      continue;
    }

    if (arg === "--catch-up") {
      parsed.catchUp = true;
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (arg === "--interval-ms") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --interval-ms");
      }

      const intervalMs = Number(value);
      if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isInteger(intervalMs)) {
        throw new Error("Invalid value for --interval-ms");
      }

      parsed.intervalMs = intervalMs;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export async function runNotifierCli(argv: string[]): Promise<number> {
  try {
    const options = parseNotifierCliArgs(argv);
    await runNotifierDaemon(options);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    process.stderr.write(`${message}\n${usage()}\n`);
    return 1;
  }
}
