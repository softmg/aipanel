"use client";

import { useEffect, useMemo, useState } from "react";
import {
  disableSessionNotificationRule,
  getDefaultNotificationChannels,
  getDefaultNotificationKinds,
  getProjectNotificationRule,
  getSessionNotificationRule,
  upsertProjectNotificationRule,
  upsertSessionNotificationRule,
} from "@/lib/notifications/rule-upsert";
import { notificationSettingsSchema } from "@/lib/notifications/schema";
import type { NotificationChannel, NotificationKind, NotificationRule, NotificationSettings } from "@/lib/notifications/schema";

type Props = {
  projectSlug: string;
  sessionId?: string;
};

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type RuleFormState = {
  enabled: boolean;
  kinds: Record<NotificationKind, boolean>;
  channels: Record<NotificationChannel, boolean>;
  contextTokensThreshold: string;
};

const KIND_OPTIONS: Array<{ kind: NotificationKind; label: string }> = [
  { kind: "question", label: "Questions from Claude" },
  { kind: "permission", label: "Permission/tool requests" },
  { kind: "task", label: "Background task notifications" },
  { kind: "alert", label: "Context threshold alerts" },
];

const SESSION_KIND_OPTIONS: Array<{ kind: NotificationKind; label: string }> = [
  { kind: "question", label: "Questions" },
  { kind: "permission", label: "Permission/tool requests" },
  { kind: "task", label: "Task notifications" },
  { kind: "alert", label: "Context threshold alerts" },
];

const CHANNEL_OPTIONS: Array<{ channel: NotificationChannel; label: string; note?: string }> = [
  { channel: "inApp", label: "In-app" },
  { channel: "browser", label: "Browser desktop alert" },
  { channel: "telegram", label: "Telegram", note: "setup later" },
  { channel: "macos", label: "macOS", note: "app coming later" },
];

function getEnabledKinds(rule?: NotificationRule): Record<NotificationKind, boolean> {
  const selected = new Set(rule?.kinds ?? getDefaultNotificationKinds());
  return {
    question: selected.has("question"),
    permission: selected.has("permission"),
    task: selected.has("task"),
    alert: selected.has("alert"),
  };
}

function getRuleChannels(rule?: NotificationRule): Record<NotificationChannel, boolean> {
  return { ...(rule?.channels ?? getDefaultNotificationChannels()) };
}

function getThresholdValue(settings: NotificationSettings, rule?: NotificationRule, fallbackRule?: NotificationRule): string {
  return String(
    rule?.thresholds?.contextTokens ??
      fallbackRule?.thresholds?.contextTokens ??
      settings.defaults.contextTokensThreshold,
  );
}

function createProjectForm(settings: NotificationSettings, projectSlug: string): RuleFormState {
  const rule = getProjectNotificationRule(settings, projectSlug);
  return {
    enabled: rule?.enabled ?? true,
    kinds: getEnabledKinds(rule),
    channels: getRuleChannels(rule),
    contextTokensThreshold: getThresholdValue(settings, rule),
  };
}

function createSessionForm(settings: NotificationSettings, projectSlug: string, sessionId: string): RuleFormState {
  const projectRule = getProjectNotificationRule(settings, projectSlug);
  const rule = getSessionNotificationRule(settings, projectSlug, sessionId);
  return {
    enabled: rule?.enabled ?? false,
    kinds: getEnabledKinds(rule ?? projectRule),
    channels: getRuleChannels(rule ?? projectRule),
    contextTokensThreshold: getThresholdValue(settings, rule, projectRule),
  };
}

function selectedKinds(kinds: Record<NotificationKind, boolean>): NotificationKind[] {
  const selected = KIND_OPTIONS.map((option) => option.kind).filter((kind) => kinds[kind]);
  return selected.length > 0 ? selected : ["alert"];
}

