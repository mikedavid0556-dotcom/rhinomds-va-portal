const LOGO_SVG = `
<svg class="logo-fallback" viewBox="0 0 305 84" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:none">
  <path d="M27 31C26 19 28 11 33 10C36 16 37 23 37 29" stroke="#884EA0" stroke-width="2.1" stroke-linecap="round"/>
  <path d="M23 22C18 30 18 41 23 50" stroke="#884EA0" stroke-width="1.8" stroke-linecap="round"/>
  <path d="M37 29C43 29 47 24 49 18C50 24 52 30 55 31C61 29 66 20 69 14C70 25 66 38 59 46C54 52 46 55 39 55" stroke="#884EA0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M16 63C24 70 35 70 45 64" stroke="#884EA0" stroke-width="2" stroke-linecap="round"/>
  <circle cx="43" cy="38" r="1.4" fill="#884EA0"/>
  <text x="80" y="33" font-family="Georgia, 'Times New Roman', serif" font-size="27" fill="#7c8594">RhinoMDs</text>
  <text x="80" y="58" font-family="Georgia, 'Times New Roman', serif" font-size="24" fill="#7c8594">Billing Services</text>
  <text x="80" y="75" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="11.2" fill="#884EA0">Your Strength In Practice Management</text>
</svg>`;

function logoBlock(cls = "rhino-logo-pill") {
  return `<div class="${cls}"><img class="logo-img" src="/logo.png" alt="RhinoMDs Billing Services">${LOGO_SVG}</div>`;
}

function attachLogoFallbacks(scope = document) {
  scope.querySelectorAll("img.logo-img").forEach((img) => {
    img.addEventListener("error", () => {
      img.style.display = "none";
      if (img.nextElementSibling) img.nextElementSibling.style.display = "block";
    });
  });
}

let state = null;
let currentPage = "dashboard";
let introPlayed = false;
let loginRole = "user";
let liveSource = null;
let liveConnected = false;
let pendingRender = false;
let clockInterval = null;
let idleWarnTimer = null;
let idleLogoutTimer = null;
let lastPingAt = 0;

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let selectedDate = todayISO();
let monthSelected = todayISO();
let reviewFilters = { from: "", to: "", lead: "", user: "", q: "", status: "All" };
let clockFilter = { from: todayISO(), to: todayISO(), lead: "", user: "" };

const pages = {
  dashboard: "Operations Command Dashboard",
  master: "Accounts, Credentials & Assignments",
  signoff: "Daily Sign-Off",
  review: "Review & Export Reports",
  clocksum: "Seat & Break Clock Summary",
  bonus: "Monthly Bonus Scorecard",
  leaderboard: "Row Lead Leaderboard",
  audit: "Security Audit Logs",
  settings: "Settings, Breaks & Clock"
};

let toastTimer = null;
function toast(s) {
  const t = document.getElementById("toast");
  t.textContent = s;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3800);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function num(v) { return Number(v) || 0; }
