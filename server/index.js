/**
 * CheckingPlan capacity — Express backend
 * ----------------------------------------------------------------------
 * Provides a single endpoint:
 *   GET /api/zoho-tasks?email=<programmer email>
 *   → { tasks: [ { name, end_date, project, total_work } ] }
 *
 * Two modes, controlled by the MODE env var (see .env.example):
 *
 *   MODE=mock  (default)
 *     Returns hardcoded sample tasks. Useful for running the UI end-to-end
 *     without setting up Zoho OAuth.
 *
 *   MODE=zoho
 *     Calls Zoho Projects' REST API directly, using an OAuth refresh token.
 *     Required env vars:
 *       ZOHO_CLIENT_ID
 *       ZOHO_CLIENT_SECRET
 *       ZOHO_REFRESH_TOKEN
 *       ZOHO_PORTAL_ID         (default: 20059477103, the conpas portal)
 *       ZOHO_DC                (default: eu — values: eu | com | in | com.au | jp)
 *
 * See README.md for the OAuth setup walkthrough.
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });
const DIST = join(__dirname, "../dist");

const app = express();
app.use(cors());

const MODE = (process.env.MODE || "mock").toLowerCase();
const PORT = Number(process.env.PORT || 3001);
const DC = process.env.ZOHO_DC || "eu";
const ZOHO_BASE = `https://projects.zoho.${DC}/api/v3`;
const ZOHO_ACCOUNTS = `https://accounts.zoho.${DC}`;
const PORTAL_ID = process.env.ZOHO_PORTAL_ID || "20059477103";

/* ---------- OAuth token cache ---------- */

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const refresh = process.env.ZOHO_REFRESH_TOKEN;
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;

  if (!refresh || !clientId || !clientSecret) {
    throw new Error(
      "Faltan ZOHO_REFRESH_TOKEN / ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET en .env"
    );
  }

  const body = new URLSearchParams({
    refresh_token: refresh,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const r = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error("Token refresh failed: " + JSON.stringify(j).slice(0, 200));
  }

  cachedToken = j.access_token;
  tokenExpiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return cachedToken;
}

/* ---------- Mock data ---------- */

function mockTasks(email) {
  const today = new Date();
  const future = (n) =>
    new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  const past = (n) =>
    new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);

  const fixtures = {
    "eduardo.pena@cuatroochenta.com": [
      {
        name: "Refactor reporting CKP",
        end_date: future(8),
        start_date: past(5),
        project: "CHECKINGPLAN PRODUCTO",
        project_id: "3000093879",
        id: "3000178921",
        total_work: "08:00",
        status: "En curso",
        completion_percentage: 50,
        priority: "high",
      },
      {
        name: "Modificación informe 28 Vodafone",
        end_date: future(20),
        start_date: past(2),
        project: "10S-6109 FCC VODAFONE",
        project_id: "3000093881",
        id: "3000178922",
        total_work: "06:00",
        status: "Pendiente",
        completion_percentage: 0,
        priority: "medium",
      },
    ],
    "ricardo.cruz@cuatroochenta.com": [
      {
        name: "Migración módulo de cuestionarios",
        end_date: future(15),
        start_date: past(10),
        project: "CHECKINGPLAN PRODUCTO",
        project_id: "3000093879",
        id: "3000178923",
        total_work: "12:00",
        status: "En curso",
        completion_percentage: 75,
        priority: "high",
      },
    ],
    "rafael.montenegro@cuatroochenta.com": [],
  };

  return fixtures[email.toLowerCase()] || [];
}

function hasWork(totalWork) {
  if (!totalWork) return false;
  const [h, m] = String(totalWork).split(":").map(Number);
  return (h || 0) + (m || 0) > 0;
}

/* ---------- Real Zoho call ---------- */

async function fetchZohoTasks(email) {
  const token = await getAccessToken();
  const filter = {
    criteria: [
      {
        criteria_condition: "is",
        field_name: "owner_email",
        value: [email],
      },
      {
        criteria_condition: "is",
        field_name: "is_completed",
        value: ["false"],
      },
    ],
    pattern: "1 AND 2",
  };

  const url = new URL(`${ZOHO_BASE}/portal/${PORTAL_ID}/tasks`);
  url.searchParams.set("filter", JSON.stringify(filter));
  url.searchParams.set("page", "1");
  url.searchParams.set("per_page", "200");
  url.searchParams.set("sort_by", "DESC(end_date)");

  const r = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  const j = await r.json();

  if (!r.ok || j.error) {
    const msg = j?.error?.title || j?.error?.message || JSON.stringify(j).slice(0, 160);
    const code = r.status || j?.error?.status_code || 500;
    const e = new Error(`Zoho ${code}: ${msg}`);
    e.statusCode = Number(code);
    throw e;
  }

  // Keep only tasks whose status name is exactly "Pendiente" or "En curso".
  const ACTIVE_STATUSES = new Set(["pendiente", "en curso"]);
  // Projects excluded from capacity calculations (e.g. absence tracking).
  const EXCLUDED_PROJECTS = new Set(["ausencias checkingplan"]);

  const lower = email.toLowerCase();
  return (j.tasks || [])
    .filter((t) => {
      const statusName = (t?.status?.name || "").toLowerCase();
      if (!ACTIVE_STATUSES.has(statusName)) return false;
      const projectName = (t?.project?.name || "").toLowerCase();
      if (EXCLUDED_PROJECTS.has(projectName)) return false;
      if (!hasWork(t?.owners_and_work?.total_work)) return false;
      return (t?.owners_and_work?.owners || []).some(
        (o) => (o.email || "").toLowerCase() === lower
      );
    })
    .map((t) => {
      if (process.env.DEBUG_ZOHO === "1") {
        console.log("[zoho task sample]", JSON.stringify({
          id: t.id, id_string: t.id_string, name: t.name,
          project: t?.project,
        }, null, 2));
      }
      return {
        name: t.name || "",
        end_date: t.end_date ? String(t.end_date).slice(0, 10) : null,
        start_date: t.start_date ? String(t.start_date).slice(0, 10) : null,
        project: t?.project?.name || "",
        project_id: String(t?.project?.id_string || t?.project?.id || ""),
        id: String(t.id_string || t.id || ""),
        total_work: t?.owners_and_work?.total_work || null,
        status: t?.status?.name || "",
        completion_percentage: Number(t.completion_percentage) || 0,
        priority: (t.priority || "none").toLowerCase(),
      };
    });
}

/* ---------- Routes ---------- */

app.get("/api/health", (req, res) => {
  res.json({ ok: true, mode: MODE, portal_id: PORTAL_ID, dc: DC });
});

app.get("/api/zoho-tasks", async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    if (MODE === "mock") {
      // Small artificial latency to make loading state visible
      await new Promise((r) => setTimeout(r, 250));
      return res.json({ tasks: mockTasks(email), mode: "mock" });
    }
    const tasks = await fetchZohoTasks(email);
    res.json({ tasks, mode: "zoho" });
  } catch (e) {
    console.error("[/api/zoho-tasks]", e);
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// Serve React frontend (must be after API routes)
app.use(express.static(DIST));
app.get("*", (req, res) => res.sendFile(join(DIST, "index.html")));

app.listen(PORT, () => {
  console.log(`✓ Backend listening on http://localhost:${PORT}`);
  console.log(`  mode = ${MODE}`);
  if (MODE === "zoho") {
    console.log(`  portal = ${PORTAL_ID}, DC = ${DC}`);
  } else {
    console.log(`  set MODE=zoho in .env to use real Zoho data`);
  }
});
