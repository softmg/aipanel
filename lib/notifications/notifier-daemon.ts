import { getGlobalNotificationRule } from "@/lib/notifications/global-settings";
import {
  advanceNotificationCursor,
  isNotificationNewerThanCursor,
  type NotificationCursor,
} from "@/lib/notifications/notification-cursor";
import { getTelegramSafeStatus, loadNotificationSecrets } from "@/lib/notifications/secrets";
import { getDefaultNotificationSettings, loadNotificationSettings } from "@/lib/notifications/settings";
import { getProjectNotifications } from "@/lib/services/aggregator";
import { loadProjectsConfig } from "@/lib/config/loader";
import { sanitizeDeliveryError } from "@/lib/notifications/delivery-log";
import {
  dispatchTelegramTaskCompletionNotifications,
  type TelegramTaskDispatchSummary,
} from "@/lib/notifications/telegram-task-dispatcher";
import { isTaskCompletionNotification } from "@/lib/notifications/task-completion";
import type { ClaudeNotification } from "@/lib/sources/claude-code/types";

export type NotifierDaemonOptions = {
  once?: boolean;
  intervalMs?: number;
  catchUp?: boolean;
  dryRun?: boolean;
  configDir?: string;
};

export type NotifierProjectScanSummary = {
  projectSlug: string;
  projectName: string;
  fetched: number;
  newSinceCursor: number;
  considered: number;
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
  baselineSeeded: boolean;
  error?: string;
};

export type NotifierScanSummary = {
  projectsWatched: number;
  projectsSucceeded: number;
  projectsFailed: number;
  fetched: number;
  newSinceCursor: number;
  considered: number;
  eligible: number;
  sent: number;
  skipped: number;
  failed: number;
  baselineEstablished: boolean;
  projectSummaries: NotifierProjectScanSummary[];
};

export type NotifierStartupStatus = {
  projectsWatched: number;
  telegramConfigured: boolean;
  telegramChannelEnabled: boolean;
  notificationsEnabled: boolean;
};

export type NotifierLogger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

export type NotifierDependencies = {
  loadProjects: typeof loadProjectsConfig;
  getProjectNotifications: typeof getProjectNotifications;
  dispatchTelegram: typeof dispatchTelegramTaskCompletionNotifications;
  loadSettings: typeof loadNotificationSettings;
  loadSecrets: typeof loadNotificationSecrets;
};

export type NotifierDaemonState = {
  cursorByProjectSlug: Map<string, NotificationCursor | null>;
  seededProjects: Set<string>;
};

const DEFAULT_INTERVAL_MS = 3000;

export function createNotifierDaemonState(): NotifierDaemonState {
  return {
    cursorByProjectSlug: new Map<string, NotificationCursor | null>(),
    seededProjects: new Set<string>(),
  };
}

export function createNotifierLogger(): NotifierLogger {
  return {
    info: (message: string) => {
      process.stdout.write(`${message}\n`);
    },
    error: (message: string) => {
      process.stderr.write(`${message}\n`);
    },
  };
}

export function createNotifierDefaultDependencies(): NotifierDependencies {
  return {
    loadProjects: loadProjectsConfig,
    getProjectNotifications,
    dispatchTelegram: dispatchTelegramTaskCompletionNotifications,
    loadSettings: loadNotificationSettings,
    loadSecrets: loadNotificationSecrets,

  };
}

function createEmptyDispatchSummary(): TelegramTaskDispatchSummary {
  return {
    considered: 0,
    eligible: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };
}

function sumDispatch(left: TelegramTaskDispatchSummary, right: TelegramTaskDispatchSummary): TelegramTaskDispatchSummary {
  return {
    considered: left.considered + right.considered,
    eligible: left.eligible + right.eligible,
    sent: left.sent + right.sent,
    skipped: left.skipped + right.skipped,
    failed: left.failed + right.failed,
  };
}

function stringifyError(error: unknown): string {
  return sanitizeDeliveryError(error);
}