function money(v) { return "$" + num(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function fmtMins(m) { return `${Math.floor(num(m) / 60)}h ${num(m) % 60}m`; }
function monthBounds(value) {
  const [y, m] = value.slice(0, 7).split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${y}-${String(m).padStart(2, "0")}-01`, `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`];
}
function inMonth(date, month) { const [a, b] = monthBounds(month); return date >= a && date <= b; }
function workdays(a, b) {
  let d = new Date(a + "T12:00:00"), end = new Date(b + "T12:00:00"), n = 0;
  while (d <= end) { if (d.getDay() !== 0 && d.getDay() !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function closeModal() {
  document.getElementById("modalBg").classList.remove("open");
  if (pendingRender) { pendingRender = false; render(currentPage); }
}
function openModal(html) {
  const box = document.getElementById("modalBox");
  box.innerHTML = html;
  document.getElementById("modalBg").classList.add("open");
}
document.getElementById("modalBg").addEventListener("click", (e) => {
  if (e.target.id === "modalBg" || e.target.closest(".close-modal-btn")) closeModal();
});

function isUserTypingInView() {
  const el = document.activeElement;
  const view = document.getElementById("view");
  return Boolean(el && view && view.contains(el) && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function clearIdleTimers() { clearTimeout(idleWarnTimer); clearTimeout(idleLogoutTimer); }

function resetIdleTimer() {
  if (!state) return;
  clearIdleTimers();
  const mins = Math.max(5, num(state.security?.idleTimeoutMinutes) || 15);
  const totalMs = mins * 60 * 1000;
  idleWarnTimer = setTimeout(() => {
    toast("⚠️ Inactive session: You will be automatically logged out in 60 seconds.");
  }, Math.max(10000, totalMs - 60000));

  idleLogoutTimer = setTimeout(async () => {
    disconnectLiveEvents(); clearIdleTimers(); stopClocks();
    await api("/api/auth/logout", { method: "POST", body: JSON.stringify({ reason: "idle" }) }).catch(() => {});
    state = null;
    renderLogin("You were logged out automatically due to inactivity.", false);
  }, totalMs);

  if (Date.now() - lastPingAt > 120000) {
    lastPingAt = Date.now();
    api("/api/auth/ping", { method: "POST" }).catch(() => {});
  }
}

["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) => {
  document.addEventListener(evt, () => { if (state) resetIdleTimer(); }, { passive: true });
});

function formatOffsetClock(nowMs, offsetHours) {
  const shifted = new Date(nowMs + offsetHours * 3600000);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true }).format(shifted);
  const date = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(shifted);
  return { time, date };
}

function updateClocks() {
  const nowMs = Date.now();
  const dstOn = Boolean(state?.clock?.daylightSaving);

  const zones = [
    { id: "clk-pkt", offset: 5, zone: "Pakistan Shift (PKT)", shift: dstOn ? "6:00 PM – 3:00 AM (US DST On)" : "7:00 PM – 4:00 AM (Standard)" },
    { id: "clk-cst", offset: dstOn ? -5 : -6, zone: dstOn ? "US Central (CDT • DST On)" : "US Central (CST • DST Off)", shift: "8:00 AM – 5:00 PM" },
    { id: "clk-est", offset: dstOn ? -4 : -5, zone: dstOn ? "US Eastern (EDT • DST On)" : "US Eastern (EST • DST Off)", shift: "9:00 AM – 6:00 PM" }
  ];

  zones.forEach((z) => {
    const el = document.getElementById(z.id);
    if (!el) return;
    const { time, date } = formatOffsetClock(nowMs, z.offset);
    el.querySelector(".clock-zone").textContent = z.zone;
    el.querySelector(".clock-shift").textContent = z.shift;
    el.querySelector(".clock-time").textContent = time;
    el.querySelector(".clock-date").textContent = date;
  });

  const dstPill = document.getElementById("dstStatusPill");
  if (dstPill) dstPill.textContent = dstOn ? "US DST: ON (EDT / CDT)" : "US DST: OFF (EST / CST)";
}

function startClocks() { stopClocks(); updateClocks(); clockInterval = setInterval(updateClocks, 1000); }
function stopClocks() { clearInterval(clockInterval); clockInterval = null; }

function updateLiveHeaderBadges() {
  if (!state) return;
  const unreadCount = (state.notifications || []).filter((n) => !n.is_read).length;
  const bellBtn = document.getElementById("bellBtn");
  if (bellBtn) bellBtn.innerHTML = `🔔 Alerts ${unreadCount ? `<span class="bell-badge">${unreadCount}</span>` : ""}`;
  const dot = document.getElementById("liveDot");
  if (dot) dot.classList.toggle("off", !liveConnected);
}

function connectLiveEvents() {
  if (liveSource) liveSource.close();
  liveSource = new EventSource("/api/events");
  liveSource.addEventListener("connected", () => { liveConnected = true; updateLiveHeaderBadges(); });
  liveSource.onerror = () => { liveConnected = false; updateLiveHeaderBadges(); };

  liveSource.addEventListener("sync", async (e) => {
    let payload = {};
    try { payload = JSON.parse(e.data || "{}"); } catch {}
    if (payload.actorId && state && payload.actorId === state.currentUser.id) return;

    try {
      state = await api("/api/bootstrap?bg=1");
      updateLiveHeaderBadges();
      updateClocks();
      if (payload.toast) toast("🔔 " + payload.toast);

      const modalOpen = document.getElementById("modalBg").classList.contains("open");
      if (modalOpen || isUserTypingInView()) {
        pendingRender = true;
        const banner = document.getElementById("pendingSyncBanner");
        if (banner) banner.style.display = "flex";
      } else {
        pendingRender = false;
        render(currentPage);
      }
    } catch {
      disconnectLiveEvents(); clearIdleTimers(); stopClocks(); state = null;
      renderLogin("Session expired or account deactivated.", false);
    }
  });
}

function disconnectLiveEvents() {
  if (liveSource) { liveSource.close(); liveSource = null; }
  liveConnected = false;
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && state) {
    try {
      state = await api("/api/bootstrap?bg=1");
      updateLiveHeaderBadges();
      updateClocks();
      if (!document.getElementById("modalBg").classList.contains("open") && !isUserTypingInView()) render(currentPage);
    } catch {}
  }
});

async function boot() {
  try {
    state = await api("/api/bootstrap");
    introPlayed = true;
    renderAppShell();
    setPage(currentPage);
    startClocks();
    resetIdleTimer();
    if (!liveSource) connectLiveEvents();
  } catch {
    disconnectLiveEvents(); clearIdleTimers(); stopClocks();
    renderLogin("", !introPlayed);
  }
}

function renderLogin(errMsg = "", withIntro = false) {
  const showIntro = withIntro && !introPlayed;
  introPlayed = true;

  document.getElementById("root").innerHTML = `
  ${showIntro ? `
  <div class="intro-overlay" id="intro">
    <div class="projector-beam"></div><div class="projector-glow"></div>
    <button class="skip-btn" id="skipBtn">Skip →</button>
    <div class="intro-stage">
      ${logoBlock("intro-logo")}
      <h1 class="intro-company">RhinoMDs Billing Services</h1>
      <p class="intro-tagline">Your Strength In Practice Management</p>
      <div class="intro-divider"></div>
      <div class="intro-dept">Medical Virtual Assistant Department</div>
      <div class="intro-loader"><i></i></div>
    </div>
  </div>` : ""}

  <div class="login-page">
    <section class="hero-panel">
      <div>
        ${logoBlock()}
        <div class="eyebrow-pill">● Medical Virtual Assistant Department</div>
        <h2 class="hero-title">Centralized Medical VA Performance & Sign-Off Hub</h2>
        <p style="margin:0;color:#cbd5e1;font-size:15px">Zero-PHI productivity portal with real-time seat status, live shift clocks, daily sign-offs, and Excel/PDF reporting.</p>
        <div class="bento-grid">
          <div class="glass-card"><small>Live Operations</small><strong>Real-Time Sync & Clocks</strong><span>7 PM–4 AM PKT • 8 AM–5 PM CST • 9 AM–6 PM EST</span></div>
          <div class="glass-card"><small>Security & Audit</small><strong>Zero-PHI Protected Portal</strong><span>Idle auto-logoff, strong passwords & full audit trail</span></div>
        </div>
      </div>
      <div style="font-size:12px;color:#cbd5e1;margin-top:24px">© RhinoMDs Billing Services • Zero-PHI Operations Portal</div>
    </section>

    <section class="form-panel">
      <div class="login-card">
        <h2 style="margin:0 0 6px;font-size:23px">Sign in to your account</h2>
        <p style="margin:0 0 16px;color:var(--muted);font-size:13px">Select your role, then enter your assigned username and password.</p>
        <label style="font-size:11px;font-weight:700;color:#475569;display:block;margin-bottom:6px">I am signing in as:</label>
        <div class="role-tabs" id="roleTabs">
          <button type="button" data-r="super_admin" class="${loginRole === "super_admin" ? "active" : ""}">Admin</button>
          <button type="button" data-r="row_lead" class="${loginRole === "row_lead" ? "active" : ""}">Row Lead</button>
          <button type="button" data-r="user" class="${loginRole === "user" ? "active" : ""}">User (VA)</button>
        </div>
        ${errMsg ? `<div class="notice" style="background:#fff0f0;border-color:#f5c2c2;color:var(--red)">${esc(errMsg)}</div>` : ""}
        <form id="loginForm">
          <div class="field" style="margin-bottom:14px"><label>Username</label><div class="input-wrap"><input name="username" required autocomplete="username" placeholder="Enter username"></div></div>
          <div class="field" style="margin-bottom:18px"><label>Password</label><div class="input-wrap"><input id="loginPw" type="password" name="password" required autocomplete="current-password" placeholder="Enter password"><button type="button" class="toggle-pw" id="togglePw">Show</button></div></div>
          <button style="width:100%;padding:12px">Sign In →</button>
        </form>
        <div style="margin-top:18px;padding:12px;border-radius:10px;background:#f1f5f9;font-size:12px;color:#475569">
          <strong>Zero-PHI Policy:</strong> Do not enter patient names, DOBs, policy IDs, or medical records anywhere in this portal.
        </div>
      </div>
    </section>
  </div>`;

  attachLogoFallbacks();

  if (showIntro) {
    const intro = document.getElementById("intro");
    const hide = () => intro && intro.classList.add("hide");
    document.getElementById("skipBtn").addEventListener("click", hide);
    setTimeout(hide, 2600);
  }

  document.getElementById("roleTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]");
    if (!b) return;
    loginRole = b.dataset.r;
    document.querySelectorAll("#roleTabs button").forEach((x) => x.classList.toggle("active", x === b));
  });

  document.getElementById("togglePw").addEventListener("click", () => {
    const pw = document.getElementById("loginPw"), b = document.getElementById("togglePw");
    const show = pw.type === "password";
    pw.type = show ? "text" : "password";
    b.textContent = show ? "Hide" : "Show";
  });

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ role: loginRole, username: f.get("username"), password: f.get("password") }) });
      await boot();
    } catch (err) {
      renderLogin(err.message, false);
    }
  });
}

function allowedPages() {
  const r = state.currentUser.role;
  if (r === "super_admin") return ["dashboard", "master", "signoff", "review", "clocksum", "bonus", "leaderboard", "audit", "settings"];
  if (r === "row_lead") return ["dashboard", "signoff", "review", "leaderboard"];
  return ["dashboard", "signoff", "review"];
}

function renderAppShell() {
  const u = state.currentUser;
  const roleText = u.role === "super_admin" ? "Admin" : u.role === "row_lead" ? "Row Lead" : "User (VA)";
  const unreadCount = (state.notifications || []).filter((n) => !n.is_read).length;
  const seat = u.seat_status || "Available";
  const dstOn = Boolean(state.clock?.daylightSaving);

  const navItems = [
    ["dashboard", "Dashboard"],
    ["master", "Accounts & Assignments"],
    ["signoff", "Daily Sign-Off"],
    ["review", "Review & Export Reports"],
    ["clocksum", "Clock Summary Report"],
    ["bonus", "Monthly Bonus"],
    ["leaderboard", "Leaderboard"],
    ["audit", "Audit Logs"],
    ["settings", "Settings & Breaks"]
  ].filter(([id]) => allowedPages().includes(id));

  if (!allowedPages().includes(currentPage)) currentPage = "dashboard";

  document.getElementById("root").innerHTML = `
  <header class="bento-header">
    <div class="bento-top">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        ${logoBlock()}
        <span class="user-chip" style="font-weight:700">Medical Virtual Assistant Department</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span class="user-chip" title="Real-time updates active"><span class="live-dot ${liveConnected ? "" : "off"}" id="liveDot"></span> Live</span>
        <button class="bell-btn" id="bellBtn">🔔 Alerts ${unreadCount ? `<span class="bell-badge">${unreadCount}</span>` : ""}</button>
        <span class="user-chip">Signed in: <strong>${esc(u.name)}</strong> (${roleText})</span>
        <button class="secondary small" id="logoutBtn">Log out</button>
      </div>
    </div>

    <div class="seat-bar">
      <div>
        <strong>My Seat Status:</strong> <span id="mySeatLabel">${esc(seat)}</span>
        <span style="opacity:.82;margin-left:12px">Scheduled Breaks: <strong>1st:</strong> ${esc(state.breaks.break1Start)}–${esc(state.breaks.break1End)} • <strong>2nd:</strong> ${esc(state.breaks.break2Start)}–${esc(state.breaks.break2End)}</span>
      </div>
      <div class="seat-btns" id="seatBtns">
        <button data-status="Available" class="${seat === "Available" ? "active-avail" : ""}">● Present / On Seat</button>
        <button data-status="Short Break" class="${seat === "Short Break" ? "active-break" : ""}">☕ Short Break</button>
        <button data-status="Away" class="${seat === "Away" ? "active-away" : ""}">🚶 Going Away</button>
      </div>
    </div>

    <nav class="bento-nav" id="nav">
      ${navItems.map(([id, label]) => `<button data-page="${id}" class="${id === currentPage ? "active" : ""}">${label}</button>`).join("")}
    </nav>
  </header>

  <main>
    <div class="clocks-bar">
      <div class="clock-card" id="clk-pkt"><div><div class="clock-zone">Pakistan Shift (PKT)</div><div class="clock-shift">7:00 PM – 4:00 AM</div></div><div style="text-align:right"><div class="clock-time">--:--:--</div><div class="clock-date">---</div></div></div>
      <div class="clock-card" id="clk-cst"><div><div class="clock-zone">US Central</div><div class="clock-shift">8:00 AM – 5:00 PM</div></div><div style="text-align:right"><div class="clock-time">--:--:--</div><div class="clock-date">---</div></div></div>
      <div class="clock-card" id="clk-est"><div><div class="clock-zone">US Eastern</div><div class="clock-shift">9:00 AM – 6:00 PM</div></div><div style="text-align:right"><div class="clock-time">--:--:--</div><div class="clock-date">---</div></div></div>
    </div>

    <div class="sync-banner" id="pendingSyncBanner" style="display:none">
      <span>🔄 <strong>New live updates arrived</strong> while you were editing.</span>
      <button class="small" id="refreshPendingBtn">Refresh View</button>
    </div>

    <div class="page-head">
      <div>
        <div class="eyebrow">RhinoMDs Billing Services • Zero-PHI Medical VA Portal</div>
        <h1 class="page-title" id="pageTitle">${pages[currentPage]}</h1>
      </div>
      <div class="top-actions">
        <span class="date-pill" id="dstStatusPill">${dstOn ? "US DST: ON (EDT / CDT)" : "US DST: OFF (EST / CST)"}</span>
        <span class="date-pill">Auto-Logoff: ${num(state.security?.idleTimeoutMinutes) || 15}m idle</span>
        ${u.role === "super_admin" ? `<button class="secondary small" id="exportTop">↓ Export JSON Backup</button>` : ""}
      </div>
    </div>
    <div id="view"></div>
  </main>`;

  attachLogoFallbacks();

  document.getElementById("nav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) setPage(b.dataset.page);
  });

document.getElementById("seatBtns").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-status]");
    if (!b) return;
    const status = b.dataset.status;
    let note = "";
    if (status === "Away") {
      const r = prompt("Optional brief reason for going away (No patient PHI):", "");
      if (r === null) return;
      note = r;
    }
    try {
      await api("/api/presence", { method: "POST", body: JSON.stringify({ status, note }) });
      state.currentUser.seat_status = status;
      state.currentUser.seat_note = note;
      const uRec = state.users.find((x) => x.id === state.currentUser.id);
      if (uRec) { uRec.seat_status = status; uRec.seat_note = note; }
      const lbl = document.getElementById("mySeatLabel");
      if (lbl) lbl.textContent = status;
      document.querySelectorAll("#seatBtns button").forEach((btn) => {
        const s = btn.dataset.status;
        btn.className = s === status ? (s === "Available" ? "active-avail" : s === "Short Break" ? "active-break" : "active-away") : "";
      });
      toast(`Seat status updated: ${status}`);
      if (currentPage === "dashboard") render("dashboard");
    } catch (err) { toast(err.message); }
  });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    disconnectLiveEvents(); clearIdleTimers(); stopClocks();
    await api("/api/auth/logout", { method: "POST" });
    state = null;
    renderLogin("", false);
  });

  document.getElementById("bellBtn").addEventListener("click", openNotificationsModal);
  document.getElementById("refreshPendingBtn").addEventListener("click", () => {
    pendingRender = false;
    document.getElementById("pendingSyncBanner").style.display = "none";
    render(currentPage);
  });
  const exp = document.getElementById("exportTop");
  if (exp) exp.addEventListener("click", exportBackup);
}

function openNotificationsModal() {
  const list = state.notifications || [];
  openModal(`
    <div class="section-head">
      <h3 style="margin:0">Notifications (${list.length})</h3>
      ${list.some((n) => !n.is_read) ? `<button class="secondary small" id="markReadBtn">Mark all read</button>` : ""}
    </div>
    <div>
      ${list.length ? list.map((n) => `
        <div class="notif-item ${n.is_read ? "" : "unread"}">
          <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
            <strong>${n.type === "presence" ? "🪑 " : n.type === "signoff_updated" ? "📝 " : "📌 "}${esc(n.title)}</strong>
            <span class="muted" style="font-size:11px">${new Date(n.created_at).toLocaleString()}</span>
          </div>
          <div style="font-size:12px;color:#334155">${esc(n.message)}</div>
        </div>`).join("") : `<p class="muted">No notifications yet.</p>`}
    </div>
    <div class="actions"><button class="secondary close-modal-btn">Close</button></div>
  `);
  const mr = document.getElementById("markReadBtn");
  if (mr) mr.addEventListener("click", async () => {
    await api("/api/notifications/read-all", { method: "POST" });
    closeModal();
    await refreshState();
  });
}

function activeVAs() { return state.users.filter((u) => u.status === "Active" && u.role === "user"); }
function assigned(user) { return state.assignments.filter((a) => a.user === user).map((a) => a.practice); }
function leadOf(user) { return state.users.find((u) => u.name === user)?.lead || ""; }
function signStatus(s) { return s && ([s.vobs, s.calls, s.scheduling, s.payments, s.extra].some((v) => num(v) > 0) || String(s.notes || "").trim()) ? "Signed" : "Pending"; }
function sum(rows, key) { return rows.reduce((a, r) => a + num(r[key]), 0); }
function monthRows(month) { return state.signoffs.filter((s) => inMonth(s.date, month)); }

function seatBadge(st) {
  if (st === "Available") return `<span class="tag">🟢 Available (On Seat)</span>`;
  if (st === "Short Break") return `<span class="tag warn">☕ Short Break</span>`;
  if (st === "Away") return `<span class="tag red">🚶 Away</span>`;
  return `<span class="tag gray">⚪ Offline</span>`;
}

function employeeStats(user, month) {
  const rows = monthRows(month).filter((s) => s.user === user), u = state.users.find((x) => x.name === user);
  const days = rows.filter((s) => signStatus(s) === "Signed").length, practices = Math.max(1, assigned(user).length);
  const [a, b] = monthBounds(month), daysCount = workdays(a, b), t = state.targets, w = state.weights;
  const actual = { vobs: sum(rows, "vobs"), calls: sum(rows, "calls"), scheduling: sum(rows, "scheduling"), payments: sum(rows, "payments"), extra: sum(rows, "extra"), consistency: days };
  const attain = {
    vobs: Math.min(1, actual.vobs / Math.max(1, t.vobs * practices * daysCount)),
    calls: Math.min(1, actual.calls / Math.max(1, t.calls * practices * daysCount)),
    scheduling: Math.min(1, actual.scheduling / Math.max(1, t.scheduling * practices * daysCount)),
    payments: Math.min(1, actual.payments / Math.max(1, t.payments * practices * daysCount)),
    extra: Math.min(1, actual.extra / Math.max(1, t.extra * practices * daysCount)),
    consistency: Math.min(1, days / Math.max(1, daysCount))
  };
  const totalW = Object.values(w).reduce((x, y) => x + num(y), 0);
  const score = totalW ? 10 * Object.keys(w).reduce((acc, k) => acc + attain[k] * num(w[k]), 0) / totalW : 0;
  return { user, lead: u?.lead || "", practices: assigned(user).length, days, actual, score: Math.round(score * 10) / 10 };
}

function kpi(label, value, note) { return `<div class="card kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-note">${note || ""}</div></div>`; }
function table(headers, rows) { return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="muted">No records found</td></tr>`}</tbody></table></div>`; }

async function refreshState() { state = await api("/api/bootstrap"); renderAppShell(); render(currentPage); updateClocks(); }

function setPage(page) {
  if (!allowedPages().includes(page)) page = "dashboard";
  currentPage = page;
  pendingRender = false;
  const b = document.getElementById("pendingSyncBanner"); if (b) b.style.display = "none";
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x.dataset.page === page));
  document.getElementById("pageTitle").textContent = pages[page];
  render(page);
}

function render(page) {
  ({ dashboard, master, signoff, review, clocksum, bonus, leaderboard, audit, settings }[page] || dashboard)(document.getElementById("view"));
}

async function dashboard(v) {
  const m = monthSelected, rows = monthRows(m), role = state.currentUser.role;
  const vas = activeVAs();
  const orgToday = state.orgToday || todayISO();
  const onlineSet = new Set(state.onlineUserIds || []);

  let liveSeatPanel = "";
  if (role === "super_admin" || role === "row_lead") {
    const monitored = state.users.filter((u) => u.status === "Active" && (role === "super_admin" ? u.role !== "super_admin" : u.role === "user"));
    const onSeatCnt = monitored.filter((u) => u.seat_status === "Available").length;
    const breakCnt = monitored.filter((u) => u.seat_status === "Short Break").length;
    const awayCnt = monitored.filter((u) => u.seat_status === "Away").length;
    const offCnt = monitored.filter((u) => !u.seat_status || u.seat_status === "Offline").length;
    const todaySignSet = new Set(state.signoffs.filter((s) => s.date === orgToday && signStatus(s) === "Signed").map((s) => s.user));

    const seatRows = monitored.map((u) => {
      const isLogged = role === "super_admin" ? onlineSet.has(u.id) : (u.seat_status && u.seat_status !== "Offline");
      const hasSigned = todaySignSet.has(u.name);
      let leaveCol = "";
      if (role === "super_admin") {
        const leaveReasons = [];
        if (!isLogged) leaveReasons.push("Not Logged In");
        if (u.role === "user" && !hasSigned) leaveReasons.push("No Sign-Off");
        leaveCol = `<td>${leaveReasons.length ? `<span class="tag red">On Leave (${leaveReasons.join(" & ")})</span>` : `<span class="tag">Active / Present</span>`}</td>`;
      }
      return `<tr>
        <td><b>${esc(u.name)}</b><div class="muted" style="font-size:11px">${u.role === "row_lead" ? "Row Lead" : "User"}</div></td>
        <td>${esc(u.lead || "—")}</td>
        <td>${seatBadge(u.seat_status)}</td>
        <td>${esc(u.seat_note || "—")}</td>
        ${leaveCol}
      </tr>`;
    }).join("");

    liveSeatPanel = `
    <section class="card" style="margin-bottom:16px">
      <div class="section-head">
        <h3>Real-Time Seat Monitor & Attendance (${orgToday})</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="tag">🟢 On Seat: ${onSeatCnt}</span>
          <span class="tag warn">☕ Break: ${breakCnt}</span>
          <span class="tag red">🚶 Away: ${awayCnt}</span>
          <span class="tag gray">⚪ Offline: ${offCnt}</span>
        </div>
      </div>
      ${table(role === "super_admin" ? ["Name", "Team / Lead", "Live Seat Status", "Note", "Auto Leave Status (Admin)"] : ["Name", "Row Lead", "Live Seat Status", "Note"], seatRows)}
    </section>`;
  }

  let teamBarsHtml = "";
  if (role === "super_admin" || role === "row_lead") {
    const lb = await api(`/api/leaderboard?month=${m.slice(0, 7)}`).catch(() => ({ teams: [] }));
    const maxV = Math.max(1, ...lb.teams.map((t) => t.vobs));
    teamBarsHtml = `<section class="card"><div class="section-head"><h3>Team Activity — VOBs</h3><span class="tag">${m.slice(0, 7)}</span></div><div class="bar-list">${lb.teams.map((t) => `<div class="bar-row"><b>${esc(t.lead)}</b><div class="bar-track"><div class="bar-fill" style="width:${Math.round(t.vobs / maxV * 100)}%"></div></div><b>${t.vobs}</b></div>`).join("")}</div></section>`;
  }

  const directory = vas.map((u) => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.pseudo_name || "—")}</td><td>${esc(u.designation || "—")}</td><td>${esc(u.date_of_joining || "—")}</td><td>${esc(u.lead)}</td><td>${assigned(u.name).length ? assigned(u.name).map((p) => `<span class="tag gray">${esc(p)}</span>`).join(" ") : '<span class="muted">Not assigned</span>'}</td></tr>`).join("");

  v.innerHTML = `
    <div class="toolbar"><div class="field"><label>Dashboard month</label><input type="month" id="dashMonth" value="${m.slice(0, 7)}"></div><span class="muted">Zero-PHI Portal • Real-time updates active.</span></div>
    <div class="grid kpis">
      ${kpi("Visible VAs", vas.length, role === "user" ? "Your profile" : role === "row_lead" ? "Your team" : "Active Medical VAs")}
      ${kpi("VOBs Completed", sum(rows, "vobs"), "Selected month")}
      ${kpi("Calls / Scheduling", `${sum(rows, "calls")} / ${sum(rows, "scheduling")}`, "Patient outreach")}
      ${kpi("Payments Collected", money(sum(rows, "payments")), `${rows.filter((s) => signStatus(s) === "Signed").length} signed entries`)}
    </div>
    ${liveSeatPanel}
    ${teamBarsHtml ? `<div class="grid two" style="margin-bottom:16px">${teamBarsHtml}<section class="card"><div class="section-head"><h3>Department Totals</h3><span class="tag">Selected month</span></div><div class="grid three">${kpi("VOBs", sum(rows, "vobs"), "")}${kpi("Calls", sum(rows, "calls"), "")}${kpi("Scheduling", sum(rows, "scheduling"), "")}${kpi("Payments", money(sum(rows, "payments")), "")}${kpi("Extra Tasks", sum(rows, "extra"), "")}${kpi("Practices", state.practices.length, "Onboarded")}</div></section></div>` : ""}
    <section class="card"><div class="section-head"><h3>${role === "user" ? "My Profile & Practices" : "Team Directory"}</h3>${role === "super_admin" ? `<button class="secondary small" id="goMasterBtn">Manage Accounts & Credentials</button>` : ""}</div>${table(["Employee", "Pseudo Name", "Designation", "Date of Joining", "Row Lead", "Assigned Practices"], directory)}</section>`;

  document.getElementById("dashMonth").addEventListener("change", (e) => { monthSelected = e.target.value + "-01"; render("dashboard"); });
  const gm = document.getElementById("goMasterBtn");
  if (gm) gm.addEventListener("click", () => setPage("master"));
}

