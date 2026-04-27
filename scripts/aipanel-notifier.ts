import { runNotifierCli } from "@/lib/notifications/notifier-daemon-cli";

void runNotifierCli(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
