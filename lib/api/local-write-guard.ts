import { NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOWED_FETCH_SITES = new Set(["same-origin", "same-site", "none"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

type GuardOptions = {
  requireJson?: boolean;
};

function sanitizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(sanitizeHost(hostname));
}

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function unsupportedMediaType() {
  return NextResponse.json({ error: "Unsupported Media Type" }, { status: 415 });
}

function parseAllowedDevOrigins(): { originSet: Set<string>; hostSet: Set<string> } {
  const raw = process.env.AIPANEL_ALLOWED_DEV_ORIGINS;
  const originSet = new Set<string>();
  const hostSet = new Set<string>();

  if (!raw) {
    return { originSet, hostSet };
  }

  for (const entry of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    const lowered = entry.toLowerCase();

    if (lowered.includes("://")) {
      try {
        const url = new URL(lowered);
        originSet.add(url.origin.toLowerCase());
        hostSet.add(sanitizeHost(url.hostname));
      } catch {
        hostSet.add(sanitizeHost(lowered));
      }
      continue;
    }

    hostSet.add(sanitizeHost(lowered));
  }

  return { originSet, hostSet };
}

function extractRequestHost(request: Request): string {
  try {
    return sanitizeHost(new URL(request.url).hostname);
  } catch {
    const host = request.headers.get("host");
    if (!host) {
      return "";
    }

    const normalized = host.trim();
    if (normalized.startsWith("[")) {
      const closing = normalized.indexOf("]");
      if (closing > 0) {
        return sanitizeHost(normalized.slice(0, closing + 1));
      }
      return sanitizeHost(normalized);
    }

    const firstPart = normalized.split(":")[0] ?? "";
    return sanitizeHost(firstPart);
  }
}

function isAllowedOrigin(request: Request): boolean {
  const requestHost = extractRequestHost(request);
  const originHeader = request.headers.get("origin");

  if (!originHeader) {
    return isLoopbackHost(requestHost);
  }

  let originUrl: URL;
  try {
    originUrl = new URL(originHeader);
  } catch {
    return false;
  }

  const { originSet, hostSet } = parseAllowedDevOrigins();
  const originHost = sanitizeHost(originUrl.hostname);

  if (originHost === requestHost) {
    return true;
  }

  if (isLoopbackHost(originHost)) {
    return true;
  }

  if (originSet.has(originUrl.origin.toLowerCase())) {
    return true;
  }

  return hostSet.has(originHost);
}

function hasValidFetchSite(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (!fetchSite) {
    return true;
  }

  return ALLOWED_FETCH_SITES.has(fetchSite);
}

function hasValidWriteToken(request: Request): boolean {
  const requiredToken = process.env.AIPANEL_WRITE_TOKEN;
  if (!requiredToken) {
    return true;
  }

  const provided = request.headers.get("x-aipanel-write-token");
  return typeof provided === "string" && provided === requiredToken;
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    return false;
  }

  return contentType.toLowerCase().includes("application/json");
}

export function guardLocalWrite(request: Request, options: GuardOptions = {}): Response | null {
  const method = request.method.trim().toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return null;
  }

  if (!hasValidFetchSite(request)) {
    return forbidden();
  }

  if (!isAllowedOrigin(request)) {
    return forbidden();
  }

  if (!hasValidWriteToken(request)) {
    return unauthorized();
  }

  if (options.requireJson && !hasJsonContentType(request)) {
    return unsupportedMediaType();
  }

  return null;
}
