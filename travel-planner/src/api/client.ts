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
  return window.fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });
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
