import { expect, test } from "@playwright/test";

test("@smoke app shell loads", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "AI Project Status Panel" })).toBeVisible();

  const openNotificationsButton = page.getByRole("button", { name: "Open notifications" });
  await expect(openNotificationsButton).toBeVisible();
  await openNotificationsButton.click();

  const notificationsDialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(notificationsDialog).toBeVisible();
  await expect(notificationsDialog.getByRole("heading", { name: "Notifications" })).toBeVisible();
});
