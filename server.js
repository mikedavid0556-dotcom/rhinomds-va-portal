require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const { pool, SEED, initDB, splitName } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const isProd = process.env.NODE_ENV === "production";

if (isProd) app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"]
      }
    }
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const sseClients = new Set();

function broadcastSync(filterFn, payload) {
  const msg = `event: sync\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      if (!filterFn || filterFn(client.user)) client.res.write(msg);
    } catch {}
  }
}

const loginAttempts = new Map();

function getClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
}

async function getOrgTodayISO() {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'clock'");
    const dstOn = Boolean(rows[0]?.value?.daylightSaving);
    const offsetHours = dstOn ? -4 : -5;
    return new Date(Date.now() + offsetHours * 3600 * 1000).toISOString().slice(0, 10);
  } catch {
    return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

function roleLabel(r) {
  return r === "super_admin" ? "Admin" : r === "row_lead" ? "Row Lead" : "User";
}

function validateStrongPassword(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters long";
  if (!/[A-Z]/.test(pw)) return "Password must contain at least 1 uppercase letter";
  if (!/[a-z]/.test(pw)) return "Password must contain at least 1 lowercase letter";
  if (!/[0-9]/.test(pw)) return "Password must contain at least 1 number";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must contain at least 1 special character (!@#$%...)";
  return null;
}

async function logAudit(actor, action, details, req) {
  try {
    await pool.query(
      "INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, details, ip_address) VALUES ($1,$2,$3,$4,$5,$6)",
      [actor?.id || null, actor?.name || "System", actor?.role ? roleLabel(actor.role) : "", action, details, req ? getClientIp(req) : ""]
    );
  } catch {}
}

async function getIdleMinutes() {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'security'");
    return Math.max(5, Number(rows[0]?.value?.idleTimeoutMinutes) || 15);
  } catch {
    return 15;
  }
}

async function setSeatStatus(user, status, note = "") {
  const shiftDate = await getOrgTodayISO();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE presence_logs SET ended_at = NOW() WHERE user_id = $1 AND ended_at IS NULL", [user.id]);
    if (status !== "Offline") {
      await client.query(
        "INSERT INTO presence_logs (user_id, user_name, lead_name, shift_date, status, note) VALUES ($1,$2,$3,$4,$5,$6)",
        [user.id, user.name, user.lead || "", shiftDate, status, note]
      );
    }
    await client.query("UPDATE users SET seat_status = $1, seat_note = $2, seat_updated_at = NOW() WHERE id = $3", [status, note, user.id]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function closeUserSession(sessionId, user, reason = "Logout") {
  if (sessionId) await pool.query("UPDATE sessions SET revoked = true WHERE id = $1", [sessionId]);
  if (user) {
    const activeSess = await pool.query("SELECT 1 FROM sessions WHERE user_id = $1 AND revoked = false AND expires_at > NOW() LIMIT 1", [user.id]);
    if (activeSess.rowCount === 0) {
      await setSeatStatus(user, "Offline", reason);
      broadcastSync(
        (u) => u.role === "super_admin" || (u.role === "row_lead" && (u.lead || u.name) === (user.lead || "")),
        { type: "presence_updated", actorId: user.id, toast: `${user.name} went Offline (${reason})` }
      );
    }
  }
}

setInterval(async () => {
  try {
    const idleMins = await getIdleMinutes();
    const { rows } = await pool.query(
      `SELECT s.id AS session_id, u.id, u.name, u.role, u.lead
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.revoked = false AND (s.expires_at < NOW() OR s.last_activity_at < NOW() - ($1 || ' minutes')::interval)`,
      [idleMins]
    );
    for (const row of rows) {
      await closeUserSession(row.session_id, row, "Auto-Logoff (Idle)");
      await logAudit(row, "AUTO_LOGOFF", "Session closed due to inactivity", null);
    }
  } catch {}
}, 60000);

async function requireAuth(req, res, next) {
  const token = req.cookies.medva_token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const sRes = await pool.query("SELECT * FROM sessions WHERE id = $1", [decoded.sid]);
    const sess = sRes.rows[0];
    if (!sess || sess.revoked || new Date(sess.expires_at) < new Date()) {
      return res.status(401).json({ error: "Session expired. Please sign in again." });
    }
    const idleMins = await getIdleMinutes();
    const idleMs = Date.now() - new Date(sess.last_activity_at).getTime();
    const { rows } = await pool.query(
      "SELECT id, first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, role, lead, status, seat_status, seat_note, seat_updated_at FROM users WHERE id = $1",
      [decoded.id]
    );
    const user = rows[0];
    if (!user || user.status !== "Active") return res.status(401).json({ error: "Account inactive or missing" });
    if (idleMs > idleMins * 60 * 1000) {
      await closeUserSession(sess.id, user, "Auto-Logoff (Idle)");
      await logAudit(user, "AUTO_LOGOFF", `Timed out after ${idleMins} minutes of inactivity`, req);
      return res.status(401).json({ error: "Logged out automatically due to inactivity." });
    }
    if (req.path !== "/events" && req.query.bg !== "1") {
      await pool.query("UPDATE sessions SET last_activity_at = NOW() WHERE id = $1", [sess.id]);
    }
    req.user = user;
    req.sessionId = sess.id;
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

app.get("/api/events", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const client = { user: req.user, res };
  sseClients.add(client);
  const hb = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
  req.on("close", () => { clearInterval(hb); sseClients.delete(client); });
});

app.post("/api/auth/ping", requireAuth, (req, res) => res.json({ ok: true }));

app.post("/api/auth/login", async (req, res) => {
  const selectedRole = String(req.body.role || "");
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const ip = getClientIp(req);
  const key = `${ip}|${username}`;

  const rec = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  if (rec.lockedUntil > Date.now()) {
    const minsLeft = Math.ceil((rec.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Locked for ${minsLeft} minute(s).` });
  }
  if (!["super_admin", "row_lead", "user"].includes(selectedRole)) return res.status(400).json({ error: "Please select Admin, Row Lead, or User" });
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });

  const { rows } = await pool.query("SELECT * FROM users WHERE LOWER(username) = $1", [username]);
  const user = rows[0];
  const validPw = user && user.password_hash ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !validPw || user.status !== "Active" || user.role !== selectedRole) {
    rec.count += 1;
    if (rec.count >= 5) { rec.lockedUntil = Date.now() + 15 * 60 * 1000; rec.count = 0; }
    loginAttempts.set(key, rec);
    await logAudit({ id: user?.id || null, name: username, role: selectedRole }, "LOGIN_FAILED", `Failed login (${selectedRole})`, req);
    if (user && user.status !== "Active") return res.status(403).json({ error: "Account is inactive. Contact Admin." });
    if (user && validPw && user.role !== selectedRole) return res.status(403).json({ error: `Account is registered as ${roleLabel(user.role)}, not ${roleLabel(selectedRole)}.` });
    return res.status(401).json({ error: "Invalid username or password" });
  }

  loginAttempts.delete(key);
  const sid = crypto.randomBytes(24).toString("hex");
  await pool.query("INSERT INTO sessions (id, user_id, ip_address, expires_at) VALUES ($1, $2, $3, NOW() + interval '12 hours')", [sid, user.id, ip]);
  await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
  await setSeatStatus(user, "Available", "Signed in");
  await logAudit(user, "LOGIN_SUCCESS", `Signed in as ${roleLabel(user.role)}`, req);

  broadcastSync(
    (u) => u.role === "super_admin" || (u.role === "row_lead" && (u.lead || u.name) === (user.lead || "")),
    { type: "presence_updated", actorId: user.id, toast: `${user.name} logged in (Available)` }
  );

  const token = jwt.sign({ id: user.id, sid, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
  res.cookie("medva_token", token, { httpOnly: true, sameSite: "lax", secure: isProd, maxAge: 12 * 60 * 60 * 1000 });
  res.json({ ok: true });
});