function parseThreshold(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function ProjectNotificationControls({ projectSlug }: Pick<Props, "projectSlug">) {
  return <NotificationRuleControls projectSlug={projectSlug} />;
}

export function SessionNotificationControls({ projectSlug, sessionId }: Required<Props>) {
  return <NotificationRuleControls projectSlug={projectSlug} sessionId={sessionId} />;
}

function NotificationRuleControls({ projectSlug, sessionId }: Props) {
  const mode = sessionId ? "session" : "project";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [form, setForm] = useState<RuleFormState | null>(null);

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

        const parsed = notificationSettingsSchema.parse(await response.json());
        if (ignore) {
          return;
        }

        setSettings(parsed);
        setForm(sessionId ? createSessionForm(parsed, projectSlug, sessionId) : createProjectForm(parsed, projectSlug));
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
  }, [projectSlug, sessionId]);

  const title = mode === "session" ? "Session notifications" : "Project notifications";
  const kindOptions = mode === "session" ? SESSION_KIND_OPTIONS : KIND_OPTIONS;
  const watched = form?.enabled ?? false;
  const threshold = form?.contextTokensThreshold ?? "";
  const canSave = Boolean(settings && form && (mode === "session" && !watched || parseThreshold(threshold)));

  const channelNotes = useMemo(() => {
    if (!settings) {
      return {} as Partial<Record<NotificationChannel, string>>;
    }

    return CHANNEL_OPTIONS.reduce<Partial<Record<NotificationChannel, string>>>((notes, option) => {
      const parts = [
        !settings.channels[option.channel] ? "disabled globally" : null,
        option.note ?? null,
      ].filter((part): part is string => Boolean(part));
      if (parts.length > 0) {
        notes[option.channel] = parts.join("; ");
      }
      return notes;
    }, {});
  }, [settings]);

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

  function updateWatched(checked: boolean) {
    setForm((current) => current ? { ...current, enabled: checked } : current);
    setSaveState("idle");
  }

  async function save() {
    if (!settings || !form) {
      return;
    }

    const contextTokensThreshold = parseThreshold(form.contextTokensThreshold);
    const disablingSession = Boolean(sessionId && !form.enabled);
    if (!disablingSession && !contextTokensThreshold) {
      setSaveState("error");
      setError("Enter a positive Context token threshold.");
      return;
    }

    setSaveState("saving");
    setError(null);

    try {
      const nextSettings = disablingSession && sessionId
        ? disableSessionNotificationRule(settings, projectSlug, sessionId)
        : sessionId
          ? upsertSessionNotificationRule(settings, {
              projectSlug,
              sessionId,
              kinds: selectedKinds(form.kinds),
              channels: form.channels,
              contextTokensThreshold: contextTokensThreshold!,
            })
          : upsertProjectNotificationRule(settings, {
              projectSlug,
              kinds: selectedKinds(form.kinds),
              channels: form.channels,
              contextTokensThreshold: contextTokensThreshold!,
            });

      const response = await fetch("/api/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });

      if (!response.ok) {
        throw new Error("Unable to save notification settings.");
      }

      const parsed = notificationSettingsSchema.parse(await response.json());
      setSettings(parsed);
      setForm(sessionId ? createSessionForm(parsed, projectSlug, sessionId) : createProjectForm(parsed, projectSlug));
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setError("Unable to save notification settings.");
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-zinc-500">
            {mode === "session" ? "Override notification rules for this session." : "Configure notification rules for this project."}
          </p>
        </div>
        {loadState === "loading" ? <span className="text-xs text-zinc-500">Loading…</span> : null}
      </div>

      {loadState === "error" ? (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {loadState === "ready" && form && settings ? (
        <div className="mt-3 space-y-3">
          {mode === "session" ? (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={watched}
                onChange={(event) => updateWatched(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Watch this session
            </label>
          ) : null}

          <fieldset disabled={mode === "session" && !watched} className="space-y-2 disabled:opacity-60">
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Controls</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {kindOptions.map((option) => (
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
                className="w-32 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          </fieldset>

          <fieldset disabled={mode === "session" && !watched} className="space-y-2 disabled:opacity-60">
            <legend className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Delivery</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHANNEL_OPTIONS.map((option) => {
                const note = channelNotes[option.channel];
                const disabled = !settings.channels[option.channel] || option.channel === "telegram" || option.channel === "macos";
                return (
                  <label key={option.channel} className="inline-flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
                    <input
                      type="checkbox"
                      checked={form.channels[option.channel]}
                      disabled={disabled}
                      onChange={(event) => updateChannel(option.channel, event.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 disabled:opacity-60"
                    />
                    <span>{option.label}</span>
                    {note ? <span className="text-[11px] text-zinc-400">({note})</span> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave || saveState === "saving"}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs transition hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
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
