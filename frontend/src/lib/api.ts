// ============================================================
// API Client — Kommunikation mit dem Dashboard-Backend
// ============================================================
// Alle Requests gehen an /api/* und werden vom Backend
// zum OpenClaw Gateway weitergeleitet.
// ============================================================

const BASE = "/api";

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "same-origin",
  });

  if (res.status === 401) {
    // Session abgelaufen — Event auslösen
    window.dispatchEvent(new CustomEvent("oc:auth:expired"));
    throw new ApiError("Nicht authentifiziert", 401);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error || res.statusText, res.status);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("json")) {
    return res.json();
  }
  return res.text() as any;
}

// ── Auth ──────────────────────────────────────────────────
export const auth = {
  login: (secret: string) =>
    request<{ ok: boolean; expiresIn: number }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),

  logout: () =>
    request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  check: () =>
    request<{ authenticated: boolean }>("/auth/check"),
};

// ── Health ────────────────────────────────────────────────
export const health = {
  dashboard: () =>
    request<{
      status: string;
      gateway: string;
      version: string;
      uptime: number;
    }>("/health"),
};

// ── Gateway ───────────────────────────────────────────────
export const gateway = {
  status: () => request("/gateway/status"),
};

// ── Sessions ──────────────────────────────────────────────
export const sessions = {
  list: () => request("/sessions"),
  get: (id: string) => request(`/sessions/${id}`),
};

// ── Config ────────────────────────────────────────────────
export const config = {
  get: () => request("/config"),
  update: (data: any) =>
    request("/config", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ── Memory ────────────────────────────────────────────────
export const memory = {
  list: () => request("/memory"),
  getFile: (filename: string) =>
    request<{ filename: string; content: string }>(`/memory/files/${filename}`),
  updateFile: (filename: string, content: string) =>
    request(`/memory/files/${filename}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
};

// ── Agents ────────────────────────────────────────────────
export const agents = {
  list: () => request("/agents"),
};

// ── Cron Jobs ─────────────────────────────────────────────
export const cron = {
  list: () => request("/cron"),
  create: (data: any) =>
    request("/cron", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request(`/cron/${id}`, { method: "DELETE" }),
};

// ── Events ────────────────────────────────────────────────
export const events = {
  list: () => request("/events"),
};

// ── Approvals ─────────────────────────────────────────────
export const approvals = {
  list: () => request("/approvals"),
  respond: (id: string, action: "approve" | "deny") =>
    request(`/approvals/${id}`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),
};

export const api = {
  auth,
  health,
  gateway,
  sessions,
  config,
  memory,
  agents,
  cron,
  events,
  approvals,
};

export default api;
