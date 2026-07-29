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
  else if (Admin.tab === "download") Admin.initDownload();
  else if (Admin.tab === "scoreplan") ScorePlan.render();
};

// ---------- 一鍵下載全部資料 ----------
// 把每張資料表各存成一個工作表，輸出單一 Excel 檔。
// 分頁抓完整，中途失敗就中止，不產生不完整的檔案。
Admin.DL_TABLES = ["employees", "stations", "machines", "work_orders", "work_order_routes",
  "jobs", "score_log", "assignments", "todos", "incidents"];
Admin.DL_PAGE = 1000;

Admin.initDownload = function () {
  $("#btnDownloadAll").onclick = Admin.downloadAll;
  $("#dlResult").innerHTML = "";
};

Admin.downloadAll = async function () {
  const btn = $("#btnDownloadAll");
  const label = btn.textContent;
  btn.disabled = true;
  const box = $("#dlResult");
  const done = [];
  try {
    const wb = XLSX.utils.book_new();
    for (const tbl of Admin.DL_TABLES) {
      const rows = [];
      for (let off = 0; ; off += Admin.DL_PAGE) {
        const { data, error } = await sb.from(tbl).select("*").range(off, off + Admin.DL_PAGE - 1);
        if (error) throw new Error(`${tbl}: ${error.message}`);
        const page = data || [];
        rows.push(...page);
        btn.textContent = t("dl_working", { tbl, n: rows.length });
        if (page.length < Admin.DL_PAGE) break;
      }
      // 欄位取所有列的聯集，避免某些列缺欄就漏掉整欄
      const cols = [];
      rows.forEach((r) => Object.keys(r).forEach((k) => { if (!cols.includes(k)) cols.push(k); }));
      const aoa = [cols.length ? cols : ["(no data)"]];
      rows.forEach((r) => aoa.push(cols.map((c) => {
        const v = r[c];
        return (v && typeof v === "object") ? JSON.stringify(v) : (v == null ? "" : v);
      })));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), tbl.slice(0, 31));
      done.push({ tbl, n: rows.length });
      box.innerHTML = done.map((d) => `✓ ${d.tbl} — ${d.n} ${t("sp_rows")}`).join("<br>");
    }
    const total = done.reduce((a, b) => a + b.n, 0);
    // 全部 0 筆多半是登入過期／權限問題，寧可不給檔案也不要給空檔
    if (total === 0) throw new Error(t("dl_empty"));
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `報工系統資料_${stamp}.xlsx`);
    box.innerHTML = done.map((d) => `✓ ${d.tbl} — ${d.n} ${t("sp_rows")}`).join("<br>")
      + `<br><strong>${t("dl_done", { n: total })}</strong>`;
    toast(t("dl_done", { n: total }), "ok");
  } catch (e) {
    box.innerHTML = `<span style="color:var(--err)">${t("dl_fail")}：${spEsc(e.message || e)}</span>`;
    toast(t("dl_fail"), "err");
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
};

// ---------- 即時看板 ----------
Admin.initDashboard = function () {
  Admin.loadDashboard();
  Admin.dashTimer = setInterval(Admin.loadDashboard, 20000); // 每 20 秒
};

// ---------- 機台使用率：改成可查日期區間的報表，不再每 20 秒自動刷新
//            （查詢中被刷掉篩選條件很干擾）。實作在檔案下方 Admin.initMachine。

