// ============================================================
//  主管看板：把電腦每小時算好的「報工點數統整」頁放進來（只有主管讀得到）
//  圖表程式（Chart.js）放在網站自己的 js/vendor 裡，不從外部網站載入。
// ============================================================
window.Board = {};

Board.render = async function () {
  const box = $("#boardBox");
  if (!box || !App.ME) return;
  box.innerHTML = '<p class="muted">…</p>';
  const { data, error } = await sb.from("board_snapshot").select("html,updated_at").eq("id", "meeting").maybeSingle();
  if (error || !data) { box.innerHTML = '<p class="muted">' + t("bd_none") + '</p>'; return; }
  // APP 本身是深色，看板也固定用深色；圖表程式改用自己網站上的那份
  const chartUrl = location.origin + "/js/vendor/chart.umd.min.js?v=101";
  const html = String(data.html)
    .replace("@media(prefers-color-scheme:dark)", "@media all")
    .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/[\d.]+\/chart\.umd\.min\.js/, chartUrl);
  box.innerHTML = '<iframe id="boardFrame" title="board" sandbox="allow-scripts allow-same-origin"></iframe>';
  const fr = $("#boardFrame");
  fr.srcdoc = html;
  const when = fmtDate(data.updated_at) + " " + fmtTime(data.updated_at);
  // 另開新視窗（框框顯示有問題時的備用）
  Board._url && URL.revokeObjectURL(Board._url);
  Board._url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  $("#boardStamp").innerHTML = t("bd_stamp") + " " + when + '　<a href="' + Board._url + '" target="_blank" rel="noopener">' + t("bd_newtab") + '</a>';
};
