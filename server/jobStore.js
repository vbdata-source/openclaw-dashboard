// ============================================================
// OpenClaw Dashboard — Job Store (MVP)
// ============================================================
// Datei-basierte Persistenz für Jobs
// Später ersetzbar durch DB (SQLite, MongoDB, etc.)
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Im Docker: /app/data (außerhalb server/, mit korrekten Permissions)
const DATA_DIR = process.env.JOB_DATA_DIR || "/app/data";
const JOBS_FILE = join(DATA_DIR, "jobs.json");
const RESULTS_DIR = join(DATA_DIR, "results");

// ── Ensure directories exist ──────────────────────────────
function ensureDirs() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

// ── Load/Save helpers ─────────────────────────────────────
function loadJobs() {
  ensureDirs();
  if (!existsSync(JOBS_FILE)) {
    return [];
  }
  try {
    const data = readFileSync(JOBS_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error("[JobStore] Error loading jobs:", err.message);
    return [];
  }
}

function saveJobs(jobs) {
  ensureDirs();
  try {
    writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2), "utf-8");
  } catch (err) {
    console.error("[JobStore] Error saving jobs:", err.message);
    throw err;
  }
}

// ── Job Status Types ──────────────────────────────────────
export const JobStatus = {
  BACKLOG: "backlog",
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
};

export const JobPriority = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

// ── Job Store Class ───────────────────────────────────────
class JobStore {
  constructor() {
    this.jobs = loadJobs();
    this.listeners = new Set();
    this.runningJob = null;
    this.queue = [];
    
    // Restore queue from saved jobs
    this._rebuildQueue();
  }

  // ── Event System ────────────────────────────────────────
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit(event, job) {
    for (const listener of this.listeners) {
      try {
        listener(event, job);
      } catch (err) {
        console.error("[JobStore] Listener error:", err.message);
      }
    }
  }

  // ── CRUD Operations ─────────────────────────────────────
  list(filter = {}) {
    let result = [...this.jobs];
    
    if (filter.status) {
      result = result.filter(j => j.status === filter.status);
    }
    if (filter.priority) {
      result = result.filter(j => j.priority === filter.priority);
    }
    
    // Sort: by priority (critical first), then by createdAt
    const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    result.sort((a, b) => {
      const prioDiff = (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);
      if (prioDiff !== 0) return prioDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    
    return result;
  }

  get(id) {
    return this.jobs.find(j => j.id === id) || null;
  }

  create(data) {
    const now = new Date().toISOString();
    const job = {
      id: randomUUID(),
      title: data.title || "Untitled Job",
      description: data.description || "",
      status: data.status || JobStatus.BACKLOG,
      priority: data.priority || JobPriority.MEDIUM,
      agent: data.agent || "main",
      channel: data.channel || null,
      createdAt: now,
      updatedAt: now,
      scheduledAt: data.scheduledAt || null,
      finishedAt: null,
      error: null,
      result: null,
      resultUrl: null,
      estimatedTokens: data.estimatedTokens || null,
      history: [
        { timestamp: now, status: data.status || JobStatus.BACKLOG, message: "Job erstellt" }
      ],
    };

    this.jobs.push(job);
    saveJobs(this.jobs);
    this._emit("job.created", job);
    
    // If created as queued, add to queue
    if (job.status === JobStatus.QUEUED) {
      this._addToQueue(job);
    }
    
    return job;
  }

  update(id, updates) {
    const index = this.jobs.findIndex(j => j.id === id);
    if (index === -1) {
      throw new Error(`Job ${id} not found`);
    }

    const job = this.jobs[index];
    const oldStatus = job.status;
    const now = new Date().toISOString();

    // Apply updates
    const allowedFields = ["title", "description", "priority", "status", "scheduledAt", "error", "result"];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        job[field] = updates[field];
      }
    }
    job.updatedAt = now;

    // Track status changes in history
    if (updates.status && updates.status !== oldStatus) {
      job.history.push({
        timestamp: now,
        status: updates.status,
        message: updates.historyMessage || `Status: ${oldStatus} → ${updates.status}`,
      });

      // Handle status transitions
      if (updates.status === JobStatus.DONE || updates.status === JobStatus.FAILED) {
        job.finishedAt = now;
      }
      
      // Clear error when restarting job
      if (updates.status === JobStatus.QUEUED || updates.status === JobStatus.RUNNING) {
        job.error = null;
        job.finishedAt = null;
      }
      
      // Queue management
      if (updates.status === JobStatus.QUEUED && oldStatus !== JobStatus.QUEUED) {
        this._addToQueue(job);
      }
      if (oldStatus === JobStatus.QUEUED && updates.status !== JobStatus.QUEUED) {
        this._removeFromQueue(job.id);
      }
      if (updates.status === JobStatus.RUNNING) {
        this.runningJob = job.id;
      }
      if (oldStatus === JobStatus.RUNNING) {
        this.runningJob = null;
        this._processNextInQueue();
      }
    }

    this.jobs[index] = job;
    saveJobs(this.jobs);
    this._emit("job.updated", job);
    
    return job;
  }

