import type { NextRequest } from "next/server";

/**
 * Same-origin reverse proxy for the FastAPI backend.
 *
 * Why this exists: the web and api App Services in Azure live on different
 * *.azurewebsites.net subdomains, which are different *sites* per the Public
 * Suffix List (not just different origins). Browsers therefore treat every
 * browser -> api fetch() as cross-site, which means:
 *   - SameSite=Lax session cookies are never sent on those calls, and
 *   - even SameSite=None cookies can be silently dropped by browsers/
 *     extensions that block third-party cookies (Safari ITP, Firefox
 *     Enhanced Tracking Protection, Brave, corporate Chrome policies, ...),
 *     independent of the SameSite attribute.
 *
 * Routing every browser call through this same-origin route handler instead
 * (browser -> web app -> this proxy -> api app) makes the session cookie a
 * genuine first-party cookie of the web app's own origin, which sidesteps
 * both problems entirely and works uniformly in every deployment (Azure,
 * docker-compose, local dev) as long as API_BASE_URL points the running web
 * server at the api's origin (reachable from the *server*, not the browser).
 */

export const dynamic = "force-dynamic";

// Headers that must not be blindly forwarded in either direction: they are
// either connection-scoped (meaningless/harmful to replay on a new
// connection) or would otherwise cause the outbound fetch/response to
// disagree with its own recomputed values.
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function getProxyTarget(): string {
  const target = process.env.API_BASE_URL;
  if (!target) {
    throw new Error(
      "API_BASE_URL is not configured; the /api-proxy route cannot reach the backend.",
    );
  }
  return target.replace(/\/$/, "");
}

function filteredHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  return headers;
}

async function proxy(request: NextRequest, path: string[]): Promise<Response> {
  const targetUrl = `${getProxyTarget()}/${path.join("/")}${request.nextUrl.search}`;
  const hasBody = !["GET", "HEAD"].includes(request.method);

  const backendResponse = await fetch(targetUrl, {
    method: request.method,
    headers: filteredHeaders(request.headers),
    body: hasBody ? request.body : undefined,
    redirect: "manual",
    // Node's undici fetch requires this when streaming a request body.
    ...(hasBody ? { duplex: "half" as const } : {}),
  });

  const responseHeaders = filteredHeaders(backendResponse.headers);
  responseHeaders.delete("set-cookie");

  // Headers.forEach()/for-of coalesce repeated Set-Cookie headers into a
  // single comma-joined value, which is invalid for cookies (commas appear
  // inside Expires=). getSetCookie() preserves them as a distinct array, and
  // Headers.append() re-emits each one as its own header line.
  for (const cookie of backendResponse.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    statusText: backendResponse.statusText,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxy(request, path);
}

export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