// 稼動/品質報表：一列 = 一個機台（或工站）在某一天
// ⚠️ 性能P% 與 OEE% 需要「每顆標準工時」，停機主因需要暫停時記錄原因，
//    這兩項目前資料庫都沒有，所以顯示「—」而不是編一個數字出來。
Admin.loadMachine = async function () {
  const by = $("#mcBy").value || "machine";
  const from = $("#mcFrom").value, to = $("#mcTo").value;
  if (!from || !to) return;
  const plan = Math.max(1, Number($("#mcPlan").value) || 480);
  const toNext = new Date(to + "T00:00:00"); toNext.setDate(toNext.getDate() + 1);

  const { data, error } = await sb.from("jobs")
    .select("machine,station,work_minutes,paused_minutes,qty,scrap_qty,start_at,status")
    .eq("status", "done")
    .gte("start_at", from + "T00:00:00").lt("start_at", toNext.toISOString())
    .order("start_at", { ascending: false }).limit(5000);
  if (error) return toast(t("err") + ": " + error.message, "err");

  // 依「對象 + 日期」彙總
  const m = new Map();
  (data || []).forEach((j) => {
    const key0 = by === "machine" ? (j.machine || t("unspecified")) : (j.station || t("unspecified"));
    const day = fmtDate(j.start_at);
    const k = key0 + "|" + day;
    if (!m.has(k)) m.set(k, { name: key0, day, run: 0, down: 0, good: 0, bad: 0, jobs: 0 });
    const x = m.get(k);
    x.run += Number(j.work_minutes) || 0;
    x.down += Number(j.paused_minutes) || 0;
    x.good += Number(j.qty) || 0;
    x.bad += Number(j.scrap_qty) || 0;
    x.jobs++;
  });
  let rows = [...m.values()].sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));

  // 篩選下拉（保留目前選擇）
  const names = [...new Set(rows.map((r) => r.name))].sort();
  const pick = $("#mcPick");
  const keep = pick.value;
  pick.innerHTML = `<option value="">${by === "machine" ? t("mc_all_machine") : t("mc_all_station")}</option>` +
    names.map((n) => `<option value="${String(n).replace(/"/g, "&quot;")}">${n}</option>`).join("");
  if (keep && names.includes(keep)) pick.value = keep;
  if (pick.value) rows = rows.filter((r) => r.name === pick.value);

  Admin._mcRows = rows;
  Admin._mcPlan = plan;
  $("#mcCount").textContent = t("jobs_total", { n: rows.length });
  $("#mcNote").innerHTML = t("mc_note");

  const now = new Date(); const p2 = (n) => String(n).padStart(2, "0");
  $("#machineTime").textContent = `${p2(now.getHours())}:${p2(now.getMinutes())}`;
  if (!rows.length) { $("#machineTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }

  const pctCell = (v) => {
    if (v == null) return `<td class="r muted">—</td>`;
    const c = v >= 85 ? "var(--go)" : v >= 70 ? "var(--warn)" : "var(--err)";
    return `<td class="r"><strong style="color:${c}">${v.toFixed(1)}%</strong></td>`;
  };
  const head = `<tr>
    <th>${by === "machine" ? t("machine") : t("station")}</th><th>${t("date")}</th>
    <th class="r">${t("mc_plan")}</th><th class="r">${t("mc_down")}</th><th class="r">${t("mc_run")}</th>
    <th class="r">${t("mc_good")}</th><th class="r">${t("mc_bad")}</th><th class="r">${t("mc_out")}</th>
    <th>${t("mc_reason")}</th>
    <th class="r">${t("mc_a")}</th><th class="r">${t("mc_p")}</th><th class="r">${t("mc_q")}</th><th class="r">${t("mc_oee")}</th></tr>`;
  const body = rows.map((x) => {
    const out = x.good + x.bad;
    const a = Math.min(100, x.run / plan * 100);
    const q = out > 0 ? (x.good / out * 100) : null;
    return `<tr>
      <td>${x.name}</td><td>${x.day}</td>
      <td class="r">${plan}</td><td class="r">${Math.round(x.down)}</td><td class="r">${Math.round(x.run)}</td>
      <td class="r">${x.good}</td><td class="r">${x.bad}</td><td class="r">${out}</td>
      <td class="muted">—</td>
      ${pctCell(a)}${pctCell(null)}${pctCell(q)}${pctCell(null)}</tr>`;
  }).join("");
  $("#machineTable").innerHTML = `<table>${head}${body}</table>`;
};

Admin.initMachine = function () {
  if (!$("#mcFrom").value) {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    $("#mcFrom").value = fmtDate(first);
    $("#mcTo").value = fmtDate(now);
  }
  $("#btnMcQuery").onclick = Admin.loadMachine;
  $("#mcBy").onchange = () => { $("#mcPick").value = ""; Admin.loadMachine(); };
  $("#mcPick").onchange = Admin.loadMachine;
  $("#mcPlan").onchange = Admin.loadMachine;
  $("#btnMcExport").onclick = Admin.exportMachine;
  Admin.loadMachine();
};

Admin.exportMachine = function () {
  const rows = Admin._mcRows || [];
  if (!rows.length) return toast(t("no_data"), "err");
  const plan = Admin._mcPlan || 480;
  const by = $("#mcBy").value === "machine" ? t("machine") : t("station");
  const aoa = [[by, t("date"), t("mc_plan"), t("mc_down"), t("mc_run"), t("mc_good"), t("mc_bad"), t("mc_out"), t("mc_a"), t("mc_q")]];
  rows.forEach((x) => {
    const out = x.good + x.bad;
    aoa.push([x.name, x.day, plan, Math.round(x.down), Math.round(x.run), x.good, x.bad, out,
      Number(Math.min(100, x.run / plan * 100).toFixed(1)), out > 0 ? Number((x.good / out * 100).toFixed(1)) : ""]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "稼動率");
  XLSX.writeFile(wb, `機台稼動率_${$("#mcFrom").value}_${$("#mcTo").value}.xlsx`);
  toast(t("export_ok", { n: rows.length }), "ok");
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
  $("#btnJobsQuery").onclick = () => { Admin.jobsPage = 0; Admin.loadJobs(); };
  $("#btnJobsExport").onclick = Admin.exportJobs;
  Admin.jobsPage = 0;
  Admin.loadJobs();
};

Admin.JOBS_PAGE_SIZE = 200;    // 畫面每頁筆數
Admin.JOBS_FETCH_SIZE = 1000;  // 匯出時每次抓的筆數
Admin.jobsPage = 0;

// 查詢欄位 → 時間區間；排序一律 start_at + id，
// 只用 start_at 排序不唯一（同秒開工會並列），分頁會重複或漏抓
Admin.jobsQuery = function () {
  const from = $("#jbFrom").value;
  const to = $("#jbTo").value;
  if (!from || !to) return null;
  const toNext = new Date(to + "T00:00:00");
  toNext.setDate(toNext.getDate() + 1);
  return { from: from + "T00:00:00", toNext: toNext.toISOString() };
};

Admin.jobsSelect = function (opts) {
  const q = Admin.jobsQuery();
  return sb.from("jobs")
    .select("id,start_at,end_at,paused_minutes,work_minutes,qty,scrap_qty,note,work_content,station,status,work_order_no,employees(name,team)", opts)
    .gte("start_at", q.from)
    .lt("start_at", q.toNext)
    .order("start_at", { ascending: false })
    .order("id", { ascending: false });
};

Admin.loadJobs = async function () {
  if (!Admin.jobsQuery()) return;
  const size = Admin.JOBS_PAGE_SIZE;
  const off = (Admin.jobsPage || 0) * size;

  const { data, error, count } = await Admin.jobsSelect({ count: "exact" }).range(off, off + size - 1);
  if (error) return toast(t("err") + ": " + error.message, "err");

  Admin._jobs = data || [];
  Admin._jobsCount = count || 0;
  const rows = Admin._jobs;
  Admin.renderJobsPager(Admin._jobsCount);
  if (rows.length === 0) { $("#jobsTable").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }

  const stMap = { running: t("status_running"), paused: t("status_paused"), done: t("status_done") };
  const head = `<tr>
    <th>${t("name")}</th><th>${t("team")}</th>
    <th>${t("wo_no")}</th><th>${t("station")}</th><th>${t("work_content")}</th>
    <th>${t("jb_start")}</th><th>${t("jb_end")}</th>
    <th class="r">${t("jb_paused")}</th><th class="r">${t("work_min")}</th>
    <th class="r">${t("qty")}</th><th class="r">${t("scrap")}</th>
    <th>${t("note")}</th><th>${t("status")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((j) => {
    const emp = j.employees || {};
    const wm = j.work_minutes != null ? Math.round(j.work_minutes) : "";
    const pm = Number(j.paused_minutes) || 0;
    const force = j.status !== "done" ? `<button class="btn small" data-act="force" data-id="${j.id}">${t("act_forceend")}</button>` : "";
    const stamp = (v) => v ? `${fmtDate(v)}<br><span class="muted" style="font-size:14px">${fmtTime(v)}</span>` : "";
    return `<tr>
      <td>${emp.name || ""}</td><td>${emp.team || ""}</td>
      <td>${j.work_order_no}</td><td>${j.station}</td><td>${j.work_content || ""}</td>
      <td style="white-space:nowrap">${stamp(j.start_at)}</td><td style="white-space:nowrap">${stamp(j.end_at)}</td>
      <td class="r">${pm ? pm : ""}</td><td class="r">${wm}</td>
      <td class="r">${j.qty != null ? j.qty : ""}</td><td class="r">${j.scrap_qty != null ? j.scrap_qty : ""}</td>
      <td>${j.note || ""}</td><td>${stMap[j.status] || j.status}</td>
      <td style="white-space:nowrap">
        <button class="btn small ghost" data-act="edit" data-id="${j.id}">${t("act_edit")}</button>
        ${force}
        <button class="btn small danger" data-act="del" data-id="${j.id}">${t("act_delete")}</button>
      </td></tr>`;
  }).join("");
  $("#jobsTable").innerHTML = `<table>${head}${body}</table>`;

  $$("#jobsTable button[data-act]").forEach((b) => { b.onclick = () => Admin.jobAction(b.dataset.act, b.dataset.id); });
};

// 分頁列：明確顯示總筆數，不會再有「悄悄被截斷」的情形
Admin.renderJobsPager = function (total) {
  const box = $("#jobsPager");
  if (!box) return;
  const size = Admin.JOBS_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / size));
  const cur = Math.min(Admin.jobsPage || 0, pages - 1);
  Admin.jobsPage = cur;
  box.innerHTML = `
    <div class="row" style="align-items:center;justify-content:space-between;margin-top:10px">
      <span class="muted" style="font-size:14px">${t("jobs_total", { n: total })} · ${t("page_x", { p: cur + 1, t: pages })}</span>
      <span class="row" style="flex:none;gap:6px">
        <button class="btn small ghost" data-pg="prev"${cur <= 0 ? " disabled" : ""}>${t("prev_page")}</button>
        <button class="btn small ghost" data-pg="next"${cur >= pages - 1 ? " disabled" : ""}>${t("next_page")}</button>
      </span>
    </div>`;
  $$("#jobsPager button[data-pg]").forEach((b) => {
    b.onclick = () => {
      Admin.jobsPage += (b.dataset.pg === "next" ? 1 : -1);
      Admin.loadJobs();
      $("#jobsTable").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  });
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
    // 以前強制結束不帶數量，做出來的紀錄 qty 是空的（現有 5 筆就這樣來的），
    // 顆數進度會算不出來，所以改成一定要問。
    const ans = prompt(t("force_qty_ask", { wo: j.work_order_no, st: j.station }));
    if (ans === null) return;
    const q = Number(String(ans).trim());
    if (!isFinite(q) || q < 0 || String(ans).trim() === "") return toast(t("qty_required"), "err");
    const { error } = await sb.rpc("end_job", { p_job_id: id, p_qty: q });
    if (error) return toast(t("err") + ": " + error.message, "err");
    toast(t("ok"), "ok"); Admin.loadJobs();
  }
};

Admin.saveJobEdit = async function () {
  const id = $("#jeId").value;
  // 更正報工也不能把數量清空，否則又製造出算不出顆數的紀錄
  const qtyRaw = $("#jeQty").value.trim();
  if (qtyRaw === "" || !isFinite(Number(qtyRaw)) || Number(qtyRaw) < 0) {
    $("#jeQty").focus();
    return toast(t("qty_required"), "err");
  }
  const upd = {
    work_content: $("#jeWork").value.trim() || null,
    qty: Number(qtyRaw),
    scrap_qty: $("#jeScrap").value === "" ? null : Number($("#jeScrap").value),
    note: $("#jeNote").value.trim() || null,
  };
  const { error } = await sb.from("jobs").update(upd).eq("id", id);
  if (error) return toast(t("err") + ": " + error.message, "err");
  $("#jobEditModal").classList.add("hide");
  toast(t("saved"), "ok"); Admin.loadJobs();
};

// 匯出 Excel：抓完整區間（分頁抓完為止），不受畫面分頁影響。
// 中途失敗就中止，不產生「看起來正常但少了幾百筆」的檔案。
Admin.exportJobs = async function () {
  if (!Admin.jobsQuery()) return;
  const btn = $("#btnJobsExport");
  const label = btn.textContent;
  btn.disabled = true;

  const size = Admin.JOBS_FETCH_SIZE;
  const rows = [];
  let total = Admin._jobsCount || 0;
  try {
    for (let off = 0; ; off += size) {
      const opts = off === 0 ? { count: "exact" } : undefined;
      const { data, error, count } = await Admin.jobsSelect(opts).range(off, off + size - 1);
      if (error) throw error;
      if (off === 0 && count != null) total = count;
      const page = data || [];
      rows.push(...page);
      btn.textContent = t("exporting", { n: rows.length, t: total });
      if (page.length < size) break;
    }
  } catch (e) {
    btn.disabled = false; btn.textContent = label;
    return toast(t("export_fail") + "：" + friendlyErr(e), "err");
  }
  btn.disabled = false; btn.textContent = label;

  if (!rows.length) return toast(t("no_data"), "err");
  const stMap = { running: t("status_running"), paused: t("status_paused"), done: t("status_done") };
  const aoa = [[t("name"), t("team"), t("wo_no"), t("station"), t("work_content"),
    t("jb_start_d"), t("jb_start_t"), t("jb_end_d"), t("jb_end_t"),
    t("jb_paused"), t("work_min"), t("qty"), t("scrap"), t("note"), t("status")]];
  rows.forEach((j) => {
    const e = j.employees || {};
    aoa.push([e.name || "", e.team || "", j.work_order_no, j.station, j.work_content || "",
      j.start_at ? fmtDate(j.start_at) : "", j.start_at ? fmtTime(j.start_at) : "",
      j.end_at ? fmtDate(j.end_at) : "", j.end_at ? fmtTime(j.end_at) : "",
      Number(j.paused_minutes) || 0,
      j.work_minutes != null ? Math.round(j.work_minutes) : "", j.qty != null ? j.qty : "",
      j.scrap_qty != null ? j.scrap_qty : "", j.note || "", stMap[j.status] || j.status]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "報工紀錄");
  XLSX.writeFile(wb, `報工紀錄_${$("#jbFrom").value}_${$("#jbTo").value}.xlsx`);
  toast(t("export_ok", { n: rows.length }), "ok");
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
      <td style="${pg >= 100 ? "text-decoration:line-through;opacity:.5" : ""}">${esc(r.content)}</td>
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
      <td><button class="btn small danger" data-del>${t("act_delete")}</button></td>
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
        <button class="btn small danger" data-del="${r.id}">${t("act_delete")}</button>
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

  // 站別下拉要列該工單的製程站，所以一次把這批工單的路線抓回來
  const routeMap = {};
  if (nos.length) {
    const { data: rts } = await sb.from("work_order_routes").select("work_order_no,seq,station").in("work_order_no", nos).order("seq");
    (rts || []).forEach((r) => { (routeMap[r.work_order_no] = routeMap[r.work_order_no] || []).push(r); });
  }

  const head = `<tr><th>${t("name")}</th><th>${t("team")}</th><th>${t("wo_no")}</th><th>${t("customer")}</th><th>${t("product")}</th><th>${t("station")}</th><th>${t("due_date")}</th><th>${t("assigner")}</th><th>${t("actions")}</th></tr>`;
  const body = rows.map((a) => {
    const e = a.employees || {}; const w = woMap[a.work_order_no] || {};
    // 站別、製作日期改成可直接編輯（改了就存）
    const opts = [`<option value=""${a.station ? "" : " selected"}>${t("any_station")}</option>`]
      .concat((routeMap[a.work_order_no] || []).map((r) => {
        const v = String(r.station).replace(/"/g, "&quot;");
        return `<option value="${v}"${r.station === a.station ? " selected" : ""}>${r.seq} ${r.station}</option>`;
      }));
    // 指派時該工單還沒匯入路線的話，至少把原本的站別留住，不要被下拉洗掉
    if (a.station && !(routeMap[a.work_order_no] || []).some((r) => r.station === a.station)) {
      const v = String(a.station).replace(/"/g, "&quot;");
      opts.push(`<option value="${v}" selected>${a.station}</option>`);
    }
    return `<tr data-aid="${a.id}"><td>${e.name || ""}</td><td>${e.team || ""}</td><td>${a.work_order_no}</td>
      <td>${w.customer || ""}</td><td>${w.product_name || ""}</td>
      <td><select class="cell" data-af="station" style="min-width:130px">${opts.join("")}</select></td>
      <td><input type="date" class="cell" data-af="due_date" value="${a.due_date || ""}" style="min-width:140px"></td>
      <td>${empMap[a.assigned_by] || ""}</td>
      <td><button class="btn small danger" data-del="${a.id}">${t("act_delete")}</button></td></tr>`;
  }).join("");
  $("#assignTable").innerHTML = `<table>${head}${body}</table>`;

  // 改站別 / 改日期 → 立即儲存
  $$("#assignTable [data-af]").forEach((inp) => {
    inp.onchange = async () => {
      const id = inp.closest("tr").dataset.aid;
      const f = inp.dataset.af;
      const { error } = await sb.from("assignments").update({ [f]: inp.value || null }).eq("id", id);
      if (error) return toast(t("err") + ": " + error.message, "err");
      toast(t("saved"), "ok");
    };
  });
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
    sb.from("work_orders").select("*").eq("work_order_no", wo).maybeSingle(),
    sb.from("work_order_routes").select("seq,station,station_type").eq("work_order_no", wo).order("seq"),
    sb.from("jobs").select("station,qty,status,end_at,work_minutes,employees(name)").eq("work_order_no", wo).eq("status", "done"),
  ]);
  if (!woRes.data) { $("#pgInfo").innerHTML = ""; $("#pgTable").innerHTML = `<p class="muted">${t("wo_not_found")}</p>`; return; }
  const routes = routeRes.data || [];
  const jobs = jobRes.data || [];

  // 分批報工同一站會有多筆，要「加總顆數」而不是有紀錄就算完成
  const total = Number(woRes.data.qty);
  const hasTotal = isFinite(total) && total > 0;
  const byStation = {};
  jobs.forEach((j) => {
    if (!byStation[j.station]) byStation[j.station] = { qty: 0, last: null, names: new Set() };
    const s = byStation[j.station];
    s.qty += Number(j.qty) || 0;
    if (!s.last || new Date(j.end_at) > new Date(s.last.end_at)) s.last = j;
    if (j.employees && j.employees.name) s.names.add(j.employees.name);
  });
  const stDone = (st) => {
    const s = byStation[st];
    if (!s) return "none";
    if (!hasTotal) return "done";                 // 沒總數可比，維持舊behaviour
    return s.qty >= total ? "done" : "partial";
  };

  const inhouse = routes.filter((r) => r.station_type === "工作站");
  const doneCount = inhouse.filter((r) => stDone(r.station) === "done").length;
  const pct = inhouse.length ? Math.round(doneCount / inhouse.length * 100) : 0;
  $("#pgInfo").innerHTML = `<div class="wo-info">
    <span class="k">${t("customer")}</span><span>${woRes.data.customer || ""}</span>
    <span class="k">${t("product")}</span><span>${woRes.data.product_name || ""}</span>
    ${hasTotal ? `<span class="k">${t("wo_qty")}</span><span><strong>${total}</strong></span>` : ""}
    <span class="k">${t("progress_pct")}</span><span><strong>${doneCount}/${inhouse.length}（${pct}%）</strong></span>
  </div>`;

  const head = `<tr><th>#</th><th>${t("station")}</th><th>${t("status")}</th><th class="r">${t("st_qty_col")}</th>
    <th>${t("maker_done")}</th><th>${t("done_time")}</th></tr>`;
  const body = routes.map((r) => {
    const outsourced = r.station_type !== "工作站";
    const s = byStation[r.station];
    const state = stDone(r.station);
    let badge, cls = "";
    if (outsourced) badge = `<span class="badge mute">${t("outsourced")}</span>`;
    else if (state === "done") badge = `<span class="badge go">${t("progress_done")}</span>`;
    else if (state === "partial") { badge = `<span class="badge warn">${t("progress_partial")}</span>`; cls = "warn-row"; }
    else { badge = `<span class="badge mute">${t("progress_undone")}</span>`; cls = "warn-row"; }
    const qtyCell = s ? (hasTotal ? `${s.qty} / ${total}` : String(s.qty)) : (hasTotal ? `0 / ${total}` : "");
    const who = s ? [...s.names].join("、") : "";
    const last = s && s.last && s.last.end_at ? fmtDate(s.last.end_at) + " " + fmtTime(s.last.end_at) : "";
    return `<tr class="${cls}"><td>${r.seq}</td><td>${r.station}</td><td>${badge}</td>
      <td class="r">${qtyCell}</td><td>${who}</td><td>${last}</td></tr>`;
  }).join("");
  $("#pgTable").innerHTML = `<table>${head}${body}</table>`;
};

// ---------- 員工管理 ----------
Admin.loadEmployees = async function () {
  const { data, error } = await sb.from("employees").select("*").order("created_at");
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  const head = `<tr><th>${t("emp_account")}</th><th>${t("name")}</th><th>${t("team")}</th>
    <th>${t("role")}</th><th>${t("lang")}</th><th class="r">${t("home_target")}</th>
    <th>${t("active")}</th><th>${t("actions")}</th></tr>`;
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
      <td class="r"><input type="number" class="cell r" style="max-width:80px" min="0" step="1"
        data-target="${e.id}" value="${Home.targets.get(e.id) != null ? Home.targets.get(e.id) : ""}"
        title="${t("home_target_tip")}"></td>
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

  // 本月目標（原型：存 localStorage，不寫資料庫）
  $$("#empTable input[data-target]").forEach((inp) => {
    inp.onchange = () => {
      Home.targets.set(inp.dataset.target, inp.value);
      toast(t("saved") + "（" + t("proto") + "）", "ok");
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
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
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
        qty: find("生產數量D"), due: find("預計完成日期D"), std: find("製程時間T"),
      };
      const get = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : "");
      // ERP 的製程時間T 有 94% 是 0，那是「沒填」不是「0 分鐘」，一律當 null
      const getNum = (row, i) => { const n = Number(get(row, i)); return (isFinite(n) && n > 0) ? n : null; };
      // 欄位還沒建的話就不要送，否則整批匯入會被 PostgREST 擋掉
      const withQty = await App.checkWoQty();

      const woMap = new Map();
      const seen = new Set();
      const routes = [];
      const stations = new Set();

      for (let r = hr + 1; r < aoa.length; r++) {
        const row = aoa[r];
        const wo = get(row, I.wo);
        if (!wo) continue;
        if (!woMap.has(wo)) {
          const rec = {
            work_order_no: wo, sku: get(row, I.sku) || null, product_name: get(row, I.name) || null,
            spec: get(row, I.spec) || null, customer: get(row, I.cust) || null,
            material_body: get(row, I.mat1) || null, material_second: get(row, I.mat2) || null,
            surface_treatment: get(row, I.surf) || null,
          };
          if (withQty) {
            const q = Number(get(row, I.qty));
            rec.qty = (isFinite(q) && q > 0) ? q : null;
            rec.due_date = excelDate(I.due >= 0 ? row[I.due] : null);   // 預計完成日 = 客戶交期
          }
          woMap.set(wo, rec);
        }
        const seq = get(row, I.seq), st = get(row, I.stName);
        if (seq && st) {
          const key = wo + "|" + seq;
          if (!seen.has(key)) {
            seen.add(key);
            const rt = { work_order_no: wo, seq, station: st, station_type: get(row, I.stType) || null, drawing_file: get(row, I.drawing) || null };
            if (withQty) rt.std_minutes = getNum(row, I.std);   // 製程時間T = 該站預估工時
            routes.push(rt);
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
