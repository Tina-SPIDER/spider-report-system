// ============================================================
//  報工（查工單 / 開始 / 暫停 / 繼續 / 結束，可多張同時）
// ============================================================
window.Report = {
  stations: [],     // 全部工站
  machines: [],     // 全部機台
  current: null,    // 目前查到的工單 { work_order_no, sku, product_name, spec }
  timer: null,
};

Report.ensureMachines = async function () {
  if (Report.machines.length === 0) {
    const { data } = await sb.from("machines").select("*").eq("active", true).order("code");
    Report.machines = data || [];
  }
  return Report.machines;
};

Report.ensureStations = async function () {
  if (Report.stations.length === 0) {
    const { data } = await sb.from("stations").select("*").order("sort_order");
    Report.stations = data || [];
  }
  return Report.stations;
};

Report.render = async function () {
  await Report.ensureStations();
  await Report.ensureMachines();
  Report.bind();
  Report.clearLookup();
  await Report.loadAssignments();
  await Report.loadRunning();

  // 一進報工頁，若有未完成的報工就跳出提醒
  if (Report._remind) {
    Report._remind = false;
    Report.showReminder();
  }

  // 進行中工單每秒更新計時
  clearInterval(Report.timer);
  Report.timer = setInterval(Report.tick, 1000);
};

Report.showReminder = function () {
  const list = Report.jobs || [];
  if (!list.length) return;
  const stMap = {};
  (Report.stations || []).forEach((s) => (stMap[s.code] = s));
  $("#remindList").innerHTML = list.map((j) => {
    const st = stMap[j.station];
    let stName = st ? stationName(st) : j.station;
    if (j.machine) stName += ` · 🛠 ${j.machine}`;
    const paused = j.status === "paused";
    const _wo = (Report.woMap || {})[j.work_order_no] || {};
    const woLine = (_wo.customer || _wo.product_name)
      ? `<div class="job-sub">${_wo.customer || ""}${_wo.product_name ? " · " + _wo.product_name : ""}</div>` : "";
    const wc = j.work_content ? `<div class="job-sub">📝 ${j.work_content}</div>` : "";
    return `<div class="job-card ${paused ? "paused" : ""}">
      <div class="job-head"><strong>${j.work_order_no}</strong>
        <span class="badge ${paused ? "warn" : "go"}">${paused ? t("status_paused") : t("status_running")}</span></div>
      ${woLine}
      <div class="job-sub">${stName}</div>${wc}</div>`;
  }).join("");
  $("#remindModal").classList.remove("hide");
  $("#btnRemindClose").onclick = () => $("#remindModal").classList.add("hide");
};

Report.bind = function () {
  $("#btnQueryWo").onclick = Report.queryWo;
  $("#inWoNo").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); Report.queryWo(); } };
  $("#btnStart").onclick = Report.start;
};

Report.clearLookup = function () {
  Report.current = null;
  $("#woInfo").classList.add("hide");
  $("#inWoNo").value = "";
  $("#selStation").innerHTML = "";
  if ($("#inNewStation")) { $("#inNewStation").value = ""; $("#inNewStation").classList.add("hide"); }
  if ($("#selMachine")) $("#selMachine").innerHTML = "";
  if ($("#inNewMachine")) { $("#inNewMachine").value = ""; $("#inNewMachine").classList.add("hide"); }
  if ($("#drawingBox")) $("#drawingBox").innerHTML = "";
};