function master(v) {
  const rows = state.users.map((u) => {
    const loginBadge = u.username ? `<span class="tag blue">${esc(u.username)}</span>` : `<span class="tag gray">No login</span>`;
    const roleTag = u.role === "super_admin" ? "Admin" : u.role === "row_lead" ? "Row Lead" : "User";
    return `<tr>
      <td><b>${esc(u.name)}</b><div class="muted" style="font-size:11px">${esc(u.email || "")}</div></td>
      <td>${esc(u.pseudo_name || "—")}</td>
      <td>${esc(u.designation || "—")}</td>
      <td>${esc(u.date_of_joining || "—")}</td>
      <td>${roleTag}</td>
      <td>${loginBadge}</td>
      <td>${esc(u.lead || "—")}</td>
      <td><span class="tag ${u.status === "Active" ? "" : "gray"}">${u.status}</span></td>
      <td><button class="secondary small edit-user-btn" data-id="${u.id}">Edit / Password</button> ${u.id !== state.currentUser.id ? `<button class="danger small del-user-btn" data-id="${u.id}" data-name="${esc(u.name)}">Delete</button>` : ""}</td>
    </tr>`;
  }).join("");

  const as = state.assignments.map((a) => `<tr><td>${esc(a.user)}</td><td>${esc(a.practice)}</td><td><button class="danger small del-assign-btn" data-user="${esc(a.user)}" data-prac="${esc(a.practice)}">Remove</button></td></tr>`).join("");

  v.innerHTML = `
  <div class="grid two">
    <section class="card">
      <div class="section-head"><h3>Create Account + Login Credentials</h3><span class="tag purple">Admin Only</span></div>
      <div class="notice">Strong Password Required: 10+ chars with uppercase, lowercase, number, and special character.</div>
      <form id="userForm"><div class="form-grid">
        <div class="field"><label>First Name *</label><input name="first_name" required placeholder="First name"></div>
        <div class="field"><label>Last Name</label><input name="last_name" placeholder="Last name"></div>
        <div class="field"><label>Date of Joining</label><input type="date" name="date_of_joining"></div>
        <div class="field"><label>Pseudo Name</label><input name="pseudo_name" placeholder="e.g. Alex"></div>
        <div class="field wide"><label>Email</label><input type="email" name="email" placeholder="name@rhinomds.com"></div>
        <div class="field wide"><label>Designation</label><input name="designation" placeholder="e.g. Medical Virtual Assistant"></div>
        <div class="field"><label>Role *</label><select name="role"><option value="user">User (VA)</option><option value="row_lead">Row Lead</option><option value="super_admin">Admin</option></select></div>
        <div class="field"><label>Row Lead Team</label><select name="lead"><option value="">— None —</option>${state.leads.map((l) => `<option>${esc(l)}</option>`).join("")}</select></div>
        <div class="field"><label>Username</label><input name="username" placeholder="Login username"></div>
        <div class="field"><label>Strong Password</label><input type="password" name="password" placeholder="10+ chars, Aa1!"></div>
        <div class="field"><label>Status</label><select name="status"><option>Active</option><option>Inactive</option></select></div>
      </div><div class="actions"><button>Create Account</button></div></form>
    </section>

    <section class="card">
      <div class="section-head"><h3>Assign User ↔ Practice</h3><span class="tag purple">Admin Only</span></div>
      <form id="assignForm"><div class="form-grid">
        <div class="field wide"><label>Employee</label><select name="user" required>${state.users.filter((u) => u.role === "user").map((u) => `<option>${esc(u.name)}</option>`).join("")}</select></div>
        <div class="field wide"><label>Practice</label><select name="practice" required>${state.practices.map((p) => `<option>${esc(p)}</option>`).join("")}</select></div>
      </div><div class="actions"><button>Add Assignment</button></div></form>
      <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
      <div class="section-head"><h3>Practice Directory (${state.practices.length})</h3></div>
      <form id="practiceForm" class="toolbar"><input class="control" name="practice" placeholder="New practice name" required><button>Add Practice</button></form>
      <div id="pracCard">${state.practices.map((p) => `<span class="tag gray" style="margin:3px">${esc(p)} <button class="danger small del-prac-btn" data-prac="${esc(p)}" style="padding:1px 5px">×</button></span>`).join("")}</div>
    </section>
  </div>
  <section class="card" style="margin-top:16px" id="usersCard">
    <div class="section-head"><h3>Organization Accounts (${state.users.length})</h3><input class="control" id="userSearch" placeholder="Search name, pseudo name, username, lead..."></div>
    ${table(["Full Name / Email", "Pseudo Name", "Designation", "Date of Joining", "Role", "Username", "Row Lead", "Status", "Action"], rows)}
  </section>
  <section class="card" style="margin-top:16px" id="assignCard">
    <div class="section-head"><h3>Practice Assignments (${state.assignments.length})</h3></div>
    ${table(["Employee", "Practice", "Action"], as)}
  </section>`;

  document.getElementById("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) }); toast("Account created"); await refreshState(); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("assignForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await api("/api/assignments", { method: "POST", body: JSON.stringify({ user: f.get("user"), practice: f.get("practice") }) }); toast("Assignment added"); await refreshState(); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("practiceForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/practices", { method: "POST", body: JSON.stringify({ practice: new FormData(e.target).get("practice") }) }); toast("Practice added"); await refreshState(); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("userSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll("#usersCard tbody tr").forEach((tr) => (tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none"));
  });
  document.getElementById("usersCard").addEventListener("click", async (e) => {
    const ed = e.target.closest(".edit-user-btn"), del = e.target.closest(".del-user-btn");
    if (ed) openEditUser(Number(ed.dataset.id));
    if (del && confirm(`Delete ${del.dataset.name}? Related assignments and sign-offs will be removed.`)) {
      try { await api(`/api/users/${del.dataset.id}`, { method: "DELETE" }); toast("Account deleted"); await refreshState(); } catch (err) { toast(err.message); }
    }
  });
  document.getElementById("assignCard").addEventListener("click", async (e) => {
    const b = e.target.closest(".del-assign-btn");
    if (b) { try { await api("/api/assignments", { method: "DELETE", body: JSON.stringify({ user: b.dataset.user, practice: b.dataset.prac }) }); await refreshState(); } catch (err) { toast(err.message); } }
  });
  document.getElementById("pracCard").addEventListener("click", async (e) => {
    const b = e.target.closest(".del-prac-btn");
    if (b && confirm(`Remove ${b.dataset.prac}?`)) { try { await api(`/api/practices/${encodeURIComponent(b.dataset.prac)}`, { method: "DELETE" }); await refreshState(); } catch (err) { toast(err.message); } }
  });
}

