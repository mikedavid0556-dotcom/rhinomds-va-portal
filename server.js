require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const ORG_TZ = process.env.ORG_TIMEZONE || "Asia/Karachi";
const isProd = process.env.NODE_ENV === "production";

if (isProd) app.set("trust proxy", 1);

const useSSL =
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes("localhost") &&
  !process.env.DATABASE_URL.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ================= REAL-TIME SSE CLIENTS =================
const sseClients = new Set();

function broadcastSync(filterFn, payload) {
  const msg = `event: sync\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      if (!filterFn || filterFn(client.user)) {
        client.res.write(msg);
      }
    } catch {}
  }
}

const SEED = {
  users: [
    {"name": "Waqar Ahmad", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Ayesha Abbasi", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Areeb Anwar", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Wajiha Zahoor", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Abdul Rafay", "lead": "Shaloom Emmanuel", "status": "Active"},
    {"name": "Moiz Adnan Awan", "lead": "Shaloom Emmanuel", "status": "Active"},
    {"name": "Sinan Afzal", "lead": "Shaloom Emmanuel", "status": "Active"},
    {"name": "Farah Liaquat", "lead": "Shaloom Emmanuel", "status": "Active"},
    {"name": "Bushra Jamil", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Muhammad Huzaifa", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Abdul Moiz", "lead": "Umer Ibrahim", "status": "Active"},
    {"name": "Zoha Mumtaz", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Zoha Mursaleen", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Sayyab Siddique", "lead": "Maaz Bin Farhan", "status": "Active"},
    {"name": "Muhammad Shahzad", "lead": "Maaz Bin Farhan", "status": "Active"},
    {"name": "Huzaifa Imran", "lead": "Maaz Bin Farhan", "status": "Active"},
    {"name": "Muhammad Husnain", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Mushahid Hussain", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Zia Ullah", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Fahad Akbar", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Muhammad Zikriya", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Saad Shah", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Saima", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Tahira Naz", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Samiullah", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Shahzaib Umer", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Mohsin Khan", "lead": "Saad Abdullah", "status": "Active"},
    {"name": "Hina Nawaz", "lead": "Shahzaib Satti", "status": "Active"},
    {"name": "Muhammad Iqbal", "lead": "Shahzaib Satti", "status": "Active"},
    {"name": "Nehemiah Gill", "lead": "Shahzaib Satti", "status": "Active"},
    {"name": "VA 31", "lead": "Row Lead 4", "status": "Active"},
    {"name": "VA 32", "lead": "Row Lead 4", "status": "Active"},
    {"name": "VA 33", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 34", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 35", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 36", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 37", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 38", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 39", "lead": "Row Lead 5", "status": "Active"},
    {"name": "VA 40", "lead": "Row Lead 5", "status": "Active"}
  ],
  assignments: [
    {"user": "Waqar Ahmad", "practice": "Cornerstone Healthcare Services"},
    {"user": "Ayesha Abbasi", "practice": "Anchor Care"},
    {"user": "Areeb Anwar", "practice": "Anchor Care"},
    {"user": "Wajiha Zahoor", "practice": "Anchor Care"},
    {"user": "Abdul Rafay", "practice": "Dominion Health"},
    {"user": "Moiz Adnan Awan", "practice": "Dominion Health"},
    {"user": "Sinan Afzal", "practice": "Dominion Health"},
    {"user": "Farah Liaquat", "practice": "Dominion Health"},
    {"user": "Bushra Jamil", "practice": "Akosua Abankwah"},
    {"user": "Bushra Jamil", "practice": "Harmonized"},
    {"user": "Muhammad Huzaifa", "practice": "Akosua Abankwah"},
    {"user": "Muhammad Huzaifa", "practice": "Harmonized"},
    {"user": "Abdul Moiz", "practice": "Healing Light"},
    {"user": "Bushra Jamil", "practice": "Gateway"},
    {"user": "Bushra Jamil", "practice": "Thriven Minds"},
    {"user": "Zoha Mumtaz", "practice": "Heartland Mental Health"},
    {"user": "Muhammad Huzaifa", "practice": "Gateway"},
    {"user": "Muhammad Huzaifa", "practice": "Thriven Minds"},
    {"user": "Zoha Mursaleen", "practice": "Heartland Mental Health"},
    {"user": "Sayyab Siddique", "practice": "Orchid Wellness"},
    {"user": "Muhammad Shahzad", "practice": "Progressive Pathway"},
    {"user": "Muhammad Shahzad", "practice": "Onyx Medical"},
    {"user": "Huzaifa Imran", "practice": "Johnson Medical"},
    {"user": "Huzaifa Imran", "practice": "Orchid Wellness"},
    {"user": "Muhammad Husnain", "practice": "Naga"},
    {"user": "Muhammad Husnain", "practice": "Eligibility Email"},
    {"user": "Mushahid Hussain", "practice": "Youbridge Health"},
    {"user": "Zia Ullah", "practice": "Youbridge Health"},
    {"user": "Fahad Akbar", "practice": "CJI"},
    {"user": "Fahad Akbar", "practice": "Central TX Holistic Care"},
    {"user": "Muhammad Zikriya", "practice": "Southlake Serenity Psychiatry"},
    {"user": "Saad Shah", "practice": "Southlake Serenity Psychiatry"},
    {"user": "Saad Shah", "practice": "Angelic"},
    {"user": "Saima", "practice": "North Node Therapy"},
    {"user": "Tahira Naz", "practice": "North Node Therapy"},
    {"user": "Samiullah", "practice": "North Node Therapy"},
    {"user": "Shahzaib Umer", "practice": "Bluehaven Psychiatry"},
    {"user": "Shahzaib Umer", "practice": "Amity Healthcare Services"},
    {"user": "Mohsin Khan", "practice": "Amity Healthcare Services"},
    {"user": "Mohsin Khan", "practice": "Bluehaven Psychiatry"},
    {"user": "Hina Nawaz", "practice": "Ideal MD"},
    {"user": "Muhammad Iqbal", "practice": "Ideal MD"},
    {"user": "Nehemiah Gill", "practice": "Ideal MD"},
    {"user": "VA 33", "practice": "Practice 08"}, {"user": "VA 33", "practice": "Practice 24"}, {"user": "VA 33", "practice": "Practice 33"},
    {"user": "VA 34", "practice": "Practice 26"}, {"user": "VA 34", "practice": "Practice 34"},
    {"user": "VA 35", "practice": "Practice 04"}, {"user": "VA 35", "practice": "Practice 10"}, {"user": "VA 35", "practice": "Practice 31"}, {"user": "VA 35", "practice": "Practice 35"},
    {"user": "VA 36", "practice": "Practice 01"}, {"user": "VA 36", "practice": "Practice 09"}, {"user": "VA 36", "practice": "Practice 21"}, {"user": "VA 36", "practice": "Practice 34"},
    {"user": "VA 37", "practice": "Practice 02"},
    {"user": "VA 38", "practice": "Practice 03"}, {"user": "VA 38", "practice": "Practice 05"}, {"user": "VA 38", "practice": "Practice 28"},
    {"user": "VA 39", "practice": "Practice 04"}, {"user": "VA 39", "practice": "Practice 18"}, {"user": "VA 39", "practice": "Practice 30"},
    {"user": "VA 40", "practice": "Practice 05"}, {"user": "VA 40", "practice": "Practice 22"}
  ],
  practices: [
    "Cornerstone Healthcare Services", "Anchor Care", "Dominion Health", "Akosua Abankwah",
    "Harmonized", "Gateway", "Thriven Minds", "Healing Light", "Heartland Mental Health",
    "Orchid Wellness", "Progressive Pathway", "Johnson Medical", "Onyx Medical", "Youbridge Health",
    "Eligibility Email", "Naga", "CJI", "Central TX Holistic Care", "Southlake Serenity Psychiatry",
    "Angelic", "North Node Therapy", "Bluehaven Psychiatry", "Amity Healthcare Services", "Ideal MD",
    "Practice 25", "Practice 26", "Practice 27", "Practice 28", "Practice 29", "Practice 30",
    "Practice 31", "Practice 32", "Practice 33", "Practice 34", "Practice 35"
  ],
  leads: ["Umer Ibrahim", "Shaloom Emmanuel", "Maaz Bin Farhan", "Saad Abdullah", "Shahzaib Satti", "Row Lead 4", "Row Lead 5"],
  targets: { vobs: 5, calls: 10, scheduling: 10, payments: 100, extra: 1, consistency: 1 },
  weights: { vobs: 0.8, calls: 0.05, scheduling: 0.05, payments: 0.05, extra: 0.01, consistency: 0.04 }
};

function orgTodayISO() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TZ }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

function roleLabel(r) {
  return r === "super_admin" ? "Admin" : r === "row_lead" ? "Row Lead" : "User";
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      name TEXT UNIQUE NOT NULL,
      dob TEXT NOT NULL DEFAULT '',
      pseudo_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      designation TEXT NOT NULL DEFAULT '',
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      lead TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leads (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS practices (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS assignments (
      user_name TEXT NOT NULL,
      practice_name TEXT NOT NULL,
      PRIMARY KEY (user_name, practice_name)
    );
    CREATE TABLE IF NOT EXISTS signoffs (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      user_name TEXT NOT NULL,
      lead_name TEXT NOT NULL,
      vobs INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      scheduling INTEGER NOT NULL DEFAULT 0,
      payments NUMERIC(12,2) NOT NULL DEFAULT 0,
      extra INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_by_role TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (date, user_name)
    );
    CREATE TABLE IF NOT EXISTS signoff_logs (
      id SERIAL PRIMARY KEY,
      signoff_date TEXT NOT NULL,
      user_name TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_by_role TEXT NOT NULL,
      vobs INTEGER NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 0,
      scheduling INTEGER NOT NULL DEFAULT 0,
      payments NUMERIC(12,2) NOT NULL DEFAULT 0,
      extra INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '',
      assigned_to_id INTEGER NOT NULL,
      assigned_to_name TEXT NOT NULL,
      assigned_to_role TEXT NOT NULL,
      assigned_to_lead TEXT NOT NULL DEFAULT '',
      assigned_by_id INTEGER NOT NULL,
      assigned_by_name TEXT NOT NULL,
      assigned_by_role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      completion_note TEXT NOT NULL DEFAULT '',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      recipient_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT false,
      dedupe_key TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);

  const adminFirst = (process.env.ADMIN_FIRST_NAME || "Super").trim();
  const adminLast = (process.env.ADMIN_LAST_NAME || "Admin").trim();
  const adminFull = `${adminFirst} ${adminLast}`.trim();
  const adminUser = (process.env.ADMIN_USERNAME || "superadmin").trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "ChangeThisStrongPassword123!";

  const existingAdmin = await pool.query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1");
  if (existingAdmin.rowCount === 0) {
    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query(
      `INSERT INTO users (first_name, last_name, name, designation, username, password_hash, role, lead, status)
       VALUES ($1, $2, $3, 'Super Admin', $4, $5, 'super_admin', '', 'Active')
       ON CONFLICT (username) DO NOTHING`,
      [adminFirst, adminLast, adminFull, adminUser, hash]
    );
    console.log(`Seeded Super Admin account: ${adminUser}`);
  }

  const userCount = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role <> 'super_admin'");
  if (userCount.rows[0].c === 0) {
    for (const l of SEED.leads) {
      await pool.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [l]);
    }
    for (const p of SEED.practices) {
      await pool.query("INSERT INTO practices (name) VALUES ($1) ON CONFLICT DO NOTHING", [p]);
    }
    for (const u of SEED.users) {
      const { first, last } = splitName(u.name);
      await pool.query(
        `INSERT INTO users (first_name, last_name, name, designation, role, lead, status)
         VALUES ($1, $2, $3, 'Medical Virtual Assistant', 'user', $4, $5)
         ON CONFLICT (name) DO NOTHING`,
        [first, last, u.name, u.lead, u.status]
      );
    }
    for (const a of SEED.assignments) {
      await pool.query(
        "INSERT INTO assignments (user_name, practice_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [a.user, a.practice]
      );
    }
  }

  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('targets', $1) ON CONFLICT (key) DO NOTHING",
    [JSON.stringify(SEED.targets)]
  );
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('weights', $1) ON CONFLICT (key) DO NOTHING",
    [JSON.stringify(SEED.weights)]
  );
}

async function syncBirthdayNotifications() {
  const today = orgTodayISO();
  const mmdd = today.slice(5, 10);
  const bdaysRes = await pool.query(
    `SELECT id, name, first_name, pseudo_name, designation, dob
     FROM users
     WHERE status = 'Active' AND dob ~ '^\\d{4}-\\d{2}-\\d{2}$' AND SUBSTRING(dob FROM 6 FOR 5) = $1`,
    [mmdd]
  );

  if (bdaysRes.rowCount === 0) return [];

  const allActive = await pool.query("SELECT id, name FROM users WHERE status = 'Active'");
  for (const bUser of bdaysRes.rows) {
    for (const rec of allActive.rows) {
      const dedupe = `bday:${today}:${bUser.id}:${rec.id}`;
      const isSelf = rec.id === bUser.id;
      const title = isSelf ? `Happy Birthday, ${bUser.first_name || bUser.name}!` : `Birthday Today: ${bUser.name}`;
      const msg = isSelf
        ? `RhinoMDs Billing Services wishes you a wonderful birthday, ${bUser.first_name || bUser.name}!`
        : `Today is ${bUser.name}'s (${bUser.designation || "Team Member"}) birthday! Be sure to wish them a Happy Birthday.`;
      await pool.query(
        `INSERT INTO notifications (recipient_id, type, title, message, dedupe_key)
         VALUES ($1, 'birthday', $2, $3, $4)
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [rec.id, title, msg, dedupe]
      );
    }
  }
  return bdaysRes.rows;
}

async function requireAuth(req, res, next) {
  const token = req.cookies.medva_token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query(
      "SELECT id, first_name, last_name, name, dob, pseudo_name, email, designation, username, role, lead, status FROM users WHERE id = $1",
      [decoded.id]
    );
    if (!rows[0] || rows[0].status !== "Active") {
      return res.status(401).json({ error: "Account inactive or missing" });
    }
    req.user = rows[0];
    next();
  } catch {
    return res.status(401).json({ error: "Session expired" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Access denied" });
    next();
  };
}

// Live SSE Stream
app.get("/api/events", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const client = { user: req.user, res };
  sseClients.add(client);

  const heartbeat = setInterval(() => {
    try { res.write(": ping\n\n"); } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(client);
  });
});

app.post("/api/auth/login", async (req, res) => {
  const selectedRole = String(req.body.role || "");
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!["super_admin", "row_lead", "user"].includes(selectedRole)) {
    return res.status(400).json({ error: "Please select Admin, Row Lead, or User" });
  }
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(username) = $1", [username]);
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: "Invalid username or password" });
  if (user.status !== "Active") return res.status(403).json({ error: "Account is inactive. Contact Admin." });
  if (user.role !== selectedRole) {
    return res.status(403).json({ error: `This account is registered as ${roleLabel(user.role)}, not ${roleLabel(selectedRole)}.` });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid username or password" });

  const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("medva_token", token, {
    httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 7 * 24 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("medva_token");
  res.json({ ok: true });
});

app.get("/api/bootstrap", requireAuth, async (req, res) => {
  const role = req.user.role;
  const todaysBirthdays = await syncBirthdayNotifications();

  const [leadsRes, practicesRes, settingsRes, notifRes] = await Promise.all([
    pool.query("SELECT name FROM leads ORDER BY name"),
    pool.query("SELECT name FROM practices ORDER BY name"),
    pool.query("SELECT key, value FROM settings"),
    pool.query("SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT 40", [req.user.id])
  ]);

  const settings = {};
  settingsRes.rows.forEach((r) => (settings[r.key] = r.value));

  let usersRes, assignRes, signRes, tasksRes;
  if (role === "super_admin") {
    [usersRes, assignRes, signRes, tasksRes] = await Promise.all([
      pool.query("SELECT id, first_name, last_name, name, dob, pseudo_name, email, designation, username, role, lead, status, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY role, name"),
      pool.query('SELECT user_name AS "user", practice_name AS practice FROM assignments ORDER BY user_name'),
      pool.query('SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs ORDER BY date DESC'),
      pool.query("SELECT * FROM tasks ORDER BY created_at DESC")
    ]);
  } else if (role === "row_lead") {
    const teamLead = req.user.lead || req.user.name;
    [usersRes, assignRes, signRes, tasksRes] = await Promise.all([
      pool.query("SELECT id, first_name, last_name, name, dob, pseudo_name, email, designation, username, role, lead, status, false AS has_password FROM users WHERE role = 'user' AND lead = $1 ORDER BY name", [teamLead]),
      pool.query('SELECT a.user_name AS "user", a.practice_name AS practice FROM assignments a JOIN users u ON a.user_name = u.name WHERE u.lead = $1', [teamLead]),
      pool.query('SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs WHERE lead_name = $1 ORDER BY date DESC', [teamLead]),
      pool.query("SELECT * FROM tasks WHERE assigned_to_id = $1 OR assigned_by_id = $1 OR assigned_to_lead = $2 ORDER BY created_at DESC", [req.user.id, teamLead])
    ]);
  } else {
    [usersRes, assignRes, signRes, tasksRes] = await Promise.all([
      pool.query("SELECT id, first_name, last_name, name, dob, pseudo_name, email, designation, username, role, lead, status, false AS has_password FROM users WHERE id = $1", [req.user.id]),
      pool.query('SELECT user_name AS "user", practice_name AS practice FROM assignments WHERE user_name = $1', [req.user.name]),
      pool.query('SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs WHERE user_name = $1 ORDER BY date DESC', [req.user.name]),
      pool.query("SELECT * FROM tasks WHERE assigned_to_id = $1 ORDER BY created_at DESC", [req.user.id])
    ]);
  }

  res.json({
    currentUser: req.user,
    orgToday: orgTodayISO(),
    todaysBirthdays: todaysBirthdays.map((b) => ({ id: b.id, name: b.name, first_name: b.first_name, designation: b.designation })),
    notifications: notifRes.rows,
    users: usersRes.rows,
    assignments: assignRes.rows,
    practices: practicesRes.rows.map((r) => r.name),
    leads: leadsRes.rows.map((r) => r.name),
    signoffs: signRes.rows,
    tasks: tasksRes.rows,
    targets: settings.targets || SEED.targets,
    weights: settings.weights || SEED.weights
  });
});

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  await pool.query("UPDATE notifications SET is_read = true WHERE recipient_id = $1", [req.user.id]);
  res.json({ ok: true });
});

app.get("/api/leaderboard", requireAuth, requireRole("super_admin", "row_lead"), async (req, res) => {
  const month = String(req.query.month || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Invalid month" });
  const { rows } = await pool.query(
    `SELECT l.name AS lead,
      (SELECT COUNT(*)::int FROM users u WHERE u.role = 'user' AND u.status = 'Active' AND u.lead = l.name) AS employees,
      COALESCE(SUM(s.vobs), 0)::int AS vobs,
      COALESCE(SUM(s.calls), 0)::int AS calls,
      COALESCE(SUM(s.scheduling), 0)::int AS scheduling,
      COALESCE(SUM(s.payments), 0)::float AS payments,
      COALESCE(SUM(s.extra), 0)::int AS extra
     FROM leads l
     LEFT JOIN signoffs s ON s.lead_name = l.name AND s.date LIKE $1
     GROUP BY l.name
     ORDER BY l.name`,
    [`${month}-%`]
  );
  res.json({ teams: rows });
});

app.post("/api/users", requireAuth, requireRole("super_admin"), async (req, res) => {
  const first_name = String(req.body.first_name || "").trim();
  const last_name = String(req.body.last_name || "").trim();
  const name = `${first_name} ${last_name}`.trim();
  const dob = String(req.body.dob || "").trim();
  const pseudo_name = String(req.body.pseudo_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const designation = String(req.body.designation || "").trim();
  const role = ["super_admin", "row_lead", "user"].includes(req.body.role) ? req.body.role : "user";
  const lead = String(req.body.lead || "").trim();
  const status = req.body.status === "Inactive" ? "Inactive" : "Active";
  const username = req.body.username ? String(req.body.username).trim().toLowerCase() : null;
  const password = String(req.body.password || "");

  if (!first_name) return res.status(400).json({ error: "First name is required" });
  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: "DOB must be YYYY-MM-DD" });
  if (username && password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const hash = username && password ? await bcrypt.hash(password, 10) : null;
  const effectiveLead = role === "row_lead" ? (lead || name) : lead;

  try {
    if (role === "row_lead" && effectiveLead) {
      await pool.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [effectiveLead]);
    }
    const { rows } = await pool.query(
      `INSERT INTO users (first_name, last_name, name, dob, pseudo_name, email, designation, username, password_hash, role, lead, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, name`,
      [first_name, last_name, name, dob, pseudo_name, email, designation, username, hash, role, effectiveLead, status]
    );
    broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
    res.json({ user: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Full name or username already exists" });
    res.status(500).json({ error: "Failed to create account" });
  }
});

app.put("/api/users/:id", requireAuth, requireRole("super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  const existing = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  if (!existing.rows[0]) return res.status(404).json({ error: "Account not found" });
  const old = existing.rows[0];

  const first_name = String(req.body.first_name ?? old.first_name).trim();
  const last_name = String(req.body.last_name ?? old.last_name).trim();
  const name = `${first_name} ${last_name}`.trim() || old.name;
  const dob = String(req.body.dob ?? old.dob).trim();
  const pseudo_name = String(req.body.pseudo_name ?? old.pseudo_name).trim();
  const email = String(req.body.email ?? old.email).trim().toLowerCase();
  const designation = String(req.body.designation ?? old.designation).trim();
  const role = ["super_admin", "row_lead", "user"].includes(req.body.role) ? req.body.role : old.role;
  const lead = req.body.lead !== undefined ? String(req.body.lead).trim() : old.lead;
  const status = req.body.status === "Inactive" ? "Inactive" : "Active";
  const username = req.body.username !== undefined ? (String(req.body.username).trim().toLowerCase() || null) : old.username;
  const newPassword = String(req.body.password || "");

  if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return res.status(400).json({ error: "DOB must be YYYY-MM-DD" });
  if (newPassword && newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const hash = newPassword ? await bcrypt.hash(newPassword, 10) : old.password_hash;
  if (username && !hash) return res.status(400).json({ error: "Set an initial password for this username" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users SET first_name=$1, last_name=$2, name=$3, dob=$4, pseudo_name=$5, email=$6, designation=$7,
       username=$8, password_hash=$9, role=$10, lead=$11, status=$12 WHERE id=$13`,
      [first_name, last_name, name, dob, pseudo_name, email, designation, username, hash, role, lead, status, id]
    );
    if (name !== old.name) {
      await client.query("UPDATE assignments SET user_name=$1 WHERE user_name=$2", [name, old.name]);
      await client.query("UPDATE signoffs SET user_name=$1 WHERE user_name=$2", [name, old.name]);
      await client.query("UPDATE tasks SET assigned_to_name=$1 WHERE assigned_to_id=$2", [name, id]);
    }
    if (lead !== old.lead && role === "user") {
      await client.query("UPDATE signoffs SET lead_name=$1 WHERE user_name=$2", [lead, name]);
      await client.query("UPDATE tasks SET assigned_to_lead=$1 WHERE assigned_to_id=$2", [lead, id]);
    }
    if (role === "row_lead" && lead) {
      await client.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [lead]);
    }
    await client.query("COMMIT");
    broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Name or username already taken" });
    res.status(500).json({ error: "Update failed" });
  } finally {
    client.release();
  }
});

