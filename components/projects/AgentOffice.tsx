import { useMemo, useState } from "react";
import { formatNumber, formatRelative } from "@/lib/format";
import type { ClaudeSubagentSummary } from "@/lib/sources/claude-code/types";
import type { ProjectDetail } from "@/lib/services/types";

type Props = {
  data: ProjectDetail;
  activeSessionId: string | null;
};

type OfficeAgent = ClaudeSubagentSummary & {
  sessionId: string;
  sessionTitle: string;
  active: boolean;
  totalTokens: number;
};

type OfficeTeam = {
  sessionId: string;
  title: string;
  lastActivityAt: string | null;
  active: boolean;
  lead: OfficeAgent | null;
  agents: OfficeAgent[];
  roster: OfficeAgent[];
  totalTokens: number;
  turns: number;
};

const desks = [
  { left: 16, top: 28 },
  { left: 39, top: 26 },
  { left: 62, top: 28 },
  { left: 84, top: 26 },
  { left: 26, top: 68 },
  { left: 50, top: 66 },
  { left: 74, top: 68 },
];

function getAgentTone(index: number): string {
  return [
    "bg-blue-500",
    "bg-violet-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
  ][index % 6];
}

function getInitials(name: string): string {
  return name
    .split(/[._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "A";
}

function getAgentTotalTokens(agent: ClaudeSubagentSummary): number {
  return (
    agent.usage.inputTokens +
    agent.usage.outputTokens +
    agent.usage.cacheReadTokens +
    agent.usage.cacheCreationTokens
  );
}

function isTeamLead(agent: OfficeAgent): boolean {
  return agent.agentName === "team-lead" || agent.agentId.startsWith("team-lead@");
}

export function AgentOffice({ data, activeSessionId }: Props) {
  const teams = useMemo<OfficeTeam[]>(() => {
    return data.sessions
      .filter((session) => (session.subagents?.length ?? 0) > 0)
      .map((session) => {
        const latestAgentTimestamp = (session.subagents ?? []).reduce((latest, agent) => {
          const timestamp = agent.lastActivityAt ? new Date(agent.lastActivityAt).valueOf() : Number.NaN;
          return Number.isNaN(timestamp) ? latest : Math.max(latest, timestamp);
        }, Number.NEGATIVE_INFINITY);
        const activeSession = session.sessionId === activeSessionId;
        const agents = (session.subagents ?? []).map((agent) => {
          const agentTimestamp = agent.lastActivityAt ? new Date(agent.lastActivityAt).valueOf() : Number.NaN;
          return {
            ...agent,
            sessionId: session.sessionId,
            sessionTitle: session.title ?? session.sessionId,
            active: activeSession && !Number.isNaN(agentTimestamp) && agentTimestamp === latestAgentTimestamp,
            totalTokens: getAgentTotalTokens(agent),
          };
        });

        const lead = agents.find(isTeamLead) ?? null;
        const deskAgents = agents.filter((agent) => agent !== lead);

        return {
          sessionId: session.sessionId,
          title: session.title ?? session.sessionId,
          lastActivityAt: session.lastActivityAt,
          active: activeSession,
          lead,
          agents: deskAgents,
          roster: agents,
          totalTokens: agents.reduce((sum, agent) => sum + agent.totalTokens, 0),
          turns: agents.reduce((sum, agent) => sum + agent.turns, 0),
        };
      });
  }, [activeSessionId, data.sessions]);

  const defaultTeamId = teams.find((team) => team.active)?.sessionId ?? teams[0]?.sessionId ?? null;
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(defaultTeamId);
  const selectedTeam = teams.find((team) => team.sessionId === selectedTeamId) ?? teams[0] ?? null;
  const agents = selectedTeam?.agents ?? [];
  const lead = selectedTeam?.lead ?? null;
  const roster = selectedTeam?.roster ?? [];
  const activeAgents = roster.filter((agent) => agent.active).length;

  if (teams.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950">
        No Agent Team activity has been recorded for this project yet.
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="Teams" value={formatNumber(teams.length)} />
        <MetricCard label="Agents in team" value={formatNumber(roster.length)} />
        <MetricCard label="Team tokens" value={formatNumber(selectedTeam?.totalTokens ?? 0)} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
        <aside className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Команда</h2>
              <p className="text-xs text-zinc-500">Выберите, кого показать в офисе</p>
            </div>
            <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {formatNumber(teams.length)}
            </span>
          </div>
          <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
            {teams.map((team) => {
              const selected = team.sessionId === selectedTeam?.sessionId;
              return (
                <button
                  key={team.sessionId}
                  type="button"
                  onClick={() => setSelectedTeamId(team.sessionId)}
                  aria-pressed={selected}
                  className={`w-full rounded-lg border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 ${
                    selected
                      ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/10"
                      : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-medium">{team.title}</p>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${team.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                      {team.active ? "Active" : "Idle"}
                    </span>
                  </div>
                  <p suppressHydrationWarning className="mt-2 text-xs text-zinc-500">
                    {team.roster.length} agents · {formatNumber(team.totalTokens)} tokens · {formatRelative(team.lastActivityAt)}
                  </p>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-slate-950 text-white shadow-sm dark:border-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Claude Office</h2>
              <p className="truncate text-xs text-slate-400">{selectedTeam?.title}</p>
            </div>
            <span className="rounded bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
              {activeAgents > 0 ? "Live activity" : "Idle team"}
            </span>
          </div>

          <div className="relative min-h-[520px] overflow-hidden bg-[linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] bg-[size:32px_32px]">
            <div className="absolute left-6 top-6 max-w-[40%] rounded border border-amber-300/30 bg-amber-200/10 px-3 py-2 text-xs text-amber-100">
              Standup board · {data.project.name}
            </div>
            {lead ? (
              <div className="absolute right-6 top-6 w-48 rounded-xl border border-cyan-300/40 bg-cyan-200/10 p-3 shadow-lg backdrop-blur">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="rounded bg-cyan-300/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                    Team lead
                  </span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${lead.active ? "bg-emerald-300/20 text-emerald-100" : "bg-white/10 text-slate-300"}`}>
                    {lead.active ? "Active" : "Idle"}
                  </span>
                </div>
                <div className={`mx-auto h-10 w-10 rounded-full border-2 border-cyan-100/60 ${lead.active ? "animate-pulse bg-emerald-500" : "bg-cyan-500"}`}>
                  <span className="flex h-full items-center justify-center text-[11px] font-bold text-white">
                    {getInitials(lead.agentName)}
                  </span>
                </div>
                <p className="mt-2 truncate text-center font-mono text-xs text-cyan-50">@{lead.agentName}</p>
                <p className="mt-1 text-center text-[10px] text-cyan-100/70">
                  {formatNumber(lead.totalTokens)} tokens · {lead.turns} turns
                </p>
              </div>
            ) : null}
            <div className="absolute bottom-6 right-6 rounded border border-cyan-300/30 bg-cyan-200/10 px-3 py-2 text-xs text-cyan-100">
              {roster.length} agents · {selectedTeam?.turns ?? 0} turns
            </div>

            {agents.map((agent, index) => {
              const position = desks[index % desks.length];
              const rowOffset = Math.floor(index / desks.length) * 8;

              return (
                <div
                  key={`${agent.sessionId}-${agent.agentId}`}
                  className="absolute w-36 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${Math.min(position.left + rowOffset, 90)}%`, top: `${Math.min(position.top + rowOffset, 84)}%` }}
                >
                  <div className="mx-auto h-14 w-28 rounded-sm border border-amber-900/50 bg-amber-700 shadow-[inset_0_-6px_rgba(0,0,0,.2)]">
                    <div className="mx-auto mt-2 h-2 w-20 rounded bg-amber-500/70" />
                  </div>
                  <div className={`relative mx-auto -mt-10 h-14 w-10 ${agent.active ? "animate-bounce" : ""}`}>
                    <div className={`mx-auto h-7 w-7 rounded-t-lg border-2 border-slate-900 ${getAgentTone(index)}`}>
                      <span className="flex h-full items-center justify-center text-[9px] font-bold text-white">
                        {getInitials(agent.agentName)}
                      </span>
                    </div>
                    <div className={`mx-auto h-6 w-8 rounded-b ${getAgentTone(index)} opacity-80`} />
                    {agent.active ? (
                      <div className="absolute -right-10 -top-5 rounded border border-emerald-200/40 bg-emerald-300/20 px-2 py-1 text-[10px] text-emerald-100">
                        typing
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-2 rounded border border-white/10 bg-black/45 px-2 py-1.5 text-center shadow-lg backdrop-blur">
                    <p className="truncate font-mono text-[11px] text-slate-100">@{agent.agentName}</p>
                    <p className="truncate text-[10px] text-slate-400">{agent.active ? "Active" : "Idle"} · {agent.turns} turns</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {agents.map((agent) => (
          <article
            key={`${agent.sessionId}-${agent.agentId}-card`}
            className="rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-200">@{agent.agentName}</p>
                <p className="truncate text-xs text-zinc-500">{agent.sessionTitle}</p>
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${agent.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>
                {agent.active ? "Active" : "Idle"}
              </span>
            </div>
            <p suppressHydrationWarning className="mt-2 text-xs text-zinc-500">
              {formatNumber(agent.totalTokens)} tokens · {agent.turns} turns · {formatRelative(agent.lastActivityAt)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
