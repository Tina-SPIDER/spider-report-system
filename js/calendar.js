// ============================================================
//  行事曆：看自己每天被排了幾張工單
//  資料來源 assignments.due_date（主管在「工單指派」設的製作日期）
// ============================================================
window.Cal = { ym: null, sel: null, byDay: {}, noDate: [] };

const calEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const calKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

Cal.render = async function () {
  if (!App.ME) return;
  if (!Cal.ym) { const n = new Date(); Cal.ym = { y: n.getFullYear(), m: n.getMonth() }; }
  await Cal.load();
  Cal.paint();
};

Cal.load = async function () {
  const { data, error } = await sb.from("assignments")
    .select("work_order_no,station,due_date")
    .eq("employee_id", App.ME.id);
  if (error) { Cal.byDay = {}; Cal.noDate = []; return; }
  const list = data || [];

  const nos = [...new Set(list.map((a) => a.work_order_no))];
  let wMap = {}, qtyMap = {};
  if (nos.length) {
    // 完成顆數要看所有人的報工（一批貨可能兩個人接力做完）
    const [{ data: wos }, { data: done }] = await Promise.all([
      sb.from("work_orders").select("*").in("work_order_no", nos),
      sb.from("jobs").select("work_order_no,station,qty,status").eq("status", "done").in("work_order_no", nos),
    ]);
    (wos || []).forEach((w) => (wMap[w.work_order_no] = w));
    (done || []).forEach((j) => {
      const k = j.work_order_no + "|" + j.station;
      qtyMap[k] = (qtyMap[k] || 0) + (Number(j.qty) || 0);
    });
  }

  Cal.byDay = {}; Cal.noDate = [];
  list.forEach((a) => {
    const w = wMap[a.work_order_no] || {};
    const total = Number(w.qty);
    const hasTotal = isFinite(total) && total > 0;
    const doneQty = a.station ? (qtyMap[a.work_order_no + "|" + a.station] || 0) : 0;
    const item = {
      ...a, customer: w.customer, product_name: w.product_name,
      doneQty, total: hasTotal ? total : null,
      finished: !!(a.station && hasTotal && doneQty >= total),
    };
    if (!a.due_date) Cal.noDate.push(item);
    else (Cal.byDay[a.due_date] = Cal.byDay[a.due_date] || []).push(item);
  });
};

// 週日起算的那一週
Cal.weekRange = function (base) {
  const s = new Date(base); s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  const e = new Date(s); e.setDate(e.getDate() + 6);
  return { s, e };
};

Cal.countBetween = function (s, e) {
  let all = 0, undone = 0;
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    (Cal.byDay[calKey(d)] || []).forEach((it) => { all++; if (!it.finished) undone++; });
  }
  return { all, undone };
};

