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
    // Include detail if available (e.g., from gateway proxy errors)
    const message = body.detail 
      ? `${body.error}: ${body.detail}`
      : (body.error || res.statusText);
    throw new ApiError(message, res.status);
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
  restart: (reason?: string) =>
    request<{ ok: boolean }>("/gateway/restart", {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
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

// ── Auth Profiles ─────────────────────────────────────────
export const authProfiles = {
  get: () => request<{ ok: boolean; profiles: Record<string, any>; path: string }>("/auth-profiles"),
  update: (profiles: Record<string, any>) =>
    request("/auth-profiles", {
      method: "PUT",
      body: JSON.stringify({ profiles }),
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
  // Memory Folder (memory/*.md)
  listFolder: () =>
    request<{ files: { name: string; size: number }[] }>("/memory/folder"),
  getFolderFile: (filename: string) =>
    request<{ filename: string; content: string }>(`/memory/folder/${filename}`),
  updateFolderFile: (filename: string, content: string) =>
    request(`/memory/folder/${filename}`, {
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

// ── Jobs (Dashboard Job Queue) ────────────────────────────
export interface JobData {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  status?: "backlog" | "queued" | "running" | "done" | "failed";
  scheduledAt?: string | null;
  agent?: string;
  channel?: string;
}

export interface JobClarification {
  question: string;
  answer: string;
  timestamp: string;
}

export interface Job extends JobData {
  id: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  error?: string | null;
  result?: string | null;
  resultUrl?: string | null;
  estimatedTokens?: number | null;
  clarifications?: JobClarification[];
  history: Array<{
    timestamp: string;
    status: string;
    message?: string;
  }>;
}

export interface JobsResponse {
  jobs: Job[];
  stats: {
    total: number;
    byStatus: Record<string, number>;
    queueLength: number;
    isRunning: boolean;
    runningJobId: string | null;
  };
}

export const jobs = {
  list: (filter?: { status?: string; priority?: string }) => {
    const params = new URLSearchParams();
    if (filter?.status) params.set("status", filter.status);
    if (filter?.priority) params.set("priority", filter.priority);
    const query = params.toString();
    return request<JobsResponse>(`/jobs${query ? `?${query}` : ""}`);
  },
  
  get: (id: string) => request<Job>(`/jobs/${id}`),
  
  create: (data: JobData) =>
    request<Job>("/jobs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  
  update: (id: string, data: Partial<JobData>) =>
    request<Job>(`/jobs/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  
  delete: (id: string) =>
    request<{ success: boolean }>(`/jobs/${id}`, { method: "DELETE" }),
  
  move: (id: string, status: string) =>
    request<Job>(`/jobs/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  
  clarify: (id: string, context: string) =>
    request<Job>(`/jobs/${id}/clarify`, {
      method: "POST",
      body: JSON.stringify({ context }),
    }),
  
  getResult: (id: string) =>
    request<string>(`/jobs/${id}/result`),
  
  queueStatus: () =>
    request<{
      total: number;
      byStatus: Record<string, number>;
      queueLength: number;
      isRunning: boolean;
      runningJobId: string | null;
      nextJobId: string | null;
      nextJobTitle: string | null;
    }>("/jobs/queue/status"),
};

// ── Templates (Job Vorlagen) ──────────────────────────────
export interface TemplateData {
  name: string;
  icon?: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
  category?: string;
  channel?: string;
}

export interface Template extends TemplateData {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplatesResponse {
  templates: Template[];
  stats: {
    total: number;
    categories: string[];
  };
}

export const templates = {
  list: (filter?: { category?: string }) => {
    const params = new URLSearchParams();
    if (filter?.category) params.set("category", filter.category);
    const query = params.toString();
    return request<TemplatesResponse>(`/templates${query ? `?${query}` : ""}`);
  },
  
  get: (id: string) => request<Template>(`/templates/${id}`),
  
  create: (data: TemplateData) =>
    request<Template>("/templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  
  update: (id: string, data: Partial<TemplateData>) =>
    request<Template>(`/templates/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  
  delete: (id: string) =>
    request<{ success: boolean }>(`/templates/${id}`, { method: "DELETE" }),
  
  run: (id: string) =>
    request<{ job: Job; template: Template }>(`/templates/${id}/run`, {
      method: "POST",
    }),
  
  categories: () =>
    request<{ categories: string[] }>("/templates/categories"),
};

export const api = {
  auth,
  health,
  gateway,
  sessions,
  config,
  authProfiles,
  memory,
  agents,
  cron,
  events,
  approvals,
  jobs,
  templates,
};

export default api;