Report.queryWo = async function () {
  const no = $("#inWoNo").value.trim();
  if (!no) return;
  const { data, error } = await sb.from("work_orders").select("*").eq("work_order_no", no).maybeSingle();
  if (error) return toast(friendlyErr(error), "err");
  if (!data) {
    Report.current = null;
    $("#woInfo").classList.add("hide");
    return toast(t("wo_not_found"), "err");
  }
  Report.current = data;
  $("#woSku").textContent = data.sku || "-";
  $("#woProduct").textContent = data.product_name || "-";
  $("#woSpec").textContent = data.spec || "-";
  $("#woMat1").textContent = data.material_body || "-";
  $("#woMat2").textContent = data.material_second || "-";
  $("#woSurf").textContent = data.surface_treatment || "-";
  $("#woCust").textContent = data.customer || "-";

  // 工序下拉：只列「這張工單的製程站」+ 新增站名選項
  const { data: routes } = await sb.from("work_order_routes")
    .select("seq,station,station_type,drawing_path").eq("work_order_no", data.work_order_no).order("seq");
  Report._routes = routes || [];
  const opts = ['<option value="">' + t("select_station") + "</option>"];
  Report._routes.forEach((r) => {
    const v = String(r.station).replace(/"/g, "&quot;");
    opts.push(`<option value="${v}">${r.seq} ${r.station}</option>`);
  });
  opts.push(`<option value="__new__">${t("new_station")}</option>`);
  const sel = $("#selStation");
  sel.innerHTML = opts.join("");
  sel.onchange = () => {
    const isNew = sel.value === "__new__";
    $("#inNewStation").classList.toggle("hide", !isNew);
    if (isNew) $("#inNewStation").focus();
    Report.updateDrawing();
  };
  $("#inNewStation").classList.add("hide");
  $("#drawingBox").innerHTML = "";

  // 機台下拉（全廠機台 + 新增機台；可不選）
  const mopts = ['<option value="">' + t("select_machine") + "</option>"];
  Report.machines.forEach((m) => {
    const v = String(m.code).replace(/"/g, "&quot;");
    mopts.push(`<option value="${v}">${m.name}</option>`);
  });
  mopts.push(`<option value="__new__">${t("new_machine")}</option>`);
  const msel = $("#selMachine");
  msel.innerHTML = mopts.join("");
  msel.onchange = () => {
    const isNew = msel.value === "__new__";
    $("#inNewMachine").classList.toggle("hide", !isNew);
    if (isNew) $("#inNewMachine").focus();
  };
  $("#inNewMachine").classList.add("hide");

  $("#woInfo").classList.remove("hide");
};

// 選到某站 → 自動在下方帶出「該站圖面」獨立預覽欄（可放大縮小）
Report.updateDrawing = async function () {
  const box = $("#drawingBox");
  if (!box) return;
  const station = $("#selStation").value;
  if (!station || station === "__new__") { box.innerHTML = ""; return; }
  const r = (Report._routes || []).find((x) => x.station === station && x.drawing_path);
  if (!r) { box.innerHTML = `<div class="drawing-empty">${t("no_drawing")}</div>`; return; }
  box.innerHTML = `<div class="drawing-empty">${t("drawing_loading")}</div>`;
  const reqId = (Report._drawReq = (Report._drawReq || 0) + 1);
  const { data, error } = await sb.storage.from("drawings").createSignedUrl(r.drawing_path, 3600);
  if (reqId !== Report._drawReq) return;            // 期間又換了站，丟棄舊結果
  if (error || !data) { box.innerHTML = `<div class="drawing-empty">${friendlyErr(error)}</div>`; return; }
  Report.renderDrawingPanel(box, data.signedUrl, station, r.drawing_path);
};

// 畫出預覽面板（圖片＝內嵌可縮放；PDF＝內嵌＋放大開新視窗）
Report.renderDrawingPanel = function (box, url, station, key) {
  const title = `📐 ${station} ${t("drawing")}`;
  const isPdf = /\.pdf(\?|$)/i.test(key) || /\.pdf(\?|$)/i.test(url);
  if (isPdf) {
    box.innerHTML = `
      <div class="drawing-panel">
        <div class="drawing-bar"><span class="drawing-title">${title}</span>
          <span class="drawing-tools"><button type="button" class="dbtn" data-act="full">⛶ ${t("zoom")}</button></span>
        </div>
        <div class="drawing-stage pdf"><iframe title="${title}"></iframe></div>
      </div>`;
    box.querySelector("iframe").src = url;
    box.querySelector('[data-act="full"]').onclick = () => window.open(url, "_blank");
    return;
  }
  box.innerHTML = `
    <div class="drawing-panel">
      <div class="drawing-bar"><span class="drawing-title">${title}</span>
        <span class="drawing-tools">
          <button type="button" class="dbtn" data-z="out">－</button>
          <button type="button" class="dbtn" data-z="reset">100%</button>
          <button type="button" class="dbtn" data-z="in">＋</button>
          <button type="button" class="dbtn" data-z="full">⛶</button>
        </span>
      </div>
      <div class="drawing-stage" data-stage><img draggable="false" alt="${title}"></div>
    </div>`;
  box.querySelector("img").src = url;
  Report.bindZoom(box.querySelector("[data-stage]"), box, url, title);
};

// 內嵌圖片縮放（按鈕＋滾輪＋拖曳平移），⛶ 開全螢幕
Report.bindZoom = function (stage, scope, url, title) {
  const img = stage.querySelector("img");
  let z = 1;
  const apply = () => { img.style.width = (z * 100) + "%"; };
  const set = (nz) => { z = Math.min(6, Math.max(1, Math.round(nz * 10) / 10)); apply(); };
  apply();
  scope.querySelector('[data-z="in"]').onclick = () => set(z + 0.5);
  scope.querySelector('[data-z="out"]').onclick = () => set(z - 0.5);
  scope.querySelector('[data-z="reset"]').onclick = () => set(1);
  scope.querySelector('[data-z="full"]').onclick = () => Report.openDrawingViewer(url, title);
  stage.onwheel = (e) => { e.preventDefault(); set(z + (e.deltaY < 0 ? 0.3 : -0.3)); };
  let drag = null;
  stage.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; try { stage.setPointerCapture(e.pointerId); } catch {} stage.style.cursor = "grabbing"; };
  stage.onpointermove = (e) => { if (!drag) return; stage.scrollLeft = drag.l - (e.clientX - drag.x); stage.scrollTop = drag.t - (e.clientY - drag.y); };
  stage.onpointerup = stage.onpointercancel = () => { drag = null; stage.style.cursor = "grab"; };
};

// 全螢幕檢視：按鈕＋滾輪縮放、單指拖曳、雙指縮放
Report.openDrawingViewer = function (url, title) {
  const dv = $("#drawingViewer"), img = $("#dvImg"), stage = $("#dvStage");
  $("#dvTitle").textContent = title;
  img.src = url;
  dv.classList.remove("hide");
  let z = 1;
  const apply = () => { img.style.width = (z * 100) + "%"; };
  const set = (nz) => { z = Math.min(8, Math.max(1, Math.round(nz * 100) / 100)); apply(); };
  set(1);
  $("#dvIn").onclick = () => set(z + 0.5);
  $("#dvOut").onclick = () => set(z - 0.5);
  $("#dvReset").onclick = () => set(1);
  $("#dvClose").onclick = () => { dv.classList.add("hide"); img.src = ""; };
  stage.onwheel = (e) => { e.preventDefault(); set(z + (e.deltaY < 0 ? 0.4 : -0.4)); };
  const pts = new Map(); let startDist = 0, startZ = 1, drag = null;
  stage.onpointerdown = (e) => {
    pts.set(e.pointerId, e); try { stage.setPointerCapture(e.pointerId); } catch {}
    if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop };
    if (pts.size === 2) { const a = [...pts.values()]; startDist = Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY); startZ = z; drag = null; }
  };
  stage.onpointermove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, e);
    if (pts.size === 2) { const a = [...pts.values()]; const d = Math.hypot(a[0].clientX - a[1].clientX, a[0].clientY - a[1].clientY); if (startDist) set(startZ * d / startDist); }
    else if (drag) { stage.scrollLeft = drag.l - (e.clientX - drag.x); stage.scrollTop = drag.t - (e.clientY - drag.y); }
  };
  const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) startDist = 0; if (pts.size === 0) drag = null; };
  stage.onpointerup = up; stage.onpointercancel = up;
};

