const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const useSSL =
  process.env.DATABASE_URL &&
  !process.env.DATABASE_URL.includes("localhost") &&
  !process.env.DATABASE_URL.includes("127.0.0.1");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

const SEED = {
  users: [
    { first_name: "Shaloom", last_name: "Emmanuel", name: "Shaloom Emmanuel", pseudo_name: "Shaloom Emmanuel", email: "sahloome@rhinomds.com", designation: "Medical Virtual Assistant", username: "shaloom", role: "row_lead", lead: "Shaloom Emmanuel", status: "Active" },
    { first_name: "Umer", last_name: "Ibrahim", name: "Umer Ibrahim", pseudo_name: "Sam Williams", email: "samwilliams@rhinomds.com", designation: "Medical Virtual Assistant", username: "umer ibrahim", role: "row_lead", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Abdul", last_name: "Moiz", name: "Abdul Moiz", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Abdul", last_name: "Rafay", name: "Abdul Rafay", designation: "Medical Virtual Assistant", role: "user", lead: "Shaloom Emmanuel", status: "Active" },
    { first_name: "Areeb", last_name: "Anwar", name: "Areeb Anwar", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Ayesha", last_name: "Abbasi", name: "Ayesha Abbasi", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Bushra", last_name: "Jamil", name: "Bushra Jamil", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Fahad", last_name: "Akbar", name: "Fahad Akbar", pseudo_name: "Liam", email: "liam@rhinomds.com", designation: "Medical Virtual Assistant", username: "liam", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Farah", last_name: "Liaquat", name: "Farah Liaquat", designation: "Medical Virtual Assistant", role: "user", lead: "Shaloom Emmanuel", status: "Active" },
    { first_name: "Hina", last_name: "Nawaz", name: "Hina Nawaz", designation: "Medical Virtual Assistant", role: "user", lead: "Shahzaib Satti", status: "Active" },
    { first_name: "Huzaifa", last_name: "Imran", name: "Huzaifa Imran", designation: "Medical Virtual Assistant", role: "user", lead: "Maaz Bin Farhan", status: "Active" },
    { first_name: "Mohsin", last_name: "Khan", name: "Mohsin Khan", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Moiz", last_name: "Adnan Awan", name: "Moiz Adnan Awan", designation: "Medical Virtual Assistant", role: "user", lead: "Shaloom Emmanuel", status: "Active" },
    { first_name: "Muhammad", last_name: "Husnain", name: "Muhammad Husnain", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Muhammad", last_name: "Huzaifa", name: "Muhammad Huzaifa", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Muhammad", last_name: "Iqbal", name: "Muhammad Iqbal", designation: "Medical Virtual Assistant", role: "user", lead: "Shahzaib Satti", status: "Active" },
    { first_name: "Muhammad", last_name: "Shahzad", name: "Muhammad Shahzad", designation: "Medical Virtual Assistant", role: "user", lead: "Maaz Bin Farhan", status: "Active" },
    { first_name: "Muhammad", last_name: "Zikriya", name: "Muhammad Zikriya", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Mushahid", last_name: "Hussain", name: "Mushahid Hussain", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Nehemiah", last_name: "Gill", name: "Nehemiah Gill", designation: "Medical Virtual Assistant", role: "user", lead: "Shahzaib Satti", status: "Active" },
    { first_name: "Saad", last_name: "Shah", name: "Saad Shah", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Saima", last_name: "", name: "Saima", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Samiullah", last_name: "", name: "Samiullah", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Sayyab", last_name: "Siddique", name: "Sayyab Siddique", designation: "Medical Virtual Assistant", role: "user", lead: "Maaz Bin Farhan", status: "Active" },
    { first_name: "Shahzaib", last_name: "Umer", name: "Shahzaib Umer", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Sinan", last_name: "Afzal", name: "Sinan Afzal", designation: "Medical Virtual Assistant", role: "user", lead: "Shaloom Emmanuel", status: "Active" },
    { first_name: "Tahira", last_name: "Naz", name: "Tahira Naz", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Wajiha", last_name: "Zahoor", name: "Wajiha Zahoor", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Waqar", last_name: "Ahmad", name: "Waqar Ahmad", designation: "Medical Virtual Assistant", role: "user", lead: "Umer Ibrahim", status: "Active" },
    { first_name: "Zia", last_name: "Ullah", name: "Zia Ullah", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Zoha", last_name: "Mumtaz", name: "Zoha Mumtaz", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" },
    { first_name: "Zoha", last_name: "Mursaleen", name: "Zoha Mursaleen", designation: "Medical Virtual Assistant", role: "user", lead: "Saad Abdullah", status: "Active" }
  ],
  assignments: [
    { user: "Abdul Moiz", practice: "Healing Light" },
    { user: "Abdul Rafay", practice: "Dominion Health" },
    { user: "Areeb Anwar", practice: "Anchor Care" },
    { user: "Ayesha Abbasi", practice: "Anchor Care" },
    { user: "Bushra Jamil", practice: "Gateway" },
    { user: "Bushra Jamil", practice: "Akosua Abankwah" },
    { user: "Bushra Jamil", practice: "Harmonized" },
    { user: "Bushra Jamil", practice: "Thriven Minds" },
    { user: "Fahad Akbar", practice: "CJI" },
    { user: "Fahad Akbar", practice: "Central TX Holistic Care" },
    { user: "Farah Liaquat", practice: "Dominion Health" },
    { user: "Hina Nawaz", practice: "Ideal MD" },
    { user: "Huzaifa Imran", practice: "Orchid Wellness" },
    { user: "Huzaifa Imran", practice: "Johnson Medical" },
    { user: "Mohsin Khan", practice: "Bluehaven Psychiatry" },
    { user: "Mohsin Khan", practice: "Amity Healthcare Services" },
    { user: "Moiz Adnan Awan", practice: "Dominion Health" },
    { user: "Muhammad Husnain", practice: "Naga" },
    { user: "Muhammad Husnain", practice: "Eligibility Email" },
    { user: "Muhammad Huzaifa", practice: "Harmonized" },
    { user: "Muhammad Huzaifa", practice: "Gateway" },
    { user: "Muhammad Huzaifa", practice: "Thriven Minds" },
    { user: "Muhammad Huzaifa", practice: "Akosua Abankwah" },
    { user: "Muhammad Iqbal", practice: "Ideal MD" },
    { user: "Muhammad Shahzad", practice: "Onyx Medical" },
    { user: "Muhammad Shahzad", practice: "Progressive Pathway" },
    { user: "Muhammad Zikriya", practice: "Southlake Serenity Psychiatry" },
    { user: "Mushahid Hussain", practice: "Youbridge Health" },
    { user: "Nehemiah Gill", practice: "Ideal MD" },
    { user: "Saad Shah", practice: "Southlake Serenity Psychiatry" },
    { user: "Saad Shah", practice: "Angelic" },
    { user: "Saima", practice: "North Node Therapy" },
    { user: "Samiullah", practice: "North Node Therapy" },
    { user: "Sayyab Siddique", practice: "Orchid Wellness" },
    { user: "Shahzaib Umer", practice: "Bluehaven Psychiatry" },
    { user: "Shahzaib Umer", practice: "Amity Healthcare Services" },
    { user: "Sinan Afzal", practice: "Dominion Health" },
    { user: "Tahira Naz", practice: "North Node Therapy" },
    { user: "Wajiha Zahoor", practice: "Anchor Care" },
    { user: "Waqar Ahmad", practice: "Cornerstone Healthcare Services" },
    { user: "Zia Ullah", practice: "Youbridge Health" },
    { user: "Zoha Mumtaz", practice: "Heartland Mental Health" },
    { user: "Zoha Mursaleen", practice: "Heartland Mental Health" }
  ],
  practices: [
    "Akosua Abankwah", "Amity Healthcare Services", "Anchor Care", "Angelic", "Bluehaven Psychiatry",
    "CJI", "Central TX Holistic Care", "Cornerstone Healthcare Services", "Dominion Health",
    "Eligibility Email", "Gateway", "Harmonized", "Healing Light", "Heartland Mental Health",
    "Ideal MD", "Johnson Medical", "Naga", "North Node Therapy", "Onyx Medical", "Orchid Wellness",
    "Progressive Pathway", "Southlake Serenity Psychiatry", "Thriven Minds", "Youbridge Health"
  ],
  leads: ["Maaz Bin Farhan", "Saad Abdullah", "Shahzaib Satti", "Shaloom Emmanuel", "Umer Ibrahim"],
  signoffs: [
    { date: "2027-02-01", user: "Fahad Akbar", lead: "Saad Abdullah", vobs: 0, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Saad Abdullah", updated_by_role: "Admin" },
    { date: "2026-11-20", user: "Abdul Moiz", lead: "Umer Ibrahim", vobs: 16, calls: 32, scheduling: 4, payments: 35, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Ayesha Abbasi", lead: "Umer Ibrahim", vobs: 0, calls: 11, scheduling: 0, payments: 200, extra: 4, notes: "Meeting with Google Team \nMeeting with office staff\nZocdoc & Calendar alignment\nMedical Record Request", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Abdul Rafay", lead: "Shaloom Emmanuel", vobs: 6, calls: 10, scheduling: 12, payments: 350, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Moiz Adnan Awan", lead: "Shaloom Emmanuel", vobs: 8, calls: 15, scheduling: 18, payments: 220, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Sinan Afzal", lead: "Shaloom Emmanuel", vobs: 8, calls: 19, scheduling: 20, payments: 120, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Farah Liaquat", lead: "Shaloom Emmanuel", vobs: 18, calls: 0, scheduling: 20, payments: 50, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Wajiha Zahoor", lead: "Umer Ibrahim", vobs: 19, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-20", user: "Fahad Akbar", lead: "Saad Abdullah", vobs: 15, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Fahad Akbar", updated_by_role: "User" },
    { date: "2026-11-20", user: "Waqar Ahmad", lead: "Umer Ibrahim", vobs: 23, calls: 51, scheduling: 37, payments: 260, extra: 1, notes: "Medication Faxes Processed", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Waqar Ahmad", lead: "Umer Ibrahim", vobs: 14, calls: 30, scheduling: 18, payments: 0, extra: 2, notes: "1) Medical Record Request\n2) Medication Request from Pharmacy", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Abdul Rafay", lead: "Shaloom Emmanuel", vobs: 3, calls: 5, scheduling: 4, payments: 550, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Farah Liaquat", lead: "Shaloom Emmanuel", vobs: 6, calls: 5, scheduling: 20, payments: 50, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Sinan Afzal", lead: "Shaloom Emmanuel", vobs: 3, calls: 13, scheduling: 15, payments: 180, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Fahad Akbar", lead: "Saad Abdullah", vobs: 21, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Fahad Akbar", updated_by_role: "User" },
    { date: "2026-11-19", user: "Areeb Anwar", lead: "Umer Ibrahim", vobs: 8, calls: 25, scheduling: 14, payments: 150, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Wajiha Zahoor", lead: "Umer Ibrahim", vobs: 15, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Abdul Moiz", lead: "Umer Ibrahim", vobs: 12, calls: 20, scheduling: 1, payments: 0, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-19", user: "Ayesha Abbasi", lead: "Umer Ibrahim", vobs: 0, calls: 15, scheduling: 29, payments: 130, extra: 6, notes: "1) Coordination with provider and front desk\n2) Sent emails regarding work hours of staff\n3) Installed software\n4) Created google Attendance sheet\n5) ZocDoc Calendar Management\n6) Tebra Calendar Alignment", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-18", user: "Moiz Adnan Awan", lead: "Shaloom Emmanuel", vobs: 6, calls: 18, scheduling: 5, payments: 180, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-18", user: "Farah Liaquat", lead: "Shaloom Emmanuel", vobs: 6, calls: 0, scheduling: 18, payments: 80, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-18", user: "Fahad Akbar", lead: "Saad Abdullah", vobs: 13, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Fahad Akbar", updated_by_role: "User" },
    { date: "2026-11-18", user: "Sinan Afzal", lead: "Shaloom Emmanuel", vobs: 6, calls: 23, scheduling: 3, payments: 250, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-18", user: "Abdul Moiz", lead: "Umer Ibrahim", vobs: 2, calls: 24, scheduling: 8, payments: 90, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-18", user: "Waqar Ahmad", lead: "Umer Ibrahim", vobs: 15, calls: 28, scheduling: 20, payments: 0, extra: 2, notes: "Processed 2 medication fax requests.\nProcessed 1 Medical records", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-18", user: "Abdul Rafay", lead: "Shaloom Emmanuel", vobs: 2, calls: 13, scheduling: 6, payments: 950, extra: 1, notes: "Patient balance sheet.", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Sinan Afzal", lead: "Shaloom Emmanuel", vobs: 62, calls: 13, scheduling: 32, payments: 265, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Waqar Ahmad", lead: "Umer Ibrahim", vobs: 17, calls: 22, scheduling: 37, payments: 0, extra: 2, notes: "Processed 3 medication fax requests.\nProcessed 2 Medical records", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Abdul Moiz", lead: "Umer Ibrahim", vobs: 8, calls: 32, scheduling: 2, payments: 0, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Wajiha Zahoor", lead: "Umer Ibrahim", vobs: 17, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Abdul Rafay", lead: "Shaloom Emmanuel", vobs: 3, calls: 5, scheduling: 10, payments: 350, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Farah Liaquat", lead: "Shaloom Emmanuel", vobs: 12, calls: 0, scheduling: 15, payments: 0, extra: 0, notes: "", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-17", user: "Moiz Adnan Awan", lead: "Shaloom Emmanuel", vobs: 6, calls: 19, scheduling: 12, payments: 220, extra: 1, notes: "Multiple calls to pharmacies per provider's request which do not comes in JD.", updated_by: "Shaloom Emmanuel", updated_by_role: "Row Lead" },
    { date: "2026-11-16", user: "Bushra Jamil", lead: "Umer Ibrahim", vobs: 9, calls: 19, scheduling: 24, payments: 580, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-16", user: "Abdul Moiz", lead: "Umer Ibrahim", vobs: 6, calls: 36, scheduling: 2, payments: 170, extra: 0, notes: "", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-16", user: "Fahad Akbar", lead: "Saad Abdullah", vobs: 4, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Fahad Akbar", updated_by_role: "User" },
    { date: "2026-11-16", user: "Waqar Ahmad", lead: "Umer Ibrahim", vobs: 9, calls: 31, scheduling: 5, payments: 0, extra: 5, notes: "Medication Faxes from pharmacy to be processed.", updated_by: "Umer Ibrahim", updated_by_role: "Row Lead" },
    { date: "2026-11-13", user: "Fahad Akbar", lead: "Saad Abdullah", vobs: 5, calls: 0, scheduling: 0, payments: 0, extra: 0, notes: "", updated_by: "Super Admin", updated_by_role: "Admin" }
  ],
  targets: { vobs: 5, calls: 10, scheduling: 10, payments: 100, extra: 1, consistency: 1 },
  weights: { vobs: 0.8, calls: 0.05, scheduling: 0.05, payments: 0.05, extra: 0.01, consistency: 0.04 },
  breaks: { break1Start: "21:30", break1End: "21:45", break2Start: "00:30", break2End: "01:00" },
  security: { idleTimeoutMinutes: Number(process.env.IDLE_TIMEOUT_MINUTES) || 15 },
  clock: { daylightSaving: false }
};

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      name TEXT UNIQUE NOT NULL,
      date_of_joining TEXT NOT NULL DEFAULT '',
      pseudo_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      designation TEXT NOT NULL DEFAULT '',
      username TEXT UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      lead TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      seat_status TEXT NOT NULL DEFAULT 'Offline',
      seat_note TEXT NOT NULL DEFAULT '',
      seat_updated_at TIMESTAMPTZ,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_joining TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS seat_status TEXT NOT NULL DEFAULT 'Offline';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS seat_note TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS seat_updated_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS presence_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      lead_name TEXT NOT NULL DEFAULT '',
      shift_date TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER,
      actor_name TEXT NOT NULL DEFAULT '',
      actor_role TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
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

  await pool.query("DELETE FROM notifications WHERE type IN ('birthday', 'task_assigned', 'task_completed')");

  const adminFirst = (process.env.ADMIN_FIRST_NAME || "Saad").trim();
  const adminLast = (process.env.ADMIN_LAST_NAME || "Abdullah").trim();
  const adminFull = `${adminFirst} ${adminLast}`.trim();
  const adminUser = (process.env.ADMIN_USERNAME || "adam smith").trim().toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "ChangeThisStrong!123";

  const existingAdmin = await pool.query("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1");
  if (existingAdmin.rowCount === 0) {
    const hash = await bcrypt.hash(adminPass, 10);
    await pool.query(
      `INSERT INTO users (first_name, last_name, name, pseudo_name, email, designation, username, password_hash, role, lead, status)
       VALUES ($1, $2, $3, 'Adam Smith', 'asmith@rhinomds.com', 'Super Admin', $4, $5, 'super_admin', '', 'Active')
       ON CONFLICT (username) DO NOTHING`,
      [adminFirst, adminLast, adminFull, adminUser, hash]
    );
    console.log(`Seeded Super Admin account: ${adminUser}`);
  }

  const userCount = await pool.query("SELECT COUNT(*)::int AS c FROM users WHERE role <> 'super_admin'");
  if (userCount.rows[0].c === 0) {
    for (const l of SEED.leads) await pool.query("INSERT INTO leads (name) VALUES ($1) ON CONFLICT DO NOTHING", [l]);
    for (const p of SEED.practices) await pool.query("INSERT INTO practices (name) VALUES ($1) ON CONFLICT DO NOTHING", [p]);
    for (const u of SEED.users) {
      await pool.query(
        `INSERT INTO users (first_name, last_name, name, pseudo_name, email, designation, username, role, lead, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (name) DO NOTHING`,
        [u.first_name, u.last_name, u.name, u.pseudo_name || "", u.email || "", u.designation || "Medical Virtual Assistant", u.username || null, u.role || "user", u.lead || "", u.status || "Active"]
      );
    }
    for (const a of SEED.assignments) {
      await pool.query("INSERT INTO assignments (user_name, practice_name) VALUES ($1, $2) ON CONFLICT DO NOTHING", [a.user, a.practice]);
    }
    for (const s of SEED.signoffs) {
      await pool.query(
        `INSERT INTO signoffs (date, user_name, lead_name, vobs, calls, scheduling, payments, extra, notes, updated_by, updated_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (date, user_name) DO NOTHING`,
        [s.date, s.user, s.lead, s.vobs, s.calls, s.scheduling, s.payments, s.extra, s.notes, s.updated_by, s.updated_by_role]
      );
    }
  }

  for (const [k, val] of Object.entries({ targets: SEED.targets, weights: SEED.weights, breaks: SEED.breaks, security: SEED.security, clock: SEED.clock })) {
    await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [k, JSON.stringify(val)]);
  }
}

module.exports = { pool, SEED, initDB, splitName };