function openEditUser(id) {
  const u = state.users.find((x) => x.id === id);
  if (!u) return;
  openModal(`
    <h3 style="margin-top:0">Edit Account & Password</h3>
    <form id="editUserForm"><div class="form-grid" style="grid-template-columns:repeat(2,1fr)">
      <div class="field"><label>First Name *</label><input name="first_name" required value="${esc(u.first_name || u.name)}"></div>
      <div class="field"><label>Last Name</label><input name="last_name" value="${esc(u.last_name || "")}"></div>
      <div class="field"><label>Date of Joining</label><input type="date" name="date_of_joining" value="${esc(u.date_of_joining || "")}"></div>
      <div class="field"><label>Pseudo Name</label><input name="pseudo_name" value="${esc(u.pseudo_name || "")}"></div>
      <div class="field"><label>Email</label><input type="email" name="email" value="${esc(u.email || "")}"></div>
      <div class="field"><label>Designation</label><input name="designation" value="${esc(u.designation || "")}"></div>
      <div class="field"><label>Role</label><select name="role"><option value="user" ${u.role === "user" ? "selected" : ""}>User (VA)</option><option value="row_lead" ${u.role === "row_lead" ? "selected" : ""}>Row Lead</option><option value="super_admin" ${u.role === "super_admin" ? "selected" : ""}>Admin</option></select></div>
      <div class="field"><label>Row Lead Team</label><select name="lead"><option value="">— None —</option>${state.leads.map((l) => `<option ${u.lead === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label>Username</label><input name="username" value="${esc(u.username || "")}"></div>
      <div class="field"><label>New Strong Password (blank = keep)</label><input type="password" name="password" placeholder="10+ chars, Aa1!"></div>
      <div class="field"><label>Status</label><select name="status"><option ${u.status === "Active" ? "selected" : ""}>Active</option><option ${u.status === "Inactive" ? "selected" : ""}>Inactive</option></select></div>
    </div><div class="actions"><button>Save Changes</button><button type="button" class="secondary close-modal-btn">Cancel</button></div></form>`);
  document.getElementById("editUserForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(e.target).entries())) }); closeModal(); toast("Account updated"); await refreshState(); }
    catch (err) { toast(err.message); }
  });
}

function calendarHTML(date) {
  const d = new Date(date + "T12:00:00"), y = d.getFullYear(), m = d.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  const signed = new Set(state.signoffs.filter((s) => s.date.startsWith(date.slice(0, 7))).map((s) => s.date));
  let cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<div class="dow">${x}</div>`).join("");
  for (let i = 0; i < first; i++) cells += "<div></div>";
  for (let n = 1; n <= days; n++) {
    const dt = `${y}-${String(m + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
    cells += `<div class="day${dt === selectedDate ? " selected" : ""}${dt === todayISO() ? " today" : ""}${signed.has(dt) ? " has-data" : ""}" data-date="${dt}">${n}</div>`;
  }
  return `<div class="calendar">${cells}</div>`;
}

function signoff(v) {
  const role = state.currentUser.role;
  const isVA = role === "user";
  const selectable = isVA ? [state.currentUser] : activeVAs();
  const selectedUser = isVA ? state.currentUser.name : (window.signUserValue && selectable.some((x) => x.name === window.signUserValue) ? window.signUserValue : (selectable[0]?.name || ""));
  const existing = state.signoffs.find((s) => s.date === selectedDate && s.user === selectedUser) || {};
  const lead = leadOf(selectedUser), prac = assigned(selectedUser).length;

  const dayMap = new Map(state.signoffs.filter((s) => s.date === selectedDate).map((s) => [s.user, s]));
  const onlineSet = new Set(state.onlineUserIds || []);
  const listUsers = isVA ? [state.currentUser] : selectable;

  const signedCount = listUsers.filter((u) => signStatus(dayMap.get(u.name)) === "Signed").length;
  const pendingCount = listUsers.length - signedCount;

  const listRows = listUsers.map((u) => {
    const s = dayMap.get(u.name);
    const st = signStatus(s);
    const isSigned = st === "Signed";
    let statusHtml = `<span class="tag ${isSigned ? "" : "warn"}">${st}</span>`;
    if (role === "super_admin" && !isSigned) {
      statusHtml += ` <span class="tag red">On Leave (No Sign-Off)</span>`;
      if (!onlineSet.has(u.id)) statusHtml += ` <span class="tag gray">Not Logged In</span>`;
    }
    return `<tr>
      <td><b>${esc(u.name)}</b></td>
      <td>${esc(u.lead || "—")}</td>
      <td>${s ? num(s.vobs) : 0}</td>
      <td>${s ? num(s.calls) : 0}</td>
      <td>${s ? num(s.scheduling) : 0}</td>
      <td>${s ? money(s.payments) : "$0"}</td>
      <td>${s ? num(s.extra) : 0}</td>
      <td>${s?.updated_by ? `${esc(s.updated_by)} <span class="tag gray">${esc(s.updated_by_role)}</span>` : "—"}</td>
      <td>${statusHtml}</td>
      <td><button class="secondary small edit-sign-btn" data-user="${esc(u.name)}">${isSigned ? "Edit" : "Enter"}</button>${s ? ` <button class="secondary small log-btn" data-date="${selectedDate}" data-user="${esc(u.name)}">History</button>` : ""}</td>
    </tr>`;
  }).join("");

  v.innerHTML = `
  ${!isVA ? `
  <div class="grid kpis" style="grid-template-columns:repeat(3,1fr)">
    ${kpi("Total Users", listUsers.length, role === "row_lead" ? "Your team" : "Active Medical VAs")}
    ${kpi("Sign-Offs Added", signedCount, `Completed for ${selectedDate}`)}
    ${kpi("Pending Sign-Offs", pendingCount, `Not yet submitted for ${selectedDate}`)}
  </div>` : ""}

  <div class="grid two">
    <section class="card">
      <div class="section-head"><h3>Select any date</h3><div class="actions"><button class="secondary small" id="prevMonth">←</button><b>${new Date(selectedDate + "T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b><button class="secondary small" id="nextMonth">→</button></div></div>
      <div class="calendar-head"><button class="secondary small" id="todayBtn">Today</button><input type="date" id="dateInput" value="${selectedDate}" class="control"></div>
      <div id="calendarWrap">${calendarHTML(selectedDate)}</div>
    </section>
    <section class="card">
      <div class="section-head"><h3>Daily activity entry</h3><span class="tag">${selectedDate === todayISO() ? "Today" : selectedDate < todayISO() ? "Past date" : "Future date"}</span></div>
      <form id="signForm"><div class="form-grid">
        <div class="field wide"><label>Employee</label><select name="user" id="signUser" ${isVA ? "disabled" : ""}>${selectable.map((u) => `<option ${u.name === selectedUser ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Row lead</label><input value="${esc(lead)}" disabled></div>
        <div class="field"><label>Practices</label><input value="${prac}" disabled></div>
        <div class="field"><label>VOBs done</label><input type="number" name="vobs" min="0" step="1" value="${num(existing.vobs)}"></div>
        <div class="field"><label>Patient calls</label><input type="number" name="calls" min="0" step="1" value="${num(existing.calls)}"></div>
        <div class="field"><label>Scheduling</label><input type="number" name="scheduling" min="0" step="1" value="${num(existing.scheduling)}"></div>
        <div class="field"><label>Patient payment ($)</label><input type="number" name="payments" min="0" step=".01" value="${num(existing.payments)}"></div>
        <div class="field"><label>Extra tasks</label><input type="number" name="extra" min="0" step="1" value="${num(existing.extra)}"></div>
        <div class="field wide"><label>Notes / operational summary (ZERO PHI — Do not enter patient info)</label><textarea name="notes">${esc(existing.notes || "")}</textarea></div>
      </div>
      <div class="actions"><button>Save daily sign-off</button>${existing.updated_by ? `<span class="muted">Last updated by <b>${esc(existing.updated_by)}</b> (${esc(existing.updated_by_role)})</span>` : ""}</div></form>
    </section>
  </div>

  <section class="card" style="margin-top:16px" id="daySignList">
    <div class="section-head"><h3>${isVA ? `My Sign-Off for ${selectedDate}` : `All Team Sign-Offs & Pending Status for ${selectedDate}`}</h3><span class="tag">${signedCount} Signed / ${pendingCount} Pending</span></div>
    ${table(["Employee", "Lead", "VOBs", "Calls", "Scheduling", "Payments", "Extra", "Last Updated By", "Status", "Action"], listRows)}
  </section>`;

  document.getElementById("dateInput").addEventListener("change", (e) => { selectedDate = e.target.value || todayISO(); render("signoff"); });
  document.getElementById("todayBtn").addEventListener("click", () => { selectedDate = todayISO(); render("signoff"); });
  document.getElementById("prevMonth").addEventListener("click", () => changeSignMonth(-1));
  document.getElementById("nextMonth").addEventListener("click", () => changeSignMonth(1));
  document.getElementById("calendarWrap").addEventListener("click", (e) => { const day = e.target.closest("[data-date]"); if (day) { selectedDate = day.dataset.date; render("signoff"); } });
  document.getElementById("signUser").addEventListener("change", (e) => { window.signUserValue = e.target.value; render("signoff"); });
  document.getElementById("daySignList").addEventListener("click", (e) => {
    const b = e.target.closest(".edit-sign-btn"), lb = e.target.closest(".log-btn");
    if (b) { window.signUserValue = b.dataset.user; render("signoff"); }
    if (lb) { openSignLogs(lb.dataset.date, lb.dataset.user); }
  });
  document.getElementById("signForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const user = isVA ? state.currentUser.name : f.get("user");
    try {
      await api("/api/signoffs", { method: "POST", body: JSON.stringify({ date: selectedDate, user, vobs: num(f.get("vobs")), calls: num(f.get("calls")), scheduling: num(f.get("scheduling")), payments: num(f.get("payments")), extra: num(f.get("extra")), notes: f.get("notes") || "" }) });
      window.signUserValue = user;
      toast("Sign-off saved & audit log updated");
      await refreshState();
    } catch (err) { toast(err.message); }
  });
}
function changeSignMonth(delta) { const d = new Date(selectedDate + "T12:00:00"); d.setMonth(d.getMonth() + delta); selectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; render("signoff"); }

async function openSignLogs(date, user) {
  try {
    const data = await api(`/api/signoffs/logs?date=${encodeURIComponent(date)}&user=${encodeURIComponent(user)}`);
    openModal(`
      <h3 style="margin-top:0">Sign-Off Update History — ${esc(user)} (${date})</h3>
      ${table(["Updated By", "Role", "Timestamp", "VOBs", "Calls", "Sched.", "Payments", "Extra", "Notes"],
        data.logs.map((l) => `<tr><td><b>${esc(l.updated_by)}</b></td><td><span class="tag blue">${esc(l.updated_by_role)}</span></td><td>${new Date(l.created_at).toLocaleString()}</td><td>${l.vobs}</td><td>${l.calls}</td><td>${l.scheduling}</td><td>${money(l.payments)}</td><td>${l.extra}</td><td>${esc(l.notes)}</td></tr>`).join(""))}
      <div class="actions"><button class="secondary close-modal-btn">Close</button></div>
    `);
  } catch (err) { toast(err.message); }
}

function review(v) {
  const rows = state.signoffs.filter((s) => (!reviewFilters.from || s.date >= reviewFilters.from) && (!reviewFilters.to || s.date <= reviewFilters.to) && (!reviewFilters.lead || s.lead === reviewFilters.lead) && (!reviewFilters.user || s.user === reviewFilters.user) && (!reviewFilters.q || `${s.user} ${s.lead} ${s.notes} ${s.updated_by}`.toLowerCase().includes(reviewFilters.q.toLowerCase())) && (reviewFilters.status === "All" || signStatus(s) === reviewFilters.status));
  const qParams = () => new URLSearchParams(reviewFilters).toString();
  const isVA = state.currentUser.role === "user";

  v.innerHTML = `<section class="card"><div class="section-head"><h3>Filter & Export Sign-Off Reports</h3><span class="tag">${rows.length} matching rows</span></div>
  <div class="form-grid"><div class="field"><label>Date from</label><input type="date" id="rf" value="${reviewFilters.from}"></div><div class="field"><label>Date to</label><input type="date" id="rt" value="${reviewFilters.to}"></div>
  <div class="field"><label>Row lead</label><select id="rl" ${state.currentUser.role !== "super_admin" ? "disabled" : ""}><option value="">All</option>${state.leads.map((l) => `<option ${l === reviewFilters.lead ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
  <div class="field"><label>Employee</label><select id="ru" ${isVA ? "disabled" : ""}><option value="">All</option>${activeVAs().map((u) => `<option ${u.name === reviewFilters.user ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
  <div class="field"><label>Search notes / updater</label><input id="rq" value="${esc(reviewFilters.q)}"></div>
  <div class="field"><label>Status</label><select id="rs"><option>All</option><option ${reviewFilters.status === "Signed" ? "selected" : ""}>Signed</option><option ${reviewFilters.status === "Pending" ? "selected" : ""}>Pending</option></select></div></div>
  <div class="actions">
    <button id="applyReview">Apply Filters</button>
    <button class="secondary" id="clearReview">Clear</button>
    <button class="secondary" id="exportXlsx">⬇ Download Excel (.xlsx)</button>
    <button class="secondary" id="exportPdf">⬇ Download PDF (.pdf)</button>
    <button class="secondary" id="exportCsv">⬇ CSV</button>
  </div></section>
  <section class="card" style="margin-top:16px" id="reviewTbl">${table(["Date", "Employee", "Lead", "VOBs", "Calls", "Scheduling", "Payments", "Extra", "Updated By", "Notes", "Status", "Action"], rows.map((s) => `<tr><td>${s.date}</td><td><b>${esc(s.user)}</b></td><td>${esc(s.lead)}</td><td>${num(s.vobs)}</td><td>${num(s.calls)}</td><td>${num(s.scheduling)}</td><td>${money(s.payments)}</td><td>${num(s.extra)}</td><td>${s.updated_by ? `${esc(s.updated_by)} <span class="tag gray">${esc(s.updated_by_role)}</span>` : "—"}</td><td>${esc(s.notes)}</td><td><span class="tag">${signStatus(s)}</span></td><td><button class="secondary small open-sign-btn" data-date="${s.date}" data-user="${esc(s.user)}">Edit</button> <button class="secondary small log-btn" data-date="${s.date}" data-user="${esc(s.user)}">History</button></td></tr>`).join(""))}</section>`;

  document.getElementById("applyReview").addEventListener("click", () => { reviewFilters = { from: document.getElementById("rf").value, to: document.getElementById("rt").value, lead: document.getElementById("rl").value, user: document.getElementById("ru").value, q: document.getElementById("rq").value, status: document.getElementById("rs").value }; render("review"); });
  document.getElementById("clearReview").addEventListener("click", () => { reviewFilters = { from: "", to: "", lead: "", user: "", q: "", status: "All" }; render("review"); });
  document.getElementById("exportXlsx").addEventListener("click", () => downloadFile(`/api/reports/signoffs/export?format=xlsx&${qParams()}`, "rhinomds-signoff-report.xlsx"));
  document.getElementById("exportPdf").addEventListener("click", () => downloadFile(`/api/reports/signoffs/export?format=pdf&${qParams()}`, "rhinomds-signoff-report.pdf"));
  document.getElementById("exportCsv").addEventListener("click", () => downloadCSV("signoff-review.csv", rows.map((s) => [s.date, s.user, s.lead, s.vobs, s.calls, s.scheduling, s.payments, s.extra, `${s.updated_by || ""} (${s.updated_by_role || ""})`, s.notes, signStatus(s)]), ["Date", "User", "Lead", "VOBs", "Calls", "Scheduling", "Payments", "Extra", "Updated By", "Notes", "Status"]));
  document.getElementById("reviewTbl").addEventListener("click", (e) => {
    const b = e.target.closest(".open-sign-btn"), lb = e.target.closest(".log-btn");
    if (b) { selectedDate = b.dataset.date; window.signUserValue = b.dataset.user; setPage("signoff"); }
    if (lb) { openSignLogs(lb.dataset.date, lb.dataset.user); }
  });
}

async function clocksum(v) {
  v.innerHTML = `<div class="card">Loading Seat & Break Clock Summary...</div>`;
  const qs = new URLSearchParams(clockFilter).toString();
  const data = await api(`/api/reports/clock-summary?${qs}`);

  v.innerHTML = `
  <section class="card" style="margin-bottom:16px">
    <div class="section-head"><h3>Seat & Break Clock Summary</h3><span class="tag purple">Admin Only</span></div>
    <div class="notice">Configured Schedule — <strong>1st Break:</strong> ${esc(data.breaks.break1Start)}–${esc(data.breaks.break1End)} | <strong>2nd Break:</strong> ${esc(data.breaks.break2Start)}–${esc(data.breaks.break2End)}</div>
    <div class="form-grid">
      <div class="field"><label>From Date</label><input type="date" id="cf" value="${clockFilter.from}"></div>
      <div class="field"><label>To Date</label><input type="date" id="ct" value="${clockFilter.to}"></div>
      <div class="field"><label>Row Lead</label><select id="cl"><option value="">All Leads</option>${state.leads.map((l) => `<option ${l === clockFilter.lead ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="field"><label>Employee</label><select id="cu"><option value="">All Users</option>${activeVAs().map((u) => `<option ${u.name === clockFilter.user ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select></div>
    </div>
    <div class="actions">
      <button id="applyClock">Apply Filters</button>
      <button class="secondary" id="clockXlsx">⬇ Download Excel (.xlsx)</button>
      <button class="secondary" id="clockPdf">⬇ Download PDF (.pdf)</button>
    </div>
  </section>
  <section class="card">
    ${table(["Employee", "Role", "Row Lead", "Live Status", "On Seat Time", "Short Break Time", "Away Time", "Total Out of Seat", "Breaks Taken", "Away Count"],
      data.rows.map((r) => `<tr>
        <td><b>${esc(r.name)}</b></td><td>${esc(r.role)}</td><td>${esc(r.lead)}</td>
        <td>${seatBadge(r.current_status)}</td>
        <td><strong style="color:#087e70">${fmtMins(r.on_seat_minutes)}</strong></td>
        <td>${fmtMins(r.break_minutes)}</td>
        <td>${fmtMins(r.away_minutes)}</td>
        <td><strong style="color:#c24141">${fmtMins(r.out_of_seat_minutes)}</strong></td>
        <td>${r.break_count}</td>
        <td>${r.away_count}</td>
      </tr>`).join(""))}
  </section>`;

  document.getElementById("applyClock").addEventListener("click", () => {
    clockFilter = { from: document.getElementById("cf").value || todayISO(), to: document.getElementById("ct").value || todayISO(), lead: document.getElementById("cl").value, user: document.getElementById("cu").value };
    render("clocksum");
  });
  document.getElementById("clockXlsx").addEventListener("click", () => downloadFile(`/api/reports/clock-summary/export?format=xlsx&${new URLSearchParams(clockFilter).toString()}`, `rhinomds-clock-summary-${clockFilter.from}.xlsx`));
  document.getElementById("clockPdf").addEventListener("click", () => downloadFile(`/api/reports/clock-summary/export?format=pdf&${new URLSearchParams(clockFilter).toString()}`, `rhinomds-clock-summary-${clockFilter.from}.pdf`));
}

function rating(n) { return n >= 9 ? "Excellent" : n >= 8 ? "Very good" : n >= 6.5 ? "Good" : n >= 5 ? "Average" : "Needs improvement"; }
function bonus(v) {
  const scores = activeVAs().map((u) => employeeStats(u.name, monthSelected)).sort((a, b) => b.score - a.score);
  const avg = scores.length ? scores.reduce((a, s) => a + s.score, 0) / scores.length : 0;
  const mStr = monthSelected.slice(0, 7);

  v.innerHTML = `<div class="toolbar"><div class="field"><label>Bonus month</label><input type="month" id="bonusMonth" value="${mStr}"></div><span class="tag purple">Admin Only</span></div>
  <div class="grid kpis">${kpi("Average score", avg.toFixed(1) + "/10", "Active VAs")}${kpi("Employees scored", scores.length, "")}${kpi("Top performer", scores[0]?.user || "—", (scores[0]?.score.toFixed(1) || 0) + " / 10")}${kpi("Signed entries", monthRows(monthSelected).filter((s) => signStatus(s) === "Signed").length, "Selected month")}</div>
  <section class="card"><div class="section-head"><h3>Monthly scorecard</h3><div class="actions" style="margin:0"><button class="secondary small" id="bonusXlsx">⬇ Excel (.xlsx)</button><button class="secondary small" id="bonusPdf">⬇ PDF (.pdf)</button><button class="secondary small" id="bonusCsv">⬇ CSV</button></div></div>
  ${table(["Rank", "Employee", "Row lead", "Practices", "Days", "VOBs", "Calls", "Scheduling", "Payments", "Extra", "Score / 10", "Rating"], scores.map((s, i) => `<tr><td class="rank">#${i + 1}</td><td><b>${esc(s.user)}</b></td><td>${esc(s.lead)}</td><td>${s.practices}</td><td>${s.days}</td><td>${s.actual.vobs}</td><td>${s.actual.calls}</td><td>${s.actual.scheduling}</td><td>${money(s.actual.payments)}</td><td>${s.actual.extra}</td><td class="score">${s.score.toFixed(1)}</td><td><span class="tag ${s.score >= 8 ? "" : s.score >= 5 ? "warn" : "red"}">${rating(s.score)}</span></td></tr>`).join(""))}</section>`;

  document.getElementById("bonusMonth").addEventListener("change", (e) => { monthSelected = e.target.value + "-01"; render("bonus"); });
  document.getElementById("bonusXlsx").addEventListener("click", () => downloadFile(`/api/reports/bonus/export?format=xlsx&month=${mStr}`, `rhinomds-bonus-${mStr}.xlsx`));
  document.getElementById("bonusPdf").addEventListener("click", () => downloadFile(`/api/reports/bonus/export?format=pdf&month=${mStr}`, `rhinomds-bonus-${mStr}.pdf`));
  document.getElementById("bonusCsv").addEventListener("click", () => downloadCSV("monthly-bonus.csv", scores.map((s, i) => [i + 1, s.user, s.lead, s.practices, s.days, s.actual.vobs, s.actual.calls, s.actual.scheduling, s.actual.payments, s.actual.extra, s.score.toFixed(1), rating(s.score)]), ["Rank", "Employee", "Lead", "Practices", "Days", "VOBs", "Calls", "Scheduling", "Payments", "Extra", "Score", "Rating"]));
}

async function leaderboard(v) {
  v.innerHTML = `<div class="card">Loading leaderboard...</div>`;
  const data = await api(`/api/leaderboard?month=${monthSelected.slice(0, 7)}`);
  const basis = window.rankBasisValue || "Total";
  const ranked = data.teams.map((t) => ({ ...t, score: basis === "Per employee" ? (t.employees ? (t.vobs + t.calls + t.scheduling + t.payments) / t.employees : 0) : (t.vobs + t.calls + t.scheduling + t.payments) })).sort((a, b) => b.score - a.score);
  v.innerHTML = `<div class="toolbar"><div class="field"><label>Month</label><input type="month" id="leaderMonth" value="${monthSelected.slice(0, 7)}"></div><div class="field"><label>Basis</label><select id="rankBasis"><option ${basis === "Total" ? "selected" : ""}>Total</option><option ${basis === "Per employee" ? "selected" : ""}>Per employee</option></select></div></div>
  <section class="card"><div class="section-head"><h3>Row lead team rankings</h3></div>${table(["Position", "Row lead team", "Employees", "VOBs", "Calls", "Scheduling", "Payments", "Points", "Award"], ranked.map((t, i) => `<tr><td class="rank">#${i + 1}</td><td><b>${esc(t.lead)}</b></td><td>${t.employees}</td><td>${t.vobs}</td><td>${t.calls}</td><td>${t.scheduling}</td><td>${money(t.payments)}</td><td><b>${t.score.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></td><td>${i === 0 ? "🥇 Gold" : i === 1 ? "🥈 Silver" : i === 2 ? "🥉 Bronze" : "—"}</td></tr>`).join(""))}</section>
  <section class="card" style="margin-top:16px"><div class="section-head"><h3>Category performance by team</h3></div>${["vobs", "calls", "scheduling", "payments"].map((k, i) => { const label = ["VOBs", "Patient calls", "Scheduling", "Patient payments"][i], max = Math.max(1, ...data.teams.map((t) => t[k])); return `<div style="margin:14px 0"><b>${label}</b><div class="bar-list" style="margin-top:8px">${data.teams.map((t) => `<div class="bar-row"><span>${esc(t.lead)}</span><div class="bar-track"><div class="bar-fill" style="width:${t[k] / max * 100}%"></div></div><b>${k === "payments" ? money(t[k]) : t[k]}</b></div>`).join("")}</div></div>`; }).join("")}</section>`;
  document.getElementById("leaderMonth").addEventListener("change", (e) => { monthSelected = e.target.value + "-01"; render("leaderboard"); });
  document.getElementById("rankBasis").addEventListener("change", (e) => { window.rankBasisValue = e.target.value; render("leaderboard"); });
}

function audit(v) {
  const logs = state.auditLogs || [];
  v.innerHTML = `<section class="card"><div class="section-head"><h3>Security Audit Logs (Latest 200)</h3><span class="tag purple">Admin Only</span></div>
  ${table(["Timestamp", "Actor", "Role", "Action", "Details", "IP Address"], logs.map((l) => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td><b>${esc(l.actor_name)}</b></td><td>${esc(l.actor_role || "—")}</td><td><span class="tag ${l.action.includes("FAIL") ? "red" : "blue"}">${esc(l.action)}</span></td><td>${esc(l.details)}</td><td>${esc(l.ip_address || "—")}</td></tr>`).join(""))}</section>`;
}

function settings(v) {
  const dstOn = Boolean(state.clock?.daylightSaving);
  v.innerHTML = `<div class="grid two">
  <section class="card"><div class="section-head"><h3>Clock DST, Break Schedule & Security</h3><span class="tag purple">Admin Only</span></div>
    <form id="breakSecForm"><div class="form-grid" style="grid-template-columns:repeat(2,1fr)">
      <div class="field wide"><label>US Daylight Saving Time (DST)</label>
        <select name="daylightSaving">
          <option value="false" ${!dstOn ? "selected" : ""}>OFF — Standard Time (EST UTC-5 / CST UTC-6)</option>
          <option value="true" ${dstOn ? "selected" : ""}>ON — Daylight Saving Time (EDT UTC-4 / CDT UTC-5)</option>
        </select>
      </div>
      <div class="field"><label>1st Break Start</label><input type="time" name="break1Start" value="${esc(state.breaks.break1Start)}"></div>
      <div class="field"><label>1st Break End</label><input type="time" name="break1End" value="${esc(state.breaks.break1End)}"></div>
      <div class="field"><label>2nd Break Start</label><input type="time" name="break2Start" value="${esc(state.breaks.break2Start)}"></div>
      <div class="field"><label>2nd Break End</label><input type="time" name="break2End" value="${esc(state.breaks.break2End)}"></div>
      <div class="field wide"><label>Idle Auto-Logoff Timeout (minutes, min 5)</label><input type="number" min="5" max="120" name="idleTimeoutMinutes" value="${num(state.security?.idleTimeoutMinutes) || 15}"></div>
    </div><div class="actions"><button>Save Clock, Break & Security Settings</button></div></form>
    <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
    <div class="section-head"><h3>Bonus scoring targets & weights</h3></div>
    <form id="targetForm"><div class="form-grid">${[["vobs", "VOB daily"], ["calls", "Calls daily"], ["scheduling", "Scheduling daily"], ["payments", "Payment daily ($)"], ["extra", "Extra daily"], ["consistency", "Consistency (days)"]].map(([k, l]) => `<div class="field"><label>${l}</label><input type="number" min="0" step=".01" name="${k}" value="${state.targets[k]}"></div>`).join("")}</div>
    <h4 style="margin:14px 0 8px">Metric weights (%)</h4><div class="form-grid">${Object.entries(state.weights).map(([k, val]) => `<div class="field"><label>${k} (%)</label><input type="number" min="0" max="100" step=".01" name="w_${k}" value="${(val * 100).toFixed(2)}"></div>`).join("")}</div>
    <div class="actions"><button>Save Scoring Settings</button></div></form>
  </section>

  <section class="card"><div class="section-head"><h3>Row Leads & Data Backup</h3></div>
    <form id="leadForm" class="toolbar"><input class="control" name="lead" placeholder="Add row lead" required><button>Add lead</button></form>
    <div id="leadsList">${state.leads.map((l) => `<span class="tag gray" style="margin:4px">${esc(l)} <button class="danger small del-lead-btn" data-lead="${esc(l)}" style="padding:1px 5px">×</button></span>`).join("")}</div>
    <div class="actions" style="margin-top:20px"><button class="secondary" id="exportBackupBtn">Download JSON Backup</button></div>
    <div class="field" style="margin-top:16px"><label>Restore / Import JSON Backup</label><input type="file" id="restoreFile" accept=".json,application/json"></div>
  </section></div>`;

  document.getElementById("breakSecForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        clock: { daylightSaving: f.get("daylightSaving") === "true" },
        breaks: { break1Start: f.get("break1Start"), break1End: f.get("break1End"), break2Start: f.get("break2Start"), break2End: f.get("break2End") },
        security: { idleTimeoutMinutes: Math.max(5, num(f.get("idleTimeoutMinutes"))) }
      })
    });
    toast("Clock DST, break & security settings saved"); await refreshState();
  });

  document.getElementById("targetForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target), targets = { ...state.targets }, weights = { ...state.weights };
    Object.keys(targets).forEach((k) => (targets[k] = num(f.get(k))));
    Object.keys(weights).forEach((k) => (weights[k] = num(f.get("w_" + k)) / 100));
    await api("/api/settings", { method: "PUT", body: JSON.stringify({ targets, weights }) });
    toast("Scoring settings saved"); await refreshState();
  });

  document.getElementById("leadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/api/leads", { method: "POST", body: JSON.stringify({ lead: new FormData(e.target).get("lead") }) }); toast("Row lead added"); await refreshState(); }
    catch (err) { toast(err.message); }
  });

  document.getElementById("leadsList").addEventListener("click", async (e) => {
    const b = e.target.closest(".del-lead-btn");
    if (b && confirm(`Delete Row Lead ${b.dataset.lead}?`)) {
      try { await api(`/api/leads/${encodeURIComponent(b.dataset.lead)}`, { method: "DELETE" }); await refreshState(); } catch (err) { toast(err.message); }
    }
  });

  document.getElementById("exportBackupBtn").addEventListener("click", exportBackup);
  document.getElementById("restoreFile").addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { await api("/api/backup/restore", { method: "POST", body: reader.result }); toast("Backup restored"); await refreshState(); }
      catch (err) { alert("Restore error: " + err.message); }
    };
    reader.readAsText(file);
  });
}

async function downloadFile(url, filename) {
  try {
    const res = await fetch(url);
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || "Download failed"); }
    downloadBlob(filename, await res.blob());
    toast(`Downloaded ${filename}`);
  } catch (err) { toast(err.message); }
}
function exportBackup() { downloadBlob("rhinomds-va-backup.json", new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })); toast("Backup downloaded"); }
function downloadBlob(name, blob) { const a = document.createElement("a"), url = URL.createObjectURL(blob); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function downloadCSV(name, rows, headers) { const csv = [headers, ...rows].map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n"); downloadBlob(name, new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })); }

boot();
