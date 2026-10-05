// ============================================================
//  我的點數（總累積／已出貨依月份／未出貨）＋ 登入提醒：最近沒做好的事
//  資料來自 my_points / my_issues，由電腦排程每小時寫入（push_app_stats.mjs）
// ============================================================
window.MyStats = { month: "all" };

const msEsc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const msNum = (n) => Math.round(Number(n) || 0).toLocaleString();

// 看幾天內的缺失（今天不算；週一要看得到上週五，所以抓 4 天）
MyStats.POPUP_DAYS = 4;
MyStats.LIST_DAYS = 31;

MyStats.dayOffset = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmtDate(d); };

// ---------- 我的績效頁 ----------
MyStats.render = async function () {
  const box = $("#myPtsBox");
  if (!box || !App.ME) return;
  const [{ data: pts, error }, { data: iss }] = await Promise.all([
    sb.from("my_points").select("bucket,points,detail,synced_at").eq("employee_id", App.ME.id),
    sb.from("my_issues").select("*").eq("employee_id", App.ME.id)
      .gte("work_date", MyStats.dayOffset(MyStats.LIST_DAYS)).order("work_date", { ascending: false }),
  ]);
  if (error) { box.innerHTML = `<p class="muted">${t("ms_not_ready")}</p>`; $("#myIssueBox").innerHTML = ""; return; }

  const rows = pts || [];
  const unshipped = Number((rows.find((r) => r.bucket === "unshipped") || {}).points) || 0;
  const months = rows.filter((r) => r.bucket !== "unshipped").sort((a, b) => a.bucket.localeCompare(b.bucket));
  const shippedAll = months.reduce((s, r) => s + Number(r.points || 0), 0);
  if (MyStats.month !== "all" && !months.some((r) => r.bucket === MyStats.month)) MyStats.month = "all";
  const shownShip = MyStats.month === "all" ? shippedAll : Number(months.find((r) => r.bucket === MyStats.month).points) || 0;
  const synced = rows.reduce((m, r) => (r.synced_at > m ? r.synced_at : m), "");

  const chips = [["all", t("ms_all")], ...months.map((r) => [r.bucket, r.bucket.replace("-", "/")])]
    .map(([k, label]) => `<button class="chip ${MyStats.month === k ? "on" : ""}" data-m="${k}">${label}</button>`).join("");

  const shipRows = MyStats.month === "all" ? months : months.filter((r) => r.bucket === MyStats.month);
  const flowRow = rows.find((r) => r.bucket === "unshipped");
  const sumD = (list) => list.reduce((acc, r) => { const d = r.detail; if (d) Object.keys(d).forEach((k) => { if (k === "items") acc.items = (acc.items || []).concat(d.items || []); else acc[k] = (acc[k] || 0) + Number(d[k] || 0); }); return acc; }, {});
  box.innerHTML = `
    <div class="ms-total"><div class="lbl">${t("ms_total")}</div><div class="num">${msNum(shippedAll + unshipped)}</div></div>
    ${months.length ? `<div class="ms-chips"><span class="muted" style="align-self:center">${t("ms_ship_month")}</span>${chips}</div>` : ""}
    <div class="ms-cards">
      ${MyStats.cardHtml(t("ms_shipped"), shownShip, sumD(shipRows), "c2")}
      ${MyStats.cardHtml(t("ms_unshipped"), unshipped, sumD(flowRow ? [flowRow] : []), "c3")}
    </div>
    <p class="muted" style="margin:10px 0 0;font-size:13px">${t("ms_note")}${synced ? `　${t("ms_updated")} ${fmtDate(synced)} ${fmtTime(synced)}` : ""}</p>`;
  $$("#myPtsBox .chip").forEach((b) => { b.onclick = () => { MyStats.month = b.dataset.m; MyStats.render(); }; });

  // 近期缺失
  const list = iss || [];
  $("#myIssueBox").innerHTML = list.length
    ? MyStats.issueHtml(list)
    : `<p class="muted">${t("ms_no_issue")}</p>`;
};

// 原本預計 → 實領的帳（已出貨依所選月份、未出貨）
MyStats.LEDGER = [["orig", "ms_l_orig", ""], ["lossSelf", "ms_l_self", "-"], ["lossNight", "ms_l_night", "-"], ["lossRework", "ms_l_rework", "-"],
  ["lossTeam", "ms_l_team", "-"], ["lead", "ms_l_lead", "+"], ["adj", "ms_l_adj", "+"], ["real", "ms_l_real", "="]];
