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

// ---- 我的得分：新版（總累積／已出貨分月／未出貨＋缺失）在 mystats.js ----
Score.renderMine = function () { if (window.MyStats) return MyStats.render(); };

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
