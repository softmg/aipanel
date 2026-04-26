import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function openNotifications(page: import("@playwright/test").Page) {
  await page.goto("/");

  const openButton = page.getByRole("button", { name: "Open notifications" });
  await expect(openButton).toBeVisible();
  await openButton.click();

  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Notification settings" })).toBeVisible();

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
  await expect(dialog.getByLabel("Browser desktop alert")).toBeVisible();
  await expect(dialog.getByLabel("Telegram task completion")).toBeVisible();
  await expect(dialog.getByText("Telegram sends only task-completion alerts. Permission/tool requests stay in the in-app drawer.")).toBeVisible();
  await expect(dialog.getByText("Telegram sends aipanel alerts through your own Telegram bot.")).toHaveCount(0);

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
