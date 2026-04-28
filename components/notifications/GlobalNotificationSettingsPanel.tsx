"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ALL_NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENT_GROUPS,
  normalizeChannelEventSelections,
  type NotificationChannelEventSelections,
  type NotificationEventKey,
} from "@/lib/notifications/events";
import {
  getGlobalNotificationRule,
  normalizeGlobalNotificationSettings,
  updateGlobalNotificationSettings,
} from "@/lib/notifications/global-settings";
import { notificationSettingsSchema, type NotificationChannel, type NotificationKind, type NotificationSettings } from "@/lib/notifications/schema";

const ALL_NOTIFICATION_KINDS: NotificationKind[] = ["question", "permission", "task", "alert"];

const CHANNEL_OPTIONS: Array<{ channel: NotificationChannel; label: string }> = [
  { channel: "inApp", label: "In-app" },
  { channel: "browser", label: "Browser desktop alert" },
  { channel: "telegram", label: "Telegram" },
  { channel: "macos", label: "macOS" },
];

const DELIVERY_ROWS: Array<{ id: string; label: string; description: string; events: NotificationEventKey[] }> = [
  {
    id: "action_required",
    label: "Action required",
    description: "Question, permission request, task ready for review",
    events: NOTIFICATION_EVENT_GROUPS.action_required,
  },
  {
    id: "updates",
    label: "Updates",
    description: "Task update",
    events: NOTIFICATION_EVENT_GROUPS.updates,
  },
  {
    id: "alerts",
    label: "Alerts",
    description: "Context threshold",
    events: NOTIFICATION_EVENT_GROUPS.alerts,
  },
  {
    id: "failures",
    label: "Failures",
    description: "API/provider failure",
    events: NOTIFICATION_EVENT_GROUPS.failures,
  },
];

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type TelegramSaveState = "idle" | "saving" | "saved" | "error";
type TelegramTestState = "idle" | "sending" | "sent" | "error";

type TelegramSafeStatus = {
  configured: boolean;
  botTokenConfigured: boolean;
  chatId?: string;
};

type FormState = {
  enabled: boolean;
  contextTokensThreshold: string;
  channels: Record<NotificationChannel, boolean>;
  channelEvents: NotificationChannelEventSelections;
};

const DEFAULT_TELEGRAM_STATUS: TelegramSafeStatus = {
  configured: false,
  botTokenConfigured: false,
};

function createForm(settings: NotificationSettings): FormState {
  const normalized = normalizeGlobalNotificationSettings(settings);
  const rule = getGlobalNotificationRule(normalized);

  return {
    enabled: normalized.enabled,
    contextTokensThreshold: String(normalized.defaults.contextTokensThreshold),
    channels: { ...(rule?.channels ?? normalized.channels) },
    channelEvents: normalizeChannelEventSelections(normalized.channelEvents),
  };
}

function hasEvent(channelEvents: NotificationChannelEventSelections, channel: NotificationChannel, event: NotificationEventKey): boolean {
  return channelEvents[channel].includes(event);
}

function areAllEventsSelected(
  channelEvents: NotificationChannelEventSelections,
  channel: NotificationChannel,
  events: NotificationEventKey[],
): boolean {
  return events.every((event) => hasEvent(channelEvents, channel, event));
}

function toggleEventGroup(
  channelEvents: NotificationChannelEventSelections,
  channel: NotificationChannel,
  events: NotificationEventKey[],
  checked: boolean,
): NotificationChannelEventSelections {
  const current = new Set(channelEvents[channel]);
  for (const event of events) {
    if (checked) {
      current.add(event);
    } else {
      current.delete(event);
    }
  }

  return normalizeChannelEventSelections({
    ...channelEvents,
    [channel]: ALL_NOTIFICATION_EVENT_KEYS.filter((key) => current.has(key)),
  });
}

