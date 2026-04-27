"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getGlobalNotificationRule,
  normalizeGlobalNotificationSettings,
  updateGlobalNotificationSettings,
} from "@/lib/notifications/global-settings";
import { notificationSettingsSchema, type NotificationChannel, type NotificationKind, type NotificationSettings } from "@/lib/notifications/schema";

const KIND_OPTIONS: Array<{ kind: NotificationKind; label: string }> = [
  { kind: "question", label: "Questions from Claude" },
  { kind: "permission", label: "Permission/tool requests" },
  { kind: "task", label: "Background task notifications" },
  { kind: "alert", label: "Context threshold alerts" },
];

const CHANNEL_OPTIONS: Array<{ channel: Exclude<NotificationChannel, "telegram">; label: string; disabled?: boolean }> = [
  { channel: "inApp", label: "In-app" },
  { channel: "browser", label: "Browser desktop alert" },
  { channel: "macos", label: "macOS app coming later", disabled: true },
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
  kinds: Record<NotificationKind, boolean>;
  contextTokensThreshold: string;
  channels: Record<NotificationChannel, boolean>;
};

const DEFAULT_TELEGRAM_STATUS: TelegramSafeStatus = {
  configured: false,
  botTokenConfigured: false,
};

function createKindState(kinds: NotificationKind[]): Record<NotificationKind, boolean> {
  const selected = new Set(kinds);
  return {
    question: selected.has("question"),
    permission: selected.has("permission"),
    task: selected.has("task"),
    alert: selected.has("alert"),
  };
}

function createForm(settings: NotificationSettings): FormState {
  const normalized = normalizeGlobalNotificationSettings(settings);
  const rule = getGlobalNotificationRule(normalized);

  return {
    enabled: normalized.enabled,
    kinds: createKindState(rule?.kinds ?? ["question", "permission", "task", "alert"]),
    contextTokensThreshold: String(normalized.defaults.contextTokensThreshold),
    channels: { ...(rule?.channels ?? normalized.channels) },
  };
}

function selectedKinds(kinds: Record<NotificationKind, boolean>): NotificationKind[] {
  return KIND_OPTIONS.map((option) => option.kind).filter((kind) => kinds[kind]);
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

  const activeKinds = useMemo(() => selectedKinds(form?.kinds ?? createKindState([])), [form?.kinds]);
  const threshold = form?.contextTokensThreshold ?? "";
  const parsedThreshold = parseThreshold(threshold);
  const canSave = Boolean(settings && form && parsedThreshold && activeKinds.length > 0 && saveState !== "saving");

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

  function updateKind(kind: NotificationKind, checked: boolean) {
    setForm((current) => current ? {
      ...current,
      kinds: { ...current.kinds, [kind]: checked },
    } : current);
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
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Notification kinds</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {KIND_OPTIONS.map((option) => (
                <label key={option.kind} className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={form.kinds[option.kind]}
                    onChange={(event) => updateKind(option.kind, event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  {option.label}
                </label>
              ))}
            </div>
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
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Channels</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHANNEL_OPTIONS.map((option) => (
                <label key={option.channel} className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={form.channels[option.channel]}
                    disabled={option.disabled}
                    onChange={(event) => updateChannel(option.channel, event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 disabled:opacity-60"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
              <label className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={form.channels.telegram}
                  disabled={!telegramStatus.configured}
                  onChange={(event) => updateChannel("telegram", event.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 disabled:opacity-60"
                />
                <span>Telegram review/questions</span>
              </label>
            </div>
            {!telegramStatus.configured ? (
              <p className="text-xs text-zinc-500">Configure Telegram first.</p>
            ) : null}
          </fieldset>

          <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
            <h4 className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">Telegram</h4>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
              Telegram sends only when Claude asks a question or a task is ready for review. Permission/tool requests stay in the in-app drawer.
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