// 由 drawing_path 直接看圖（圖片→全螢幕縮放；PDF→開新視窗）
Report.viewDrawing = async function (path, title) {
  if (!path) return;
  const { data, error } = await sb.storage.from("drawings").createSignedUrl(path, 3600);
  if (error || !data) return toast(friendlyErr(error), "err");
  if (/\.pdf(\?|$)/i.test(path)) window.open(data.signedUrl, "_blank");
  else Report.openDrawingViewer(data.signedUrl, title || t("drawing"));
};

Report.start = async function () {
  if (!Report.current) return toast(t("wo_not_found"), "err");
  let station = $("#selStation").value;
  if (station === "__new__") station = $("#inNewStation").value.trim();
  if (!station) return toast(t("select_station"), "err");
  let machine = $("#selMachine").value;
  if (machine === "__new__") machine = $("#inNewMachine").value.trim();
  const { data, error } = await sb.rpc("start_job", {
    p_work_order_no: Report.current.work_order_no,
    p_station: station,
    p_machine: machine || null,
  });
  if (error) return toast(friendlyErr(error), "err");
  Report._flashId = data && data.id;   // 新卡片高亮用
  toast(t("ok"), "ok");
  Report.stations = []; Report.machines = [];   // 下次重載（含剛新增的站/機台）
  await Report.ensureStations(); await Report.ensureMachines();
  Report.clearLookup();
  await Report.loadRunning();
};