function selectedKindsFromEvents(channelEvents: NotificationChannelEventSelections): NotificationKind[] {
  const selected = new Set<NotificationKind>();

  for (const event of ALL_NOTIFICATION_EVENT_KEYS) {
    const enabledInAnyChannel = CHANNEL_OPTIONS.some((option) => channelEvents[option.channel].includes(event));
    if (!enabledInAnyChannel) {
      continue;
    }

    if (event.startsWith("question.")) {
      selected.add("question");
      continue;
    }
    if (event.startsWith("permission.")) {
      selected.add("permission");
      continue;
    }
    if (event.startsWith("task.")) {
      selected.add("task");
      continue;
    }
    selected.add("alert");
  }

  const kinds = ALL_NOTIFICATION_KINDS.filter((kind) => selected.has(kind));
  return kinds.length > 0 ? kinds : [...ALL_NOTIFICATION_KINDS];
}

function parseThreshold(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseTelegramSafeStatus(value: unknown): TelegramSafeStatus {
  if (!value || typeof value !== "object") {
    return DEFAULT_TELEGRAM_STATUS;
  }

  const raw = value as {
    configured?: unknown;
    botTokenConfigured?: unknown;
    chatId?: unknown;
  };

  const chatId = typeof raw.chatId === "string" && raw.chatId.trim() ? raw.chatId.trim() : undefined;

  return {
    configured: raw.configured === true,
    botTokenConfigured: raw.botTokenConfigured === true,
    ...(chatId ? { chatId } : {}),
  };
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function GlobalNotificationSettingsPanel() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const [telegramStatus, setTelegramStatus] = useState<TelegramSafeStatus>(DEFAULT_TELEGRAM_STATUS);
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState("");
  const [telegramChatIdInput, setTelegramChatIdInput] = useState("");
  const [telegramSaveState, setTelegramSaveState] = useState<TelegramSaveState>("idle");
  const [telegramTestState, setTelegramTestState] = useState<TelegramTestState>("idle");
  const [telegramError, setTelegramError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadSettings() {
      setLoadState("loading");
      setSettingsError(null);
      setTelegramError(null);

      try {
        const response = await fetch("/api/notification-settings", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load notification settings.");
        }

        const parsedSettings = normalizeGlobalNotificationSettings(notificationSettingsSchema.parse(await response.json()));

        let loadedTelegramStatus = DEFAULT_TELEGRAM_STATUS;
        try {
          const telegramResponse = await fetch("/api/notifications/telegram", { cache: "no-store" });
          if (!telegramResponse.ok) {
            throw new Error("Unable to load Telegram setup status.");
          }

          loadedTelegramStatus = parseTelegramSafeStatus(await telegramResponse.json());
        } catch {
          if (!ignore) {
            setTelegramError("Unable to load Telegram setup status.");
          }
        }

        if (ignore) {
          return;
        }

        setSettings(parsedSettings);
        setForm(createForm(parsedSettings));
        setTelegramStatus(loadedTelegramStatus);
        setTelegramChatIdInput(loadedTelegramStatus.chatId ?? "");
        setLoadState("ready");
      } catch {
        if (!ignore) {
          setLoadState("error");
          setSettingsError("Unable to load notification settings.");
        }
      }
    }

    void loadSettings();

    return () => {
      ignore = true;
    };
  }, []);

  const activeKinds = useMemo(
    () => selectedKindsFromEvents(form?.channelEvents ?? normalizeChannelEventSelections(undefined)),
    [form?.channelEvents],
  );
  const threshold = form?.contextTokensThreshold ?? "";
  const parsedThreshold = parseThreshold(threshold);
  const canSave = Boolean(settings && form && parsedThreshold && saveState !== "saving");

  const telegramStatusLabel = useMemo(() => {
    if (telegramTestState === "sent") {
      return "Test message sent";
    }

    if (telegramTestState === "error") {
      return "Test failed";
    }

    return telegramStatus.configured ? "Configured" : "Not configured";
  }, [telegramStatus.configured, telegramTestState]);

  function updateEnabled(enabled: boolean) {
    setForm((current) => current ? { ...current, enabled } : current);
    setSaveState("idle");
  }

  function updateChannel(channel: NotificationChannel, checked: boolean) {
    setForm((current) => current ? {
      ...current,
      channels: { ...current.channels, [channel]: checked },
    } : current);
    setSaveState("idle");
  }

  async function save() {
    if (!settings || !form) {
      return;
    }

    if (!parsedThreshold) {
      setSaveState("error");
      setSettingsError("Enter a positive Context token threshold.");
      return;
    }

    if (activeKinds.length === 0) {
      setSaveState("error");
      setSettingsError("Select at least one notification kind.");
      return;
    }

    setSaveState("saving");
    setSettingsError(null);

    try {
      const nextSettings = updateGlobalNotificationSettings(settings, {
        enabled: form.enabled,
        kinds: activeKinds,
        contextTokensThreshold: parsedThreshold,
        channels: form.channels,
        channelEvents: normalizeChannelEventSelections(form.channelEvents),
      });

      const response = await fetch("/api/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });

      if (!response.ok) {
        throw new Error("Unable to save notification settings.");
      }

      const parsed = normalizeGlobalNotificationSettings(notificationSettingsSchema.parse(await response.json()));
      setSettings(parsed);
      setForm(createForm(parsed));
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setSettingsError("Unable to save notification settings.");
    }
  }

  async function saveTelegramSettings() {
    const botToken = telegramBotTokenInput.trim();
    const chatId = telegramChatIdInput.trim();

    if (!botToken || !chatId) {
      setTelegramSaveState("error");
      setTelegramError("Enter bot token and chat ID.");
      return;
    }

    setTelegramSaveState("saving");
    setTelegramTestState("idle");
    setTelegramError(null);

    try {
      const response = await fetch("/api/notifications/telegram", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, chatId }),
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to save Telegram settings."));
      }

      const safeStatus = parseTelegramSafeStatus(await response.json());
      setTelegramStatus(safeStatus);
      setTelegramChatIdInput(safeStatus.chatId ?? chatId);
      setTelegramBotTokenInput("");
      setTelegramSaveState("saved");
    } catch (error) {
      setTelegramSaveState("error");
      setTelegramError(error instanceof Error ? error.message : "Unable to save Telegram settings.");
    }
  }

  async function sendTelegramTestMessage() {
    setTelegramTestState("sending");
    setTelegramError(null);

    try {
      const response = await fetch("/api/notifications/telegram/test", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to send Telegram test message."));
      }

      setTelegramTestState("sent");
    } catch (error) {
      setTelegramTestState("error");
      setTelegramError(error instanceof Error ? error.message : "Unable to send Telegram test message.");
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Notification settings</h3>
          <p className="text-xs text-zinc-500">These settings apply to all projects.</p>
        </div>
        {loadState === "loading" ? <span className="text-xs text-zinc-500">Loading…</span> : null}
      </div>

      {telegramError && loadState !== "ready" ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{telegramError}</p>
      ) : null}

      {loadState === "error" ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{settingsError}</p>
      ) : null}

      {loadState === "ready" && form ? (
        <div className="mt-3 space-y-4">
          <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => updateEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300"
            />
            Enable notifications
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Channels</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHANNEL_OPTIONS.map((option) => (
                <label key={option.channel} className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={form.channels[option.channel]}
                    disabled={option.channel === "telegram" && !telegramStatus.configured}
                    onChange={(event) => updateChannel(option.channel, event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 disabled:opacity-60"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {!telegramStatus.configured ? (
              <p className="text-xs text-zinc-500">Configure Telegram first.</p>
            ) : null}
            <p className="text-xs text-zinc-500">macOS delivery works only on macOS while pnpm notify is running.</p>
          </fieldset>

          <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span>Context tokens exceed</span>
            <input
              type="number"
              min="1"
              step="1000"
              value={form.contextTokensThreshold}
              onChange={(event) => {
                setForm((current) => current ? { ...current, contextTokensThreshold: event.target.value } : current);
                setSaveState("idle");
              }}
              className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Notification delivery</legend>
            <p className="text-xs text-zinc-500">Choose which events are delivered to each channel.</p>
            <p className="text-xs text-zinc-500">AI provider/API errors are sent by default because work may be blocked.</p>
            <div className="overflow-x-auto rounded border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/40">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50 text-left dark:border-zinc-800 dark:bg-zinc-900/40">
                    <th className="px-3 py-2 font-medium text-zinc-700 dark:text-zinc-200">Event group</th>
                    {CHANNEL_OPTIONS.map((option) => (
                      <th key={option.channel} className="px-3 py-2 text-center font-medium text-zinc-700 dark:text-zinc-200">{option.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DELIVERY_ROWS.map((row) => (
                    <tr key={row.id} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/80">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-zinc-700 dark:text-zinc-200">{row.label}</div>
                        <div className="text-zinc-500 dark:text-zinc-400">{row.description}</div>
                      </td>
                      {CHANNEL_OPTIONS.map((option) => {
                        const checked = areAllEventsSelected(form.channelEvents, option.channel, row.events);
                        return (
                          <td key={`${row.id}-${option.channel}`} className="px-3 py-2 text-center align-middle">
                            <input
                              type="checkbox"
                              aria-label={`${row.label} for ${option.label}`}
                              checked={checked}
                              onChange={(event) => {
                                setForm((current) => {
                                  if (!current) {
                                    return current;
                                  }

                                  return {
                                    ...current,
                                    channelEvents: toggleEventGroup(
                                      current.channelEvents,
                                      option.channel,
                                      row.events,
                                      event.target.checked,
                                    ),
                                  };
                                });
                                setSaveState("idle");
                              }}
                              className="h-4 w-4 rounded border-zinc-300"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>

          <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Telegram</h4>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              Telegram delivery requires bot setup and follows your event matrix selection for the Telegram channel.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-zinc-600 dark:text-zinc-300">
              <li>Create a bot with BotFather.</li>
              <li>Send /start to your bot in Telegram.</li>
              <li>Paste the bot token and chat ID here.</li>
              <li>Save and send a test message.</li>
            </ol>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <span>Bot token</span>
                <input
                  type="password"
                  value={telegramBotTokenInput}
                  onChange={(event) => {
                    setTelegramBotTokenInput(event.target.value);
                    setTelegramSaveState("idle");
                  }}
                  placeholder="123456:ABC..."
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
                <span>Chat ID</span>
                <input
                  type="text"
                  value={telegramChatIdInput}
                  onChange={(event) => {
                    setTelegramChatIdInput(event.target.value);
                    setTelegramSaveState("idle");
                  }}
                  placeholder="-100123456789"
                  className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void saveTelegramSettings()}
                disabled={telegramSaveState === "saving"}
                className="rounded border border-zinc-300 px-3 py-1.5 text-xs transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {telegramSaveState === "saving" ? "Saving Telegram settings…" : "Save Telegram settings"}
              </button>

              <button
                type="button"
                onClick={() => void sendTelegramTestMessage()}
                disabled={telegramTestState === "sending" || !telegramStatus.configured}
                className="rounded border border-zinc-300 px-3 py-1.5 text-xs transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {telegramTestState === "sending" ? "Sending test message…" : "Send test message"}
              </button>

              <span className="text-xs text-zinc-600 dark:text-zinc-300">Status: {telegramStatusLabel}</span>
              {telegramStatus.botTokenConfigured ? (
                <span className="text-xs text-zinc-500">Bot token saved on server.</span>
              ) : null}
            </div>

            {telegramError ? (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{telegramError}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              aria-label="Save global notification settings"
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
            {saveState === "saved" ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span> : null}
            {saveState === "error" ? <span role="alert" className="text-xs text-red-600 dark:text-red-400">{settingsError}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
