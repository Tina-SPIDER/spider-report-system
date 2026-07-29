// ============================================================
//  行事曆：日 / 週 / 月三種檢視，看哪天要做哪個客戶、哪張工單
//  兩個來源可各自開關：
//    📌 我的指派 — assignments.due_date（主管在「工單指派」排的）
//    📅 工單交期 — work_orders.due_date（ERP 預計完成日，全廠）
// ============================================================
window.Cal = { mode: "week", cursor: null, byDay: {}, sel: null, srcMine: true, srcDue: true, noDate: [] };

const calEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const calAttr = (s) => calEsc(s).replace(/"/g, "&quot;");

// 品名後面多半掛著尺寸規格，例如
//   U7特殊管式內模(成型放電3凹x60L)(D17x36L+>16.7L+管7.3L=60L)
// 月曆放不下，取第一個括號前的主體就好 → U7特殊管式內模。
// 有些品名本身以括號開頭（(LSZH)D20充實緊包外模…），所以要跳過開頭那組。
const calShortName = (s) => {
  const str = String(s == null ? "" : s).trim();
  if (!str) return "";
  let from = 0;
  if (str[0] === "(" || str[0] === "（") {
    const close = str.search(/[)）]/);
    if (close > 0) from = close + 1;
  }
  const i = str.slice(from).search(/[(（]/);
  return (i > 0 ? str.slice(0, from + i) : str).trim();
};
const calKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const calAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const calMidnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

Cal.render = async function () {
  if (!App.ME) return;
  if (!Cal.cursor) Cal.cursor = calMidnight(new Date());
  await Cal.load();
  Cal.paint();
};

// 目前檢視涵蓋的日期範圍（月檢視要含前後補滿的格子）
Cal.range = function () {
  const c = Cal.cursor;
  if (Cal.mode === "day") return { s: c, e: c };
  if (Cal.mode === "week") { const s = calAdd(c, -c.getDay()); return { s, e: calAdd(s, 6) }; }
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const s = calAdd(first, -first.getDay());
  return { s, e: calAdd(s, 41) };
};

Cal.load = async function () {
  const { s, e } = Cal.range();
  const sKey = calKey(s), eKey = calKey(e);
  const byDay = {};
  const push = (k, item) => { (byDay[k] = byDay[k] || []).push(item); };

  // 1) 指派給我的
  let mineWos = [];
  if (Cal.srcMine) {
    const { data } = await sb.from("assignments")
      .select("work_order_no,station,due_date").eq("employee_id", App.ME.id);
    const all = data || [];
    Cal.noDate = all.filter((a) => !a.due_date);
    mineWos = all.filter((a) => a.due_date && a.due_date >= sKey && a.due_date <= eKey);
  } else { Cal.noDate = []; }

  // 2) 交期落在範圍內的工單
  let dueWos = [];
  if (Cal.srcDue) {
    // due_date_manual 欄位可能還沒建，沒有就退回不帶它的查詢
    let res = await sb.from("work_orders")
      .select("work_order_no,customer,product_name,qty,due_date,due_date_manual")
      .gte("due_date", sKey).lte("due_date", eKey).order("due_date").limit(2000);
    if (res.error) {
      res = await sb.from("work_orders")
        .select("work_order_no,customer,product_name,qty,due_date")
        .gte("due_date", sKey).lte("due_date", eKey).order("due_date").limit(2000);
    }
    dueWos = res.data || [];
  }

  // 補齊指派工單的客戶/品名/數量
  const need = [...new Set(mineWos.map((a) => a.work_order_no))]
    .filter((no) => !dueWos.some((w) => w.work_order_no === no));
  const wMap = {};
  dueWos.forEach((w) => (wMap[w.work_order_no] = w));
  if (need.length) {
    const { data } = await sb.from("work_orders")
      .select("work_order_no,customer,product_name,qty").in("work_order_no", need);
    (data || []).forEach((w) => (wMap[w.work_order_no] = w));
  }

  // 指派的站別做了幾顆
  const qtyMap = {};
  const allNos = [...new Set([...mineWos.map((a) => a.work_order_no)])];
  if (allNos.length) {
    const { data } = await sb.from("jobs")
      .select("work_order_no,station,qty,status").eq("status", "done").in("work_order_no", allNos);
    (data || []).forEach((j) => {
      const k = j.work_order_no + "|" + j.station;
      qtyMap[k] = (qtyMap[k] || 0) + (Number(j.qty) || 0);
    });
  }

  mineWos.forEach((a) => {
    const w = wMap[a.work_order_no] || {};
    const total = Number(w.qty);
    const hasTotal = isFinite(total) && total > 0;
    const doneQty = a.station ? (qtyMap[a.work_order_no + "|" + a.station] || 0) : 0;
    push(a.due_date, {
      type: "mine", work_order_no: a.work_order_no, station: a.station,
      customer: w.customer, product_name: w.product_name,
      doneQty, total: hasTotal ? total : null,
      finished: !!(a.station && hasTotal && doneQty >= total),
    });
  });
  // 同一天同一張工單如果已經以「我的指派」出現，就不要再用「工單交期」畫一次。
  // 指派那筆帶站別和顆數進度，資訊比較完整，留它。
  const seen = new Set();
  Object.entries(byDay).forEach(([k, arr]) => arr.forEach((it) => seen.add(k + "|" + it.work_order_no)));
  dueWos.forEach((w) => {
    if (seen.has(w.due_date + "|" + w.work_order_no)) return;
    push(w.due_date, {
      type: "due", work_order_no: w.work_order_no, customer: w.customer,
      product_name: w.product_name, total: Number(w.qty) || null,
      manual: !!w.due_date_manual,
    });
  });

  Cal.byDay = byDay;
};

// ---------- 畫面 ----------
Cal.paint = function () {
  const today = calMidnight(new Date());
  const todayKey = calKey(today);
  const { s, e } = Cal.range();

  // 頂部統計固定看「本週 / 下週」，換檢視不影響
  const wkS = calAdd(today, -today.getDay()), wkE = calAdd(wkS, 6);
  const count = (a, b) => {
    let n = 0;
    for (let d = new Date(a); d <= b; d = calAdd(d, 1)) n += (Cal.byDay[calKey(d)] || []).length;
    return n;
  };
  const inView = count(s, e);
  $("#calSummary").innerHTML = `
    <div class="stat"><div class="num">${inView}</div><div class="lbl">${t("cal_in_view")}</div></div>
    <div class="stat"><div class="num">${count(wkS, wkE)}</div><div class="lbl">${t("cal_this_week")}</div></div>
    <div class="stat"><div class="num">${count(calAdd(wkS, 7), calAdd(wkE, 7))}</div><div class="lbl">${t("cal_next_week")}</div></div>
    <div class="stat"><div class="num">${Cal.noDate.length}</div><div class="lbl">${t("cal_no_date")}</div></div>`;

  // 標題依檢視變化
  const c = Cal.cursor;
  $("#calTitle").textContent =
    Cal.mode === "day" ? `${calKey(c)} ${t("wd" + c.getDay())}`
    : Cal.mode === "week" ? `${calKey(s)} ～ ${calKey(e)}`
    : t("cal_ym", { y: c.getFullYear(), m: String(c.getMonth() + 1).padStart(2, "0") });

  $$("#calModes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === Cal.mode));
  $("#calSrcMine").checked = Cal.srcMine;
  $("#calSrcDue").checked = Cal.srcDue;

  if (Cal.mode === "month") Cal.paintMonth(todayKey, s);
  else Cal.paintList(todayKey, s, e);

  Cal.bind();
};

// 只有主管能拖曳改期；員工看得到但拖不動
Cal.canMove = function () { return App.ME && App.ME.role === "主管"; };

// 品名中位數 16 字、最長 46 字，塞不進月曆格子，所以分檢視處理：
//   日檢視 → 完整顯示（空間夠）
//   週檢視 → 第二行顯示、單行截斷
//   月檢視 → 只留滑鼠提示（格子太小）
Cal.chip = function (it, day) {
  const cls = it.type === "mine" ? "mine" : "due";
  const who = it.customer || "";
  const name = calShortName(it.product_name);
  const qty = it.total && it.total > 1 ? ` ×${it.total}` : "";
  const drag = Cal.canMove()
    ? ` draggable="true" data-wo="${calAttr(it.work_order_no)}" data-type="${it.type}" data-from="${day}"` : "";
  const tip = [who, it.work_order_no, it.product_name, it.manual ? t("cal_manual_tip") : ""].filter(Boolean).join(" · ");
  return `<span class="cal-chip ${cls}${it.finished ? " done" : ""}${Cal.canMove() ? " movable" : ""}${it.manual ? " manual" : ""}"${drag} title="${calAttr(tip)}">
    <span class="chip-l1">${it.type === "mine" ? "📌" : "📅"} ${calEsc(who)} ${calEsc(it.work_order_no)}${qty}${it.manual ? " ✎" : ""}</span>
    ${name ? `<span class="chip-l2">${calEsc(name)}</span>` : ""}</span>`;
};

// 真正寫入新日期
Cal.move = async function (wo, type, toDay) {
  if (!Cal.canMove()) return;
  if (type === "mine") {
    const { error } = await sb.from("assignments")
      .update({ due_date: toDay }).eq("work_order_no", wo).eq("employee_id", App.ME.id);
    if (error) return toast(friendlyErr(error), "err");
  } else {
    const { error } = await sb.rpc("set_wo_due_date", { p_wo: wo, p_date: toDay });
    if (error) return toast(t("cal_move_fail") + "：" + friendlyErr(error), "err");
  }
  toast(t("cal_moved", { wo, d: toDay }), "ok");
  await Cal.render();
};

Cal.paintMonth = function (todayKey, start) {
  const m = Cal.cursor.getMonth();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = calAdd(start, i);
    const key = calKey(d);
    const items = Cal.byDay[key] || [];
    // 月曆格子只放得下客戶名，品名放進 title 讓滑鼠停留看得到
    const show = items.slice(0, 2).map((it) => {
      const tip = [it.customer, it.work_order_no, it.product_name].filter(Boolean).join(" · ");
      return `<span class="cal-mini ${it.type}" title="${calAttr(tip)}">${calEsc(it.customer || it.work_order_no)}</span>`;
    }).join("");
    const more = items.length > 2 ? `<span class="cal-mini more">+${items.length - 2}</span>` : "";
    cells.push(`<button class="cal-cell${d.getMonth() !== m ? " other" : ""}${key === todayKey ? " today" : ""}${Cal.sel === key ? " sel" : ""}" data-d="${key}" data-drop="${key}">
      <span class="cal-d">${d.getDate()}${items.length ? `<span class="cal-n">${items.length}</span>` : ""}</span>
      ${show}${more}</button>`);
  }
  const wd = [0, 1, 2, 3, 4, 5, 6].map((i) => `<div class="cal-wd">${t("wd" + i)}</div>`).join("");
  $("#calGrid").innerHTML = `<div class="cal-head">${wd}</div><div class="cal-body month">${cells.join("")}</div>`;
  Cal.paintDay();
};

// 週 / 日：直接把客戶＋工單列出來
Cal.paintList = function (todayKey, s, e) {
  const days = [];
  for (let d = new Date(s); d <= e; d = calAdd(d, 1)) {
    const key = calKey(d);
    const items = Cal.byDay[key] || [];
    days.push(`<div class="cal-col${key === todayKey ? " today" : ""}" data-drop="${key}">
      <div class="cal-colhead">${key.slice(5)} ${t("wd" + d.getDay())}
        ${items.length ? `<span class="cal-n">${items.length}</span>` : ""}</div>
      <div class="cal-colbody">${items.length
        ? items.map((it) => Cal.chip(it, key)).join("")
        : `<span class="muted" style="font-size:13px">—</span>`}</div></div>`);
  }
  $("#calGrid").innerHTML = `<div class="cal-cols ${Cal.mode}">${days.join("")}</div>`;
  Cal.sel = Cal.mode === "day" ? calKey(Cal.cursor) : Cal.sel;
  Cal.paintDay();
};

Cal.paintDay = function () {
  const box = $("#calDay");
  const key = Cal.sel;
  if (!key) {
    box.innerHTML = `<p class="muted">${t("cal_pick_day")}</p>` +
      (Cal.noDate.length ? `<p class="muted">${t("cal_no_date_n", { n: Cal.noDate.length })}</p>` : "");
    return;
  }
  const items = Cal.byDay[key] || [];
  const head = `<h4 style="margin:0 0 10px">${key}　<span class="muted" style="font-size:15px">${t("cal_n_wo", { n: items.length })}</span></h4>`;
  if (!items.length) { box.innerHTML = head + `<p class="muted">${t("cal_day_empty")}</p>`; return; }

  box.innerHTML = head + items.map((a) => {
    const stTag = a.station ? ` · 🔧 ${calEsc(a.station)}` : "";
    const qtyTag = a.total ? `<span class="badge mute">${t("wo_qty")} ${a.total}</span>` : "";
    let prog = "";
    if (a.type === "mine" && a.station) {
      prog = a.total
        ? (a.finished
          ? `<span class="badge go">✓ ${t("st_all_done", { n: a.doneQty, t: a.total })}</span>`
          : `<span class="badge ${a.doneQty > 0 ? "warn" : "mute"}">${t("st_of_total", { n: a.doneQty, t: a.total, r: a.total - a.doneQty })}</span>`)
        : (a.doneQty > 0 ? `<span class="badge warn">${t("st_done_n", { n: a.doneQty })}</span>` : "");
    }
    const tag = a.type === "mine"
      ? `<span class="badge go">📌 ${t("cal_src_mine")}</span>`
      : `<span class="badge mute">📅 ${t("cal_src_due")}</span>`;
    const manualTag = a.manual ? `<span class="badge warn">✎ ${t("cal_manual")}</span>` : "";
    // 手機拖不動，主管在這裡直接改日期
    const mover = Cal.canMove()
      ? `<div class="job-sub cal-mover">${t("cal_move_to")}
           <input type="date" value="${key}" data-mv="${calEsc(a.work_order_no)}" data-mvtype="${a.type}" style="width:160px">
           ${a.manual && a.type === "due" ? `<button class="btn small ghost" data-reset="${calEsc(a.work_order_no)}">${t("cal_reset_erp")}</button>` : ""}
         </div>` : "";
    return `<div class="job-card${a.finished ? " home-done" : ""}" style="border-left-color:${a.type === "mine" ? "var(--go)" : "var(--c1)"}">
      <div class="job-head"><strong>${calEsc(a.customer || "")} ${calEsc(a.work_order_no)}</strong>
        <button class="btn small ${a.finished ? "ghost" : "primary"}" data-wo="${calEsc(a.work_order_no)}" data-st="${calEsc(a.station || "")}">${t("act_report")}</button></div>
      <div class="job-sub">${calEsc(a.product_name || "")}${stTag}</div>
      <div class="job-sub">${tag} ${manualTag} ${qtyTag} ${prog}</div>${mover}</div>`;
  }).join("");

  $$("#calDay button[data-wo]").forEach((b) => {
    b.onclick = () => { Report._pendingWo = { wo: b.dataset.wo, st: b.dataset.st }; App.go("report"); };
  });
  $$("#calDay input[data-mv]").forEach((inp) => {
    inp.onchange = () => { if (inp.value && inp.value !== key) Cal.move(inp.dataset.mv, inp.dataset.mvtype, inp.value); };
  });
  $$("#calDay button[data-reset]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(t("cal_reset_ask"))) return;
      const { error } = await sb.rpc("set_wo_due_date", { p_wo: b.dataset.reset, p_date: null });
      if (error) return toast(friendlyErr(error), "err");
      toast(t("saved"), "ok");
      await Cal.render();
    };
  });
};

