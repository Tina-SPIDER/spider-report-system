// ============================================================
//  申訴處理（只有主管）：員工在「我的績效」送出的申訴／補正，在這裡通過或駁回
//  通過後，電腦每小時重算點數時會自動套用：
//    補正（填實際結束時間）→ 這一筆改成該時間結束，工時重算，違規自動解除（若不再違規）
//    申訴「我其實有按」    → 這一筆不算違規
//    同單連坐／其他        → 主管可另外填「補點數」，會加到那位員工那一站
//  資料表：appeals（supabase/_live_v103_appeals.sql）
// ============================================================
window.Appeals = { tab: "pending" };
Object.assign(window.I18N.zh, { nav_appeals: "申訴處理" });
Object.assign(window.I18N.vi, { nav_appeals: "Xử lý khiếu nại" });

Appeals.KIND = { fix: "補正：忘記按結束／暫停（員工填了實際時間）", deny: "申訴：我其實有按，不是違規", team: "申訴：同單連坐不合理", other: "其他" };

Appeals.render = async function () {
  const box = document.getElementById("appealsBox");
  if (!box || !App.ME || App.ME.role !== "主管") return;
  box.innerHTML = '<p class="muted">…</p>';
  const { data, error } = await sb.from("appeals").select("*, emp:employees!appeals_employee_id_fkey(name,team)").order("created_at", { ascending: false }).limit(200);
  if (error) { box.innerHTML = '<p class="muted">申訴功能還沒啟用（Supabase 要先跑 _live_v103_appeals.sql）。</p>'; return; }
  const all = data || [], pend = all.filter((r) => r.status === "待處理"), done = all.filter((r) => r.status !== "待處理");
  const esc = msEsc, cur = Appeals.tab === "pending" ? pend : done;
  const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso), p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); };
  const card = (r) => {
    const who = r.emp ? r.emp.name + "（" + (r.emp.team || "") + "）" : "?";
    const st = r.status === "待處理" ? ["#3a3217", "#f0b24d"] : r.status === "已通過" ? ["#12382a", "#3ccf93"] : ["#3a1e24", "#ff7a87"];
    const where = [r.work_order_no, r.station, r.work_date].filter(Boolean).map(esc).join(" · ");
    const pending = r.status === "待處理";
    const warn = r.kind === "fix" && !r.job_id ? '<div style="color:#f0b24d;font-size:12px;margin-top:4px">⚠ 這筆不是從「最近缺失」送出的，系統找不到對應的報工，無法自動改時間。通過時請在「補點數」填要補的點數，或駁回請員工從缺失那筆重送。</div>' : "";
    return `<div class="card" style="margin-bottom:10px" data-id="${r.id}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${esc(who)}</b><span style="background:${st[0]};color:${st[1]};border-radius:99px;padding:2px 10px;font-size:12px">${esc(r.status)}</span></div>
      <div style="margin-top:4px"><b>${esc(r.item)}</b></div>
      <div class="muted" style="font-size:12px">${esc(Appeals.KIND[r.kind] || r.kind)}　${where ? where + "　" : ""}${esc(fmtDate(r.created_at))} ${esc(fmtTime(r.created_at))}</div>
      ${r.actual_end ? `<div style="font-size:13px;margin-top:4px">員工說的實際時間：<b>${esc(toLocal(r.actual_end).replace("T", " "))}</b></div>` : ""}
      <div style="margin-top:6px;background:rgba(127,127,127,.12);border-radius:8px;padding:8px 10px;font-size:14px">${esc(r.note)}</div>${warn}
      ${pending ? `<div style="display:grid;gap:8px;margin-top:10px">
        ${r.kind === "fix" ? `<label style="font-size:12px" class="muted">通過時採用的實際結束時間（可以改）<input type="datetime-local" class="ap-end" value="${toLocal(r.actual_end)}" style="width:100%;margin-top:3px"></label>` : ""}
        <label style="font-size:12px" class="muted">另外補點數（可空，例：25）<input type="number" class="ap-adj" step="1" placeholder="0" style="width:100%;margin-top:3px"></label>
        <label style="font-size:12px" class="muted">處理說明（駁回一定要寫原因）<input type="text" class="ap-note" style="width:100%;margin-top:3px"></label>
        <div style="display:flex;gap:10px"><button class="btn primary ap-ok" style="flex:1">通過</button><button class="btn ghost ap-no" style="flex:1">駁回</button></div></div>`
      : `<div style="margin-top:8px;font-size:13px">${r.manager_note ? "主管說明：" + esc(r.manager_note) : ""}${Number(r.adj_points) ? "　補點數：＋" + esc(r.adj_points) : ""}${r.decided_at ? '<span class="muted">　' + esc(fmtDate(r.decided_at)) + "</span>" : ""}</div>`}
    </div>`;
  };
  box.innerHTML = `<div class="ms-chips" style="margin-bottom:10px"><button class="chip ${Appeals.tab === "pending" ? "on" : ""}" data-t="pending">待處理（${pend.length}）</button><button class="chip ${Appeals.tab === "done" ? "on" : ""}" data-t="done">已處理（${done.length}）</button></div>
    <p class="muted" style="font-size:12px;margin:0 0 10px">通過後，電腦每小時重算點數時會自動套用（最慢 1 小時後員工的點數就會更新）。</p>
    ${cur.length ? cur.map(card).join("") : '<p class="muted">目前沒有' + (Appeals.tab === "pending" ? "待處理的" : "已處理的") + "申訴。</p>"}`;
  box.querySelectorAll("[data-t]").forEach((b) => { b.onclick = () => { Appeals.tab = b.dataset.t; Appeals.render(); }; });
  box.querySelectorAll(".card[data-id]").forEach((c) => {
    const decide = async (status) => {
      const note = c.querySelector(".ap-note").value.trim();
      if (status === "已駁回" && !note) { c.querySelector(".ap-note").focus(); toast("駁回請寫原因", "err"); return; }
      const adj = c.querySelector(".ap-adj").value;
      const endEl = c.querySelector(".ap-end"), endV = endEl && endEl.value ? new Date(endEl.value).toISOString() : null;
      const { error: e2 } = await sb.rpc("decide_appeal", { p_id: c.dataset.id, p_status: status, p_note: note || null, p_adj: adj === "" ? null : Number(adj), p_end: status === "已通過" ? endV : null });
      if (e2) { toast("失敗：" + (e2.message || e2), "err"); return; }
      toast("已" + (status === "已通過" ? "通過" : "駁回"), "ok"); Appeals.render();
    };
    const ok = c.querySelector(".ap-ok"), no = c.querySelector(".ap-no");
    if (ok) ok.onclick = () => decide("已通過");
    if (no) no.onclick = () => decide("已駁回");
  });
};
