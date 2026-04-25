export type BrowserNotificationStatusInput = {
  realtimeEnabled: boolean;
  browserNotificationsEnabled: boolean;
  notificationSupported: boolean;
  permission: "default" | "granted" | "denied" | "unsupported";
  isSecureContext: boolean;
  isLocalhost: boolean;
  visibilityState: "visible" | "hidden" | "prerender" | "unloaded" | "unknown";
  suppressWhenVisible: boolean;
};

export type BrowserNotificationStatus =
  | { state: "realtime-disabled"; severity: "off"; message: string }
  | { state: "env-disabled"; severity: "off"; message: string }
  | { state: "unsupported"; severity: "off"; message: string }
  | { state: "insecure-origin"; severity: "warning"; message: string }
  | {
      state: "permission-default";
      severity: "needs-action";
      message: string;
      actionLabel: "Enable desktop alerts";
    }
  | { state: "permission-denied"; severity: "blocked"; message: string }
  | { state: "visible-suppressed"; severity: "ready"; message: string }
  | { state: "ready"; severity: "ready"; message: string };

export function getBrowserNotificationStatus(
  input: BrowserNotificationStatusInput,
): BrowserNotificationStatus {
  if (!input.realtimeEnabled) {
    return {
      state: "realtime-disabled",
      severity: "off",
      message: "Realtime updates are disabled by configuration.",
    };
  }

  if (!input.browserNotificationsEnabled) {
    return {
      state: "env-disabled",
      severity: "off",
      message: "Browser desktop alerts are disabled by configuration.",
    };
  }

  if (!input.notificationSupported || input.permission === "unsupported") {
    return {
      state: "unsupported",
      severity: "off",
      message: "This browser does not support desktop alerts.",
    };
  }

  if (!input.isSecureContext && !input.isLocalhost) {
    return {
      state: "insecure-origin",
      severity: "warning",
      message: "Desktop alerts require localhost or HTTPS. Use http://localhost or enable HTTPS.",
    };
  }

  if (input.permission === "default") {
    return {
      state: "permission-default",
      severity: "needs-action",
      message: "Desktop alerts need browser permission.",
      actionLabel: "Enable desktop alerts",
    };
  }

  if (input.permission === "denied") {
    return {
      state: "permission-denied",
      severity: "blocked",
      message: "Desktop alerts are blocked. Re-enable them in browser site settings for this origin.",
    };
  }

  if (input.suppressWhenVisible && input.visibilityState === "visible") {
    return {
      state: "visible-suppressed",
      severity: "ready",
      message: "This tab is active, so desktop alerts are suppressed. In-app notifications still appear.",
    };
  }

  return {
    state: "ready",
    severity: "ready",
    message: "Desktop alerts are ready and will appear when this tab is in the background.",
  };
}
