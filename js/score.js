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

// ---- 我的得分 ----
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
  const todayStr = fmtDate(new Date());
  let monthSum = 0, todaySum = 0;
  rows.forEach((r) => {
    if (r.status === "有效") {
      monthSum += Number(r.score);
      if (fmtDate(r.created_at) === todayStr) todaySum += Number(r.score);
    }
  });

  $("#myToday").textContent = todaySum.toFixed(2);
  $("#myMonth").textContent = monthSum.toFixed(2);
  $("#myMonthLabel").textContent = `${y}/${String(m).padStart(2, "0")}`;

  const stMap = {};
  (Report.stations || []).forEach((s) => (stMap[s.code] = s));

  if (rows.length === 0) {
    $("#myScoreTable").innerHTML = `<p class="muted">${t("no_data")}</p>`;
    return;
  }
  const head = `<tr><th>${t("date")}</th><th>${t("wo_no")}</th><th>${t("station")}</th>
    <th class="r">${t("score")}</th><th>${t("status")}</th></tr>`;
  const body = rows.map((r) => {
    const st = stMap[r.station];
    const stName = st ? stationName(st) : r.station;
    const badge = Score.statusBadge(r.status);
    return `<tr><td>${fmtDate(r.created_at)}</td><td>${r.work_order_no}</td>
      <td>${stName}</td><td class="r">${Number(r.score).toFixed(2)}</td><td>${badge}</td></tr>`;
  }).join("");
  $("#myScoreTable").innerHTML = `<table>${head}${body}</table>`;
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
