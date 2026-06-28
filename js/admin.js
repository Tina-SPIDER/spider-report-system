// ============================================================
//  主管後台：員工管理 / 工單匯入 / 製程分數表 / 全員總覽
// ============================================================
window.Admin = { tab: "dashboard" };

Admin.render = function () {
  if (!App.ME || App.ME.role !== "主管") return;
  // 離開看板就停掉自動更新
  if (Admin.dashTimer) { clearInterval(Admin.dashTimer); Admin.dashTimer = null; }
  $$("#adminTabs button").forEach((b) => {
    b.onclick = () => { Admin.tab = b.dataset.atab; Admin.render(); };
    b.classList.toggle("active", b.dataset.atab === Admin.tab);
  });
  $$(".admin-pane").forEach((p) => p.classList.toggle("hide", p.id !== "pane-" + Admin.tab));

  if (Admin.tab === "dashboard") Admin.initDashboard();
  else if (Admin.tab === "machine") Admin.initMachine();
  else if (Admin.tab === "progress") Admin.initProgress();
  else if (Admin.tab === "assign") Admin.initAssign();
  else if (Admin.tab === "jobs") Admin.initJobs();
  else if (Admin.tab === "incident") Admin.loadIncidents();
  else if (Admin.tab === "todos") Admin.loadTodos();
  else if (Admin.tab === "machmgr") Admin.initMachMgr();
  else if (Admin.tab === "emp") Admin.loadEmployees();
  else if (Admin.tab === "wo") Admin.initWoImport();
  else if (Admin.tab === "rules") Admin.loadRules();
  else if (Admin.tab === "overview") Admin.loadOverview();
};

// ---------- 即時看板 ----------
Admin.initDashboard = function () {
  Admin.loadDashboard();
  Admin.dashTimer = setInterval(Admin.loadDashboard, 20000); // 每 20 秒
};

// ---------- 機台使用率（獨立分頁，自動更新） ----------
Admin.initMachine = function () {
  Admin.loadMachine();
  Admin.dashTimer = setInterval(Admin.loadMachine, 20000);
};

Admin.loadMachine = async function () {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const sel = "status,work_minutes,start_at,paused_minutes,paused_at,machine";
  const [doneRes, actRes] = await Promise.all([
    sb.from("jobs").select(sel).eq("status", "done").gte("start_at", start.toISOString()).lt("start_at", end.toISOString()),
    sb.from("jobs").select(sel).in("status", ["running", "paused"]),
  ]);
  if (doneRes.error) return toast(t("err") + ": " + doneRes.error.message, "err");

  const liveMin = (j) => {
    let op = 0;
    if (j.status === "paused" && j.paused_at) op = (Date.now() - new Date(j.paused_at).getTime()) / 60000;
    return Math.max(0, (Date.now() - new Date(j.start_at).getTime()) / 60000 - Number(j.paused_minutes || 0) - op);
  };
  const SHIFT_MIN = 480;
  const m = new Map();
  const g = (c) => { if (!m.has(c)) m.set(c, { code: c, min: 0, cnt: 0, active: 0 }); return m.get(c); };
  (doneRes.data || []).forEach((j) => { if (j.machine) { const x = g(j.machine); x.min += Number(j.work_minutes || 0); x.cnt++; } });
  (actRes.data || []).forEach((j) => { if (j.machine) { const x = g(j.machine); x.min += liveMin(j); x.cnt++; x.active++; } });
  const rows = [...m.values()].sort((a, b) => b.min - a.min);

  const p2 = (n) => String(n).padStart(2, "0");
  $("#machineTime").textContent = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
  if (rows.length === 0) { $("#machineTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  const head = `<tr><th>${t("machine")}</th><th>${t("status")}</th><th class="r">${t("today_use_min")}</th><th class="r">${t("util")}</th><th class="r">${t("dash_done")}</th></tr>`;
  const body = rows.map((x) => {
    const util = Math.min(100, Math.round(x.min / SHIFT_MIN * 100));
    const badge = x.active > 0 ? `<span class="badge go">${t("in_use")}</span>` : `<span class="badge mute">${t("idle")}</span>`;
    return `<tr><td>${x.code}</td><td>${badge}</td><td class="r">${Math.round(x.min)}</td><td class="r">${util}%</td><td class="r">${x.cnt}</td></tr>`;
  }).join("");
  $("#machineTable").innerHTML = `<table>${head}${body}</table>`;
};

// ---------- 工單進度（獨立分頁） ----------
Admin.initProgress = function () {
  $("#btnPgQuery").onclick = Admin.loadProgress;
  $("#pgWo").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); Admin.loadProgress(); } };
};

