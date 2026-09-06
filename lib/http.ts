import { isAllowedOrigin } from "./auth";

function securityHeaders(): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(self)",
    "content-security-policy": "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; connect-src 'self' https:; frame-src 'self' https:; font-src 'self' data: https:; form-action 'self' https://accounts.google.com",
    "cache-control": "no-store",
  };
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = origin && isAllowedOrigin(request, origin) ? origin : undefined;
  return {
    "content-type": "application/json",
    ...(allowed ? { "access-control-allow-origin": allowed } : {}),
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
    ...securityHeaders(),
  };
}

export function jsonResponse(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request) });
}

export function preflight(request: Request): Response {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(request, origin)) return new Response(null, { status: 403, headers: securityHeaders() });
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function sameOrigin(request: Request): boolean {
  return isAllowedOrigin(request, request.headers.get("origin"));
}

export async function safeHandler(request: Request, tag: string, run: () => Promise<Response>): Promise<Response> {
  try { return await run(); }
  catch (error) {
    console.error(`[${tag}] unhandled error`, error instanceof Error ? error.name : "unknown");
    return jsonResponse(request, { ok: false, error: "server_error" }, 500);
  }
}
