export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatRelative(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  const delta = Date.now() - date.valueOf();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < hour) {
    return `${Math.max(1, Math.floor(delta / minute))}m ago`;
  }

  if (delta < day) {
    return `${Math.floor(delta / hour)}h ago`;
  }

  return `${Math.floor(delta / day)}d ago`;
}

export function formatContextTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (value >= 1000) {
    return `${Math.round(value / 1000).toLocaleString()}k`;
  }

  return value.toLocaleString();
}