app.delete("/api/users/:id", requireAuth, requireRole("super_admin"), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "Cannot delete your own Admin account" });
  const { rows } = await pool.query("DELETE FROM users WHERE id = $1 RETURNING name", [id]);
  if (rows[0]) {
    await pool.query("DELETE FROM assignments WHERE user_name = $1", [rows[0].name]);
    await pool.query("DELETE FROM signoffs WHERE user_name = $1", [rows[0].name]);
    await pool.query("DELETE FROM tasks WHERE assigned_to_id = $1 OR assigned_by_id = $1", [id]);
    await pool.query("DELETE FROM notifications WHERE recipient_id = $1", [id]);
  }
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.post("/api/assignments", requireAuth, requireRole("super_admin"), async (req, res) => {
  if (!req.body.user || !req.body.practice) return res.status(400).json({ error: "User and practice required" });
  await pool.query("INSERT INTO assignments (user_name, practice_name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.body.user, req.body.practice]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.delete("/api/assignments", requireAuth, requireRole("super_admin"), async (req, res) => {
  await pool.query("DELETE FROM assignments WHERE user_name = $1 AND practice_name = $2", [req.body.user, req.body.practice]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.post("/api/practices", requireAuth, requireRole("super_admin"), async (req, res) => {
  const practice = String(req.body.practice || "").trim();
  if (!practice) return res.status(400).json({ error: "Practice name required" });
  await pool.query("INSERT INTO practices (name) VALUES ($1) ON CONFLICT DO NOTHING", [practice]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.delete("/api/practices/:name", requireAuth, requireRole("super_admin"), async (req, res) => {
  await pool.query("DELETE FROM practices WHERE name = $1", [req.params.name]);
  await pool.query("DELETE FROM assignments WHERE practice_name = $1", [req.params.name]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.post("/api/leads", requireAuth, requireRole("super_admin"), async (req, res) => {
  const lead = String(req.body.lead || "").trim();
  if (!lead) return res.status(400).json({ error: "Row lead name required" });
  await pool.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [lead]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.delete("/api/leads/:name", requireAuth, requireRole("super_admin"), async (req, res) => {
  const check = await pool.query("SELECT 1 FROM users WHERE lead = $1 LIMIT 1", [req.params.name]);
  if (check.rowCount > 0) return res.status(400).json({ error: "Reassign users before deleting this Row Lead" });
  await pool.query("DELETE FROM leads WHERE name = $1", [req.params.name]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.put("/api/settings", requireAuth, requireRole("super_admin"), async (req, res) => {
  await pool.query("INSERT INTO settings (key, value) VALUES ('targets', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(req.body.targets)]);
  await pool.query("INSERT INTO settings (key, value) VALUES ('weights', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(req.body.weights)]);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "Scoring settings updated by Admin" });
  res.json({ ok: true });
});

app.post("/api/signoffs", requireAuth, async (req, res) => {
  const date = String(req.body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Invalid date" });

  let targetUserName = String(req.body.user || "");
  if (req.user.role === "user") targetUserName = req.user.name;

  const targetRes = await pool.query("SELECT id, name, lead FROM users WHERE name = $1", [targetUserName]);
  if (!targetRes.rows[0]) return res.status(404).json({ error: "Employee not found" });
  const target = targetRes.rows[0];

  if (req.user.role === "row_lead") {
    const teamLead = req.user.lead || req.user.name;
    if (target.lead !== teamLead && target.name !== req.user.name) {
      return res.status(403).json({ error: "Row leads can only edit sign-offs for their own team" });
    }
  }

  const vobs = Math.max(0, parseInt(req.body.vobs, 10) || 0);
  const calls = Math.max(0, parseInt(req.body.calls, 10) || 0);
  const scheduling = Math.max(0, parseInt(req.body.scheduling, 10) || 0);
  const payments = Math.max(0, Number(req.body.payments) || 0);
  const extra = Math.max(0, parseInt(req.body.extra, 10) || 0);
  const notes = String(req.body.notes || "").slice(0, 2000);
  const updaterName = req.user.name;
  const updaterRole = roleLabel(req.user.role);

  await pool.query(
    `INSERT INTO signoffs (date, user_name, lead_name, vobs, calls, scheduling, payments, extra, notes, updated_by, updated_by_role, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
     ON CONFLICT (date, user_name) DO UPDATE SET
       lead_name=EXCLUDED.lead_name, vobs=EXCLUDED.vobs, calls=EXCLUDED.calls, scheduling=EXCLUDED.scheduling,
       payments=EXCLUDED.payments, extra=EXCLUDED.extra, notes=EXCLUDED.notes,
       updated_by=EXCLUDED.updated_by, updated_by_role=EXCLUDED.updated_by_role, updated_at=NOW()`,
    [date, target.name, target.lead || "", vobs, calls, scheduling, payments, extra, notes, updaterName, updaterRole]
  );

  await pool.query(
    `INSERT INTO signoff_logs (signoff_date, user_name, updated_by, updated_by_role, vobs, calls, scheduling, payments, extra, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [date, target.name, updaterName, updaterRole, vobs, calls, scheduling, payments, extra, notes]
  );

  // Create persistent notifications for Admin, Row Lead, and target User (excluding the actor)
  const recipients = new Set();
  const admins = await pool.query("SELECT id FROM users WHERE role = 'super_admin' AND status = 'Active'");
  admins.rows.forEach((a) => recipients.add(a.id));
  if (target.lead) {
    const leads = await pool.query(
      "SELECT id FROM users WHERE role = 'row_lead' AND status = 'Active' AND (lead = $1 OR name = $1)",
      [target.lead]
    );
    leads.rows.forEach((l) => recipients.add(l.id));
  }
  recipients.add(target.id);

  const notifTitle = `Sign-Off Updated: ${target.name} (${date})`;
  const notifMsg = `${updaterName} (${updaterRole}) updated sign-off for ${target.name} on ${date} — VOBs: ${vobs}, Calls: ${calls}, Sched: ${scheduling}, Payments: $${payments.toFixed(2)}, Extra: ${extra}.`;
  for (const recId of recipients) {
    if (recId === req.user.id) continue;
    await pool.query(
      "INSERT INTO notifications (recipient_id, type, title, message) VALUES ($1, 'signoff_updated', $2, $3)",
      [recId, notifTitle, notifMsg]
    );
  }

  // Push live update to Admin, that Row Lead's team lead, and the target user
  broadcastSync(
    (u) =>
      u.role === "super_admin" ||
      (u.role === "row_lead" && (u.lead || u.name) === (target.lead || "")) ||
      u.id === target.id,
    {
      type: "signoff_updated",
      actorId: req.user.id,
      toast: `${updaterName} updated sign-off for ${target.name} (${date})`
    }
  );

  res.json({ ok: true });
});

app.get("/api/signoffs/logs", requireAuth, async (req, res) => {
  const { date, user } = req.query;
  if (req.user.role === "user" && user !== req.user.name) return res.status(403).json({ error: "Access denied" });
  if (req.user.role === "row_lead") {
    const teamLead = req.user.lead || req.user.name;
    const uRes = await pool.query("SELECT lead FROM users WHERE name = $1", [user]);
    if (!uRes.rows[0] || uRes.rows[0].lead !== teamLead) return res.status(403).json({ error: "Access denied" });
  }
  const { rows } = await pool.query(
    "SELECT * FROM signoff_logs WHERE signoff_date = $1 AND user_name = $2 ORDER BY created_at DESC",
    [date, user]
  );
  res.json({ logs: rows });
});

app.post("/api/tasks", requireAuth, requireRole("super_admin", "row_lead"), async (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const timeframe = String(req.body.timeframe || "").trim();
  const due_date = String(req.body.due_date || "").trim();
  const assigneeId = Number(req.body.assigned_to_id);

  if (!title || !description || !timeframe || !assigneeId) {
    return res.status(400).json({ error: "Task title, nature/description, timeframe, and assignee are required" });
  }

  const targetRes = await pool.query("SELECT id, name, role, lead, status FROM users WHERE id = $1", [assigneeId]);
  const target = targetRes.rows[0];
  if (!target || target.status !== "Active") return res.status(404).json({ error: "Assignee not found or inactive" });

  if (req.user.role === "row_lead") {
    const teamLead = req.user.lead || req.user.name;
    if (target.role !== "user" || target.lead !== teamLead) {
      return res.status(403).json({ error: "Row leads can only assign tasks to users in their own team" });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO tasks (title, description, timeframe, due_date, assigned_to_id, assigned_to_name, assigned_to_role, assigned_to_lead, assigned_by_id, assigned_by_name, assigned_by_role)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [title, description, timeframe, due_date, target.id, target.name, target.role, target.lead || "", req.user.id, req.user.name, req.user.role]
  );

  await pool.query(
    `INSERT INTO notifications (recipient_id, type, title, message) VALUES ($1, 'task_assigned', $2, $3)`,
    [target.id, `New Task Assigned: ${title}`, `${req.user.name} (${roleLabel(req.user.role)}) assigned you a task. Timeframe: ${timeframe}. Details: ${description}`]
  );

  broadcastSync(
    (u) =>
      u.id === target.id ||
      u.role === "super_admin" ||
      (u.role === "row_lead" && (u.lead || u.name) === (target.lead || "")),
    {
      type: "task_assigned",
      actorId: req.user.id,
      toast: `New task "${title}" assigned to ${target.name}`
    }
  );

  res.json({ task: rows[0] });
});

app.post("/api/tasks/:id/complete", requireAuth, async (req, res) => {
  const taskId = Number(req.params.id);
  const completionNote = String(req.body.completion_note || "").trim();
  const tRes = await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId]);
  const task = tRes.rows[0];
  if (!task) return res.status(404).json({ error: "Task not found" });

  const canComplete =
    task.assigned_to_id === req.user.id ||
    req.user.role === "super_admin" ||
    (req.user.role === "row_lead" && task.assigned_to_lead === (req.user.lead || req.user.name));

  if (!canComplete) return res.status(403).json({ error: "Access denied" });

  await pool.query(
    "UPDATE tasks SET status = 'Completed', completion_note = $1, completed_at = NOW() WHERE id = $2",
    [completionNote, taskId]
  );

  const recipients = new Set();
  const admins = await pool.query("SELECT id FROM users WHERE role = 'super_admin' AND status = 'Active'");
  admins.rows.forEach((a) => recipients.add(a.id));

  if (task.assigned_to_lead) {
    const leads = await pool.query(
      "SELECT id FROM users WHERE role = 'row_lead' AND status = 'Active' AND (lead = $1 OR name = $1)",
      [task.assigned_to_lead]
    );
    leads.rows.forEach((l) => recipients.add(l.id));
  }

  const msg = `${task.assigned_to_name} completed task "${task.title}" (Timeframe: ${task.timeframe})${completionNote ? ` — Note: ${completionNote}` : ""}.`;
  for (const recId of recipients) {
    if (recId === req.user.id) continue;
    await pool.query(
      "INSERT INTO notifications (recipient_id, type, title, message) VALUES ($1, 'task_completed', $2, $3)",
      [recId, `Task Completed by ${task.assigned_to_name}`, msg]
    );
  }

  broadcastSync(
    (u) =>
      u.id === task.assigned_to_id ||
      u.role === "super_admin" ||
      (u.role === "row_lead" && (u.lead || u.name) === (task.assigned_to_lead || "")),
    {
      type: "task_completed",
      actorId: req.user.id,
      toast: `${task.assigned_to_name} completed task "${task.title}"`
    }
  );

  res.json({ ok: true });
});

function sendPdfReport(res, filename, title, subtitle, headers, rows, colWidths) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ margin: 32, size: "LETTER", layout: "landscape" });
  doc.pipe(res);

  const drawHeader = () => {
    doc.rect(32, 24, doc.page.width - 64, 46).fill("#1e3a8a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text("RhinoMDs Billing Services — Medical Virtual Assistant Department", 44, 34);
    doc.font("Helvetica").fontSize(9).fillColor("#dbeafe").text(`${title}   |   ${subtitle}   |   Generated: ${new Date().toLocaleString()}`, 44, 52);
    doc.moveDown(1.5);
  };

  const drawTableHeaders = (y) => {
    let x = 32;
    doc.rect(32, y, colWidths.reduce((a, b) => a + b, 0), 20).fill("#0f172a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    headers.forEach((h, i) => {
      doc.text(h, x + 4, y + 6, { width: colWidths[i] - 8, ellipsis: true });
      x += colWidths[i];
    });
    return y + 20;
  };

  drawHeader();
  let y = 82;
  y = drawTableHeaders(y);

  rows.forEach((row, idx) => {
    const rowH = 20;
    if (y + rowH > doc.page.height - 40) {
      doc.addPage({ margin: 32, size: "LETTER", layout: "landscape" });
      y = 32;
      y = drawTableHeaders(y);
    }
    if (idx % 2 === 1) doc.rect(32, y, colWidths.reduce((a, b) => a + b, 0), rowH).fill("#f8fafc");
    let x = 32;
    doc.fillColor("#0f172a").font("Helvetica").fontSize(8);
    row.forEach((cell, i) => {
      doc.text(String(cell ?? ""), x + 4, y + 6, { width: colWidths[i] - 8, ellipsis: true, lineBreak: false });
      x += colWidths[i];
    });
    y += rowH;
  });

  doc.end();
}

async function sendExcelReport(res, filename, sheetName, title, headers, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);

  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = `RhinoMDs Billing Services — ${title}`;
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: "FFFFFFFF" } };
  ws.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  ws.getRow(1).height = 26;

  const hRow = ws.addRow(headers);
  hRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } };
  });

  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((col) => {
    let max = 12;
    col.eachCell({ includeEmpty: true }, (c) => { max = Math.max(max, String(c.value ?? "").length + 3); });
    col.width = Math.min(max, 38);
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

app.get("/api/reports/signoffs/export", requireAuth, async (req, res) => {
  const format = req.query.format === "pdf" ? "pdf" : "xlsx";
  const { from = "", to = "", lead = "", user = "", q = "", status = "All" } = req.query;

  let query = 'SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs WHERE 1=1';
  const params = [];

  if (req.user.role === "user") {
    params.push(req.user.name);
    query += ` AND user_name = $${params.length}`;
  } else if (req.user.role === "row_lead") {
    params.push(req.user.lead || req.user.name);
    query += ` AND lead_name = $${params.length}`;
    if (user) { params.push(user); query += ` AND user_name = $${params.length}`; }
  } else {
    if (lead) { params.push(lead); query += ` AND lead_name = $${params.length}`; }
    if (user) { params.push(user); query += ` AND user_name = $${params.length}`; }
  }

  if (from) { params.push(from); query += ` AND date >= $${params.length}`; }
  if (to) { params.push(to); query += ` AND date <= $${params.length}`; }
  query += " ORDER BY date DESC";

  const { rows } = await pool.query(query, params);
  const filtered = rows.filter((s) => {
    const st = [s.vobs, s.calls, s.scheduling, s.payments, s.extra].some((v) => Number(v) > 0) || String(s.notes || "").trim() ? "Signed" : "Pending";
    const qMatch = !q || `${s.user} ${s.lead} ${s.notes} ${s.updated_by}`.toLowerCase().includes(String(q).toLowerCase());
    const stMatch = status === "All" || st === status;
    return qMatch && stMatch;
  });

  const headers = ["Date", "Employee", "Row Lead", "VOBs", "Calls", "Sched.", "Payments", "Extra", "Status", "Updated By", "Notes"];
  const data = filtered.map((s) => {
    const st = [s.vobs, s.calls, s.scheduling, s.payments, s.extra].some((v) => Number(v) > 0) || String(s.notes || "").trim() ? "Signed" : "Pending";
    return [s.date, s.user, s.lead, s.vobs, s.calls, s.scheduling, `$${Number(s.payments).toFixed(2)}`, s.extra, st, `${s.updated_by || "—"} (${s.updated_by_role || ""})`, s.notes];
  });

  if (format === "pdf") {
    return sendPdfReport(res, "rhinomds-signoff-report.pdf", "Daily Sign-Off Review Report", `${filtered.length} entries`, headers, data, [62, 95, 85, 38, 38, 42, 58, 38, 46, 105, 121]);
  }
  await sendExcelReport(res, "rhinomds-signoff-report.xlsx", "Sign-Off Report", "Daily Sign-Off Review Report", headers, data);
});

app.get("/api/reports/bonus/export", requireAuth, async (req, res) => {
  const format = req.query.format === "pdf" ? "pdf" : "xlsx";
  const month = String(req.query.month || orgTodayISO().slice(0, 7)).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Invalid month" });

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  let wd = 0;
  for (let d = 1; d <= lastDay; d++) {
    const dow = new Date(y, m - 1, d).getDay();
    if (dow !== 0 && dow !== 6) wd++;
  }

  let uQuery = "SELECT name, lead FROM users WHERE role = 'user' AND status = 'Active'";
  const uParams = [];
  if (req.user.role === "user") { uParams.push(req.user.name); uQuery += " AND name = $1"; }
  else if (req.user.role === "row_lead") { uParams.push(req.user.lead || req.user.name); uQuery += " AND lead = $1"; }
  uQuery += " ORDER BY name";

  const [uRes, aRes, sRes, setRes] = await Promise.all([
    pool.query(uQuery, uParams),
    pool.query("SELECT user_name, COUNT(*)::int AS c FROM assignments GROUP BY user_name"),
    pool.query("SELECT * FROM signoffs WHERE date LIKE $1", [`${month}-%`]),
    pool.query("SELECT key, value FROM settings")
  ]);

  const settings = {};
  setRes.rows.forEach((r) => (settings[r.key] = r.value));
  const t = settings.targets || SEED.targets;
  const w = settings.weights || SEED.weights;
  const pMap = {};
  aRes.rows.forEach((r) => (pMap[r.user_name] = r.c));

  const scores = uRes.rows.map((u) => {
    const rows = sRes.rows.filter((s) => s.user_name === u.name);
    const days = rows.filter((s) => s.vobs > 0 || s.calls > 0 || s.scheduling > 0 || Number(s.payments) > 0 || s.extra > 0 || s.notes.trim()).length;
    const pr = Math.max(1, pMap[u.name] || 0);
    const act = {
      vobs: rows.reduce((a, r) => a + r.vobs, 0),
      calls: rows.reduce((a, r) => a + r.calls, 0),
      scheduling: rows.reduce((a, r) => a + r.scheduling, 0),
      payments: rows.reduce((a, r) => a + Number(r.payments), 0),
      extra: rows.reduce((a, r) => a + r.extra, 0)
    };
    const att = {
      vobs: Math.min(1, act.vobs / Math.max(1, t.vobs * pr * wd)),
      calls: Math.min(1, act.calls / Math.max(1, t.calls * pr * wd)),
      scheduling: Math.min(1, act.scheduling / Math.max(1, t.scheduling * pr * wd)),
      payments: Math.min(1, act.payments / Math.max(1, t.payments * pr * wd)),
      extra: Math.min(1, act.extra / Math.max(1, t.extra * pr * wd)),
      consistency: Math.min(1, days / Math.max(1, wd))
    };
    const totW = Object.values(w).reduce((a, b) => a + Number(b), 0);
    const score = totW ? Math.round((10 * Object.keys(w).reduce((a, k) => a + att[k] * Number(w[k]), 0) / totW) * 10) / 10 : 0;
    const rating = score >= 9 ? "Excellent" : score >= 8 ? "Very good" : score >= 6.5 ? "Good" : score >= 5 ? "Average" : "Needs improvement";
    return { user: u.name, lead: u.lead, practices: pMap[u.name] || 0, days, act, score, rating };
  }).sort((a, b) => b.score - a.score);

  const headers = ["Rank", "Employee", "Row Lead", "Practices", "Days", "VOBs", "Calls", "Sched.", "Payments", "Extra", "Score / 10", "Rating"];
  const data = scores.map((s, i) => [`#${i + 1}`, s.user, s.lead, s.practices, s.days, s.act.vobs, s.act.calls, s.act.scheduling, `$${s.act.payments.toFixed(2)}`, s.act.extra, s.score.toFixed(1), s.rating]);

  if (format === "pdf") {
    return sendPdfReport(res, `rhinomds-bonus-${month}.pdf`, `Monthly Bonus Scorecard (${month})`, `${scores.length} employees`, headers, data, [36, 110, 95, 50, 40, 48, 48, 48, 65, 42, 58, 88]);
  }
  await sendExcelReport(res, `rhinomds-bonus-${month}.xlsx`, "Bonus Scorecard", `Monthly Bonus Scorecard (${month})`, headers, data);
});

app.post("/api/backup/restore", requireAuth, requireRole("super_admin"), async (req, res) => {
  const b = req.body;
  if (!b || !Array.isArray(b.users) || !Array.isArray(b.assignments) || !Array.isArray(b.signoffs) || !Array.isArray(b.leads)) {
    return res.status(400).json({ error: "Invalid backup JSON format" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("TRUNCATE leads, practices, assignments, signoffs RESTART IDENTITY");
    for (const l of b.leads) await client.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [l]);
    for (const p of (b.practices || [])) await client.query("INSERT INTO practices (name) VALUES ($1) ON CONFLICT DO NOTHING", [p]);
    for (const u of b.users) {
      if (u.role === "super_admin") continue;
      const { first, last } = splitName(u.name);
      await client.query(
        `INSERT INTO users (first_name, last_name, name, role, lead, status) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET lead = EXCLUDED.lead, status = EXCLUDED.status`,
        [u.first_name || first, u.last_name || last, u.name, u.role || "user", u.lead || "", u.status || "Active"]
      );
    }
    for (const a of b.assignments) {
      await client.query("INSERT INTO assignments (user_name, practice_name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a.user, a.practice]);
    }
    for (const s of b.signoffs) {
      await client.query(
        `INSERT INTO signoffs (date, user_name, lead_name, vobs, calls, scheduling, payments, extra, notes, updated_by, updated_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (date, user_name) DO NOTHING`,
        [s.date, s.user, s.lead || "", parseInt(s.vobs, 10) || 0, parseInt(s.calls, 10) || 0, parseInt(s.scheduling, 10) || 0, Number(s.payments) || 0, parseInt(s.extra, 10) || 0, s.notes || "", s.updated_by || req.user.name, s.updated_by_role || "Admin"]
      );
    }
    if (b.targets) await client.query("INSERT INTO settings (key, value) VALUES ('targets', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(b.targets)]);
    if (b.weights) await client.query("INSERT INTO settings (key, value) VALUES ('weights', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(b.weights)]);
    await client.query("COMMIT");
    broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "Database restored by Admin" });
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Restore failed: " + err.message });
  } finally {
    client.release();
  }
});

initDB()
  .then(() => app.listen(PORT, () => console.log(`RhinoMDs Medical VA Portal running on port ${PORT}`)))
  .catch((err) => { console.error("Database initialization error:", err); process.exit(1); });