function toIntervalMs(intervalMs: number | undefined): number {
  if (typeof intervalMs !== "number") {
    return DEFAULT_INTERVAL_MS;
  }

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULT_INTERVAL_MS;
  }

  return Math.floor(intervalMs);
}

function collectNewNotifications(
  notifications: ClaudeNotification[],
  cursor: NotificationCursor | null,
  seeded: boolean,
): ClaudeNotification[] {
  if (!seeded || !cursor) {
    return [];
  }

  return notifications.filter((notification) => isNotificationNewerThanCursor(notification, cursor));
}

export async function getNotifierStartupStatus(
  options: Pick<NotifierDaemonOptions, "configDir"> = {},
  dependencies: NotifierDependencies = createNotifierDefaultDependencies(),
): Promise<NotifierStartupStatus> {
  const [projects, settings, secrets] = await Promise.all([
    dependencies.loadProjects(),
    dependencies.loadSettings({ configDir: options.configDir }).catch(() => getDefaultNotificationSettings()),
    dependencies.loadSecrets({ configDir: options.configDir }).catch(() => ({})),
  ]);

  const globalRule = getGlobalNotificationRule(settings);
  const telegramChannelEnabled = Boolean(settings.channels.telegram && globalRule?.channels.telegram);
  const telegramConfigured = getTelegramSafeStatus(secrets).configured;

  return {
    projectsWatched: projects.length,
    telegramConfigured,
    telegramChannelEnabled,
    notificationsEnabled: settings.enabled,
  };
}

export async function scanNotifierProjects(
  state: NotifierDaemonState,
  options: NotifierDaemonOptions = {},
  dependencies: NotifierDependencies = createNotifierDefaultDependencies(),
): Promise<NotifierScanSummary> {
  const projects = await dependencies.loadProjects();
  const activeProjectSlugs = new Set(projects.map((project) => project.slug));

  for (const slug of state.seededProjects) {
    if (!activeProjectSlugs.has(slug)) {
      state.seededProjects.delete(slug);
      state.cursorByProjectSlug.delete(slug);
    }
  }

  const projectSummaries: NotifierProjectScanSummary[] = [];
  let totalFetched = 0;
  let totalNewSinceCursor = 0;
  let totalDispatch = createEmptyDispatchSummary();
  let projectsSucceeded = 0;
  let projectsFailed = 0;
  let baselineEstablished = false;

  for (const project of projects) {
    try {
      const notifications = await dependencies.getProjectNotifications(project.slug);
      const fetched = notifications.length;

      const cursor = state.cursorByProjectSlug.get(project.slug) ?? null;
      const seeded = state.seededProjects.has(project.slug);
      const shouldSeedOnly = !seeded && !options.catchUp;

      const newNotifications = shouldSeedOnly
        ? []
        : collectNewNotifications(notifications, cursor, seeded || Boolean(options.catchUp));

      let dispatchSummary = createEmptyDispatchSummary();
      if (newNotifications.length > 0) {
        if (options.dryRun) {
          dispatchSummary = {
            considered: newNotifications.length,
            eligible: 0,
            sent: 0,
            skipped: newNotifications.length,
            failed: 0,
          };
        } else {
          dispatchSummary = await dependencies.dispatchTelegram(newNotifications, { configDir: options.configDir });
        }
      }

      if (options.dryRun && newNotifications.length > 0) {
        dispatchSummary.eligible = newNotifications.filter((notification) => isTaskCompletionNotification(notification)).length;
      }

      const nextCursor = advanceNotificationCursor(cursor, notifications);
      state.cursorByProjectSlug.set(project.slug, nextCursor);
      state.seededProjects.add(project.slug);

      totalFetched += fetched;
      totalNewSinceCursor += newNotifications.length;
      totalDispatch = sumDispatch(totalDispatch, dispatchSummary);
      projectsSucceeded += 1;

      if (shouldSeedOnly) {
        baselineEstablished = true;
      }

      projectSummaries.push({
        projectSlug: project.slug,
        projectName: project.name,
        fetched,
        newSinceCursor: newNotifications.length,
        considered: dispatchSummary.considered,
        eligible: dispatchSummary.eligible,
        sent: dispatchSummary.sent,
        skipped: dispatchSummary.skipped,
        failed: dispatchSummary.failed,
        baselineSeeded: shouldSeedOnly,
      });
    } catch (error) {
      projectsFailed += 1;
      projectSummaries.push({
        projectSlug: project.slug,
        projectName: project.name,
        fetched: 0,
        newSinceCursor: 0,
        considered: 0,
        eligible: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        baselineSeeded: false,
        error: stringifyError(error),
      });
    }
  }

  return {
    projectsWatched: projects.length,
    projectsSucceeded,
    projectsFailed,
    fetched: totalFetched,
    newSinceCursor: totalNewSinceCursor,
    considered: totalDispatch.considered,
    eligible: totalDispatch.eligible,
    sent: totalDispatch.sent,
    skipped: totalDispatch.skipped,
    failed: totalDispatch.failed,
    baselineEstablished,
    projectSummaries,
  };
}

