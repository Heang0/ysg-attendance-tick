const express = require("express");
const { sql } = require("@vercel/postgres");
const path = require("path");

if (process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

const app = express();
const PORT = process.env.PORT || 3000;

// ====== CONFIG ======
// Optional simple admin key for export page (no login). Set ADMIN_KEY in env.
const ADMIN_KEY = process.env.ADMIN_KEY || "";

// Attendance slots (local server time)
const SLOTS = [
  { key: "08:00", label: "08:00 AM" },
  { key: "12:00", label: "12:00 PM" },
  { key: "12:30", label: "12:30 PM" },
  { key: "17:30", label: "05:30 PM" },
];

// Business rules
const EARLY_MINUTES = 5;
function isAllowedDate(dateObj) {
  return true;
}

function todayISO(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function slotDateTime(dateObj, slotKey) {
  const [hh, mm] = slotKey.split(":").map(Number);
  const dt = new Date(dateObj);
  dt.setHours(hh, mm, 0, 0);
  return dt;
}

function canTickNow(now, slotKey) {
  const slotTime = slotDateTime(now, slotKey);
  const earliest = new Date(slotTime.getTime() - EARLY_MINUTES * 60 * 1000);
  return { allowed: now >= earliest, earliest, slotTime };
}

async function getEmployees() {
  const result = await sql`SELECT name FROM employees ORDER BY name ASC`;
  return result.rows.map(r => r.name);
}

async function employeeExists(name) {
  const result = await sql`SELECT 1 FROM employees WHERE name = ${name} LIMIT 1`;
  return result.rowCount > 0;
}

function csvEscape(s) {
  const str = String(s ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ====== API ======
app.get("/api/meta", (req, res) => {
  const now = new Date();
  res.json({
    serverTime: now.toISOString(),
    localDate: todayISO(now),
    allowedNow: isAllowedDate(now),
    slots: SLOTS,
    rules: { days: "Every day", earlyMinutes: EARLY_MINUTES }
  });
});

app.get("/api/employees", async (req, res) => {
  const employees = await getEmployees();
  res.json({ employees });
});

app.get("/api/ticks/today", async (req, res) => {
  const employee = req.query.employee;
  if (!employee) return res.status(400).json({ error: "Missing employee" });

  const now = new Date();
  const date = todayISO(now);

  const result = await sql`
    SELECT employee, date::text AS date, slot, timestamp, ip, user_agent AS "userAgent"
    FROM ticks
    WHERE employee = ${employee} AND date = ${date}
    ORDER BY timestamp ASC
  `;

  res.json({ date, employee, ticks: result.rows });
});

app.get("/api/ticks/history", async (req, res) => {
  const employee = req.query.employee;
  if (!employee) return res.status(400).json({ error: "Missing employee" });

  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
  const date = req.query.date;

  const rows = date
    ? await sql`
        SELECT employee, date::text AS date, slot, timestamp, ip, user_agent AS "userAgent"
        FROM ticks
        WHERE employee = ${employee} AND date = ${date}
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT employee, date::text AS date, slot, timestamp, ip, user_agent AS "userAgent"
        FROM ticks
        WHERE employee = ${employee}
        ORDER BY timestamp DESC
        LIMIT ${limit}
      `;

  res.json({ employee, date: date || null, limit, ticks: rows.rows });
});

app.post("/api/tick", async (req, res) => {
  const { employee, slot } = req.body || {};
  if (!employee || !slot) return res.status(400).json({ error: "Missing employee or slot" });

  const now = new Date();
  if (!isAllowedDate(now)) {
    return res.status(403).json({
      error: "Not allowed today",
      detail: "This tracker is not accepting ticks today."
    });
  }

  const slotOk = SLOTS.some(s => s.key === slot);
  if (!slotOk) return res.status(400).json({ error: "Invalid slot" });

  const timeCheck = canTickNow(now, slot);
  if (!timeCheck.allowed) {
    return res.status(403).json({
      error: "Too early for this slot",
      detail: `You can tick ${EARLY_MINUTES} minutes before the slot time.`,
      earliest: timeCheck.earliest.toISOString(),
      slotTime: timeCheck.slotTime.toISOString()
    });
  }

  const date = todayISO(now);
  const timestamp = now.toISOString();

  if (!(await employeeExists(employee))) {
    return res.status(400).json({ error: "Unknown employee. Add it in the database." });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  const insert = await sql`
    INSERT INTO ticks (employee, date, slot, timestamp, ip, user_agent)
    VALUES (${employee}, ${date}, ${slot}, ${timestamp}, ${ip}, ${userAgent})
    ON CONFLICT (employee, date, slot) DO NOTHING
    RETURNING employee, date::text AS date, slot, timestamp, ip, user_agent AS "userAgent"
  `;

  if (insert.rowCount === 0) {
    return res.status(409).json({ error: "Already ticked for this slot today" });
  }

  res.json({ ok: true, record: insert.rows[0] });
});

// ====== ADMIN / EXPORT ======
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next(); // if no key set, allow (local testing)
  const key = req.query.key || req.headers["x-admin-key"] || "";
  if (key !== ADMIN_KEY) return res.status(401).send("Unauthorized");
  next();
}

app.get("/admin", requireAdmin, async (req, res) => {
  const totalResult = await sql`SELECT COUNT(*)::int AS total FROM ticks`;
  const total = totalResult.rows[0]?.total || 0;
  res.type("html").send(`
    <html>
      <head><title>Admin - Attendance Tick</title><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style="font-family:system-ui;max-width:900px;margin:40px auto;padding:0 16px;">
        <h1>Admin</h1>
        <p>Total tick records: <b>${total}</b></p>
        <ul>
          <li><a href="/api/export.csv${ADMIN_KEY ? "?key=" + encodeURIComponent(req.query.key || "") : ""}">Download CSV export</a></li>
        </ul>
        <p>Tip: Set <code>ADMIN_KEY</code> environment variable so only admins can export.</p>
      </body>
    </html>
  `);
});

app.get("/api/export.csv", requireAdmin, async (req, res) => {
  const header = ["employee","date","slot","timestamp","ip","userAgent"];
  const lines = [header.join(",")];

  // Sort stable for readability
  const rows = await sql`
    SELECT employee, date::text AS date, slot, timestamp, ip, user_agent AS "userAgent"
    FROM ticks
    ORDER BY date ASC, employee ASC, slot ASC
  `;

  for (const t of rows.rows) {
    const row = header.map(h => csvEscape(t[h]));
    lines.push(row.join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="attendance_ticks.csv"');
  res.send(lines.join("\n"));
});

module.exports = { app, PORT };