Admin.loadDashboard = async function () {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const sel = "id,employee_id,status,work_minutes,qty,scrap_qty,start_at,paused_minutes,paused_at,work_order_no,station,machine,employees(name,team)";

  const [empRes, doneRes, actRes] = await Promise.all([
    sb.from("employees").select("id,name,team").eq("active", true).eq("role", "員工").not("team", "is", null),
    sb.from("jobs").select(sel).eq("status", "done").gte("start_at", start.toISOString()).lt("start_at", end.toISOString()),
    sb.from("jobs").select(sel).in("status", ["running", "paused"]),
  ]);
  if (doneRes.error) return toast(t("err") + ": " + doneRes.error.message, "err");

  // 取進行中工單的客戶/品名
  const woNos = [...new Set((actRes.data || []).map((j) => j.work_order_no))];
  const woMap = {};
  if (woNos.length) {
    const { data: wos } = await sb.from("work_orders").select("work_order_no,customer,product_name").in("work_order_no", woNos);
    (wos || []).forEach((w) => (woMap[w.work_order_no] = w));
  }

  const liveMin = (j) => {
    let openPause = 0;
    if (j.status === "paused" && j.paused_at) openPause = (Date.now() - new Date(j.paused_at).getTime()) / 60000;
    return Math.max(0, (Date.now() - new Date(j.start_at).getTime()) / 60000 - Number(j.paused_minutes || 0) - openPause);
  };

  // 依員工彙整
  const agg = new Map();
  const empIds = new Set();
  const get = (id, emp) => {
    if (!agg.has(id)) agg.set(id, { name: (emp || {}).name || "", team: (emp || {}).team || "", done: 0, doneMin: 0, qty: 0, scrap: 0, active: 0, activeMin: 0 });
    return agg.get(id);
  };
  (empRes.data || []).forEach((e) => { empIds.add(e.id); get(e.id, e); });
  (doneRes.data || []).forEach((j) => {
    const r = get(j.employee_id, j.employees); r.done++; r.doneMin += Number(j.work_minutes || 0);
    r.qty += Number(j.qty || 0); r.scrap += Number(j.scrap_qty || 0);
  });
  (actRes.data || []).forEach((j) => { const r = get(j.employee_id, j.employees); r.active++; r.activeMin += liveMin(j); });

  const rnd = (n) => Math.round(n);

  // 摘要
  let totMin = 0, totQty = 0, totScrap = 0, online = 0;
  agg.forEach((r) => { totMin += r.doneMin + r.activeMin; totQty += r.qty; totScrap += r.scrap; if (r.active > 0) online++; });
  const totYield = totQty > 0 ? ((totQty - totScrap) / totQty * 100).toFixed(1) : "—";
  $("#dashSummary").innerHTML = `
    <div class="stat"><div class="num">${online}</div><div class="lbl">${t("dash_people")}</div></div>
    <div class="stat"><div class="num">${rnd(totMin)}</div><div class="lbl">${t("dash_total_min")}</div></div>
    <div class="stat"><div class="num">${totQty}</div><div class="lbl">${t("dash_total_qty")}</div></div>
    <div class="stat"><div class="num">${totYield}</div><div class="lbl">${t("yield")}</div></div>`;

  // ① 目前正在製作
  const acts = (actRes.data || []).slice().sort((a, b) => liveMin(b) - liveMin(a));
  if (acts.length === 0) { $("#dashNow").innerHTML = `<p class="muted">${t("no_running")}</p>`; }
  else {
    const head = `<tr><th>${t("dash_maker")}</th><th>${t("machine")}</th><th>${t("customer")}</th><th>${t("wo_no")}</th>
      <th>${t("product")}</th><th>${t("station")}</th><th class="r">${t("dash_duration")}</th></tr>`;
    const body = acts.map((j) => {
      const wo = woMap[j.work_order_no] || {};
      const paused = j.status === "paused";
      const mins = liveMin(j);
      const over = !paused && mins > 480;   // 逾時 8 小時
      const tag = paused ? ` <span class="badge warn">${t("status_paused")}</span>`
        : (over ? ` <span class="badge err">⚠ ${t("overtime")}</span>` : "");
      return `<tr class="${over ? "warn-row" : ""}"><td>${(j.employees || {}).name || ""}${tag}</td><td>${j.machine || "-"}</td><td>${wo.customer || ""}</td>
        <td>${j.work_order_no}</td><td>${wo.product_name || ""}</td><td>${j.station}</td>
        <td class="r">${rnd(mins)}</td></tr>`;
    }).join("");
    $("#dashNow").innerHTML = `<table>${head}${body}</table>`;
  }

  // ② 今日報工狀態（有完成紀錄者）
  const doneRows = [...agg.values()].filter((r) => r.done > 0).sort((a, b) => b.doneMin - a.doneMin);
  if (doneRows.length === 0) { $("#dashTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; }
  else {
    const head = `<tr><th>${t("name")}</th><th>${t("team")}</th><th class="r">${t("dash_done")}</th>
      <th class="r">${t("dash_min")}</th><th class="r">${t("qty")}</th><th class="r">${t("scrap")}</th><th class="r">${t("yield")}</th></tr>`;
    const body = doneRows.map((r) => {
      const y = r.qty > 0 ? ((r.qty - r.scrap) / r.qty * 100).toFixed(1) : "—";
      return `<tr><td>${r.name}</td><td>${r.team}</td><td class="r">${r.done}</td>
        <td class="r">${rnd(r.doneMin)}</td><td class="r">${r.qty}</td><td class="r">${r.scrap}</td><td class="r">${y}</td></tr>`;
    }).join("");
    $("#dashTable").innerHTML = `<table>${head}${body}</table>`;
  }

  // ③ 應報工 / 未報工（所有在職員工）
  const attend = [...empIds].map((id) => agg.get(id)).sort((a, b) => {
    const ra = (a.done + a.active) > 0, rb = (b.done + b.active) > 0;
    if (ra !== rb) return ra ? 1 : -1;          // 未報工排前面
    return (b.doneMin + b.activeMin) - (a.doneMin + a.activeMin);
  });
  if (attend.length === 0) { $("#dashAttend").innerHTML = `<p class="muted">${t("no_data")}</p>`; }
  else {
    const head = `<tr><th>${t("name")}</th><th>${t("team")}</th><th class="r">${t("dash_cumulative")}</th><th>${t("status")}</th></tr>`;
    const body = attend.map((r) => {
      const reported = (r.done + r.active) > 0;
      const cls = reported ? "" : "warn-row";
      const badge = reported ? `<span class="badge go">${t("reported")}</span>` : `<span class="badge err">${t("not_reported")}</span>`;
      const live = r.active > 0 ? " ●" : "";
      return `<tr class="${cls}"><td>${r.name}${live}</td><td>${r.team}</td>
        <td class="r">${rnd(r.doneMin + r.activeMin)}</td><td>${badge}</td></tr>`;
    }).join("");
    $("#dashAttend").innerHTML = `<table>${head}${body}</table>`;
  }

  const p2 = (n) => String(n).padStart(2, "0");
  $("#dashTime").textContent = `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`;
};

// ---------- 報工紀錄 ----------
Admin.initJobs = function () {
  if (!$("#jbFrom").value) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const p = (n) => String(n).padStart(2, "0");
    const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    $("#jbFrom").value = fmt(first);
    $("#jbTo").value = fmt(now);
  }
  $("#btnJobsQuery").onclick = Admin.loadJobs;
  $("#btnJobsExport").onclick = Admin.exportJobs;
  Admin.loadJobs();
};

Admin.loadJobs = async function () {
  const from = $("#jbFrom").value;
  const to = $("#jbTo").value;
  if (!from || !to) return;
  const toNext = new Date(to + "T00:00:00");
  toNext.setDate(toNext.getDate() + 1);

  const { data, error } = await sb.from("jobs")
    .select("id,start_at,end_at,work_minutes,qty,scrap_qty,note,work_content,station,status,work_order_no,employees(name,team)")
    .gte("start_at", from + "T00:00:00")
    .lt("start_at", toNext.toISOString())
    .order("start_at", { ascending: false })
    .limit(2000);
  if (error) return toast(t("err") + ": " + error.message, "err");

  Admin._jobs = data || [];
  const rows = Admin._jobs;
  if (rows.length === 0) { $("#jobsTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }

  const stMap = { running: t("status_running"), paused: t("status_paused"), done: t("status_done") };
  const head = `<tr>
    <th>${t("date")}</th><th>${t("name")}</th><th>${t("team")}</th>
    <th>${t("wo_no")}</th><th>${t("station")}</th><th>${t("work_content")}</th>
    <th class="r">${t("work_min")}</th><th class="r">${t("qty")}</th><th class="r">${t("scrap")}</th>
    <th>${t("note")}</th><th>${t("status")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((j) => {
    const emp = j.employees || {};
    const wm = j.work_minutes != null ? Math.round(j.work_minutes) : "";
    const force = j.status !== "done" ? `<button class="btn small" data-act="force" data-id="${j.id}">${t("act_forceend")}</button>` : "";
    return `<tr>
      <td>${fmtDate(j.start_at)}</td><td>${emp.name || ""}</td><td>${emp.team || ""}</td>
      <td>${j.work_order_no}</td><td>${j.station}</td><td>${j.work_content || ""}</td>
      <td class="r">${wm}</td><td class="r">${j.qty != null ? j.qty : ""}</td><td class="r">${j.scrap_qty != null ? j.scrap_qty : ""}</td>
      <td>${j.note || ""}</td><td>${stMap[j.status] || j.status}</td>
      <td style="white-space:nowrap">
        <button class="btn small ghost" data-act="edit" data-id="${j.id}">${t("act_edit")}</button>
        ${force}
        <button class="btn small" data-act="del" data-id="${j.id}" style="background:#fee2e2;color:#dc2626">${t("act_delete")}</button>
      </td></tr>`;
  }).join("");
  $("#jobsTable").innerHTML = `<table>${head}${body}</table>`;

  $$("#jobsTable button[data-act]").forEach((b) => { b.onclick = () => Admin.jobAction(b.dataset.act, b.dataset.id); });
};

Admin.jobAction = async function (act, id) {
  const j = (Admin._jobs || []).find((x) => x.id === id);
  if (!j) return;
  if (act === "edit") {
    $("#jeId").value = id;
    $("#jeWork").value = j.work_content || "";
    $("#jeQty").value = j.qty != null ? j.qty : "";
    $("#jeScrap").value = j.scrap_qty != null ? j.scrap_qty : "";
    $("#jeNote").value = j.note || "";
    $("#jobEditModal").classList.remove("hide");
    $("#btnJeCancel").onclick = () => $("#jobEditModal").classList.add("hide");
    $("#btnJeSave").onclick = Admin.saveJobEdit;
  } else if (act === "del") {
    if (!confirm(t("confirm_delete"))) return;
    const { error } = await sb.from("jobs").delete().eq("id", id);
    if (error) return toast(t("err") + ": " + error.message, "err");
    toast(t("saved_del"), "ok"); Admin.loadJobs();
  } else if (act === "force") {
    const { error } = await sb.rpc("end_job", { p_job_id: id });
    if (error) return toast(t("err") + ": " + error.message, "err");
    toast(t("ok"), "ok"); Admin.loadJobs();
  }
};

Admin.saveJobEdit = async function () {
  const id = $("#jeId").value;
  const upd = {
    work_content: $("#jeWork").value.trim() || null,
    qty: $("#jeQty").value === "" ? null : Number($("#jeQty").value),
    scrap_qty: $("#jeScrap").value === "" ? null : Number($("#jeScrap").value),
    note: $("#jeNote").value.trim() || null,
  };
  const { error } = await sb.from("jobs").update(upd).eq("id", id);
  if (error) return toast(t("err") + ": " + error.message, "err");
  $("#jobEditModal").classList.add("hide");
  toast(t("saved"), "ok"); Admin.loadJobs();
};

Admin.exportJobs = function () {
  const rows = Admin._jobs || [];
  if (!rows.length) return toast(t("no_data"), "err");
  const stMap = { running: t("status_running"), paused: t("status_paused"), done: t("status_done") };
  const aoa = [[t("date"), t("name"), t("team"), t("wo_no"), t("station"), t("work_content"),
    t("work_min"), t("qty"), t("scrap"), t("note"), t("status")]];
  rows.forEach((j) => {
    const e = j.employees || {};
    aoa.push([fmtDate(j.start_at), e.name || "", e.team || "", j.work_order_no, j.station, j.work_content || "",
      j.work_minutes != null ? Math.round(j.work_minutes) : "", j.qty != null ? j.qty : "",
      j.scrap_qty != null ? j.scrap_qty : "", j.note || "", stMap[j.status] || j.status]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "報工紀錄");
  XLSX.writeFile(wb, `報工紀錄_${$("#jbFrom").value}_${$("#jbTo").value}.xlsx`);
};

// ---------- 員工待辦（主管檢視） ----------
Admin.loadTodos = async function () {
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const { data, error } = await sb.from("todos")
    .select("content,priority,progress,due_date,created_at,employees(name,team)")
    .order("created_at", { ascending: false }).limit(500);
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  if (rows.length === 0) { $("#todosTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  const priColor = (n) => ({ 1: "#dc2626", 2: "#ea580c", 3: "#d97706", 4: "#0891b2", 5: "#94a3b8" }[n] || "#94a3b8");
  const head = `<tr><th>${t("date")}</th><th>${t("name")}</th><th>${t("team")}</th><th>${t("priority")}</th><th>${t("nav_todo")}</th><th>${t("todo_due")}</th><th class="r">${t("progress_col")}</th></tr>`;
  const body = rows.map((r) => {
    const e = r.employees || {}; const pg = Number(r.progress) || 0;
    return `<tr><td>${fmtDate(r.created_at)}</td><td>${e.name || ""}</td><td>${e.team || ""}</td>
      <td><span class="badge" style="background:${priColor(r.priority)}">${r.priority}</span></td>
      <td style="${pg >= 100 ? "text-decoration:line-through;color:#999" : ""}">${esc(r.content)}</td>
      <td>${r.due_date || "-"}</td><td class="r">${pg}%</td></tr>`;
  }).join("");
  $("#todosTable").innerHTML = `<table>${head}${body}</table>`;
};

// ---------- 機台管理 ----------
Admin.initMachMgr = function () {
  $("#btnMachAdd").onclick = Admin.addMachines;
  Admin.loadMachMgr();
};

Admin.addMachines = async function () {
  const raw = $("#machInput").value.trim();
  if (!raw) return;
  const names = [...new Set(raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
  if (names.length === 0) return;
  const rows = names.map((n) => ({ code: n, name: n, active: true }));
  const { error } = await sb.from("machines").upsert(rows, { onConflict: "code", ignoreDuplicates: true });
  if (error) return toast(t("err") + ": " + error.message, "err");
  toast(`${t("add")} ✓ ${names.length}`, "ok");
  $("#machInput").value = "";
  Report.machines = [];           // 讓報工頁下次重抓
  Admin.loadMachMgr();
};

Admin.loadMachMgr = async function () {
  const { data, error } = await sb.from("machines").select("code,name,active").order("code");
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  if (rows.length === 0) { $("#machMgrTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  const head = `<tr><th>${t("machine")}</th><th style="text-align:center">${t("active")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((m) => `
    <tr data-code="${String(m.code).replace(/"/g, "&quot;")}">
      <td>${m.name}</td>
      <td style="text-align:center"><input type="checkbox" data-act ${m.active ? "checked" : ""}></td>
      <td><button class="btn small" data-del style="background:#fee2e2;color:#dc2626">${t("act_delete")}</button></td>
    </tr>`).join("");
  $("#machMgrTable").innerHTML = `<table>${head}${body}</table>`;
  $$("#machMgrTable [data-act]").forEach((c) => {
    c.onchange = async () => {
      const code = c.closest("tr").dataset.code;
      const { error } = await sb.from("machines").update({ active: c.checked }).eq("code", code);
      if (error) toast(t("err") + ": " + error.message, "err"); else { toast(t("saved"), "ok"); Report.machines = []; }
    };
  });
  $$("#machMgrTable [data-del]").forEach((b) => {
    b.onclick = async () => {
      const code = b.closest("tr").dataset.code;
      const { error } = await sb.from("machines").delete().eq("code", code);
      if (error) return toast(t("err") + ": " + error.message, "err");
      toast(t("saved_del"), "ok"); Report.machines = []; Admin.loadMachMgr();
    };
  });
};

// ---------- 異常回報（主管檢視） ----------
Admin.loadIncidents = async function () {
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const { data, error } = await sb.from("incidents")
    .select("id,category,content,status,created_at,employees(name,team)")
    .order("created_at", { ascending: false }).limit(500);
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  if (rows.length === 0) { $("#incTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  const head = `<tr><th>${t("date")}</th><th>${t("name")}</th><th>${t("inc_category")}</th>
    <th>${t("inc_content")}</th><th>${t("status")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((r) => {
    const e = r.employees || {};
    const done = r.status === "已處理";
    return `<tr><td>${fmtDate(r.created_at)}</td><td>${e.name || ""}</td><td>${esc(r.category)}</td>
      <td style="white-space:pre-wrap">${esc(r.content)}</td>
      <td>${done ? '<span class="badge go">已處理</span>' : '<span class="badge warn">待處理</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn small ${done ? "ghost" : "primary"}" data-toggle="${r.id}" data-st="${done ? "待處理" : "已處理"}">${done ? "待處理" : "標記已處理"}</button>
        <button class="btn small" data-del="${r.id}" style="background:#fee2e2;color:#dc2626">${t("act_delete")}</button>
      </td></tr>`;
  }).join("");
  $("#incTable").innerHTML = `<table>${head}${body}</table>`;
  $$("#incTable button[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      const { error } = await sb.from("incidents").update({ status: b.dataset.st }).eq("id", b.dataset.toggle);
      if (error) return toast(t("err") + ": " + error.message, "err");
      Admin.loadIncidents();
    };
  });
  $$("#incTable button[data-del]").forEach((b) => {
    b.onclick = async () => {
      const { error } = await sb.from("incidents").delete().eq("id", b.dataset.del);
      if (error) return toast(t("err") + ": " + error.message, "err");
      toast(t("saved_del"), "ok"); Admin.loadIncidents();
    };
  });
};

// ---------- 工單指派 ----------
Admin.initAssign = async function () {
  const emps = await sb.from("employees").select("id,name,team").eq("active", true).eq("role", "員工").order("name");
  $("#asEmp").innerHTML = (emps.data || []).map((e) => `<option value="${e.id}">${e.name}${e.team ? " (" + e.team + ")" : ""}</option>`).join("");
  $("#asStation").innerHTML = `<option value="">${t("any_station")}</option>`;
  // 輸入工單號後，站別下拉只列該工單的製程站
  $("#asWo").onchange = Admin.loadAssignStations;
  $("#btnAssign").onclick = Admin.doAssign;
  Admin.loadAssignList();
};

Admin.loadAssignStations = async function () {
  const wo = $("#asWo").value.trim();
  const sel = $("#asStation");
  sel.innerHTML = `<option value="">${t("any_station")}</option>`;
  if (!wo) return;
  const { data } = await sb.from("work_order_routes").select("seq,station").eq("work_order_no", wo).order("seq");
  (data || []).forEach((r) => {
    const o = document.createElement("option");
    o.value = r.station; o.textContent = `${r.seq} ${r.station}`;
    sel.appendChild(o);
  });
};

Admin.doAssign = async function () {
  const emp = $("#asEmp").value, wo = $("#asWo").value.trim();
  const station = $("#asStation").value || null;
  const due = $("#asDate").value || null;
  if (!emp || !wo) return toast(t("err"), "err");
  const { error } = await sb.from("assignments").upsert(
    { work_order_no: wo, employee_id: emp, station: station, due_date: due, assigned_by: App.ME.id }, { onConflict: "work_order_no,employee_id" });
  if (error) return toast(t("err") + ": " + error.message, "err");
  toast(t("ok"), "ok"); $("#asWo").value = ""; $("#asDate").value = ""; Admin.loadAssignList();
};

Admin.loadAssignList = async function () {
  const { data, error } = await sb.from("assignments")
    .select("id,work_order_no,station,due_date,assigned_by,created_at,employees(name,team)").order("created_at", { ascending: false });
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  if (rows.length === 0) { $("#assignTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  // 客戶/品名 + 指派人名稱
  const nos = [...new Set(rows.map((r) => r.work_order_no))];
  const woMap = {};
  if (nos.length) { const { data: wos } = await sb.from("work_orders").select("work_order_no,customer,product_name").in("work_order_no", nos); (wos || []).forEach((w) => (woMap[w.work_order_no] = w)); }
  const ids = [...new Set(rows.map((r) => r.assigned_by).filter(Boolean))];
  const empMap = {};
  if (ids.length) { const { data: es } = await sb.from("employees").select("id,name").in("id", ids); (es || []).forEach((e) => (empMap[e.id] = e.name)); }

  const head = `<tr><th>${t("name")}</th><th>${t("team")}</th><th>${t("wo_no")}</th><th>${t("customer")}</th><th>${t("product")}</th><th>${t("station")}</th><th>${t("due_date")}</th><th>${t("assigner")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((a) => {
    const e = a.employees || {}; const w = woMap[a.work_order_no] || {};
    return `<tr><td>${e.name || ""}</td><td>${e.team || ""}</td><td>${a.work_order_no}</td><td>${w.customer || ""}</td><td>${w.product_name || ""}</td><td>${a.station || "-"}</td><td>${a.due_date || "-"}</td><td>${empMap[a.assigned_by] || ""}</td>
      <td><button class="btn small" data-del="${a.id}" style="background:#fee2e2;color:#dc2626">${t("act_delete")}</button></td></tr>`;
  }).join("");
  $("#assignTable").innerHTML = `<table>${head}${body}</table>`;
  $$("#assignTable button[data-del]").forEach((b) => {
    b.onclick = async () => {
      const { error } = await sb.from("assignments").delete().eq("id", b.dataset.del);
      if (error) return toast(t("err") + ": " + error.message, "err");
      toast(t("saved_del"), "ok"); Admin.loadAssignList();
    };
  });
};

// ---------- 工單進度（看板內） ----------
Admin.loadProgress = async function () {
  const q = $("#pgWo").value.trim();
  if (!q) return toast(t("query_wo_first"), "err");
  const safe = q.replace(/[,()*]/g, " ").trim();

  // 用 工單號/客戶/品名 模糊搜尋
  const { data, error } = await sb.from("work_orders")
    .select("work_order_no,customer,product_name")
    .or(`work_order_no.ilike.%${safe}%,customer.ilike.%${safe}%,product_name.ilike.%${safe}%`)
    .limit(300);
  if (error) return toast(t("err") + ": " + error.message, "err");
  const list = data || [];
  if (list.length === 0) { $("#pgInfo").innerHTML = ""; $("#pgTable").innerHTML = `<p class="muted">${t("wo_not_found")}</p>`; return; }
  if (list.length === 1) { Admin.showProgressDetail(list[0].work_order_no); return; }

  // 多筆 → 清單讓使用者點選
  $("#pgInfo").innerHTML = `<p class="muted">${t("found_n", { n: list.length })}</p>`;
  const head = `<tr><th>${t("wo_no")}</th><th>${t("customer")}</th><th>${t("product")}</th><th></th></tr>`;
  const body = list.map((w) =>
    `<tr><td>${w.work_order_no}</td><td>${w.customer || ""}</td><td>${w.product_name || ""}</td>
     <td><button class="btn small ghost" data-view="${String(w.work_order_no).replace(/"/g, "&quot;")}">${t("act_view")}</button></td></tr>`
  ).join("");
  $("#pgTable").innerHTML = `<table>${head}${body}</table>`;
  $$("#pgTable button[data-view]").forEach((b) => { b.onclick = () => Admin.showProgressDetail(b.dataset.view); });
};

Admin.showProgressDetail = async function (wo) {
  const [woRes, routeRes, jobRes] = await Promise.all([
    sb.from("work_orders").select("customer,product_name,spec").eq("work_order_no", wo).maybeSingle(),
    sb.from("work_order_routes").select("seq,station,station_type").eq("work_order_no", wo).order("seq"),
    sb.from("jobs").select("station,end_at,work_minutes,employees(name)").eq("work_order_no", wo).eq("status", "done"),
  ]);
  if (!woRes.data) { $("#pgInfo").innerHTML = ""; $("#pgTable").innerHTML = `<p class="muted">${t("wo_not_found")}</p>`; return; }
  const routes = routeRes.data || [];
  const doneMap = {};
  (jobRes.data || []).forEach((j) => { if (!doneMap[j.station]) doneMap[j.station] = j; });

  // 完成度只算廠內工作站（委外不計入分母）
  const inhouse = routes.filter((r) => r.station_type === "工作站");
  const doneCount = inhouse.filter((r) => doneMap[r.station]).length;
  const pct = inhouse.length ? Math.round(doneCount / inhouse.length * 100) : 0;
  $("#pgInfo").innerHTML = `<div class="wo-info">
    <span class="k">${t("customer")}</span><span>${woRes.data.customer || ""}</span>
    <span class="k">${t("product")}</span><span>${woRes.data.product_name || ""}</span>
    <span class="k">${t("progress_pct")}</span><span><strong>${doneCount}/${inhouse.length}（${pct}%）</strong></span>
  </div>`;

  const head = `<tr><th>#</th><th>${t("station")}</th><th>${t("status")}</th><th>${t("maker_done")}</th><th>${t("done_time")}</th></tr>`;
  const body = routes.map((r) => {
    const outsourced = r.station_type !== "工作站";
    const d = doneMap[r.station];
    let badge, cls;
    if (outsourced) { badge = `<span class="badge" style="background:#94a3b8">${t("outsourced")}</span>`; cls = ""; }
    else if (d) { badge = `<span class="badge go">${t("progress_done")}</span>`; cls = ""; }
    else { badge = `<span class="badge mute">${t("progress_undone")}</span>`; cls = "warn-row"; }
    return `<tr class="${cls}"><td>${r.seq}</td><td>${r.station}</td><td>${badge}</td>
      <td>${d ? (d.employees || {}).name || "" : ""}</td><td>${d && d.end_at ? fmtDate(d.end_at) + " " + fmtTime(d.end_at) : ""}</td></tr>`;
  }).join("");
  $("#pgTable").innerHTML = `<table>${head}${body}</table>`;
};

// ---------- 員工管理 ----------
Admin.loadEmployees = async function () {
  const { data, error } = await sb.from("employees").select("*").order("created_at");
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  const head = `<tr><th>${t("emp_account")}</th><th>${t("name")}</th><th>${t("team")}</th>
    <th>${t("role")}</th><th>${t("lang")}</th><th>${t("active")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((e) => `
    <tr data-id="${e.id}">
      <td>${e.account}</td>
      <td><input class="cell" data-f="name" value="${e.name || ""}"></td>
      <td><input class="cell" data-f="team" value="${e.team || ""}"></td>
      <td><select class="cell" data-f="role">
        <option value="員工" ${e.role === "員工" ? "selected" : ""}>${t("employee")}</option>
        <option value="主管" ${e.role === "主管" ? "selected" : ""}>${t("manager")}</option>
      </select></td>
      <td><select class="cell" data-f="lang">
        <option value="zh" ${e.lang === "zh" ? "selected" : ""}>中文</option>
        <option value="vi" ${e.lang === "vi" ? "selected" : ""}>Tiếng Việt</option>
      </select></td>
      <td style="text-align:center"><input type="checkbox" data-f="active" ${e.active ? "checked" : ""}></td>
      <td><button class="btn small ghost" data-pw="${e.id}">${t("reset_pw")}</button></td>
    </tr>`).join("");
  $("#empTable").innerHTML = `<table>${head}${body}</table>`;

  $$("#empTable button[data-pw]").forEach((b) => {
    b.onclick = async () => {
      const pw = prompt(t("enter_new_pw"));
      if (!pw) return;
      if (pw.length < 6) return toast(t("err") + " (≥6)", "err");
      const { error } = await sb.rpc("admin_reset_password", { p_employee_id: b.dataset.pw, p_new_password: pw });
      if (error) return toast(t("err") + ": " + error.message, "err");
      toast(t("pw_reset_ok"), "ok");
    };
  });

  // 自動儲存（改值即更新）
  $$("#empTable [data-f]").forEach((inp) => {
    inp.onchange = async () => {
      const tr = inp.closest("tr");
      const id = tr.dataset.id;
      const f = inp.dataset.f;
      const val = inp.type === "checkbox" ? inp.checked : inp.value;
      const { error } = await sb.from("employees").update({ [f]: val }).eq("id", id);
      if (error) toast(t("err") + ": " + error.message, "err");
      else toast(t("saved"), "ok");
    };
  });

  // 新增員工
  $("#btnAddEmp").onclick = Admin.addEmployee;
};

Admin.addEmployee = async function () {
  const account = $("#neAccount").value.trim();
  const password = $("#nePassword").value;
  const name = $("#neName").value.trim();
  const team = $("#neTeam").value.trim() || null;
  const role = $("#neRole").value;
  const lang = $("#neLang").value;
  if (!account || !password || !name) return toast(t("err"), "err");

  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(window.FN_CREATE_EMPLOYEE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + session.access_token,
      "apikey": window.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ account, password, name, team, role, lang }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.error) return toast(t("err") + ": " + (out.error || res.status), "err");
  toast(t("created"), "ok");
  $("#neAccount").value = $("#nePassword").value = $("#neName").value = $("#neTeam").value = "";
  Admin.loadEmployees();
};

// ---------- 工單匯入 ----------
Admin.initWoImport = function () {
  $("#woImportHint").textContent = t("import_hint");
  $("#btnWoImport").onclick = Admin.doWoImport;
  $("#btnWoFile").onclick = Admin.doWoFile;
  $("#btnErpImport").onclick = Admin.doErpImport;
};

// 每日匯入 ERP「加工製程明細表」(.xls)：自動更新工單 + 製程路線 + 站名
Admin.doErpImport = function () {
  const f = $("#erpFile").files[0];
  if (!f) return toast(t("err"), "err");
  $("#erpResult").textContent = t("erp_importing");
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      const norm = (s) => String(s).replace(/\s/g, "").trim();

      // 找表頭列
      let hr = -1;
      for (let i = 0; i < Math.min(25, aoa.length); i++) {
        if (aoa[i].map(norm).some((c) => c.includes("工單號碼"))) { hr = i; break; }
      }
      if (hr < 0) { $("#erpResult").textContent = t("erp_no_header"); return; }

      const header = aoa[hr].map(norm);
      const find = (...kws) => header.findIndex((h) => kws.every((k) => h.includes(k)));
      const I = {
        wo: find("工單號碼"), sku: find("產品編號"), name: find("產品名稱"),
        spec: find("產品規格"), cust: find("客戶名稱"),
        mat1: find("材質", "本體"), mat2: find("第二添加"), surf: find("表面處理"),
        seq: find("代碼"), stName: find("站名"), stType: find("站別"), drawing: find("圖檔檔名", "T"),
      };
      const get = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : "");

      const woMap = new Map();
      const seen = new Set();
      const routes = [];
      const stations = new Set();

      for (let r = hr + 1; r < aoa.length; r++) {
        const row = aoa[r];
        const wo = get(row, I.wo);
        if (!wo) continue;
        if (!woMap.has(wo)) {
          woMap.set(wo, {
            work_order_no: wo, sku: get(row, I.sku) || null, product_name: get(row, I.name) || null,
            spec: get(row, I.spec) || null, customer: get(row, I.cust) || null,
            material_body: get(row, I.mat1) || null, material_second: get(row, I.mat2) || null,
            surface_treatment: get(row, I.surf) || null,
          });
        }
        const seq = get(row, I.seq), st = get(row, I.stName);
        if (seq && st) {
          const key = wo + "|" + seq;
          if (!seen.has(key)) {
            seen.add(key);
            routes.push({ work_order_no: wo, seq, station: st, station_type: get(row, I.stType) || null, drawing_file: get(row, I.drawing) || null });
          }
          stations.add(st);
        }
      }

      // 1) 站名（不覆蓋既有權重）
      const stationRows = [...stations].map((n) => ({ code: n, name_zh: n, name_vi: n, sort_order: 999 }));
      if (stationRows.length) {
        const r1 = await sb.from("stations").upsert(stationRows, { onConflict: "code", ignoreDuplicates: true });
        if (r1.error) throw r1.error;
      }
      // 2) 工單
      const woRows = [...woMap.values()];
      for (let i = 0; i < woRows.length; i += 500) {
        const r2 = await sb.from("work_orders").upsert(woRows.slice(i, i + 500), { onConflict: "work_order_no" });
        if (r2.error) throw r2.error;
      }
      // 3) 製程路線
      for (let i = 0; i < routes.length; i += 500) {
        const r3 = await sb.from("work_order_routes").upsert(routes.slice(i, i + 500), { onConflict: "work_order_no,seq" });
        if (r3.error) throw r3.error;
      }

      $("#erpResult").textContent = t("erp_done", { wo: woRows.length, r: routes.length, s: stationRows.length });
      toast(t("ok"), "ok");
    } catch (err) {
      $("#erpResult").textContent = t("err") + ": " + (err.message || err);
      toast(t("err"), "err");
    }
  };
  reader.readAsArrayBuffer(f);
};

// 共用：把整理好的 rows 寫入資料庫
Admin.upsertWorkOrders = async function (rows) {
  if (!rows || rows.length === 0) return toast(t("err") + ": 0", "err");
  const { error } = await sb.from("work_orders").upsert(rows, { onConflict: "work_order_no" });
  if (error) return toast(t("err") + ": " + error.message, "err");
  toast(`${t("import")} ✓ ${rows.length}`, "ok");
};

// 從 Excel 檔讀取並匯入
Admin.doWoFile = function () {
  const f = $("#woFile").files[0];
  if (!f) return toast(t("err"), "err");
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (!aoa.length) return toast(t("no_data"), "err");

      // 嘗試辨識標題列，建立欄位對應
      const pats = {
        work_order_no: /工單|單號|work\s*order|lệnh/i,
        sku: /貨編|料號|品號|mã/i,
        product_name: /品名|名稱|tên/i,
        spec: /規格|quy/i,
        customer: /客戶|khách/i,
      };
      const header = aoa[0].map((x) => String(x).trim());
      const looksHeader = header.some((h) => /工單|單號|貨編|品名|規格|客戶|lệnh|mã|tên/i.test(h));
      let map = { work_order_no: 0, sku: 1, product_name: 2, spec: 3, customer: 4 };
      let startRow = 0;
      if (looksHeader) {
        map = {};
        for (const key in pats) {
          map[key] = header.findIndex((h) => pats[key].test(h));
        }
        startRow = 1;
      }
      const pick = (arr, i) => (i != null && i >= 0 && arr[i] != null ? String(arr[i]).trim() : "");

      const rows = [];
      for (let r = startRow; r < aoa.length; r++) {
        const a = aoa[r];
        const no = pick(a, map.work_order_no);
        if (!no) continue;
        rows.push({
          work_order_no: no,
          sku: pick(a, map.sku) || null,
          product_name: pick(a, map.product_name) || null,
          spec: pick(a, map.spec) || null,
          customer: pick(a, map.customer) || null,
        });
      }
      $("#woFilePreview").textContent = t("wo_file_preview", { n: rows.length });
      Admin.upsertWorkOrders(rows);
    } catch (err) {
      toast(t("err") + ": " + err.message, "err");
    }
  };
  reader.readAsArrayBuffer(f);
};

Admin.doWoImport = async function () {
  const raw = $("#woImportText").value.trim();
  if (!raw) return;
  const rows = [];
  raw.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    // 支援逗號或 Tab 分隔（可直接從 Excel 複製貼上）
    const c = line.split(/[,\t]/).map((x) => x.trim());
    if (!c[0]) return;
    // 跳過標題列（第一格出現「工單」字樣）
    if (/工單|工單號|work\s*order/i.test(c[0])) return;
    rows.push({
      work_order_no: c[0], sku: c[1] || null, product_name: c[2] || null,
      spec: c[3] || null, customer: c[4] || null,
    });
  });
  if (rows.length === 0) return toast(t("err") + ": 0", "err");
  const { error } = await sb.from("work_orders").upsert(rows, { onConflict: "work_order_no" });
  if (error) return toast(t("err") + ": " + error.message, "err");
  toast(`${t("import")} ✓ ${rows.length}`, "ok");
  $("#woImportText").value = "";
};

// ---------- 站別權重 ----------
Admin.loadRules = async function () {
  const { data, error } = await sb.from("stations").select("code,name_zh,weight").order("name_zh");
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  const head = `<tr><th>${t("station")}</th><th class="r">${t("weight")}</th></tr>`;
  const body = rows.map((r) => `
    <tr data-code="${String(r.code).replace(/"/g, "&quot;")}">
      <td>${r.name_zh}</td>
      <td class="r"><input class="cell ratio" data-f="weight" type="number" step="0.5" min="0"
        value="${r.weight != null ? r.weight : 1}"></td>
    </tr>`).join("");
  $("#rulesTable").innerHTML = `<table>${head}${body}</table>`;

  $$("#rulesTable [data-f='weight']").forEach((inp) => {
    inp.onchange = async () => {
      const code = inp.closest("tr").dataset.code;
      const val = inp.value === "" ? 1 : Number(inp.value);
      const { error } = await sb.from("stations").update({ weight: val }).eq("code", code);
      if (error) toast(t("err") + ": " + error.message, "err");
      else toast(t("saved"), "ok");
    };
  });

  $("#btnRecompute").onclick = Admin.recompute;
};

Admin.recompute = async function () {
  const { data, error } = await sb.rpc("recompute_pending");
  if (error) return toast(t("err") + ": " + error.message, "err");
  toast(t("recomputed_n", { n: data }), "ok");
};

// ---------- 全員總覽 ----------
Admin.loadOverview = async function () {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + 1;
  $("#ovMonthLabel").textContent = `${y}/${String(m).padStart(2, "0")}`;
  const { data, error } = await sb.rpc("member_scoreboard", { p_year: y, p_month: m });
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  if (rows.length === 0) { $("#ovTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  const head = `<tr><th>#</th><th>${t("name")}</th><th>${t("team")}</th><th class="r">${t("month_score")}</th></tr>`;
  const body = rows.map((r, i) =>
    `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.team || ""}</td><td class="r">${Number(r.total).toFixed(2)}</td></tr>`
  ).join("");
  $("#ovTable").innerHTML = `<table>${head}${body}</table>`;
};
