import { describe, expect, it } from "vitest";
import {
  getBrowserNotificationStatus,
  type BrowserNotificationStatusInput,
} from "@/lib/notifications/browser-status";

const baseInput: BrowserNotificationStatusInput = {
  realtimeEnabled: true,
  browserNotificationsEnabled: true,
  notificationSupported: true,
  permission: "granted",
  isSecureContext: true,
  isLocalhost: false,
  visibilityState: "hidden",
  suppressWhenVisible: true,
};

function status(overrides: Partial<BrowserNotificationStatusInput>) {
  return getBrowserNotificationStatus({ ...baseInput, ...overrides });
}

describe("getBrowserNotificationStatus", () => {
  it("returns realtime disabled before other states", () => {
    expect(
      status({
        realtimeEnabled: false,
        browserNotificationsEnabled: false,
        notificationSupported: false,
        permission: "denied",
        isSecureContext: false,
        isLocalhost: false,
      }),
    ).toEqual({
      state: "realtime-disabled",
      severity: "off",
      message: "Realtime updates are disabled by configuration.",
    });
  });

  it("returns browser env disabled before browser capability checks", () => {
    expect(
      status({
        browserNotificationsEnabled: false,
        notificationSupported: false,
        permission: "denied",
        isSecureContext: false,
        isLocalhost: false,
      }),
    ).toEqual({
      state: "env-disabled",
      severity: "off",
      message: "Browser desktop alerts are disabled by configuration.",
    });
  });

  it("returns unsupported for browsers without desktop alert support", () => {
    expect(status({ notificationSupported: false })).toEqual({
      state: "unsupported",
      severity: "off",
      message: "This browser does not support desktop alerts.",
    });
  });

  it("returns insecure origin for non-localhost HTTP origins", () => {
    expect(status({ isSecureContext: false, isLocalhost: false })).toEqual({
      state: "insecure-origin",
      severity: "warning",
      message: "Desktop alerts require localhost or HTTPS. Use http://localhost or enable HTTPS.",
    });
  });

  it("returns permission default when browser permission has not been requested", () => {
    expect(status({ permission: "default" })).toEqual({
      state: "permission-default",
      severity: "needs-action",
      message: "Desktop alerts need browser permission.",
      actionLabel: "Enable desktop alerts",
    });
  });

  it("returns permission denied when desktop alerts are blocked", () => {
    expect(status({ permission: "denied" })).toEqual({
      state: "permission-denied",
      severity: "blocked",
      message: "Desktop alerts are blocked. Re-enable them in browser site settings for this origin.",
    });
  });

  it("returns visible suppressed for granted permission in a visible tab", () => {
    expect(status({ permission: "granted", visibilityState: "visible", suppressWhenVisible: true })).toEqual({
      state: "visible-suppressed",
      severity: "ready",
      message: "This tab is active, so desktop alerts are suppressed. In-app notifications still appear.",
    });
  });

  it("returns ready for granted permission in a hidden tab", () => {
    expect(status({ permission: "granted", visibilityState: "hidden" })).toEqual({
      state: "ready",
      severity: "ready",
      message: "Desktop alerts are ready and will appear when this tab is in the background.",
    });
  });

  it("allows localhost even when the context is not secure", () => {
    expect(status({ isSecureContext: false, isLocalhost: true })).toEqual({
      state: "ready",
      severity: "ready",
      message: "Desktop alerts are ready and will appear when this tab is in the background.",
    });
  });

  it("returns ready for a visible tab when visible suppression is disabled", () => {
    expect(status({ permission: "granted", visibilityState: "visible", suppressWhenVisible: false })).toEqual({
      state: "ready",
      severity: "ready",
      message: "Desktop alerts are ready and will appear when this tab is in the background.",
    });
  });
});
