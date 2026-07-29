// ============================================================
//  績效：我的得分 + 團體（班組）排行
// ============================================================
window.Score = {};

function monthRange() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(); // 0-based
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 1);
  return { y, m: m + 1, startISO: start.toISOString(), endISO: end.toISOString() };
}

// ---- 我的得分（三層：生產 → 出貨 → 收款）----
//  ① 生產已得分：報工結束就算，score_log 狀態「有效」
//  ② 出貨已得分：該工單「最後一站」已完成 → 視同可出貨
//     （實測 468 張工單裡 460 張最後一站是品包；用「最後一站」而不是寫死品包，
//       才涵蓋得到結尾是組裝／噴砂的那 8 張）
//  ③ 收款已得分：待接收款資料，目前一律未達成
Score.renderMine = async function () {
  await Report.ensureStations();
  const { y, m, startISO, endISO } = monthRange();
  const { data, error } = await sb.from("score_log")
    .select("*")
    .eq("employee_id", App.ME.id)
    .gte("created_at", startISO).lt("created_at", endISO)
    .order("created_at", { ascending: false });
  if (error) return toast(t("err") + ": " + error.message, "err");

  const rows = data || [];
  const nos = [...new Set(rows.map((r) => r.work_order_no).filter(Boolean))];
  const shipped = await Score.shippedMap(nos);
  const woMap = Score.woMap || {};

  const todayStr = fmtDate(new Date());
  let made = 0, ship = 0, paid = 0, todaySum = 0;
  rows.forEach((r) => {
    if (r.status !== "有效") return;
    const v = Number(r.score);
    made += v;
    if (shipped[r.work_order_no]) ship += v;
    if (fmtDate(r.created_at) === todayStr) todaySum += v;
  });

  $("#myToday").textContent = todaySum.toFixed(2);
  $("#myMade").textContent = made.toFixed(2);
  $("#myShipped").textContent = ship.toFixed(2);
  $("#myPaid").textContent = paid.toFixed(2);
  $("#myMonthLabel").textContent = `${y}/${String(m).padStart(2, "0")}`;
  $("#tierNote").innerHTML = t("tier_note");

  const stMap = {};
  (Report.stations || []).forEach((s) => (stMap[s.code] = s));

  if (rows.length === 0) {
    $("#myScoreTable").innerHTML = `<p class="muted">${t("no_data")}</p>`;
    return;
  }
  const head = `<tr><th>${t("date")}</th><th>${t("wo_no")}</th><th>${t("customer")}</th><th>${t("product")}</th>
    <th>${t("station")}</th><th class="r">${t("score")}</th><th>${t("status")}</th></tr>`;
  const body = rows.map((r) => {
    const st = stMap[r.station];
    const stName = st ? stationName(st) : r.station;
    const w = woMap[r.work_order_no] || {};
    return `<tr><td>${fmtDate(r.created_at)}</td><td>${r.work_order_no}</td>
      <td>${w.customer || ""}</td><td>${r.product_name || w.product_name || ""}</td>
      <td>${stName}</td><td class="r">${Number(r.score).toFixed(2)}</td>
      <td>${Score.tierBadge(r, shipped[r.work_order_no])}</td></tr>`;
  }).join("");
  $("#myScoreTable").innerHTML = `<table>${head}${body}</table>`;
};

// 每張工單是否已「出貨」＝最後一站做滿數量（沒有總數量時，該站有完成紀錄就算）
Score.shippedMap = async function (nos) {
  Score.woMap = {};
  if (!nos.length) return {};
  const [{ data: wos }, { data: routes }, { data: jobs }] = await Promise.all([
    sb.from("work_orders").select("*").in("work_order_no", nos),
    sb.from("work_order_routes").select("work_order_no,seq,station").in("work_order_no", nos),
    sb.from("jobs").select("work_order_no,station,qty,end_at,status").eq("status", "done").in("work_order_no", nos),
  ]);
  (wos || []).forEach((w) => (Score.woMap[w.work_order_no] = w));

  const lastOf = {};
  (routes || []).forEach((r) => {
    const cur = lastOf[r.work_order_no];
    if (!cur || Number(r.seq) > Number(cur.seq)) lastOf[r.work_order_no] = r;
  });
  const doneQty = {}, doneAt = {};
  (jobs || []).forEach((j) => {
    const k = j.work_order_no + "|" + j.station;
    doneQty[k] = (doneQty[k] || 0) + (Number(j.qty) || 0);
    if (!doneAt[k] || new Date(j.end_at) > new Date(doneAt[k])) doneAt[k] = j.end_at;
  });

  const out = {};
  nos.forEach((no) => {
    const last = lastOf[no];
    if (!last) return;
    const k = no + "|" + last.station;
    if (!(k in doneQty)) return;                       // 最後一站還沒人報工
    const total = Number((Score.woMap[no] || {}).qty);
    const ok = (isFinite(total) && total > 0) ? doneQty[k] >= total : true;
    if (ok) out[no] = { at: doneAt[k], station: last.station };
  });
  return out;
};

Score.tierBadge = function (r, ship) {
  if (r.status !== "有效") return Score.statusBadge(r.status);
  if (ship) {
    return `<span class="badge go">② ${t("tier_shipped_s")}</span>` +
      (ship.at ? ` <small class="muted">${fmtDate(ship.at)}</small>` : "");
  }
  return `<span class="badge warn">① ${t("tier_made_s")}</span>`;
};

Score.statusBadge = function (s) {
  const map = { "有效": ["go", "valid"], "待設定": ["warn", "pending"], "重複": ["err", "duplicate"], "已轉移": ["mute", "transferred"] };
  const m = map[s] || ["mute", "no_data"];
  return `<span class="badge ${m[0]}">${t(m[1])}</span>`;
};

// ---- 團體排行（今日 + 本月，標出自己的班組）----
Score.renderTeam = async function () {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const y = now.getFullYear(), m = now.getMonth() + 1;
  const today = `${y}-${p(m)}-${p(now.getDate())}`;
  const myTeam = App.ME.team;

  // 自己班組橫幅
  $("#myTeamBanner").innerHTML = myTeam
    ? `<div style="font-size:14px;color:var(--muted)">${t("your_team")}</div>
       <div style="font-size:28px;font-weight:800;color:var(--primary)">${myTeam}</div>`
    : `<div class="muted">${t("your_team")}: -</div>`;

  const { data, error } = await sb.rpc("team_scores", { p_year: y, p_month: m, p_today: today });
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];
  if (rows.length === 0) {
    $("#teamTable").innerHTML = `<p class="muted">${t("no_data")}</p>`;
    return;
  }
  const head = `<tr><th>${t("team")}</th><th class="r">${t("today_score")}</th><th class="r">${t("month_score")}</th></tr>`;
  const body = rows.map((r) => {
    const mine = r.team === myTeam;
    return `<tr class="${mine ? "me-row" : ""}">
      <td>${r.team}${mine ? " ◀" : ""}</td>
      <td class="r">${Number(r.today).toFixed(2)}</td>
      <td class="r">${Number(r.month).toFixed(2)}</td></tr>`;
  }).join("");
  $("#teamTable").innerHTML = `<table>${head}${body}</table>`;
};
