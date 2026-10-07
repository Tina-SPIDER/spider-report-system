// ============================================================
//  主管看板：把電腦每小時算好的「報工點數統整」頁放進來（只有主管讀得到）
// ============================================================
window.Board = {};

Board.render = async function () {
  const box = $("#boardBox");
  if (!box || !App.ME) return;
  box.innerHTML = '<p class="muted">…</p>';
  const { data, error } = await sb.from("board_snapshot").select("html,updated_at").eq("id", "meeting").maybeSingle();
  if (error || !data) { box.innerHTML = '<p class="muted">' + t("bd_none") + '</p>'; return; }
  // APP 本身是深色，看板也固定用深色
  const html = String(data.html).replace("@media(prefers-color-scheme:dark)", "@media all");
  box.innerHTML = '<iframe id="boardFrame" title="board" sandbox="allow-scripts" srcdoc=""></iframe>';
  $("#boardFrame").srcdoc = html;
  $("#boardStamp").textContent = t("bd_stamp") + " " + fmtDate(data.updated_at) + " " + fmtTime(data.updated_at);
};
