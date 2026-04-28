import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function openNotifications(page: import("@playwright/test").Page) {
  await page.goto("/");

  const openButton = page.getByRole("button", { name: "Open notifications" });
  await expect(openButton).toBeVisible();

  const settingsResponse = page.waitForResponse((response) => (
    response.url().includes("/api/notification-settings") && response.ok()
  ));
  const telegramStatusResponse = page.waitForResponse((response) => (
    response.url().includes("/api/notifications/telegram") && response.ok()
  ));

  await openButton.click();
  await settingsResponse;
  await telegramStatusResponse;

  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Notification settings" })).toBeVisible();
  await expect(dialog.getByLabel("Enable notifications")).toBeVisible();

  return dialog;
}

test("@smoke notification drawer/settings opens", async ({ page }) => {
  const dialog = await openNotifications(page);

  await expect(dialog.getByRole("heading", { name: "Notifications" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Notification settings" })).toBeVisible();
  await expect(dialog.getByText("These settings apply to all projects.")).toBeVisible();
});

test("@smoke global notification settings copy is correct", async ({ page }) => {
  const dialog = await openNotifications(page);

  await expect(dialog.getByLabel("Enable notifications")).toBeVisible();
  await expect(dialog.getByLabel("Context tokens exceed")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Browser desktop alert", exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Telegram", exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "macOS", exact: true })).toBeVisible();

  await expect(dialog.getByText("Notification delivery")).toBeVisible();
  await expect(dialog.getByText("Choose which events are delivered to each channel.")).toBeVisible();
  await expect(dialog.getByText("AI provider/API errors are sent by default because work may be blocked.")).toBeVisible();

  await expect(dialog.getByText("Action required")).toBeVisible();
  await expect(dialog.getByText("Question, permission request, task ready for review")).toBeVisible();
  await expect(dialog.getByText("Updates")).toBeVisible();
  await expect(dialog.getByText("Task update")).toBeVisible();
  await expect(dialog.getByText("Alerts")).toBeVisible();
  await expect(dialog.getByText("Context threshold")).toBeVisible();
  await expect(dialog.getByText("Failures")).toBeVisible();
  await expect(dialog.getByText("API/provider failure")).toBeVisible();

  await expect(dialog.getByLabel("Action required for Telegram")).toBeVisible();
  await expect(dialog.getByLabel("Failures for Browser desktop alert")).toBeVisible();

  await expect(dialog.getByText("Push", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Project notifications")).toHaveCount(0);
  await expect(dialog.getByText("Session notifications")).toHaveCount(0);
  await expect(dialog.getByText("Main session input tokens")).toHaveCount(0);
});

test("@smoke Telegram setup UI does not expose token after save", async ({ page }) => {
  let telegramTestEndpointHits = 0;
  await page.route("**/api/notifications/telegram/test", async (route) => {
    telegramTestEndpointHits += 1;
    await route.abort();
  });

  const dialog = await openNotifications(page);

  const fakeToken = "123456:FAKE_E2E_TOKEN_DO_NOT_USE";
  const fakeChatId = "-100123456789";

  await dialog.getByLabel("Bot token").fill(fakeToken);
  await dialog.getByLabel("Chat ID").fill(fakeChatId);
  await dialog.getByRole("button", { name: "Save Telegram settings" }).click();

  await expect(dialog.getByText("Status: Configured")).toBeVisible();
  await expect(dialog.getByText(fakeToken)).toHaveCount(0);
  await expect(dialog.getByText("Bot token saved on server.")).toBeVisible();
  expect(telegramTestEndpointHits).toBe(0);
});

test("@smoke context threshold persists", async ({ page }) => {
  const dialog = await openNotifications(page);
  const thresholdInput = dialog.getByLabel("Context tokens exceed");

  const currentValue = await thresholdInput.inputValue();
  const nextValue = currentValue === "123456" ? "123457" : "123456";

  await thresholdInput.fill(nextValue);
  await dialog.getByRole("button", { name: "Save global notification settings" }).click();
  await expect(dialog.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  const dialogAfterReload = await openNotifications(page);
  await expect(dialogAfterReload.getByLabel("Context tokens exceed")).toHaveValue(nextValue);
});
