async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, body };
  return body;
}

const el = (id) => document.getElementById(id);
const employeeSel = el("employee");
const slotsDiv = el("slots");
const msgDiv = el("msg");
const todayDiv = el("today");
const historyDiv = el("history");
const dateLine = el("dateLine");
const ruleLine = el("ruleLine");
const earlyLine = el("earlyLine");
const historyDate = el("historyDate");
const historyClear = el("historyClear");

let meta = null;

function displayDays(days) {
  if (days === "Mon-Sat") return "ចន្ទ-សៅរ៍";
  if (days === "Every day") return "រាល់ថ្ងៃ";
  return days;
}

function setMsg(text, kind = "info") {
  msgDiv.className = "msg " + kind;
  msgDiv.textContent = text;
}

function slotButton(slotKey, label) {
  const btn = document.createElement("button");
  btn.className = "slot";
  btn.type = "button";
  btn.dataset.slot = slotKey;
  btn.innerHTML = `<div class="slotTime">${label}</div><div class="slotKey">${slotKey}</div>`;
  btn.addEventListener("click", () => onTick(slotKey));
  return btn;
}

async function loadMeta() {
  meta = await api("/api/meta");
  dateLine.textContent = `ថ្ងៃនេះ៖ ${meta.localDate}`;
  const earlyText = meta.rules.earlyMinutes ? ` | អាចមុន ${meta.rules.earlyMinutes} នាទី` : "";
  const yearText = meta.rules.year ? ` | ${meta.rules.year}` : "";
  ruleLine.textContent = `${displayDays(meta.rules.days)}${yearText}${earlyText}`;
  if (earlyLine && meta.rules.earlyMinutes) {
    earlyLine.textContent = `អាចចុះវត្តមានមុន ${meta.rules.earlyMinutes} នាទី។`;
  }
  if (!meta.allowedNow) {
    setMsg("ថ្ងៃនេះមិនអនុញ្ញាតទេ។", "warn");
  } else {
    setMsg("រួចរាល់។ សូមចុចម៉ោងរបស់អ្នក។", "ok");
  }

  slotsDiv.innerHTML = "";
  meta.slots.forEach(s => slotsDiv.appendChild(slotButton(s.key, s.label)));
}

async function loadEmployees() {
  const data = await api("/api/employees");
  employeeSel.innerHTML = "";
  data.employees.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    employeeSel.appendChild(opt);
  });

  employeeSel.addEventListener("change", refreshToday);
  if (data.employees.length) {
    if ([...employeeSel.options].some(o => o.value === "Heang")) {
      employeeSel.value = "Heang";
    }
    if (historyDate) {
      historyDate.value = meta?.localDate || "";
      historyDate.addEventListener("change", refreshHistory);
    }
    if (historyClear) {
      historyClear.addEventListener("click", () => {
        if (historyDate) historyDate.value = "";
        refreshHistory();
      });
    }
    refreshToday();
  } else {
    todayDiv.textContent = "មិនមានឈ្មោះទេ។ សូមបន្ថែមនៅ attendance.json។";
  }
}

function renderTodayTicks(ticks) {
  if (!ticks.length) return `<div class="muted">មិនទាន់មានវត្តមានថ្ងៃនេះទេ។</div>`;
  return `
    <table class="table">
      <thead><tr><th>ម៉ោង</th><th>ពេលវេលា (ម៉ាស៊ីន)</th></tr></thead>
      <tbody>
        ${ticks.map(t => `<tr><td>${t.slot}</td><td>${new Date(t.timestamp).toLocaleTimeString()}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function updateSlotStates(ticks) {
  const done = new Set(ticks.map(t => t.slot));
  slotsDiv.querySelectorAll(".slot").forEach(btn => {
    const isDone = done.has(btn.dataset.slot);
    btn.classList.toggle("slot-done", isDone);
    btn.disabled = isDone;
  });
}

function renderHistory(ticks) {
  if (!ticks.length) return `<div class="muted">មិនទាន់មានប្រវត្តិទេ។</div>`;
  return `
    <table class="table">
      <thead><tr><th>កាលបរិច្ឆេទ</th><th>ម៉ោង</th><th>ពេលវេលា (ម៉ាស៊ីន)</th></tr></thead>
      <tbody>
        ${ticks
          .map(t => `<tr><td>${t.date}</td><td>${t.slot}</td><td>${new Date(t.timestamp).toLocaleString()}</td></tr>`)
          .join("")}
      </tbody>
    </table>
  `;
}

async function refreshHistory() {
  const employee = employeeSel.value;
  if (!employee) return;
  if (!historyDiv) return;
  try {
    const dateParam = historyDate?.value ? `&date=${encodeURIComponent(historyDate.value)}` : "";
    const data = await api(`/api/ticks/history?employee=${encodeURIComponent(employee)}&limit=200${dateParam}`);
    historyDiv.innerHTML = renderHistory(data.ticks);
  } catch (e) {
    historyDiv.innerHTML = `<div class="muted">មិនអាចបង្ហាញប្រវត្តិបានទេ។</div>`;
  }
}

async function refreshToday() {
  const employee = employeeSel.value;
  if (!employee) return;
  const data = await api(`/api/ticks/today?employee=${encodeURIComponent(employee)}`);
  todayDiv.innerHTML = renderTodayTicks(data.ticks);
  updateSlotStates(data.ticks);
  await refreshHistory();
}

async function onTick(slot) {
  const employee = employeeSel.value;
  if (!employee) return setMsg("សូមជ្រើសឈ្មោះជាមុន។", "warn");

  const btn = slotsDiv.querySelector(`[data-slot="${slot}"]`);
  if (btn) {
    btn.disabled = true;
    btn.classList.add("slot-loading");
  }

  try {
    const out = await api("/api/tick", {
      method: "POST",
      body: JSON.stringify({ employee, slot })
    });
    setMsg(`បានរក្សាទុក៖ ${employee} ចុះវត្តមាន ${slot} ម៉ោង ${new Date(out.record.timestamp).toLocaleTimeString()}`, "ok");
    await refreshToday();
    if (btn) {
      btn.classList.remove("slot-loading");
      btn.classList.add("slot-success");
      setTimeout(() => btn.classList.remove("slot-success"), 1400);
    }
  } catch (e) {
    if (e?.status === 409) return setMsg("ម៉ោងនេះបានចុះរួចហើយ។", "warn");
    if (e?.status === 403) {
      const detail = e?.body?.detail ? ` ${e.body.detail}` : "";
      const earliest = e?.body?.earliest ? ` Earliest: ${new Date(e.body.earliest).toLocaleTimeString()}.` : "";
      return setMsg(`មិនអនុញ្ញាត។${detail}${earliest}`, "warn");
    }
    setMsg(`កំហុស៖ ${e?.body?.error || "មានបញ្ហា"}`, "bad");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("slot-loading");
    }
  }
}

(async function init() {
  try {
    await loadMeta();
    await loadEmployees();
  } catch (e) {
    setMsg("មិនអាចភ្ជាប់ម៉ាស៊ីនមេបានទេ។", "bad");
  }
})();
