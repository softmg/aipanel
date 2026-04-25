import { describe, expect, it } from "vitest";
import {
  shouldShowBrowserDesktopAlert,
  type BrowserDesktopAlertDeliveryInput,
} from "@/lib/notifications/browser-delivery";

const baseInput: BrowserDesktopAlertDeliveryInput = {
  permission: "granted",
  notificationSupported: true,
  browserNotificationsEnabled: true,
  realtimeEnabled: true,
  visibilityState: "hidden",
  suppressWhenVisible: true,
  rateLimited: false,
};

function shouldShow(overrides: Partial<BrowserDesktopAlertDeliveryInput>) {
  return shouldShowBrowserDesktopAlert({ ...baseInput, ...overrides });
}

describe("shouldShowBrowserDesktopAlert", () => {
  it("returns false for denied permission", () => {
    expect(shouldShow({ permission: "denied" })).toBe(false);
  });

  it("returns false for default permission", () => {
    expect(shouldShow({ permission: "default" })).toBe(false);
  });

  it("returns false for unsupported browser", () => {
    expect(shouldShow({ notificationSupported: false, permission: "unsupported" })).toBe(false);
  });

  it("returns false when browser notifications are disabled by configuration", () => {
    expect(shouldShow({ browserNotificationsEnabled: false })).toBe(false);
  });

  it("returns false when realtime is disabled", () => {
    expect(shouldShow({ realtimeEnabled: false })).toBe(false);
  });

  it("returns false for visible tabs when visible suppression is enabled", () => {
    expect(shouldShow({ visibilityState: "visible", suppressWhenVisible: true })).toBe(false);
  });

  it("returns true for hidden tabs with granted permission", () => {
    expect(shouldShow({ visibilityState: "hidden", permission: "granted" })).toBe(true);
  });

  it("returns true for visible tabs when visible suppression is disabled", () => {
    expect(shouldShow({ visibilityState: "visible", suppressWhenVisible: false })).toBe(true);
  });

  it("returns false when rate limited", () => {
    expect(shouldShow({ rateLimited: true })).toBe(false);
  });
});