// ---------- 互動 ----------
Cal.step = function (dir) {
  const c = Cal.cursor;
  if (Cal.mode === "day") Cal.cursor = calAdd(c, dir);
  else if (Cal.mode === "week") Cal.cursor = calAdd(c, dir * 7);
  else Cal.cursor = new Date(c.getFullYear(), c.getMonth() + dir, 1);
  Cal.render();
};

Cal.bind = function () {
  $("#btnCalPrev").onclick = () => Cal.step(-1);
  $("#btnCalNext").onclick = () => Cal.step(1);
  $("#btnCalToday").onclick = () => { Cal.cursor = calMidnight(new Date()); Cal.sel = calKey(Cal.cursor); Cal.render(); };
  $$("#calModes button").forEach((b) => {
    b.onclick = () => { Cal.mode = b.dataset.mode; Cal.render(); };
  });
  $("#calSrcMine").onchange = (e) => { Cal.srcMine = e.target.checked; Cal.render(); };
  $("#calSrcDue").onchange = (e) => { Cal.srcDue = e.target.checked; Cal.render(); };
  $$("#calGrid .cal-cell").forEach((b) => {
    b.onclick = () => { Cal.sel = b.dataset.d; Cal.paint(); };
  });
  $$("#calGrid .cal-col").forEach((col, i) => {
    const head = col.querySelector(".cal-colhead");
    if (head) head.onclick = () => { Cal.sel = calKey(calAdd(Cal.range().s, i)); Cal.paintDay(); };
  });
  Cal.bindDrag();
};

// 拖曳改期（主管限定）。手機拖不動 HTML5 DnD，所以下方明細另外給日期欄。
Cal.bindDrag = function () {
  if (!Cal.canMove()) return;
  $$("#calGrid [data-wo]").forEach((el) => {
    el.ondragstart = (e) => {
      Cal._drag = { wo: el.dataset.wo, type: el.dataset.type, from: el.dataset.from };
      el.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", el.dataset.wo); e.dataTransfer.effectAllowed = "move"; } catch (err) {}
    };
    el.ondragend = () => { el.classList.remove("dragging"); $$("#calGrid .drop-hot").forEach((x) => x.classList.remove("drop-hot")); };
  });
  $$("#calGrid [data-drop]").forEach((z) => {
    z.ondragover = (e) => { e.preventDefault(); z.classList.add("drop-hot"); };
    z.ondragleave = () => z.classList.remove("drop-hot");
    z.ondrop = (e) => {
      e.preventDefault();
      z.classList.remove("drop-hot");
      const d = Cal._drag; Cal._drag = null;
      if (!d) return;
      const to = z.dataset.drop;
      if (!to || to === d.from) return;              // 拖回原地就當沒事
      Cal.move(d.wo, d.type, to);
    };
  });
};
