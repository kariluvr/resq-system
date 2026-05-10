const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const mongoose = require("mongoose");
const Report = require("./models/Report");
const RiskReport = require("./models/RiskReport");
const News = require("./models/News");
const { Admin, Resident, AppSettings, AuditLog, Notification } = require("./models/models");

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(cors((req, callback) => {
  callback(null, {
    origin(origin, originCallback) {
      const allowed = (process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);

      if (!origin || allowed.length === 0 || allowed.includes(origin) || allowed.includes("*")) {
        return originCallback(null, true);
      }

      try {
        const originUrl = new URL(origin);
        const requestHost = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
        const requestProto = (req.get("x-forwarded-proto") || req.protocol || "").split(",")[0].trim();

        if (requestHost && originUrl.host === requestHost && originUrl.protocol === `${requestProto}:`) {
          return originCallback(null, true);
        }
      } catch {
        // Let the explicit deny below handle invalid origins.
      }

      originCallback(new Error("Origin not allowed"));
    }
  });
}));

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Try again later." }
});

const apiLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Try again later." }
});

const SECRET = process.env.JWT_SECRET || "resq-secret";
const PORT = process.env.PORT || 5000;
const ML_API_URL = (process.env.ML_API_URL || "").trim().replace(/\/+$/, "");
const ROOT_DIR = path.join(__dirname, "..");
const DATA_FILE = path.join(__dirname, "data.json");
const UPLOAD_DIR = process.env.UPLOAD_DIR || (
  process.env.VERCEL ? path.join("/tmp", "resq-uploads") : path.join(__dirname, "uploads")
);
const NEWS_UPLOAD_DIR = process.env.NEWS_UPLOAD_DIR || path.join(UPLOAD_DIR, "news");
const ADMIN_NAME = process.env.DEFAULT_ADMIN_NAME || "Admin User";
const DEFAULT_REPORT_LAT = Number(process.env.DEFAULT_REPORT_LAT || 13.2233);
const DEFAULT_REPORT_LNG = Number(process.env.DEFAULT_REPORT_LNG || 120.5960);
const SUPABASE_REPORTS_TABLE = process.env.SUPABASE_REPORTS_TABLE || "reports";
const SUPABASE_REPORT_SYNC_LIMIT = Number(process.env.SUPABASE_REPORT_SYNC_LIMIT || 100);
const SUPABASE_REPORT_SYNC_INTERVAL_MS = Number(process.env.SUPABASE_REPORT_SYNC_INTERVAL_MS || 30000);

let lastSupabaseReportSync = 0;
let supabaseReportSyncRunning = null;
let lastDatabaseFailure = 0;

class DeploymentConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "DeploymentConfigError";
    this.statusCode = 503;
    this.publicMessage = message;
  }
}

class DatabaseConnectionError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatabaseConnectionError";
    this.statusCode = 503;
    this.publicMessage = "Database connection failed. Check MONGO_URI and MongoDB Atlas Network Access in Vercel.";
  }
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(NEWS_UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      callback(null, UPLOAD_DIR);
    },
    filename(req, file, callback) {
      const ext = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4"];
    callback(null, allowed.includes(file.mimetype));
  }
});

const newsUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      callback(null, NEWS_UPLOAD_DIR);
    },
    filename(req, file, callback) {
      const ext = path.extname(file.originalname).toLowerCase();
      callback(null, `news-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    callback(null, allowed.includes(file.mimetype));
  }
});

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function publicAdmin(admin) {
  const plain = typeof admin.toJSON === "function" ? admin.toJSON() : admin;
  return {
    id: plain.id,
    email: plain.email,
    username: plain.username,
    name: plain.name,
    role: plain.role
  };
}

async function addAudit(action, target, details = {}, by = ADMIN_NAME) {
  await AuditLog.create({
    action,
    target,
    details,
    by
  });
}

async function notify(title, message, kind = "info", refType = "", refId = "") {
  await Notification.create({ title, message, kind, refType, refId });
}

function reportSummary(reports) {
  return reports.reduce((summary, report) => {
    summary.total += 1;
    summary[report.status] = (summary[report.status] || 0) + 1;
    if (report.priority === "critical") summary.critical += 1;
    return summary;
  }, {
    total: 0,
    received: 0,
    verified: 0,
    dispatched: 0,
    on_scene: 0,
    resolved: 0,
    false_report: 0,
    critical: 0
  });
}

function userSummary(residents) {
  return residents.reduce((summary, resident) => {
    summary.total += 1;
    summary[resident.status] = (summary[resident.status] || 0) + 1;
    return summary;
  }, {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0
  });
}

function labelStatus(status = "") {
  return status.replaceAll("_", " ");
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function reportIdQuery(id) {
  if (mongoose.Types.ObjectId.isValid(id)) return { _id: id };
  const legacyId = Number(id);
  if (Number.isInteger(legacyId)) return { legacyId };
  return { _id: null };
}

async function findReport(id) {
  return Report.findOne(reportIdQuery(id));
}

async function nextLegacyReportId() {
  const report = await Report.findOne({ legacyId: { $type: "number" } }).sort({ legacyId: -1 });
  return (report?.legacyId || 0) + 1;
}

function normalizeReportPayload(body, existing = {}) {
  const now = new Date().toISOString();
  const lat = Number(body.lat ?? body.coordinates?.lat ?? existing.coordinates?.lat ?? DEFAULT_REPORT_LAT);
  const lng = Number(body.lng ?? body.coordinates?.lng ?? existing.coordinates?.lng ?? DEFAULT_REPORT_LNG);
  const assignedTo = cleanText(body.assignedTo ?? existing.assignedTo ?? "", 120);
  const responder = cleanText(body.responder ?? existing.dispatch?.responder ?? "", 120);
  const etaMinutes = Number(body.etaMinutes ?? existing.dispatch?.etaMinutes ?? 10);

  return {
    type: cleanText(body.type ?? existing.type ?? "OTHER", 40).toUpperCase(),
    title: cleanText(body.title ?? existing.title, 160),
    status: body.status ?? existing.status ?? "received",
    priority: cleanText(body.priority ?? existing.priority ?? "medium", 40).toLowerCase(),
    reporter: cleanText(body.reporter ?? existing.reporter, 120),
    mobile: cleanText(body.mobile ?? existing.mobile ?? "", 40),
    location: cleanText(body.location ?? existing.location, 200),
    coordinates: {
      lat: Number.isFinite(lat) ? lat : DEFAULT_REPORT_LAT,
      lng: Number.isFinite(lng) ? lng : DEFAULT_REPORT_LNG
    },
    description: cleanText(body.description ?? existing.description, 2000),
    assignedTo,
    evidence: body.evidence ?? existing.evidence ?? [],
    dispatch: {
      unit: assignedTo,
      responder,
      etaMinutes: Number.isFinite(etaMinutes) ? etaMinutes : undefined,
      lastUpdatedAt: now
    }
  };
}

function requireFields(body, fields) {
  const missing = fields.filter(field => !String(body[field] || "").trim());
  return missing.length ? `${missing.join(", ")} required` : null;
}

function cleanText(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePhoneNumber(value) {
  return String(value || "").replace(/[^0-9+]/g, "").trim();
}

async function sendSmsMessage(to, message) {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM;
  const smsApiUrl = process.env.SMS_API_URL;
  const smsApiKey = process.env.SMS_API_KEY;

  if (twilioAccountSid && twilioAuthToken && twilioFrom) {
    const body = new URLSearchParams({
      To: to,
      From: twilioFrom,
      Body: message
    });
    const auth = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Twilio SMS send failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  if (smsApiUrl) {
    const response = await fetch(smsApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(smsApiKey ? { Authorization: `Bearer ${smsApiKey}` } : {})
      },
      body: JSON.stringify({ to, message })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS provider failed: ${response.status} ${errorText}`);
    }

    return await response.json();
  }

  throw new Error("SMS provider is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM or SMS_API_URL.");
}

function validUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const NEWS_CATEGORIES = ["Emergency", "Weather", "Advisory", "Missing Person", "Disaster Alert", "General News"];
const NEWS_PRIORITIES = ["Low", "Moderate", "High", "Emergency"];

function normalizeNewsValue(value, allowed, fallback) {
  const incoming = cleanText(value, 80).toLowerCase();
  return allowed.find(item => item.toLowerCase() === incoming) || fallback;
}

function publicNewsQuery(query = {}) {
  const filter = { archived: false };
  if (query.category && query.category !== "all") {
    filter.category = normalizeNewsValue(query.category, NEWS_CATEGORIES, query.category);
  }
  if (query.priority && query.priority !== "all") {
    filter.priority = normalizeNewsValue(query.priority, NEWS_PRIORITIES, query.priority);
  }
  if (query.targetAudience) {
    filter.targetAudience = { $in: ["All residents", cleanText(query.targetAudience, 120)] };
  }
  return filter;
}

function normalizeNewsPayload(body, file, existing = {}) {
  const title = cleanText(body.title ?? existing.title, 180);
  const message = cleanText(body.message ?? existing.message, 5000);
  const publishedAt = body.publishedAt || body.publishDateTime || existing.publishedAt || new Date();

  return {
    title,
    message,
    imageUrl: file ? `/uploads/news/${file.filename}` : cleanText(body.imageUrl ?? existing.imageUrl ?? "", 500),
    category: normalizeNewsValue(body.category ?? existing.category, NEWS_CATEGORIES, "General News"),
    priority: normalizeNewsValue(body.priority ?? existing.priority, NEWS_PRIORITIES, "Low"),
    createdBy: cleanText(body.createdBy ?? existing.createdBy ?? ADMIN_NAME, 120),
    publishedAt: new Date(publishedAt).toString() === "Invalid Date" ? new Date() : new Date(publishedAt),
    archived: String(body.archived ?? existing.archived ?? "false") === "true",
    targetAudience: cleanText(body.targetAudience ?? existing.targetAudience ?? "All residents", 120),
    pinned: String(body.pinned ?? existing.pinned ?? "false") === "true"
  };
}

function buildNewsNotificationPayload(news) {
  const kindByCategory = {
    Emergency: "emergency_alert",
    "Disaster Alert": "disaster_warning",
    Advisory: "advisory"
  };

  const type = news.priority === "Emergency"
    ? "emergency_alert"
    : kindByCategory[news.category] || "general";

  return {
    type,
    channel: "in_app",
    fcmReady: true,
    payload: {
      topic: "resq_announcements",
      title: news.title,
      body: news.message,
      imageUrl: news.imageUrl || "",
      data: {
        newsId: String(news.id || news._id || ""),
        category: news.category,
        priority: news.priority,
        targetAudience: news.targetAudience,
        pinned: String(Boolean(news.pinned))
      }
    },
    preparedAt: new Date().toISOString()
  };
}