Cal.paint = function () {
  const { y, m } = Cal.ym;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = calKey(today);

  // 本週／下週合計
  const wk = Cal.weekRange(today);
  const nextS = new Date(wk.s); nextS.setDate(nextS.getDate() + 7);
  const nextE = new Date(wk.e); nextE.setDate(nextE.getDate() + 7);
  const cThis = Cal.countBetween(wk.s, wk.e), cNext = Cal.countBetween(nextS, nextE);
  $("#calSummary").innerHTML = `
    <div class="stat"><div class="num">${cThis.all}</div><div class="lbl">${t("cal_this_week")}</div></div>
    <div class="stat"><div class="num">${cThis.undone}</div><div class="lbl">${t("cal_this_week_undone")}</div></div>
    <div class="stat"><div class="num">${cNext.all}</div><div class="lbl">${t("cal_next_week")}</div></div>
    <div class="stat"><div class="num">${Cal.noDate.length}</div><div class="lbl">${t("cal_no_date")}</div></div>`;

  $("#calTitle").textContent = t("cal_ym", { y, m: String(m + 1).padStart(2, "0") });

  // 月曆格：從當月 1 號往前補到週日
  const first = new Date(y, m, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = calKey(d);
    const items = Cal.byDay[key] || [];
    const undone = items.filter((x) => !x.finished).length;
    const other = d.getMonth() !== m;
    const isToday = key === todayKey;
    const inWeek = d >= wk.s && d <= wk.e;
    const badge = items.length
      ? `<span class="cal-n ${undone ? (d < today ? "over" : "todo") : "done"}">${items.length}</span>` : "";
    cells.push(`<button class="cal-cell${other ? " other" : ""}${isToday ? " today" : ""}${inWeek ? " inweek" : ""}${Cal.sel === key ? " sel" : ""}"
      data-d="${key}"><span class="cal-d">${d.getDate()}</span>${badge}</button>`);
    if (i >= 34 && d.getMonth() !== m && d.getDay() === 6) break;   // 最後一週已跨月就不再多畫
  }
  const wd = [0, 1, 2, 3, 4, 5, 6].map((i) => `<div class="cal-wd">${t("wd" + i)}</div>`).join("");
  $("#calGrid").innerHTML = `<div class="cal-head">${wd}</div><div class="cal-body">${cells.join("")}</div>`;

  $$("#calGrid .cal-cell").forEach((b) => {
    b.onclick = () => { Cal.sel = b.dataset.d; Cal.paint(); };
  });
  $("#btnCalPrev").onclick = () => { Cal.ym = { y: m === 0 ? y - 1 : y, m: m === 0 ? 11 : m - 1 }; Cal.paint(); };
  $("#btnCalNext").onclick = () => { Cal.ym = { y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 }; Cal.paint(); };
  $("#btnCalToday").onclick = () => {
    const n = new Date();
    Cal.ym = { y: n.getFullYear(), m: n.getMonth() };
    Cal.sel = calKey(n);
    Cal.paint();
  };

  Cal.paintDay();
};

Cal.paintDay = function () {
  const box = $("#calDay");
  const key = Cal.sel;
  if (!key) {
    const n = Cal.noDate.length
      ? `<p class="muted">${t("cal_no_date_n", { n: Cal.noDate.length })}</p>` : "";
    box.innerHTML = `<p class="muted">${t("cal_pick_day")}</p>${n}`;
    return;
  }
  const items = Cal.byDay[key] || [];
  const head = `<h4 style="margin:0 0 10px">${key}　<span class="muted" style="font-size:15px">${t("cal_n_wo", { n: items.length })}</span></h4>`;
  if (!items.length) { box.innerHTML = head + `<p class="muted">${t("cal_day_empty")}</p>`; return; }

  box.innerHTML = head + items.map((a) => {
    const stTag = a.station ? ` · 🔧 ${calEsc(a.station)}` : "";
    let qtyTag = "";
    if (a.station) {
      if (a.total) {
        qtyTag = a.finished
          ? `<span class="badge go">✓ ${t("st_all_done", { n: a.doneQty, t: a.total })}</span>`
          : `<span class="badge ${a.doneQty > 0 ? "warn" : "mute"}">${t("st_of_total", { n: a.doneQty, t: a.total, r: a.total - a.doneQty })}</span>`;
      } else if (a.doneQty > 0) {
        qtyTag = `<span class="badge warn">${t("st_done_n", { n: a.doneQty })}</span>`;
      }
    }
    return `<div class="job-card${a.finished ? " home-done" : ""}" style="border-left-color:${a.finished ? "var(--muted)" : "var(--c1)"}">
      <div class="job-head"><strong>${calEsc(a.work_order_no)}</strong>
        <button class="btn small ${a.finished ? "ghost" : "primary"}" data-wo="${calEsc(a.work_order_no)}" data-st="${calEsc(a.station || "")}">${t("act_report")}</button></div>
      <div class="job-sub">${calEsc(a.customer || "")} ${calEsc(a.product_name || "")}${stTag}</div>
      ${qtyTag ? `<div class="job-sub">${qtyTag}</div>` : ""}</div>`;
  }).join("");

  $$("#calDay button[data-wo]").forEach((b) => {
    b.onclick = () => {
      Report._pendingWo = { wo: b.dataset.wo, st: b.dataset.st };
      App.go("report");
    };
  });
};