Report.loadAssignments = async function () {
  const box = $("#assignList");
  if (!box) return;
  const { data, error } = await sb.from("assignments").select("work_order_no,station,due_date,assigned_by").eq("employee_id", App.ME.id).order("due_date", { ascending: true, nullsFirst: false });
  if (error) { box.innerHTML = ""; return; }
  const list = data || [];
  if (list.length === 0) { box.innerHTML = `<p class="muted">${t("no_assignments")}</p>`; return; }
  const nos = list.map((a) => a.work_order_no);
  const { data: wos } = await sb.from("work_orders").select("work_order_no,customer,product_name").in("work_order_no", nos);
  const map = {}; (wos || []).forEach((w) => (map[w.work_order_no] = w));
  const ids = [...new Set(list.map((a) => a.assigned_by).filter(Boolean))];
  const aMap = {};
  if (ids.length) { const { data: es } = await sb.from("employees").select("id,name").in("id", ids); (es || []).forEach((e) => (aMap[e.id] = e.name)); }
  box.innerHTML = list.map((a) => {
    const w = map[a.work_order_no] || {};
    const wo = String(a.work_order_no).replace(/"/g, "&quot;");
    const st = a.station ? String(a.station).replace(/"/g, "&quot;") : "";
    const stTag = a.station ? ` · 🔧 ${a.station}` : "";
    const dateTag = a.due_date ? `<span class="badge" style="background:#6aac1e">📅 ${a.due_date}</span>` : "";
    const assigner = a.assigned_by && aMap[a.assigned_by] ? ` · ${t("assigner")}: ${aMap[a.assigned_by]}` : "";
    return `<div class="job-card" style="border-left-color:var(--primary)">
      <div class="job-head"><strong>${a.work_order_no}</strong>
        <button class="btn small primary" data-wo="${wo}" data-st="${st}">${t("act_report")}</button></div>
      <div class="job-sub">${w.customer || ""} ${w.product_name || ""}${stTag}</div>
      ${dateTag || assigner ? `<div class="job-sub">${dateTag}${assigner}</div>` : ""}</div>`;
  }).join("");
  $$("#assignList button[data-wo]").forEach((b) => {
    b.onclick = async () => {
      $("#inWoNo").value = b.dataset.wo;
      await Report.queryWo();
      const st = b.dataset.st;
      if (st) {
        const sel = $("#selStation");
        if ([...sel.options].some((o) => o.value === st)) { sel.value = st; Report.updateDrawing(); }
      }
      $("#inWoNo").scrollIntoView({ behavior: "smooth", block: "center" });
    };
  });
};

Report.loadRunning = async function () {
  const { data, error } = await sb.from("jobs")
    .select("*")
    .eq("employee_id", App.ME.id)
    .in("status", ["running", "paused"])
    .order("start_at", { ascending: true });
  if (error) return toast(friendlyErr(error), "err");
  Report.jobs = data || [];
  // 取進行中工單的客戶/品名
  Report.woMap = {};
  Report.routeDraw = {};
  const nos = [...new Set(Report.jobs.map((j) => j.work_order_no))];
  if (nos.length) {
    const { data: wos } = await sb.from("work_orders").select("work_order_no,customer,product_name").in("work_order_no", nos);
    (wos || []).forEach((w) => (Report.woMap[w.work_order_no] = w));
    const { data: rts } = await sb.from("work_order_routes").select("work_order_no,station,drawing_path").in("work_order_no", nos);
    (rts || []).forEach((r) => { if (r.drawing_path) Report.routeDraw[r.work_order_no + "|" + r.station] = r.drawing_path; });
  }
  Report.renderRunning();
};

Report.renderRunning = function () {
  const box = $("#runningList");
  if (!Report.jobs || Report.jobs.length === 0) {
    box.innerHTML = `<p class="muted">${t("no_running")}</p>`;
    return;
  }
  const stMap = {};
  Report.stations.forEach((s) => (stMap[s.code] = s));
  box.innerHTML = Report.jobs.map((j) => {
    const st = stMap[j.station];
    const stBase = st ? stationName(st) : j.station;
    let stName = stBase;
    if (j.machine) stName += ` · 🛠 ${j.machine}`;
    const paused = j.status === "paused";
    const _wo = (Report.woMap || {})[j.work_order_no] || {};
    const woLine = (_wo.customer || _wo.product_name)
      ? `<div class="job-sub">${_wo.customer || ""}${_wo.product_name ? " · " + _wo.product_name : ""}</div>` : "";
    const wc = j.work_content ? `<div class="job-sub">📝 ${j.work_content}</div>` : "";
    // 逾時警示（進行中超過 8 小時，多半忘了結束）
    const mins = (Date.now() - new Date(j.start_at).getTime()) / 60000 - Number(j.paused_minutes || 0);
    const over = j.status !== "paused" && mins > 480;
    const overTag = over ? ` <span class="badge err">⚠ ${t("overtime")}</span>` : "";
    const flash = (Report._flashId && j.id === Report._flashId) ? " flash" : "";
    const _dp = (Report.routeDraw || {})[j.work_order_no + "|" + j.station];
    const drawBtn = _dp ? `<button class="btn small ghost" data-act="drawing" data-draw="${String(_dp).replace(/"/g, "&quot;")}" data-dtitle="📐 ${String(stBase).replace(/"/g, "&quot;")} ${t("drawing")}">📐 ${t("drawing")}</button>` : "";
    return `
    <div class="job-card ${paused ? "paused" : ""}${over ? " over" : ""}${flash}" data-id="${j.id}">
      <div class="job-head">
        <strong>${j.work_order_no}</strong>
        <span class="badge ${paused ? "warn" : "go"}">${paused ? t("status_paused") : t("status_running")}</span>${overTag}
      </div>
      ${woLine}
      <div class="job-sub">${stName}</div>
      ${wc}
      <div class="job-timer" data-timer>${t("elapsed")}: …</div>
      <div class="job-btns">
        ${drawBtn}
        ${paused
          ? `<button class="btn small" data-act="resume">${t("resume")}</button>`
          : `<button class="btn small ghost" data-act="pause">${t("pause")}</button>`}
        <button class="btn small primary" data-act="finish">${t("finish")}</button>
      </div>
    </div>`;
  }).join("");

  $$("#runningList .job-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll("button").forEach((b) => {
      b.onclick = () => { if (b.dataset.act === "drawing") Report.viewDrawing(b.dataset.draw, b.dataset.dtitle); else Report.action(id, b.dataset.act); };
    });
  });
  Report._flashId = null;   // 高亮只觸發一次
  Report.tick();
};

