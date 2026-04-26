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

const CHANNEL_OPTIONS: Array<{ channel: NotificationChannel; label: string; disabled?: boolean }> = [
  { channel: "inApp", label: "In-app" },
  { channel: "browser", label: "Browser desktop alert" },
  { channel: "telegram", label: "Telegram setup later", disabled: true },
  { channel: "macos", label: "macOS app coming later", disabled: true },
];

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

type FormState = {
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
  contextTokensThreshold: string;
  channels: Record<NotificationChannel, boolean>;
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

export function GlobalNotificationSettingsPanel() {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadSettings() {
      setLoadState("loading");
      setError(null);

      try {
        const response = await fetch("/api/notification-settings", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Unable to load notification settings.");
        }

        const parsed = normalizeGlobalNotificationSettings(notificationSettingsSchema.parse(await response.json()));
        if (ignore) {
          return;
        }

        setSettings(parsed);
        setForm(createForm(parsed));
        setLoadState("ready");
      } catch {
        if (!ignore) {
          setLoadState("error");
          setError("Unable to load notification settings.");
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
      setError("Enter a positive Context token threshold.");
      return;
    }

    if (activeKinds.length === 0) {
      setSaveState("error");
      setError("Select at least one notification kind.");
      return;
    }

    setSaveState("saving");
    setError(null);

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
      setError("Unable to save notification settings.");
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

      {loadState === "error" ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {loadState === "ready" && form ? (
        <div className="mt-3 space-y-3">
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
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {saveState === "saving" ? "Saving…" : "Save"}
            </button>
            {saveState === "saved" ? <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span> : null}
            {saveState === "error" ? <span role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