// 一張卡：大數字 + 自己的帳（原始 → 扣 → 加 → 實領）
MyStats.cardHtml = function (title, points, D, cls) {
  const items = D.items || [];
  const body = MyStats.LEDGER.filter(([k]) => k === "orig" || k === "real" || D[k]).map(([k, label, sign]) => {
    const v = Math.round(D[k] || 0);
    const c = k === "real" ? "ms-sum" : sign === "-" ? "ms-minus" : sign === "+" ? "ms-plus" : "";
    const shown = sign === "-" ? "－" + msNum(v) : sign === "+" ? "＋" + msNum(v) : msNum(v);
    const mine = items.filter((i) => i.k === (k.replace("loss", "").toLowerCase())).sort((x, y) => Math.abs(y.a) - Math.abs(x.a));
    if (!mine.length) return `<div class="ms-row ${c}"><span>${t(label)}</span><b>${shown}</b></div>`;
    const detail = mine.map((i) => `<div class="ms-item"><div><b>${msEsc(i.wo)}</b> ${msEsc(i.st)} <span class="muted">${msEsc(i.c)}</span></div>
      <div class="muted">${i.d ? msEsc(i.d) + "　" : ""}${msEsc(i.why)}</div><div class="ms-amt">${(sign === "-" ? -Math.abs(i.a) : i.a) > 0 ? "＋" : "－"}${msNum(Math.abs(i.a))}</div></div>`).join("");
    return `<div class="ms-row ${c} tap" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('hide')"><span>${t(label)} <small class="muted">${mine.length} ${t("ms_n")} ▾</small></span><b>${shown}</b></div><div class="ms-items hide">${detail}</div>`;
  }).join("");
  return `<div class="ms-card ${cls}"><div class="num">${msNum(points)}</div><div class="lbl">${title}</div>${D.orig || D.real ? `<div class="ms-rows">${body}</div><p class="muted" style="font-size:12px;margin:8px 0 0">${t("ms_tap")}</p>` : ""}</div>`;
};

// 缺失清單（依日期分組）
MyStats.issueHtml = function (list) {
  const byDay = {};
  list.forEach((r) => (byDay[r.work_date] = byDay[r.work_date] || []).push(r));
  return Object.keys(byDay).sort().reverse().map((d) => {
    const items = byDay[d].sort((a, b) => (a.kind === "完成度未填") - (b.kind === "完成度未填")).map((r) => {
      const soft = r.kind === "完成度未填";
      const where = [r.work_order_no, r.station, r.machine].filter(Boolean).map(msEsc).join(" · ");
      return `<div class="job-card ${soft ? "paused" : "over"}">
        <div class="job-head"><strong>${msEsc(MyStats.kindName(r.kind))}</strong><span class="badge ${soft ? "warn" : "err"}">${soft ? t("ms_remind") : t("ms_penalty")}</span></div>
        <div class="job-sub">${where}</div>
        <div class="job-sub">${msEsc(r.detail || "")}</div></div>`;
    }).join("");
    return `<h4 style="margin:12px 0 6px">${d} ${t("wd" + new Date(d + "T00:00:00").getDay())}</h4>${items}`;
  }).join("");
};

MyStats.kindName = (k) => ({
  "忘記按結束": t("ms_k_forgot"), "午休沒按暫停": t("ms_k_lunch"), "晚餐沒按暫停": t("ms_k_dinner"),
  "未完成報工": t("ms_k_unfinished"), "完成度未填": t("ms_k_progress"),
}[k] || k);

// ---------- 每天第一次登入：跳出最近沒做好的事 ----------
// 每筆缺失只提醒一次（記在這支瀏覽器裡），沒有新的就不打擾
MyStats.dailyPopup = async function () {
  try {
    if (!App.ME) return;
    const todayKey = "ms_popup_day_" + App.ME.id;
    const seenKey = "ms_seen_" + App.ME.id;
    if (localStorage.getItem(todayKey) === fmtDate(new Date())) return;
    const { data, error } = await sb.from("my_issues").select("*").eq("employee_id", App.ME.id)
      .gte("work_date", MyStats.dayOffset(MyStats.POPUP_DAYS)).order("work_date", { ascending: false });
    if (error) return;
    localStorage.setItem(todayKey, fmtDate(new Date()));
    const seen = new Set(JSON.parse(localStorage.getItem(seenKey) || "[]"));
    const fresh = (data || []).filter((r) => !seen.has(r.key));
    if (!fresh.length) return;
    $("#msPopupList").innerHTML = MyStats.issueHtml(fresh);
    $("#msPopup").classList.remove("hide");
    $("#btnMsClose").onclick = () => {
      $("#msPopup").classList.add("hide");
      const keep = [...seen, ...fresh.map((r) => r.key)].slice(-300);
      try { localStorage.setItem(seenKey, JSON.stringify(keep)); } catch (e) {}
    };
    $("#btnMsMore").onclick = () => { $("#btnMsClose").click(); App.go("score"); };
  } catch (e) { /* 提醒失敗不影響登入 */ }
};