// 每秒更新各卡片計時器（時:分:秒）；暫停時凍結
Report.tick = function () {
  if (!Report.jobs) return;
  const now = Date.now();
  const p2 = (n) => String(n).padStart(2, "0");
  $$("#runningList .job-card").forEach((card) => {
    const j = Report.jobs.find((x) => x.id === card.dataset.id);
    if (!j) return;
    let openPauseMs = 0;
    if (j.status === "paused" && j.paused_at) openPauseMs = now - new Date(j.paused_at).getTime();
    const ms = (now - new Date(j.start_at).getTime()) - Number(j.paused_minutes || 0) * 60000 - openPauseMs;
    let sec = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(sec / 3600); sec %= 3600;
    const mm = Math.floor(sec / 60); const ss = sec % 60;
    const el = card.querySelector("[data-timer]");
    if (el) el.textContent = `⏱ ${p2(hh)}:${p2(mm)}:${p2(ss)}`;
  });
};

Report.action = async function (id, act) {
  if (act === "pause") {
    const { error } = await sb.rpc("pause_job", { p_job_id: id });
    if (error) return toast(friendlyErr(error), "err");
    await Report.loadRunning();
  } else if (act === "resume") {
    const { error } = await sb.rpc("resume_job", { p_job_id: id });
    if (error) return toast(friendlyErr(error), "err");
    await Report.loadRunning();
  } else if (act === "finish") {
    Report.openFinish(id);
  }
};

// 結束報工小視窗
Report.openFinish = function (id) {
  $("#finishJobId").value = id;
  $("#finWork").value = "";
  $("#finQty").value = "";
  $("#finScrap").value = "";
  $("#finNote").value = "";
  $("#finishModal").classList.remove("hide");
  $("#btnFinCancel").onclick = () => $("#finishModal").classList.add("hide");
  $("#btnFinConfirm").onclick = Report.confirmFinish;
};

Report.confirmFinish = async function () {
  const id = $("#finishJobId").value;
  const qty = $("#finQty").value === "" ? null : Number($("#finQty").value);
  const scrap = $("#finScrap").value === "" ? null : Number($("#finScrap").value);
  const note = $("#finNote").value.trim() || null;
  const workContent = $("#finWork").value.trim() || null;
  const { data, error } = await sb.rpc("end_job", {
    p_job_id: id, p_qty: qty, p_scrap: scrap, p_note: note, p_work_content: workContent,
  });
  if (error) return toast(friendlyErr(error), "err");
  $("#finishModal").classList.add("hide");
  const st = data ? data.status : "";
  toast(`${t("finish")} ✓ ${st ? "(" + st + ")" : ""}`, "ok");
  await Report.loadRunning();
};
