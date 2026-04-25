import type { BrowserNotificationStatusInput } from "@/lib/notifications/browser-status";

export type BrowserDesktopAlertDeliveryInput = Pick<
  BrowserNotificationStatusInput,
  | "permission"
  | "notificationSupported"
  | "browserNotificationsEnabled"
  | "realtimeEnabled"
  | "visibilityState"
  | "suppressWhenVisible"
> & {
  rateLimited: boolean;
};

export function shouldShowBrowserDesktopAlert(input: BrowserDesktopAlertDeliveryInput): boolean {
  if (!input.realtimeEnabled || !input.browserNotificationsEnabled) {
    return false;
  }

  if (!input.notificationSupported || input.permission !== "granted") {
    return false;
  }

  if (input.suppressWhenVisible && input.visibilityState === "visible") {
    return false;
  }

  return !input.rateLimited;
}
