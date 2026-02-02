const express = require("express");
const path = require("path");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const DEFAULT_EMPLOYEES = [
  "Heang",
  "Riya",
  "Kdey",
  "Chi Vorn",
  "Nith",
  "Savath"
];

const TIME_ZONE = process.env.APP_TZ || process.env.TZ || "Asia/Phnom_Penh";
const TZ_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function initFirebase() {
  if (getApps().length) return;
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  const serviceAccount = JSON.parse(json);
  initializeApp({ credential: cert(serviceAccount) });
}

function getTzParts(dateObj) {
  const parts = TZ_FORMAT.formatToParts(dateObj);
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getTimeZoneOffsetMs(dateObj) {
  const parts = getTzParts(dateObj);
  const utcFromParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return utcFromParts - dateObj.getTime();
}

function makeZonedDate(parts, hour, minute, second = 0) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(utcGuess);
  return new Date(utcGuess.getTime() - offset);
}

function normalizeTick(t) {
  const ts = t?.timestamp;
  const iso = ts && typeof ts.toDate === "function" ? ts.toDate().toISOString() : ts;
  return { ...t, timestamp: iso };
}

async function seedEmployeesIfEmpty() {
  initFirebase();
  const db = getFirestore();
  const snap = await db.collection("employees").limit(1).get();
  if (!snap.empty) return;

  const batch = db.batch();
  DEFAULT_EMPLOYEES.forEach(name => {
    const ref = db.collection("employees").doc(name);
    batch.set(ref, { name });
  });
  await batch.commit();
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
  { key: "12:20", label: "12:20 PM" },
  { key: "17:30", label: "05:30 PM" },
];

// Business rules
const EARLY_MINUTES = 5;
function isAllowedDate(dateObj) {
  return true;
}

function todayISOFromParts(parts) {
  const y = parts.year;
  const m = String(parts.month).padStart(2, "0");
  const d = String(parts.day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function slotDateTime(parts, slotKey) {
  const [hh, mm] = slotKey.split(":").map(Number);
  return makeZonedDate(parts, hh, mm, 0);
}

function canTickNow(nowUtc, slotKey, parts) {
  const slotTime = slotDateTime(parts, slotKey);
  const earliest = new Date(slotTime.getTime() - EARLY_MINUTES * 60 * 1000);
  return { allowed: nowUtc >= earliest, earliest, slotTime };
}

async function getEmployees() {
  initFirebase();
  const db = getFirestore();
  const snapshot = await db.collection("employees").orderBy("name").get();
  return snapshot.docs.map(d => d.get("name"));
}

async function employeeExists(name) {
  initFirebase();
  const db = getFirestore();
  const doc = await db.collection("employees").doc(name).get();
  return doc.exists;
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
app.get("/api/meta", async (req, res) => {
  await seedEmployeesIfEmpty();
  const now = new Date();
  const parts = getTzParts(now);
  res.json({
    serverTime: now.toISOString(),
    localDate: todayISOFromParts(parts),
    allowedNow: isAllowedDate(now),
    slots: SLOTS,
    rules: { days: "Every day", earlyMinutes: EARLY_MINUTES, timeZone: TIME_ZONE }
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
  const parts = getTzParts(now);
  const date = todayISOFromParts(parts);

  initFirebase();
  const db = getFirestore();
  const snapshot = await db.collection("ticks")
    .where("employee", "==", employee)
    .where("date", "==", date)
    .get();

  const rows = snapshot.docs
    .map(d => normalizeTick(d.data()))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  res.json({ date, employee, ticks: rows });
});

app.get("/api/ticks/history", async (req, res) => {
  const employee = req.query.employee;
  if (!employee) return res.status(400).json({ error: "Missing employee" });

  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
  const date = req.query.date;

  initFirebase();
  const db = getFirestore();
  let query = db.collection("ticks")
    .where("employee", "==", employee);
  if (date) query = query.where("date", "==", date);
  const snapshot = await query.get();
  const rows = snapshot.docs
    .map(d => normalizeTick(d.data()))
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, limit);

  res.json({ employee, date: date || null, limit, ticks: rows });
});

app.post("/api/tick", async (req, res) => {
  const { employee, slot } = req.body || {};
  if (!employee || !slot) return res.status(400).json({ error: "Missing employee or slot" });

  const now = new Date();
  const parts = getTzParts(now);
  if (!isAllowedDate(now)) {
    return res.status(403).json({
      error: "Not allowed today",
      detail: "This tracker is not accepting ticks today."
    });
  }

  const slotOk = SLOTS.some(s => s.key === slot);
  if (!slotOk) return res.status(400).json({ error: "Invalid slot" });

  const timeCheck = canTickNow(now, slot, parts);
  if (!timeCheck.allowed) {
    return res.status(403).json({
      error: "Too early for this slot",
      detail: `You can tick ${EARLY_MINUTES} minutes before the slot time.`,
      earliest: timeCheck.earliest.toISOString(),
      slotTime: timeCheck.slotTime.toISOString()
    });
  }

  const date = todayISOFromParts(parts);
  const timestamp = now.toISOString();

  if (!(await employeeExists(employee))) {
    return res.status(400).json({ error: "Unknown employee. Add it in Firebase." });
  }

  initFirebase();
  const db = getFirestore();
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  const existsSnap = await db.collection("ticks")
    .where("employee", "==", employee)
    .where("date", "==", date)
    .where("slot", "==", slot)
    .limit(1)
    .get();

  if (!existsSnap.empty) {
    return res.status(409).json({ error: "Already ticked for this slot today" });
  }

  const record = {
    employee,
    date,
    slot,
    timestamp: Timestamp.fromDate(new Date(timestamp)),
    ip,
    userAgent
  };

  await db.collection("ticks").add(record);

  res.json({
    ok: true,
    record: {
      ...record,
      timestamp
    }
  });
});

// ====== ADMIN / EXPORT ======
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return next(); // if no key set, allow (local testing)
  const key = req.query.key || req.headers["x-admin-key"] || "";
  if (key !== ADMIN_KEY) return res.status(401).send("Unauthorized");
  next();
}

app.get("/admin", requireAdmin, async (req, res) => {
  initFirebase();
  const db = getFirestore();
  const snap = await db.collection("ticks").count().get();
  const total = snap.data().count || 0;
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
  initFirebase();
  const db = getFirestore();
  const snapshot = await db.collection("ticks").get();
  const sorted = snapshot.docs.map(d => normalizeTick(d.data())).sort((a, b) => {
    const k1 = `${a.date} ${a.employee} ${a.slot}`;
    const k2 = `${b.date} ${b.employee} ${b.slot}`;
    return k1.localeCompare(k2);
  });

  for (const t of sorted) {
    const row = header.map(h => csvEscape(t[h]));
    lines.push(row.join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="attendance_ticks.csv"');
  res.send(lines.join("\n"));
});

module.exports = { app, PORT };
