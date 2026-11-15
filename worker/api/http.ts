const JSON_CT = "application/json; charset=utf-8";

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", JSON_CT);
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, _hint?: string): Response {
  const body = status === 401 ? { error: "Unauthorized" } : status === 403 ? { error: "Forbidden" } : { error: "Request failed" };
  return jsonResponse(body, { status });
}

export function etagForVersion(version: number): string {
  return `"city-v${version}"`;
}

export function requireJsonContentType(request: Request): boolean {
  const ct = request.headers.get("Content-Type") || "";
  return ct.toLowerCase().startsWith("application/json");
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const len = Number(request.headers.get("Content-Length") || "0");
  if (len > maxBytes) throw new BodyTooLargeError();
  const text = await request.text();
  if (text.length > maxBytes) throw new BodyTooLargeError();
  return JSON.parse(text);
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("body too large");
    this.name = "BodyTooLargeError";
  }
}