app.post("/api/auth/logout", async (req, res) => {
  const token = req.cookies.medva_token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const { rows } = await pool.query("SELECT id, name, role, lead FROM users WHERE id = $1", [decoded.id]);
      const reason = req.body?.reason === "idle" ? "Auto-Logoff (Idle)" : "Logged Out";
      await closeUserSession(decoded.sid, rows[0], reason);
      if (rows[0]) await logAudit(rows[0], req.body?.reason === "idle" ? "AUTO_LOGOFF" : "LOGOUT", reason, req);
    } catch {}
  }
  res.clearCookie("medva_token");
  res.json({ ok: true });
});

app.get("/api/bootstrap", requireAuth, async (req, res) => {
  const role = req.user.role;
  const orgToday = await getOrgTodayISO();

  const [leadsRes, practicesRes, settingsRes, notifRes] = await Promise.all([
    pool.query("SELECT name FROM leads ORDER BY name"),
    pool.query("SELECT name FROM practices ORDER BY name"),
    pool.query("SELECT key, value FROM settings"),
    pool.query("SELECT * FROM notifications WHERE recipient_id = $1 ORDER BY created_at DESC LIMIT 40", [req.user.id])
  ]);

  const settings = {};
  settingsRes.rows.forEach((r) => (settings[r.key] = r.value));

  let usersRes, assignRes, signRes, activeSessRes, auditRes;
  if (role === "super_admin") {
    [usersRes, assignRes, signRes, activeSessRes, auditRes] = await Promise.all([
      pool.query("SELECT id, first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, role, lead, status, seat_status, seat_note, seat_updated_at, last_login_at, (password_hash IS NOT NULL) AS has_password FROM users ORDER BY role, name"),
      pool.query('SELECT user_name AS "user", practice_name AS practice FROM assignments ORDER BY user_name'),
      pool.query('SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs ORDER BY date DESC'),
      pool.query("SELECT DISTINCT user_id FROM sessions WHERE revoked = false AND expires_at > NOW()"),
      pool.query("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200")
    ]);
  } else if (role === "row_lead") {
    const teamLead = req.user.lead || req.user.name;
    [usersRes, assignRes, signRes] = await Promise.all([
      pool.query("SELECT id, first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, role, lead, status, seat_status, seat_note, seat_updated_at FROM users WHERE role = 'user' AND lead = $1 ORDER BY name", [teamLead]),
      pool.query('SELECT a.user_name AS "user", a.practice_name AS practice FROM assignments a JOIN users u ON a.user_name = u.name WHERE u.lead = $1', [teamLead]),
      pool.query('SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs WHERE lead_name = $1 ORDER BY date DESC', [teamLead])
    ]);
  } else {
    [usersRes, assignRes, signRes] = await Promise.all([
      pool.query("SELECT id, first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, role, lead, status, seat_status, seat_note, seat_updated_at FROM users WHERE id = $1", [req.user.id]),
      pool.query('SELECT user_name AS "user", practice_name AS practice FROM assignments WHERE user_name = $1', [req.user.name]),
      pool.query('SELECT date, user_name AS "user", lead_name AS lead, vobs, calls, scheduling, payments::float, extra, notes, updated_by, updated_by_role, updated_at FROM signoffs WHERE user_name = $1 ORDER BY date DESC', [req.user.name])
    ]);
  }

  res.json({
    currentUser: req.user,
    orgToday,
    notifications: notifRes.rows,
    users: usersRes.rows,
    onlineUserIds: activeSessRes ? activeSessRes.rows.map((r) => r.user_id) : [],
    assignments: assignRes.rows,
    practices: practicesRes.rows.map((r) => r.name),
    leads: leadsRes.rows.map((r) => r.name),
    signoffs: signRes.rows,
    auditLogs: auditRes ? auditRes.rows : [],
    breaks: settings.breaks || SEED.breaks,
    security: settings.security || SEED.security,
    clock: settings.clock || SEED.clock,
    targets: role === "super_admin" ? (settings.targets || SEED.targets) : null,
    weights: role === "super_admin" ? (settings.weights || SEED.weights) : null
  });
});