  delete(id) {
    const index = this.jobs.findIndex(j => j.id === id);
    if (index === -1) {
      throw new Error(`Job ${id} not found`);
    }

    const job = this.jobs[index];
    this.jobs.splice(index, 1);
    this._removeFromQueue(id);
    saveJobs(this.jobs);
    this._emit("job.deleted", { id });
    
    return job;
  }

  // ── Queue Management ────────────────────────────────────
  _rebuildQueue() {
    this.queue = this.jobs
      .filter(j => j.status === JobStatus.QUEUED)
      .sort((a, b) => {
        // Immediate jobs first (no scheduledAt or scheduledAt in past)
        const aImmediate = !a.scheduledAt || new Date(a.scheduledAt) <= new Date();
        const bImmediate = !b.scheduledAt || new Date(b.scheduledAt) <= new Date();
        if (aImmediate && !bImmediate) return -1;
        if (!aImmediate && bImmediate) return 1;
        
        // Then by priority
        const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const prioDiff = (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);
        if (prioDiff !== 0) return prioDiff;
        
        // Then by creation time
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      })
      .map(j => j.id);
    
    // Check for running job
    const running = this.jobs.find(j => j.status === JobStatus.RUNNING);
    this.runningJob = running?.id || null;
  }

  _addToQueue(job) {
    if (!this.queue.includes(job.id)) {
      this.queue.push(job.id);
      this._sortQueue();
    }
  }

  _removeFromQueue(id) {
    this.queue = this.queue.filter(qid => qid !== id);
  }

  _sortQueue() {
    this.queue.sort((aId, bId) => {
      const a = this.get(aId);
      const b = this.get(bId);
      if (!a || !b) return 0;
      
      const prioOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const prioDiff = (prioOrder[a.priority] || 2) - (prioOrder[b.priority] || 2);
      if (prioDiff !== 0) return prioDiff;
      
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  getNextInQueue() {
    if (this.runningJob) return null;
    
    for (const id of this.queue) {
      const job = this.get(id);
      if (!job) continue;
      
      // Check if scheduled time has passed
      if (job.scheduledAt && new Date(job.scheduledAt) > new Date()) {
        continue;
      }
      
      return job;
    }
    return null;
  }

  _processNextInQueue() {
    // This will be called by the job executor
    // Just emit an event that the queue should be checked
    this._emit("queue.ready", null);
  }

  // ── Result Storage ──────────────────────────────────────
  saveResult(jobId, content) {
    ensureDirs();
    const resultFile = join(RESULTS_DIR, `${jobId}.txt`);
    writeFileSync(resultFile, content, "utf-8");
    
    const job = this.get(jobId);
    if (job) {
      this.update(jobId, { resultUrl: `/api/jobs/${jobId}/result` });
    }
    
    return resultFile;
  }

  getResult(jobId) {
    const resultFile = join(RESULTS_DIR, `${jobId}.txt`);
    if (!existsSync(resultFile)) {
      return null;
    }
    return readFileSync(resultFile, "utf-8");
  }

  // ── Stats ───────────────────────────────────────────────
  getStats() {
    const stats = {
      total: this.jobs.length,
      byStatus: {},
      queueLength: this.queue.length,
      isRunning: this.runningJob !== null,
      runningJobId: this.runningJob,
    };
    
    for (const status of Object.values(JobStatus)) {
      stats.byStatus[status] = this.jobs.filter(j => j.status === status).length;
    }
    
    return stats;
  }
}

// ── Singleton Export ──────────────────────────────────────
export const jobStore = new JobStore();
export default jobStore;