async function sendSemaphoreMessage(to, message) {
  const apiKey = process.env.SEMAPHORE_API_KEY;
  if (!apiKey) throw new Error("SEMAPHORE_API_KEY is not configured.");

  const body = new URLSearchParams({
    apikey: apiKey,
    number: to,
    message,
    ...(process.env.SEMAPHORE_SENDER_NAME ? { sendername: process.env.SEMAPHORE_SENDER_NAME } : {})
  });

  const response = await fetch(process.env.SEMAPHORE_API_URL || "https://api.semaphore.co/api/v4/messages", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Semaphore SMS failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

async function triggerEmergencyNewsSms(news) {
  if (news.priority !== "Emergency" || process.env.NEWS_SMS_ENABLED !== "true") {
    return { attempted: false, sent: 0, failed: 0, provider: "semaphore" };
  }

  const recipients = await Resident.find({
    status: { $in: ["approved", "verified"] },
    mobile: { $exists: true, $ne: "" }
  }).lean();

  const message = `[ResQ Emergency] ${news.title}: ${news.message}`.slice(0, 1000);
  const results = await Promise.allSettled(recipients.map(recipient => {
    const to = normalizePhoneNumber(recipient.mobile);
    if (!to) throw new Error(`Invalid mobile number for ${recipient.fullName || "resident"}`);
    return sendSemaphoreMessage(to, message);
  }));

  const sent = results.filter(item => item.status === "fulfilled").length;
  const failed = results.length - sent;
  const firstError = results.find(item => item.status === "rejected")?.reason?.message || "";

  return { attempted: true, sent, failed, provider: "semaphore", lastError: firstError };
}

function asClientNews(news) {
  const plain = typeof news?.toJSON === "function" ? news.toJSON() : { ...news };
  plain.id = plain.id || plain._id?.toString?.();
  delete plain._id;
  delete plain.__v;
  return plain;
}

function firstValue(source, fields, fallback = "") {
  for (const field of fields) {
    const value = source?.[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function normalizePriority(value) {
  const priority = cleanText(value || "medium", 40).toLowerCase();
  return ["critical", "high", "medium", "low"].includes(priority) ? priority : "medium";
}

function normalizeStatus(value) {
  const status = cleanText(value || "received", 40).toLowerCase();
  return ["received", "verified", "dispatched", "on_scene", "resolved", "false_report"].includes(status)
    ? status
    : "received";
}

function normalizeEvidence(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === "string" ? { kind: "link", label: "Evidence", url: item } : item)
      .filter(item => validUrl(item?.url || ""));
  }

  if (validUrl(value || "")) {
    return [{ kind: "link", label: "Evidence", url: cleanText(value, 500) }];
  }

  return [];
}

function normalizeSupabaseReport(row) {
  const externalId = cleanText(firstValue(row, ["id", "report_id", "uuid"]), 120);
  if (!externalId) return null;

  const submittedAt = firstValue(row, ["submitted_at", "created_at", "reported_at", "timestamp"], new Date().toISOString());
  const lat = Number(firstValue(row, ["lat", "latitude"], DEFAULT_REPORT_LAT));
  const lng = Number(firstValue(row, ["lng", "longitude", "lon"], DEFAULT_REPORT_LNG));
  const title = cleanText(firstValue(row, ["title", "incident_title"], ""), 160);
  const type = cleanText(firstValue(row, ["type", "incident_type", "emergency_type", "category"], "OTHER"), 40).toUpperCase();
  const barangay = cleanText(firstValue(row, ["barangay", "barangay_name"], ""), 120);
  const address = cleanText(firstValue(row, ["location", "address", "place"], ""), 200);
  const reporter = cleanText(firstValue(row, ["reporter", "reporter_name", "full_name", "name"], "Resident"), 120);
  const description = cleanText(firstValue(row, ["description", "details", "message", "notes"], ""), 2000);
  const evidence = normalizeEvidence(firstValue(row, ["evidence", "evidence_url", "photo_url", "image_url", "video_url"], ""));

  return {
    externalSource: "supabase",
    externalId,
    type,
    title: title || `${type} report from ${barangay || address || "resident"}`,
    status: normalizeStatus(row.status),
    priority: normalizePriority(row.priority || row.severity || row.risk_level),
    reporter,
    reporterId: cleanText(firstValue(row, ["user_id", "resident_id", "reporter_id"], ""), 120),
    mobile: cleanText(firstValue(row, ["mobile", "phone", "contact", "contact_number"], ""), 40),
    location: address || barangay || "Location not provided",
    coordinates: {
      lat: Number.isFinite(lat) ? lat : DEFAULT_REPORT_LAT,
      lng: Number.isFinite(lng) ? lng : DEFAULT_REPORT_LNG
    },
    description: description || "No description provided.",
    submittedAt: new Date(submittedAt).toString() === "Invalid Date" ? new Date().toISOString() : new Date(submittedAt).toISOString(),
    evidence,
    assignedTo: cleanText(firstValue(row, ["assigned_to", "assignedTo"], ""), 120),
    dispatch: {
      unit: cleanText(firstValue(row, ["assigned_to", "assignedTo"], ""), 120),
      responder: cleanText(firstValue(row, ["responder"], ""), 120),
      lastUpdatedAt: new Date().toISOString()
    }
  };
}

function asClientReport(report) {
  const plain = typeof report?.toJSON === "function" ? report.toJSON() : { ...report };
  plain.id = plain.id || plain.externalId || plain._id?.toString?.() || String(Date.now());
  delete plain._id;
  delete plain.__v;
  return plain;
}

async function supabaseReportsFallback() {
  try {
    const rows = await fetchSupabaseReports();
    return rows
      .map(normalizeSupabaseReport)
      .filter(Boolean)
      .map(asClientReport)
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  } catch (error) {
    console.error("Supabase reports fallback failed:", error.message);
    return [];
  }
}

async function getReportsForDashboard() {
  try {
    await connectDatabase();
    await syncSupabaseReports();
    return (await Report.find().sort({ submittedAt: -1 })).map(asClientReport);
  } catch {
    return await supabaseReportsFallback();
  }
}

function defaultSettingsPayload() {
  const data = readData();
  return {
    barangays: data.barangays || [],
    settings: {
      moderation: data.settings?.moderation || { keywords: [], threshold: 5 },
      reasons: data.settings?.reasons || { approval: [], rejection: [] }
    }
  };
}

function supabaseReportConfig() {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    ""
  ).replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    "";
  return { url, key, table: SUPABASE_REPORTS_TABLE };
}

function supabaseReportStatus() {
  const config = supabaseReportConfig();
  return {
    configured: Boolean(config.url && config.key),
    hasUrl: Boolean(config.url),
    hasKey: Boolean(config.key),
    table: config.table,
    syncEnabled: process.env.SUPABASE_REPORT_SYNC !== "false"
  };
}

async function fetchSupabaseReports() {
  const { url, key } = supabaseReportConfig();
  if (!url || !key || process.env.SUPABASE_REPORT_SYNC === "false") return [];

  const endpoint = new URL(`${url}/rest/v1/${encodeURIComponent(SUPABASE_REPORTS_TABLE)}`);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("limit", String(Number.isFinite(SUPABASE_REPORT_SYNC_LIMIT) ? SUPABASE_REPORT_SYNC_LIMIT : 100));
  if (process.env.SUPABASE_REPORTS_ORDER_COLUMN !== "none") {
    endpoint.searchParams.set("order", `${process.env.SUPABASE_REPORTS_ORDER_COLUMN || "created_at"}.desc`);
  }

  const response = await fetch(endpoint, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (endpoint.searchParams.has("order")) {
      endpoint.searchParams.delete("order");
      const retry = await fetch(endpoint, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json"
        }
      });

      if (retry.ok) return await retry.json();
    }

    throw new Error(`Supabase report sync failed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

async function syncSupabaseReports(force = false) {
  const now = Date.now();
  if (!force && now - lastSupabaseReportSync < SUPABASE_REPORT_SYNC_INTERVAL_MS) return { skipped: true, imported: 0 };
  if (supabaseReportSyncRunning) return supabaseReportSyncRunning;

  supabaseReportSyncRunning = (async () => {
    try {
      const rows = await fetchSupabaseReports();
      let imported = 0;

      for (const row of rows) {
        const report = normalizeSupabaseReport(row);
        if (!report) continue;

        const result = await Report.updateOne(
          { externalSource: "supabase", externalId: report.externalId },
          {
            $setOnInsert: {
              ...report,
              legacyId: await nextLegacyReportId(),
              history: [{
                status: report.status,
                note: "Report synced from Supabase.",
                at: report.submittedAt,
                by: "Supabase"
              }],
              notes: []
            }
          },
          { upsert: true }
        );

        if (result.upsertedCount) {
          imported += 1;
          await notify("New Supabase report", report.title, report.priority === "critical" ? "critical" : "report", "report", report.externalId);
        }
      }

      lastSupabaseReportSync = Date.now();
      return { skipped: false, imported };
    } catch (error) {
      console.error(error.message);
      lastSupabaseReportSync = Date.now();
      return { skipped: false, imported: 0, error: error.message };
    } finally {
      supabaseReportSyncRunning = null;
    }
  })();

  return supabaseReportSyncRunning;
}

async function buildSystemRiskReport(barangay) {
  const recentSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const reports = await Report.find({
    location: { $regex: new RegExp(escapeRegExp(barangay), "i") },
    status: { $nin: ["resolved", "false_report"] }
  }).lean();

  const recentReports = reports.filter(report => {
    const submittedAt = new Date(report.submittedAt || 0);
    return Number.isFinite(submittedAt.getTime()) && submittedAt >= recentSince;
  });

  const priorityScore = recentReports.reduce((score, report) => {
    const priority = String(report.priority || "medium").toLowerCase();
    if (priority === "critical") return score + 35;
    if (priority === "high") return score + 20;
    if (priority === "medium") return score + 10;
    return score + 5;
  }, 0);

  const riskScore = Math.min(100, priorityScore);
  const riskLevel = riskScore >= 70 ? "HIGH" : riskScore >= 30 ? "MODERATE" : "LOW";

  return {
    barangay,
    risk_level: riskLevel,
    risk_score: riskScore,
    rainfall: null,
    humidity: null,
    wind_speed: null,
    temperature: null,
    trend: recentReports.length > 0 ? "monitoring" : "stable",
    data_points: recentReports.length,
    last_updated: new Date().toISOString(),
    source: "system_reports",
    recommendations: riskLevel === "HIGH"
      ? ["Prepare evacuation support.", "Coordinate responders and barangay officials.", "Send resident advisories immediately."]
      : riskLevel === "MODERATE"
        ? ["Monitor incoming reports.", "Prepare response teams.", "Notify barangay officials to stay on standby."]
        : ["Continue routine monitoring.", "Keep emergency contacts available.", "Review barangay readiness supplies."]
  };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return res.status(401).json({ message: "Authentication required" });

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Session expired. Please log in again." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.user?.role)) return next();
    res.status(403).json({ message: "Permission denied" });
  };
}

async function seedReportsFromJson() {
  const count = await Report.countDocuments();
  if (count > 0) return;

  const data = readData();
  const reports = data.reports || [];
  if (!reports.length) return;

  await Report.insertMany(reports.map(report => ({
    legacyId: report.id,
    type: report.type,
    title: report.title,
    status: report.status || "received",
    priority: report.priority || "medium",
    reporter: report.reporter,
    reporterId: report.reporterId || report.user_id || undefined,
    mobile: report.mobile || "",
    location: report.location,
    coordinates: report.coordinates || {
      lat: DEFAULT_REPORT_LAT,
      lng: DEFAULT_REPORT_LNG
    },
    description: report.description,
    submittedAt: report.submittedAt || new Date().toISOString(),
    evidence: report.evidence || [],
    assignedTo: report.assignedTo || "",
    notes: report.notes || [],
    history: report.history || [],
    dispatch: report.dispatch || {}
  })));

  console.log(`Seeded ${reports.length} reports from data.json`);
}

async function seedCoreFromJson() {
  const data = readData();

  if (await Admin.countDocuments() === 0) {
    const admins = data.admins?.length ? data.admins : [{
      id: 1,
      email: process.env.DEFAULT_ADMIN_EMAIL || "admin@resq.com",
      username: process.env.DEFAULT_ADMIN_USERNAME || "admin",
      name: ADMIN_NAME,
      password: await bcrypt.hash(process.env.DEFAULT_ADMIN_PASSWORD || "admin", 10),
      role: "admin"
    }];

    await Admin.insertMany(admins.map(admin => ({
      legacyId: admin.id,
      email: admin.email,
      username: admin.username,
      name: admin.name,
      password: admin.password,
      role: admin.role || "admin"
    })));
  }

  if (await Resident.countDocuments() === 0) {
    await Resident.insertMany((data.residents || []).map(resident => ({
      legacyId: resident.id,
      fullName: resident.fullName,
      mobile: resident.mobile,
      submittedId: resident.submittedId,
      registeredAt: resident.registeredAt,
      status: resident.status || "pending",
      address: resident.address,
      decisions: resident.decisions || []
    })));
  }

  if (await AppSettings.countDocuments() === 0) {
    await AppSettings.create({
      key: "main",
      moderation: data.settings?.moderation || { keywords: [], threshold: 5 },
      reasons: data.settings?.reasons || { approval: [], rejection: [] },
      barangays: data.barangays || []
    });
  }
}

let databaseReady;

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return;
  if (databaseReady) return databaseReady;
  if (lastDatabaseFailure && Date.now() - lastDatabaseFailure < 30000) {
    throw new DatabaseConnectionError("Previous database connection attempt failed recently.");
  }

  if (!process.env.MONGO_URI) {
    throw new DeploymentConfigError("MONGO_URI is missing in Vercel environment variables.");
  }

  databaseReady = mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 2500),
    socketTimeoutMS: 45000
  }).then(async () => {
    lastDatabaseFailure = 0;
    console.log("MongoDB Connected");
    try {
      await seedCoreFromJson();
      await seedReportsFromJson();
    } catch (err) {
      console.error("Seed failed:", err);
    }
  }).catch(err => {
    databaseReady = null;
    lastDatabaseFailure = Date.now();
    throw new DatabaseConnectionError(err.message);
  });

  return databaseReady;
}

app.use(asyncRoute(async (req, res, next) => {
  const dbOptionalRoutes = new Set([
    "/healthz",
    "/api/deployment-check",
    "/api/login",
    "/api/dashboard",
    "/api/reports",
    "/api/reports/debug",
    "/api/reports/summary",
    "/api/settings",
    "/api/users",
    "/public/reports"
  ]);

  if (dbOptionalRoutes.has(req.path) || req.path.startsWith("/public/reports/user/")) return next();

  await connectDatabase();
  next();
}));

// ===== LOGIN =====
app.post("/api/login", loginLimit, asyncRoute(async (req, res) => {
  const { email, username, password } = req.body;
  const login = email || username;
  let admin;

  try {
    await connectDatabase();
    admin = await Admin.findOne({ $or: [{ email: login }, { username: login }] });
  } catch (error) {
    const fallbackUsername = process.env.DEFAULT_ADMIN_USERNAME || "admin";
    const fallbackEmail = process.env.DEFAULT_ADMIN_EMAIL || "admin@resq.local";
    const fallbackPassword = process.env.DEFAULT_ADMIN_PASSWORD || "admin";
    const loginMatches = login === fallbackUsername || login === fallbackEmail || login === "admin";
    const passwordMatches = password === fallbackPassword || (login === "admin" && password === "admin");

    if (loginMatches && passwordMatches) {
      const user = {
        id: "env-admin",
        email: fallbackEmail,
        username: fallbackUsername,
        name: ADMIN_NAME,
        role: "admin"
      };
      const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: "12h" });
      return res.json({ token, user, mode: "database-fallback" });
    }

    throw error;
  }

  const passwordMatches = admin && (
    await bcrypt.compare(password || "", admin.password) ||
    (admin.username === "admin" && password === "admin" && !admin.password.startsWith("$2"))
  );

  if (!admin || !passwordMatches) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const user = publicAdmin(admin);
  const token = jwt.sign({ id: admin.id, role: admin.role }, SECRET, { expiresIn: "12h" });
  try {
    await addAudit("login", "admin", { email: admin.email }, admin.name);
  } catch (error) {
    console.error("Login audit failed:", error.message);
  }

  res.json({ token, user });
}));

app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    database: mongoose.connection.readyState === 1 ? "connected" : "not_connected",
    time: new Date().toISOString()
  });
});

app.get("/api/deployment-check", asyncRoute(async (req, res) => {
  const checks = {
    mongoUri: Boolean(process.env.MONGO_URI),
    jwtSecret: Boolean(process.env.JWT_SECRET),
    supabase: supabaseReportStatus(),
    database: "not_checked",
    supabaseReports: "not_checked"
  };

  try {
    await connectDatabase();
    checks.database = mongoose.connection.readyState === 1 ? "connected" : "not_connected";
  } catch (error) {
    checks.database = error.publicMessage || error.message;
  }

  try {
    const rows = await fetchSupabaseReports();
    checks.supabaseReports = `ok (${rows.length} rows checked)`;
  } catch (error) {
    checks.supabaseReports = error.message;
  }

  res.json({
    ok: checks.database === "connected",
    checks
  });
}));

app.get("/public/reports", asyncRoute(async (req, res) => {
  const reports = await getReportsForDashboard();
  res.json(reports.filter(report => ["verified", "dispatched", "on_scene", "resolved", "received"].includes(report.status)));
}));

app.get("/public/reports/user/:userId", asyncRoute(async (req, res) => {
  try {
    await connectDatabase();
    await syncSupabaseReports();
    const reports = await Report.find({
      reporterId: req.params.userId
    }).sort({ submittedAt: -1 });

    res.json(reports);
  } catch {
    const reports = await supabaseReportsFallback();
    res.json(reports.filter(report => report.reporterId === req.params.userId));
  }
}));

app.get("/api/news", apiLimit, asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 100);
  const news = await News.find(publicNewsQuery(req.query))
    .sort({ pinned: -1, publishedAt: -1, createdAt: -1 })
    .limit(Number.isFinite(limit) ? limit : 100);
  res.json(news.map(asClientNews));
}));

app.get("/api/news/:id", apiLimit, asyncRoute(async (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next();

  const news = await News.findOneAndUpdate(
    { _id: req.params.id, archived: false },
    { $inc: { views: 1 } },
    { new: true }
  );

  if (!news) {
    return res.status(404).json({ message: "News not found" });
  }

  res.json(asClientNews(news));
}));

// PUBLIC NEWS ANALYTICS
app.get("/api/news/analytics", apiLimit, asyncRoute(async (req, res) => {
  const [total, archived, totalViews, byCategory, byPriority, latest] = await Promise.all([
    News.countDocuments(),

    News.countDocuments({
      archived: true
    }),

    News.aggregate([
      {
        $group: {
          _id: null,
          views: { $sum: "$views" }
        }
      }
    ]),

    News.aggregate([
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          views: { $sum: "$views" }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]),

    News.aggregate([
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]),

    News.find({
      archived: false
    })
      .sort({
        pinned: -1,
        publishedAt: -1
      })
      .limit(5)
  ]);

  res.json({
    total,
    active: total - archived,
    archived,
    views: totalViews[0]?.views || 0,
    byCategory,
    byPriority,
    latest: latest.map(asClientNews)
  });
}));

// PROTECTED ADMIN ROUTES
app.use("/api", apiLimit, requireAuth, requireRole("admin"));

app.get("/api/me", asyncRoute(async (req, res) => {
  if (req.user?.id === "env-admin") {
    return res.json({
      id: "env-admin",
      email: process.env.DEFAULT_ADMIN_EMAIL || "admin@resq.local",
      username: process.env.DEFAULT_ADMIN_USERNAME || "admin",
      name: ADMIN_NAME,
      role: "admin"
    });
  }

  const admin = await Admin.findById(req.user.id);
  if (!admin) return res.status(404).json({ message: "User not found" });
  res.json(publicAdmin(admin));
}));

app.patch("/api/me/password", asyncRoute(async (req, res) => {
  const admin = await Admin.findById(req.user.id);
  const currentPassword = String(req.body.currentPassword || "");
  const nextPassword = String(req.body.nextPassword || "");

  if (!admin) return res.status(404).json({ message: "User not found" });
  if (nextPassword.length < 8) return res.status(400).json({ message: "Password must be at least 8 characters" });

  const passwordMatches = await bcrypt.compare(currentPassword, admin.password);
  if (!passwordMatches) return res.status(401).json({ message: "Current password is incorrect" });

  admin.password = await bcrypt.hash(nextPassword, 10);
  await admin.save();
  await addAudit("change_password", "admin", { id: admin.id }, admin.name);
  await notify("Password changed", `${admin.name} changed the admin password`, "security", "admin", admin.id);

  res.json({ message: "Password updated" });
}));

app.get("/api/audit", asyncRoute(async (req, res) => {
  const logs = await AuditLog.find().sort({ at: -1 }).limit(100);
  res.json(logs);
}));

app.get("/api/notifications", asyncRoute(async (req, res) => {
  const notifications = await Notification.find().sort({ at: -1 }).limit(50);
  res.json(notifications);
}));

app.patch("/api/notifications/:id/read", asyncRoute(async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
  if (!notification) return res.status(404).json({ message: "Notification not found" });
  res.json(notification);
}));



app.post("/api/news", newsUpload.single("image"), asyncRoute(async (req, res) => {
  const payload = normalizeNewsPayload(req.body, req.file);
  if (!payload.title || !payload.message) {
    return res.status(400).json({ message: "Title and message are required" });
  }

  const news = new News(payload);
  news.notification = buildNewsNotificationPayload(news);
  await news.save();

  try {
    const sms = await triggerEmergencyNewsSms(news);
    news.sms = sms;
    await news.save();
  } catch (error) {
    news.sms = { attempted: true, sent: 0, failed: 0, provider: "semaphore", lastError: error.message };
    await news.save();
  }

  await addAudit("create_news", "news", { id: news.id, title: news.title, priority: news.priority });
  await notify(news.title, news.message, news.notification.type, "news", news.id);
  res.status(201).json(asClientNews(news));
}));

app.put("/api/news/:id", newsUpload.single("image"), asyncRoute(async (req, res) => {
  const news = await News.findById(req.params.id);
  if (!news) return res.status(404).json({ message: "News not found" });

  Object.assign(news, normalizeNewsPayload(req.body, req.file, news.toObject()));
  if (!news.title || !news.message) {
    return res.status(400).json({ message: "Title and message are required" });
  }
  news.notification = buildNewsNotificationPayload(news);
  await news.save();

  await addAudit("update_news", "news", { id: news.id, title: news.title, archived: news.archived });
  res.json(asClientNews(news));
}));

app.post("/api/news/:id/archive", asyncRoute(async (req, res) => {
  const news = await News.findByIdAndUpdate(req.params.id, { archived: true, updatedAt: new Date() }, { new: true });
  if (!news) return res.status(404).json({ message: "News not found" });
  await addAudit("archive_news", "news", { id: news.id, title: news.title });
  res.json(asClientNews(news));
}));

app.delete("/api/news/:id", asyncRoute(async (req, res) => {
  const news = await News.findByIdAndDelete(req.params.id);
  if (!news) return res.status(404).json({ message: "News not found" });
  await addAudit("delete_news", "news", { id: news.id, title: news.title });
  res.json({ message: "News deleted", id: news.id });
}));

// ===== DASHBOARD =====
app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const reports = await getReportsForDashboard();
  let residents;
  let latestNews = [];
  let pinnedNews = 0;

  try {
    await connectDatabase();
    residents = await Resident.find();
    latestNews = await News.find({ archived: false }).sort({ pinned: -1, publishedAt: -1 }).limit(4);
    pinnedNews = await News.countDocuments({ archived: false, pinned: true });
  } catch {
    residents = [];
  }

  const reportCounts = reportSummary(reports);
  const userCounts = userSummary(residents);

  res.json({
    users: userCounts,
    reports: reportCounts,
    responders: new Set(reports.map(r => r.dispatch?.responder).filter(Boolean)).size,
    news: {
      latest: latestNews.map(asClientNews),
      pinned: pinnedNews
    },
    recentReports: reports
      .slice()
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
      .slice(0, 6)
  });
}));

// ===== USERS =====
app.get("/api/users", asyncRoute(async (req, res) => {
  try {
    await connectDatabase();
    const residents = await Resident.find().sort({ registeredAt: -1 });
    res.json(residents);
  } catch {
    res.json(readData().residents || []);
  }
}));

app.patch("/api/users/:id", asyncRoute(async (req, res) => {
  const user = await Resident.findOne({ legacyId: Number(req.params.id) });

  if (!user) return res.status(404).json({ message: "User not found" });
  if (!["pending", "approved", "rejected"].includes(req.body.status)) {
    return res.status(400).json({ message: "Valid status is required" });
  }

  user.status = req.body.status;
  user.decisions = user.decisions || [];
  user.decisions.push({
    status: user.status,
    note: req.body.note || "",
    at: new Date().toISOString(),
    by: ADMIN_NAME
  });
  await user.save();
  await addAudit("update_user", "resident", { id: user.id, status: user.status });
  await notify("Resident updated", `${user.fullName} marked as ${user.status}`, "user", "resident", user.id);

  res.json(user);
}));

// ===== SETTINGS =====
app.get("/api/settings", asyncRoute(async (req, res) => {
  try {
    await connectDatabase();
    const settings = await AppSettings.findOne({ key: "main" });
    res.json({
      barangays: settings?.barangays || [],
      settings: {
        moderation: settings?.moderation || { keywords: [], threshold: 5 },
        reasons: settings?.reasons || { approval: [], rejection: [] }
      }
    });
  } catch {
    res.json(defaultSettingsPayload());
  }
}));

app.patch("/api/settings/moderation", asyncRoute(async (req, res) => {
  const settings = await AppSettings.findOne({ key: "main" });
  const threshold = Number(req.body.threshold ?? settings.moderation?.threshold ?? 5);
  settings.moderation = {
    ...(settings.moderation?.toObject?.() || settings.moderation || {}),
    ...(Array.isArray(req.body.keywords) ? { keywords: req.body.keywords.map(item => cleanText(item, 40)).filter(Boolean) } : {}),
    threshold: Number.isFinite(threshold) ? Math.min(Math.max(threshold, 1), 100) : 5
  };
  await settings.save();
  await addAudit("update_settings", "moderation");
  res.json(settings.moderation);
}));

app.patch("/api/settings/reasons", asyncRoute(async (req, res) => {
  const settings = await AppSettings.findOne({ key: "main" });
  settings.reasons = {
    approval: Array.isArray(req.body.approval)
      ? req.body.approval.map(item => cleanText(item, 120)).filter(Boolean)
      : settings.reasons?.approval || [],
    rejection: Array.isArray(req.body.rejection)
      ? req.body.rejection.map(item => cleanText(item, 120)).filter(Boolean)
      : settings.reasons?.rejection || []
  };
  await settings.save();
  await addAudit("update_settings", "reasons");
  res.json(settings.reasons);
}));

app.post("/api/settings/barangays", asyncRoute(async (req, res) => {
  const settings = await AppSettings.findOne({ key: "main" });
  const name = cleanText(req.body.name, 80);
  if (!name) return res.status(400).json({ message: "Barangay name is required" });

  const barangays = settings.barangays || [];
  const barangay = {
    id: barangays.reduce((max, item) => Math.max(max, item.id || 0), 0) + 1,
    name,
    district: cleanText(req.body.district || "New operating area", 120),
    status: "active",
    residents: 0
  };

  settings.barangays.push(barangay);
  await settings.save();
  await addAudit("create_barangay", "settings", { id: barangay.id, name: barangay.name });
  res.status(201).json(barangay);
}));

app.patch("/api/settings/barangays/:id", asyncRoute(async (req, res) => {
  const settings = await AppSettings.findOne({ key: "main" });
  const barangay = (settings.barangays || []).find(item => item.id === Number(req.params.id));

  if (!barangay) return res.status(404).json({ message: "Barangay not found" });

  barangay.status = barangay.status === "offline" ? "active" : "offline";
  await settings.save();
  await addAudit("toggle_barangay", "settings", { id: barangay.id, status: barangay.status });
  res.json(barangay);
}));

// ===== REPORTS =====

app.get("/api/reports", asyncRoute(async (req, res) => {
  res.json(await getReportsForDashboard());
}));

app.get("/api/reports/summary", asyncRoute(async (req, res) => {
  res.json(reportSummary(await getReportsForDashboard()));
}));

app.get("/api/reports/debug", asyncRoute(async (req, res) => {
  const status = supabaseReportStatus();
  let rawRows = 0;
  let mappedRows = 0;
  let sampleKeys = [];
  let error = "";

  try {
    const rows = await fetchSupabaseReports();
    rawRows = rows.length;
    mappedRows = rows.map(normalizeSupabaseReport).filter(Boolean).length;
    sampleKeys = rows[0] ? Object.keys(rows[0]).slice(0, 30) : [];
  } catch (err) {
    error = err.message;
  }

  res.json({
    supabase: status,
    rawRows,
    mappedRows,
    sampleKeys,
    error
  });
}));

app.post("/api/reports/sync-supabase", asyncRoute(async (req, res) => {
  res.json(await syncSupabaseReports(true));
}));

app.post("/api/reports", asyncRoute(async (req, res) => {
  const missing = requireFields(req.body, ["title", "type", "priority", "reporter", "location", "description"]);
  if (missing) return res.status(400).json({ message: missing });
  if (!["critical", "high", "medium", "low"].includes(cleanText(req.body.priority, 40).toLowerCase())) {
    return res.status(400).json({ message: "Valid priority is required" });
  }
  if ((req.body.evidence || []).some(item => !validUrl(item.url || ""))) {
    return res.status(400).json({ message: "Evidence URL must use http or https" });
  }

  const payload = normalizeReportPayload(req.body);
  const now = new Date().toISOString();
  const report = new Report({
    ...payload,
    reporterId: req.body.user_id,
    legacyId: await nextLegacyReportId(),
    status: "received",
    submittedAt: now,
    history: [{
      status: "received",
      note: "Report received.",
      at: now,
      by: "System"
    }],
    notes: []
  });

  await report.save();
  await addAudit("create_report", "report", { id: report.id, title: report.title });
  await notify("New report", report.title, report.priority === "critical" ? "critical" : "report", "report", report.id);
  res.status(201).json(report);
}));

app.patch("/api/reports/:id", asyncRoute(async (req, res) => {
  const report = await findReport(req.params.id);

  if (!report) return res.status(404).json({ message: "Report not found" });
  if (req.body.status && !["received", "verified", "dispatched", "on_scene", "resolved", "false_report"].includes(req.body.status)) {
    return res.status(400).json({ message: "Valid status is required" });
  }

  const previousStatus = report.status;
  Object.assign(report, normalizeReportPayload(req.body, report.toObject()));

  if (req.body.status && req.body.status !== previousStatus) {
    report.history = report.history || [];
    report.history.push({
      status: req.body.status,
      note: req.body.note || "",
      at: new Date().toISOString(),
      by: ADMIN_NAME
    });
  }

  await report.save();
  await addAudit("update_report", "report", { id: report.id, status: report.status });
  await notify("Report updated", `${report.title} is now ${labelStatus(report.status)}`, "report", "report", report.id);
  res.json(report);
}));

app.post("/api/reports/:id/notes", asyncRoute(async (req, res) => {
  const report = await findReport(req.params.id);

  if (!report) return res.status(404).json({ message: "Report not found" });
  if (!req.body.text) return res.status(400).json({ message: "Note text is required" });

  report.notes = report.notes || [];
  report.notes.push({
    text: cleanText(req.body.text, 1000),
    at: new Date().toISOString(),
    by: ADMIN_NAME
  });

  await report.save();
  await addAudit("add_report_note", "report", { id: report.id });
  res.status(201).json(report);
}));

app.post("/api/reports/:id/evidence", asyncRoute(async (req, res) => {
  const report = await findReport(req.params.id);

  if (!report) return res.status(404).json({ message: "Report not found" });
  if (!validUrl(req.body.url || "")) return res.status(400).json({ message: "Evidence URL must use http or https" });

  report.evidence = report.evidence || [];
  report.evidence.push({
    kind: cleanText(req.body.kind || "note", 40),
    label: cleanText(req.body.label || "", 200),
    url: cleanText(req.body.url || "", 500)
  });

  await report.save();
  await addAudit("add_report_evidence", "report", { id: report.id });
  res.status(201).json(report);
}));

app.post("/api/reports/:id/evidence-file", upload.single("evidence"), asyncRoute(async (req, res) => {
  const report = await findReport(req.params.id);

  if (!report) return res.status(404).json({ message: "Report not found" });
  if (!req.file) return res.status(400).json({ message: "Evidence file is required" });

  const evidence = {
    kind: "file",
    label: cleanText(req.body.label || req.file.originalname, 200),
    url: `/uploads/${req.file.filename}`
  };

  report.evidence = report.evidence || [];
  report.evidence.push(evidence);
  await report.save();
  await addAudit("upload_report_evidence", "report", { id: report.id, file: req.file.filename });
  await notify("Evidence uploaded", `${report.title} has new evidence`, "evidence", "report", report.id);

  res.status(201).json(report);
}));

// ===== RISK REPORT =====
app.get("/api/risk-report/:barangay", asyncRoute(async (req, res, next) => {
  const barangay = req.params.barangay;
  if (barangay === "summary") return next();
  if (!barangay) return res.status(400).json({ message: "Barangay is required" });

  if (!ML_API_URL) {
    return res.json(await buildSystemRiskReport(barangay));
  }

  try {
    const mlResponse = await fetch(`${ML_API_URL}/risk-report/${encodeURIComponent(barangay)}`);
    if (!mlResponse.ok) {
      throw new Error(`ML API responded with status ${mlResponse.status}`);
    }
    const data = await mlResponse.json();
    res.json(data);
  } catch (error) {
    console.error("Risk report error:", error);
    res.json(await buildSystemRiskReport(barangay));
  }
}));

// Save risk report to database
app.post("/api/risk-report", asyncRoute(async (req, res) => {
  const {
    barangay,
    risk_level,
    risk_score,
    rainfall,
    humidity,
    wind_speed,
    temperature,
    trend,
    data_points,
    recommendations
  } = req.body;

  if (!barangay || !risk_level) {
    return res.status(400).json({ message: "Barangay and risk level are required" });
  }

  try {
    const report = new RiskReport({
      barangay,
      riskLevel: risk_level,
      riskScore: risk_score || 0,
      weatherData: {
        rainfall: rainfall || 0,
        humidity: humidity || 0,
        windSpeed: wind_speed || 0,
        temperature: temperature || 0
      },
      trend: trend || "stable",
      dataPoints: data_points || 0,
      recommendations: recommendations || []
    });

    await report.save();
    await addAudit("create_risk_report", "risk_report", { 
      id: report.id, 
      barangay, 
      riskLevel: risk_level 
    });
    
    res.status(201).json(report);
  } catch (error) {
    console.error("Save risk report error:", error);
    res.status(500).json({ message: "Failed to save risk report", error: error.message });
  }
}));

// Get risk report history for a barangay
app.get("/api/risk-report/history/:barangay", asyncRoute(async (req, res) => {
  const barangay = req.params.barangay;
  const limit = parseInt(req.query.limit) || 50;

  try {
    const reports = await RiskReport.find({ barangay })
      .sort({ calculatedAt: -1 })
      .limit(limit);
    
    res.json(reports);
  } catch (error) {
    console.error("Get risk history error:", error);
    res.status(500).json({ message: "Failed to get risk report history", error: error.message });
  }
}));

app.post("/api/risk-report/send-sms", asyncRoute(async (req, res) => {
  const { barangay, scope, message } = req.body;
  const allowedScopes = ["barangay", "municipality"];

  if (!message || !String(message).trim()) {
    return res.status(400).json({ message: "SMS message text is required." });
  }

  if (!allowedScopes.includes(scope)) {
    return res.status(400).json({ message: "SMS scope must be either 'barangay' or 'municipality'." });
  }

  const filter = {
    status: { $in: ["approved", "verified"] },
    mobile: { $exists: true, $ne: "" }
  };

  if (scope === "barangay") {
    if (!barangay || !String(barangay).trim()) {
      return res.status(400).json({ message: "Barangay is required when scope is 'barangay'." });
    }
    filter.address = { $regex: new RegExp(`\\b${escapeRegExp(barangay.trim())}\\b`, "i") };
  }

  const recipients = await Resident.find(filter).lean();
  if (!recipients.length) {
    return res.status(404).json({ message: "No verified recipients found for the selected scope." });
  }

  const results = await Promise.allSettled(recipients.map(async recipient => {
    const to = normalizePhoneNumber(recipient.mobile);
    if (!to) {
      throw new Error(`Invalid mobile number for ${recipient.fullName || recipient.address || "recipient"}`);
    }
    return await sendSmsMessage(to, message);
  }));

  const sentCount = results.filter(r => r.status === "fulfilled").length;
  const failedResults = results.filter(r => r.status === "rejected").map(r => ({ reason: r.reason?.message || String(r.reason) }));

  await addAudit("send_risk_sms", "sms", {
    scope,
    barangay: scope === "barangay" ? barangay : "municipality",
    requested: recipients.length,
    sent: sentCount,
    failed: failedResults.length
  });

  res.json({
    message: `SMS send completed. ${sentCount} of ${recipients.length} messages sent successfully.
`,
    count: recipients.length,
    sent: sentCount,
    failed: failedResults.length,
    errors: failedResults
  });
}));

// Get latest risk report for a barangay
app.get("/api/risk-report/latest/:barangay", asyncRoute(async (req, res) => {
  const barangay = req.params.barangay;

  try {
    const report = await RiskReport.findOne({ barangay })
      .sort({ calculatedAt: -1 });
    
    if (!report) {
      return res.status(404).json({ message: "No risk report found for this barangay" });
    }
    
    res.json(report);
  } catch (error) {
    console.error("Get latest risk report error:", error);
    res.status(500).json({ message: "Failed to get latest risk report", error: error.message });
  }
}));

// Get risk summary for all barangays
app.get("/api/risk-report/summary", asyncRoute(async (req, res) => {
  try {
    // Get the latest report for each barangay
    const latestReports = await RiskReport.aggregate([
      {
        $sort: { calculatedAt: -1 }
      },
      {
        $group: {
          _id: "$barangay",
          latestReport: { $first: "$$ROOT" }
        }
      },
      {
        $replaceRoot: { newRoot: "$latestReport" }
      }
    ]);

    // Count by risk level
    const summary = {
      total: latestReports.length,
      high: latestReports.filter(r => r.riskLevel === "HIGH").length,
      moderate: latestReports.filter(r => r.riskLevel === "MODERATE").length,
      low: latestReports.filter(r => r.riskLevel === "LOW").length,
      unknown: latestReports.filter(r => r.riskLevel === "UNKNOWN").length,
      barangays: latestReports.map(r => ({
        barangay: r.barangay,
        riskLevel: r.riskLevel,
        riskScore: r.riskScore,
        calculatedAt: r.calculatedAt
      }))
    };

    res.json(summary);
  } catch (error) {
    console.error("Get risk summary error:", error);
    res.status(500).json({ message: "Failed to get risk summary", error: error.message });
  }
}));

// ===== TEST SMS =====
if (process.env.ENABLE_TEST_SMS === "true") {
  app.get("/test-sms", asyncRoute(async (req, res) => {
    try {
      if (!process.env.TEST_SMS_TO) {
        return res.status(400).json({
          success: false,
          error: "TEST_SMS_TO is required when ENABLE_TEST_SMS is true"
        });
      }

      const result = await sendSmsMessage(
        process.env.TEST_SMS_TO,
        "TEST SMS FROM RESQ SYSTEM"
      );

      console.log(result);

      res.json({
        success: true,
        message: "SMS sent successfully",
        result
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  }));
}

// ===== SERVE FRONTEND =====
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(ROOT_DIR));

app.get("/", (req, res) => {
  res.redirect("/LOGIN/login.html");
});

// ===== MONGODB CONNECTION =====
mongoose.set("strictQuery", false);

if (require.main === module) {
  connectDatabase().then(() => {
    app.listen(PORT, () => {
    console.log("Server running on port " + PORT);
    });
  }).catch(err => {
    console.error("Server startup failed:", err);
    process.exit(1);
  });
}

mongoose.connection.on("error", (err) => {
  console.error("MongoDB ERROR:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB Disconnected");
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: "Upload failed" });
  }

  if (err.statusCode && err.publicMessage) {
    console.error(err);
    return res.status(err.statusCode).json({ message: err.publicMessage });
  }

  console.error(err);
  res.status(500).json({ message: "Server error" });
});

module.exports = app;