app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  await pool.query("UPDATE notifications SET is_read = true WHERE recipient_id = $1", [req.user.id]);
  res.json({ ok: true });
});

app.post("/api/presence", requireAuth, async (req, res) => {
  const allowed = ["Available", "Short Break", "Away"];
  const status = String(req.body.status || "");
  const note = String(req.body.note || "").trim().slice(0, 200);
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid seat status" });

  await setSeatStatus(req.user, status, note);
  await logAudit(req.user, "SEAT_STATUS", `Changed seat status to ${status}${note ? ` (${note})` : ""}`, req);

  if (status !== "Available") {
    const recipients = new Set();
    const admins = await pool.query("SELECT id FROM users WHERE role = 'super_admin' AND status = 'Active'");
    admins.rows.forEach((a) => recipients.add(a.id));
    if (req.user.lead) {
      const leads = await pool.query("SELECT id FROM users WHERE role = 'row_lead' AND status = 'Active' AND (lead = $1 OR name = $1)", [req.user.lead]);
      leads.rows.forEach((l) => recipients.add(l.id));
    }
    for (const recId of recipients) {
      if (recId === req.user.id) continue;
      await pool.query("INSERT INTO notifications (recipient_id, type, title, message) VALUES ($1, 'presence', $2, $3)",
        [recId, `${req.user.name} is ${status}`, `${req.user.name} switched seat status to ${status}${note ? ` (${note})` : ""}.`]);
    }
  }

  broadcastSync(
    (u) => u.role === "super_admin" || (u.role === "row_lead" && (u.lead || u.name) === (req.user.lead || "")) || u.id === req.user.id,
    { type: "presence_updated", actorId: req.user.id, toast: `${req.user.name} is now ${status}` }
  );
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
     GROUP BY l.name ORDER BY l.name`,
    [`${month}-%`]
  );
  res.json({ teams: rows });
});

app.post("/api/users", requireAuth, requireRole("super_admin"), async (req, res) => {
  const first_name = String(req.body.first_name || "").trim();
  const last_name = String(req.body.last_name || "").trim();
  const name = `${first_name} ${last_name}`.trim();
  const date_of_joining = String(req.body.date_of_joining || "").trim();
  const pseudo_name = String(req.body.pseudo_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const designation = String(req.body.designation || "").trim();
  const role = ["super_admin", "row_lead", "user"].includes(req.body.role) ? req.body.role : "user";
  const lead = String(req.body.lead || "").trim();
  const status = req.body.status === "Inactive" ? "Inactive" : "Active";
  const username = req.body.username ? String(req.body.username).trim().toLowerCase() : null;
  const password = String(req.body.password || "");

  if (!first_name) return res.status(400).json({ error: "First name is required" });
  if (date_of_joining && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_joining)) return res.status(400).json({ error: "Date of Joining must be YYYY-MM-DD" });
  if (username) {
    const pwErr = validateStrongPassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
  }

  const hash = username && password ? await bcrypt.hash(password, 10) : null;
  const effectiveLead = role === "row_lead" ? (lead || name) : lead;

  try {
    if (role === "row_lead" && effectiveLead) await pool.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [effectiveLead]);
    const { rows } = await pool.query(
      `INSERT INTO users (first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, password_hash, role, lead, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, name`,
      [first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, hash, role, effectiveLead, status]
    );
    await logAudit(req.user, "USER_CREATE", `Created ${roleLabel(role)} account: ${name}`, req);
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
  const date_of_joining = String(req.body.date_of_joining ?? old.date_of_joining).trim();
  const pseudo_name = String(req.body.pseudo_name ?? old.pseudo_name).trim();
  const email = String(req.body.email ?? old.email).trim().toLowerCase();
  const designation = String(req.body.designation ?? old.designation).trim();
  const role = ["super_admin", "row_lead", "user"].includes(req.body.role) ? req.body.role : old.role;
  const lead = req.body.lead !== undefined ? String(req.body.lead).trim() : old.lead;
  const status = req.body.status === "Inactive" ? "Inactive" : "Active";
  const username = req.body.username !== undefined ? (String(req.body.username).trim().toLowerCase() || null) : old.username;
  const newPassword = String(req.body.password || "");

  if (date_of_joining && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_joining)) return res.status(400).json({ error: "Date of Joining must be YYYY-MM-DD" });
  if (newPassword) {
    const pwErr = validateStrongPassword(newPassword);
    if (pwErr) return res.status(400).json({ error: pwErr });
  }

  const hash = newPassword ? await bcrypt.hash(newPassword, 10) : old.password_hash;
  if (username && !hash) return res.status(400).json({ error: "Set a strong initial password for this username" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users SET first_name=$1, last_name=$2, name=$3, date_of_joining=$4, pseudo_name=$5, email=$6, designation=$7,
       username=$8, password_hash=$9, role=$10, lead=$11, status=$12 WHERE id=$13`,
      [first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, hash, role, lead, status, id]
    );
    if (name !== old.name) {
      await client.query("UPDATE assignments SET user_name=$1 WHERE user_name=$2", [name, old.name]);
      await client.query("UPDATE signoffs SET user_name=$1 WHERE user_name=$2", [name, old.name]);
      await client.query("UPDATE presence_logs SET user_name=$1 WHERE user_id=$2", [name, id]);
    }
    if (lead !== old.lead && role === "user") {
      await client.query("UPDATE signoffs SET lead_name=$1 WHERE user_name=$2", [lead, name]);
      await client.query("UPDATE presence_logs SET lead_name=$1 WHERE user_id=$2", [lead, id]);
    }
    if (role === "row_lead" && lead) await client.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [lead]);
    if (status === "Inactive" || newPassword) await client.query("UPDATE sessions SET revoked = true WHERE user_id = $1", [id]);
    await client.query("COMMIT");
    await logAudit(req.user, "USER_UPDATE", `Updated account ${name}${newPassword ? " (password changed)" : ""}`, req);
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
    await pool.query("DELETE FROM sessions WHERE user_id = $1", [id]);
    await pool.query("DELETE FROM presence_logs WHERE user_id = $1", [id]);
    await pool.query("DELETE FROM notifications WHERE recipient_id = $1", [id]);
    await logAudit(req.user, "USER_DELETE", `Deleted account: ${rows[0].name}`, req);
  }
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.post("/api/assignments", requireAuth, requireRole("super_admin"), async (req, res) => {
  if (!req.body.user || !req.body.practice) return res.status(400).json({ error: "User and practice required" });
  await pool.query("INSERT INTO assignments (user_name, practice_name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [req.body.user, req.body.practice]);
  await logAudit(req.user, "ASSIGNMENT_ADD", `${req.body.user} <-> ${req.body.practice}`, req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.delete("/api/assignments", requireAuth, requireRole("super_admin"), async (req, res) => {
  await pool.query("DELETE FROM assignments WHERE user_name = $1 AND practice_name = $2", [req.body.user, req.body.practice]);
  await logAudit(req.user, "ASSIGNMENT_REMOVE", `${req.body.user} <-> ${req.body.practice}`, req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.post("/api/practices", requireAuth, requireRole("super_admin"), async (req, res) => {
  const practice = String(req.body.practice || "").trim();
  if (!practice) return res.status(400).json({ error: "Practice name required" });
  await pool.query("INSERT INTO practices (name) VALUES ($1) ON CONFLICT DO NOTHING", [practice]);
  await logAudit(req.user, "PRACTICE_ADD", practice, req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.delete("/api/practices/:name", requireAuth, requireRole("super_admin"), async (req, res) => {
  await pool.query("DELETE FROM practices WHERE name = $1", [req.params.name]);
  await pool.query("DELETE FROM assignments WHERE practice_name = $1", [req.params.name]);
  await logAudit(req.user, "PRACTICE_DELETE", req.params.name, req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.post("/api/leads", requireAuth, requireRole("super_admin"), async (req, res) => {
  const lead = String(req.body.lead || "").trim();
  if (!lead) return res.status(400).json({ error: "Row lead name required" });
  await pool.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [lead]);
  await logAudit(req.user, "LEAD_ADD", lead, req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.delete("/api/leads/:name", requireAuth, requireRole("super_admin"), async (req, res) => {
  const check = await pool.query("SELECT 1 FROM users WHERE lead = $1 LIMIT 1", [req.params.name]);
  if (check.rowCount > 0) return res.status(400).json({ error: "Reassign users before deleting this Row Lead" });
  await pool.query("DELETE FROM leads WHERE name = $1", [req.params.name]);
  await logAudit(req.user, "LEAD_DELETE", req.params.name, req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "" });
  res.json({ ok: true });
});

app.put("/api/settings", requireAuth, requireRole("super_admin"), async (req, res) => {
  if (req.body.targets) await pool.query("INSERT INTO settings (key, value) VALUES ('targets', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(req.body.targets)]);
  if (req.body.weights) await pool.query("INSERT INTO settings (key, value) VALUES ('weights', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(req.body.weights)]);
  if (req.body.breaks) await pool.query("INSERT INTO settings (key, value) VALUES ('breaks', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(req.body.breaks)]);
  if (req.body.security) await pool.query("INSERT INTO settings (key, value) VALUES ('security', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(req.body.security)]);
  if (req.body.clock) {
    const cleanClock = { daylightSaving: Boolean(req.body.clock.daylightSaving) };
    await pool.query("INSERT INTO settings (key, value) VALUES ('clock', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(cleanClock)]);
  }
  await logAudit(req.user, "SETTINGS_UPDATE", "Updated scoring, break schedule, DST clock, or security settings", req);
  broadcastSync(null, { type: "data_updated", actorId: req.user.id, toast: "Settings & Clock updated by Admin" });
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
  await logAudit(req.user, "SIGNOFF_SAVE", `Saved sign-off for ${target.name} on ${date}`, req);

  const recipients = new Set();
  const admins = await pool.query("SELECT id FROM users WHERE role = 'super_admin' AND status = 'Active'");
  admins.rows.forEach((a) => recipients.add(a.id));
  if (target.lead) {
    const leads = await pool.query("SELECT id FROM users WHERE role = 'row_lead' AND status = 'Active' AND (lead = $1 OR name = $1)", [target.lead]);
    leads.rows.forEach((l) => recipients.add(l.id));
  }
  recipients.add(target.id);

  const notifTitle = `Sign-Off Updated: ${target.name} (${date})`;
  const notifMsg = `${updaterName} (${updaterRole}) updated sign-off for ${target.name} on ${date} — VOBs: ${vobs}, Calls: ${calls}, Sched: ${scheduling}, Payments: $${payments.toFixed(2)}, Extra: ${extra}.`;
  for (const recId of recipients) {
    if (recId === req.user.id) continue;
    await pool.query("INSERT INTO notifications (recipient_id, type, title, message) VALUES ($1, 'signoff_updated', $2, $3)", [recId, notifTitle, notifMsg]);
  }

  broadcastSync(
    (u) => u.role === "super_admin" || (u.role === "row_lead" && (u.lead || u.name) === (target.lead || "")) || u.id === target.id,
    { type: "signoff_updated", actorId: req.user.id, toast: `${updaterName} updated sign-off for ${target.name} (${date})` }
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
  const { rows } = await pool.query("SELECT * FROM signoff_logs WHERE signoff_date = $1 AND user_name = $2 ORDER BY created_at DESC", [date, user]);
  res.json({ logs: rows });
});

async function buildClockSummary(from, to, leadFilter = "", userFilter = "") {
  let uSql = "SELECT id, name, role, lead, seat_status, status FROM users WHERE status = 'Active' AND role IN ('user', 'row_lead')";
  const uParams = [];
  if (leadFilter) { uParams.push(leadFilter); uSql += ` AND lead = $${uParams.length}`; }
  if (userFilter) { uParams.push(userFilter); uSql += ` AND name = $${uParams.length}`; }
  uSql += " ORDER BY role, name";

  const [uRes, pRes, bRes] = await Promise.all([
    pool.query(uSql, uParams),
    pool.query("SELECT * FROM presence_logs WHERE shift_date >= $1 AND shift_date <= $2", [from, to]),
    pool.query("SELECT value FROM settings WHERE key = 'breaks'")
  ]);

  const now = Date.now();
  const rows = uRes.rows.map((u) => {
    const logs = pRes.rows.filter((l) => l.user_id === u.id);
    let availableSec = 0, breakSec = 0, awaySec = 0, breakCount = 0, awayCount = 0;
    for (const l of logs) {
      const end = l.ended_at ? new Date(l.ended_at).getTime() : now;
      const dur = Math.max(0, (end - new Date(l.started_at).getTime()) / 1000);
      if (l.status === "Available") availableSec += dur;
      else if (l.status === "Short Break") { breakSec += dur; breakCount += 1; }
      else if (l.status === "Away") { awaySec += dur; awayCount += 1; }
    }
    return {
      id: u.id, name: u.name, role: roleLabel(u.role), lead: u.lead || "—",
      current_status: u.seat_status || "Offline",
      on_seat_minutes: Math.round(availableSec / 60),
      break_minutes: Math.round(breakSec / 60),
      away_minutes: Math.round(awaySec / 60),
      out_of_seat_minutes: Math.round((breakSec + awaySec) / 60),
      break_count: breakCount, away_count: awayCount
    };
  });
  return { rows, breaks: bRes.rows[0]?.value || SEED.breaks };
}

function fmtMins(m) { return `${Math.floor(m / 60)}h ${m % 60}m`; }

app.get("/api/reports/clock-summary", requireAuth, requireRole("super_admin"), async (req, res) => {
  const today = await getOrgTodayISO();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today;
  const result = await buildClockSummary(from, to, req.query.lead || "", req.query.user || "");
  res.json({ from, to, ...result });
});

app.get("/api/reports/clock-summary/export", requireAuth, requireRole("super_admin"), async (req, res) => {
  const format = req.query.format === "pdf" ? "pdf" : "xlsx";
  const today = await getOrgTodayISO();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : today;
  const { rows } = await buildClockSummary(from, to, req.query.lead || "", req.query.user || "");
  await logAudit(req.user, "REPORT_EXPORT", `Exported Clock Summary (${format.toUpperCase()}) for ${from} to ${to}`, req);

  const headers = ["Employee", "Role", "Row Lead", "Live Status", "On Seat", "Short Break", "Away", "Total Out of Seat", "Breaks Taken", "Away Count"];
  const data = rows.map((r) => [
    r.name, r.role, r.lead, r.current_status,
    fmtMins(r.on_seat_minutes), fmtMins(r.break_minutes), fmtMins(r.away_minutes),
    fmtMins(r.out_of_seat_minutes), r.break_count, r.away_count
  ]);

  if (format === "pdf") {
    return sendPdfReport(res, `rhinomds-clock-summary-${from}.pdf`, `Seat & Break Clock Summary (${from} to ${to})`, `${rows.length} users`, headers, data, [110, 55, 95, 70, 68, 68, 62, 82, 58, 60]);
  }
  await sendExcelReport(res, `rhinomds-clock-summary-${from}.xlsx`, "Clock Summary", `Seat & Break Clock Summary (${from} to ${to})`, headers, data);
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
  };
  const drawTableHeaders = (y) => {
    let x = 32;
    doc.rect(32, y, colWidths.reduce((a, b) => a + b, 0), 20).fill("#0f172a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    headers.forEach((h, i) => { doc.text(h, x + 4, y + 6, { width: colWidths[i] - 8, ellipsis: true }); x += colWidths[i]; });
    return y + 20;
  };

  drawHeader();
  let y = drawTableHeaders(82);
  rows.forEach((row, idx) => {
    if (y + 20 > doc.page.height - 40) { doc.addPage({ margin: 32, size: "LETTER", layout: "landscape" }); y = drawTableHeaders(32); }
    if (idx % 2 === 1) doc.rect(32, y, colWidths.reduce((a, b) => a + b, 0), 20).fill("#f8fafc");
    let x = 32;
    doc.fillColor("#0f172a").font("Helvetica").fontSize(8);
    row.forEach((cell, i) => { doc.text(String(cell ?? ""), x + 4, y + 6, { width: colWidths[i] - 8, ellipsis: true, lineBreak: false }); x += colWidths[i]; });
    y += 20;
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
  hRow.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } }; });
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
    params.push(req.user.name); query += ` AND user_name = $${params.length}`;
  } else if (req.user.role === "row_lead") {
    params.push(req.user.lead || req.user.name); query += ` AND lead_name = $${params.length}`;
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
    return qMatch && (status === "All" || st === status);
  });

  await logAudit(req.user, "REPORT_EXPORT", `Exported Sign-Off Report (${format.toUpperCase()}, ${filtered.length} rows)`, req);

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

app.get("/api/reports/bonus/export", requireAuth, requireRole("super_admin"), async (req, res) => {
  const format = req.query.format === "pdf" ? "pdf" : "xlsx";
  const today = await getOrgTodayISO();
  const month = String(req.query.month || today.slice(0, 7)).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Invalid month" });

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  let wd = 0;
  for (let d = 1; d <= lastDay; d++) { const dow = new Date(y, m - 1, d).getDay(); if (dow !== 0 && dow !== 6) wd++; }

  const [uRes, aRes, sRes, setRes] = await Promise.all([
    pool.query("SELECT name, lead FROM users WHERE role = 'user' AND status = 'Active' ORDER BY name"),
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

  await logAudit(req.user, "REPORT_EXPORT", `Exported Monthly Bonus (${format.toUpperCase()}) for ${month}`, req);

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

    const keepNames = b.users.map((u) => u.name);
    await client.query("DELETE FROM users WHERE role <> 'super_admin' AND NOT (name = ANY($1::text[]))", [keepNames]);

    for (const u of b.users) {
      if (u.role === "super_admin") continue;
      const { first, last } = splitName(u.name);
      await client.query(
        `INSERT INTO users (first_name, last_name, name, date_of_joining, pseudo_name, email, designation, username, role, lead, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (name) DO UPDATE SET
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           pseudo_name = EXCLUDED.pseudo_name,
           email = EXCLUDED.email,
           designation = EXCLUDED.designation,
           username = COALESCE(EXCLUDED.username, users.username),
           role = EXCLUDED.role,
           lead = EXCLUDED.lead,
           status = EXCLUDED.status`,
        [
          u.first_name || first, u.last_name || last, u.name, u.date_of_joining || "",
          u.pseudo_name || "", u.email || "", u.designation || "Medical Virtual Assistant",
          u.username || null, u.role || "user", u.lead || "", u.status || "Active"
        ]
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
    if (b.breaks) await client.query("INSERT INTO settings (key, value) VALUES ('breaks', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(b.breaks)]);
    if (b.clock) await client.query("INSERT INTO settings (key, value) VALUES ('clock', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [JSON.stringify(b.clock)]);
    await client.query("COMMIT");
    await logAudit(req.user, "BACKUP_RESTORE", "Restored database snapshot", req);
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