function formatSummary(summary: NotifierScanSummary): string {
  return [
    `scan: projects=${summary.projectsWatched}`,
    `ok=${summary.projectsSucceeded}`,
    `failed=${summary.projectsFailed}`,
    `fetched=${summary.fetched}`,
    `new=${summary.newSinceCursor}`,
    `sent=${summary.sent}`,
    `skipped=${summary.skipped}`,
    `failedSends=${summary.failed}`,
  ].join(" ");
}

export function formatNotifierStartupSummary(status: NotifierStartupStatus, intervalMs: number): string {
  return [
    "aipanel notifier started",
    `intervalMs=${intervalMs}`,
    `projects=${status.projectsWatched}`,
    `notificationsEnabled=${status.notificationsEnabled ? "yes" : "no"}`,
    `telegramChannelEnabled=${status.telegramChannelEnabled ? "yes" : "no"}`,
    `telegramConfigured=${status.telegramConfigured ? "yes" : "no"}`,
  ].join(" ");
}

export async function runNotifierDaemon(
  options: NotifierDaemonOptions = {},
  dependencies: NotifierDependencies = createNotifierDefaultDependencies(),
  logger: NotifierLogger = createNotifierLogger(),
  state: NotifierDaemonState = createNotifierDaemonState(),
): Promise<{ lastScan: NotifierScanSummary | null; baselineOnlyOnce: boolean }> {
  const intervalMs = toIntervalMs(options.intervalMs);
  const startupStatus = await getNotifierStartupStatus(options, dependencies);
  logger.info(formatNotifierStartupSummary(startupStatus, intervalMs));

  let lastScan: NotifierScanSummary | null = null;
  let baselineOnlyOnce = false;

  const executeScan = async () => {
    const summary = await scanNotifierProjects(state, options, dependencies);
    lastScan = summary;
    logger.info(formatSummary(summary));

    if (summary.baselineEstablished && summary.newSinceCursor === 0 && summary.sent === 0) {
      baselineOnlyOnce = true;
      if (options.once) {
        logger.info("Baseline established. No historical notifications were sent.");
      }
    }

    for (const projectSummary of summary.projectSummaries) {
      if (projectSummary.error) {
        logger.error(`scan project=${projectSummary.projectSlug} error=${projectSummary.error}`);
      }
    }

    return summary;
  };

  if (options.once) {
    try {
      await executeScan();
      return { lastScan, baselineOnlyOnce };
    } catch (error) {
      logger.error(`scan failed error=${stringifyError(error)}`);
      return { lastScan, baselineOnlyOnce };
    }
  }

  let closed = false;
  let inFlight = false;

  const tick = async () => {
    if (closed || inFlight) {
      return;
    }

    inFlight = true;
    try {
      await executeScan();
    } catch (error) {
      logger.error(`scan failed error=${stringifyError(error)}`);
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);

  await tick();

  await new Promise<void>((resolve) => {
    const stop = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(interval);
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  return { lastScan, baselineOnlyOnce };
}
