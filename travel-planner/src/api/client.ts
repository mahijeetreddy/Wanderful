import { registerRequest, sessionEpoch } from "../features/auth/session";
let needsValidation = !navigator.onLine;
window.addEventListener("offline", () => { needsValidation = true; });

export class ApiError extends Error {
  status: number;
  correlationId: string;

  constructor(message: string, status: number, correlationId = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.correlationId = correlationId;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const epoch = sessionEpoch();
  if (!["GET", "HEAD", "OPTIONS"].includes((init.method || "GET").toUpperCase()) && !path.startsWith("/api/auth/")) {
    if (!navigator.onLine) throw new ApiError("Reconnect before editing. Offline plans are read-only.", 0);
    if (needsValidation) {
      const validation = await apiFetch("/api/auth/me");
      const session = await readApiJson<{ user?: { status?: string } | null }>(validation);
      if (!session.user || session.user.status !== "active") throw new ApiError("Sign in again before editing this trip.", 401);
      if (epoch !== sessionEpoch()) throw new DOMException("Session changed", "AbortError");
      needsValidation = false;
    }
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  const unregister = registerRequest(controller);
  const cleanup = () => { unregister(); init.signal?.removeEventListener("abort", abort); };
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  headers.set("X-Correlation-ID", crypto.randomUUID());
  const method = (init.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("wanderful_csrf");
    if (csrf) {
      headers.set("X-CSRF-Token", csrf);
    }
  }
  if (path === "/api/plan-jobs" && method === "POST" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", crypto.randomUUID());
  }
  try {
  const response = await window.fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    signal: controller.signal,
  });
  const text = response.text.bind(response);
  response.text = async () => {
    try {
      const result = await text();
      if (epoch !== sessionEpoch() || controller.signal.aborted) throw new DOMException("Session changed", "AbortError");
      return result;
    } finally { cleanup(); }
  };
  response.json = async () => JSON.parse(await response.text());
  const blob = response.blob.bind(response);
  response.blob = async () => {
    try {
      const result = await blob();
      if (epoch !== sessionEpoch() || controller.signal.aborted) throw new DOMException("Session changed", "AbortError");
      return result;
    } finally { cleanup(); }
  };
  if (epoch !== sessionEpoch()) throw new DOMException("Session changed", "AbortError");
  return response;
  } catch (error) { cleanup(); throw error; }
}

export async function readApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const correlationId = response.headers.get("X-Correlation-ID") || "";
  if (!text.trim()) {
    throw new ApiError("API returned an empty response.", response.status, correlationId);
  }
  let payload: T & { error?: string; correlation_id?: string };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiError(
      "API returned HTML or invalid JSON. Verify the backend deployment and API proxy.",
      response.status,
      correlationId,
    );
  }
  if (!response.ok) {
    throw new ApiError(
      payload.error || "API request failed.",
      response.status,
      payload.correlation_id || correlationId,
    );
  }
  return payload;
}

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie.split("; ").find((entry) => entry.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : "";
}
