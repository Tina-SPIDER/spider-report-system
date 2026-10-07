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
  try { MyStats.decorate(box, rows, iss || []); } catch (e) { console.warn("MyStats.decorate", e); }   // 新圖表（評分／折線／圓餅／缺失週）

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

// ============================================================
//  我的績效：新圖表（右上角評分／每月點數折線／扣點圓餅（點了看哪幾張工單）／近 4 週缺失（點了看問題））
//  只用 my_points／my_issues 現有資料；樣式與中、越文字都放在這支檔案裡
// ============================================================
MyStats.TX = {
  zh: {
    score: "我的評分", rate: "點數達成率", rate_eq: "＝照工時實際拿到的 ÷ 照工時本來可拿",
    rate_note: "不含隊長加給和主管調整，所以最高 100%", stars_hint: "★5：95% 以上　★4：85%　★3：70%　★2：50%　★1：50% 以下",
    m_title: "每月點數", m_sub: "實線＝已出貨、真的領到的；虛線＝還沒出貨、累積中的預估（出貨後才發）",
    m_ship: "{m}月出貨", m_flow: "累積中（預估）", m_got: "已領到（出貨）", m_acc: "累積中（預估）",
    p_title: "我的點數是被什麼扣掉的", p_sub: "你照工時本來可拿 {o} 點，被扣掉 {c} 點。點每一項，會列出是哪幾張工單", p_none: "目前沒有被扣點，繼續保持 👍",
    p_total: "一共少了", p_unit: "點", p_tap: "點我看是哪幾張工單 ▾", p_list: "「{k}」是這幾張工單（共 {n} 筆）：",
    p_mine: "其中「自己的失誤」{a} 點是你可以自己避免的；「同事連帶」{b} 點是別人造成的，請互相提醒。",
    k_team: "同單同事違規 ×0.7", k_rework: "重工",
    e_team: "別人的失誤：同一張工單有同事違規，你在這幾張單的點數被打 7 折（{n} 張單）", e_rework: "做壞重做：做壞那輪 0 點、重工那輪打 7 折（{n} 張單）",
    e_lunch: "你自己中午 12:00～13:00 沒按暫停，那一站點數歸零（{n} 站）", e_dinner: "你自己晚餐 18:00～18:30 沒按暫停，那一站點數歸零（{n} 站）", e_both: "你自己午休、晚餐都沒按暫停，那一站點數歸零（{n} 站）",
    e_forgot: "做完或下班沒按結束（或超過 21:00 才按），那一站點數歸零（{n} 站）", e_self: "你自己的失誤，那一站點數歸零（{n} 站）",
    w_title: "近 4 週的缺失次數", w_sub: "點任何一週，下面會列出那週是什麼問題", w_times: "{n} 次", w_none: "✅ {l} 這週沒有缺失 🎉", w_head: "{l} 的缺失（{n} 次）",
    w_streak: "🎉 最近連續 {n} 週沒有缺失，繼續保持！", w_better: "👍 這週比上週少，進步中", w_worse: "⚠️ 這週比上週多，下週加油", w_same: "持平，再努力一點",
  },
  vi: {
    score: "Điểm đánh giá của tôi", rate: "Tỷ lệ đạt điểm", rate_eq: "= điểm thực nhận theo giờ làm ÷ điểm lẽ ra nhận theo giờ làm",
    rate_note: "Không gồm phụ cấp đội trưởng và điều chỉnh của quản lý nên tối đa 100%", stars_hint: "★5: từ 95%　★4: 85%　★3: 70%　★2: 50%　★1: dưới 50%",
    m_title: "Điểm theo tháng", m_sub: "Nét liền = đã xuất hàng, đã nhận thật; nét đứt = chưa xuất hàng, đang tích lũy (ước tính, xuất hàng xong mới phát)",
    m_ship: "Xuất hàng T{m}", m_flow: "Đang tích lũy (ước tính)", m_got: "Đã nhận (đã xuất hàng)", m_acc: "Đang tích lũy (ước tính)",
    p_title: "Điểm của tôi bị trừ vì sao", p_sub: "Theo giờ làm bạn lẽ ra nhận {o} điểm, bị trừ {c} điểm. Bấm từng mục để xem các lệnh sản xuất", p_none: "Hiện chưa bị trừ điểm, hãy giữ vững 👍",
    p_total: "Tổng bị trừ", p_unit: "điểm", p_tap: "Bấm để xem các lệnh sản xuất ▾", p_list: "「{k}」gồm các lệnh sản xuất sau ({n} mục):",
    p_mine: "Trong đó {a} điểm là lỗi của chính bạn, bạn có thể tránh; {b} điểm là do đồng nghiệp gây ra, hãy nhắc nhau.",
    k_team: "Đồng nghiệp cùng đơn vi phạm ×0.7", k_rework: "Làm lại",
    e_team: "Lỗi của người khác: cùng một lệnh có đồng nghiệp vi phạm, điểm của bạn ở các lệnh này bị giảm 30% ({n} lệnh)", e_rework: "Làm hỏng phải làm lại: lần hỏng 0 điểm, lần làm lại giảm 30% ({n} lệnh)",
    e_lunch: "Bạn không bấm tạm dừng giờ nghỉ trưa 12:00～13:00, công đoạn đó 0 điểm ({n} công đoạn)", e_dinner: "Bạn không bấm tạm dừng giờ ăn tối 18:00～18:30, công đoạn đó 0 điểm ({n} công đoạn)", e_both: "Bạn không bấm tạm dừng cả giờ nghỉ trưa và giờ ăn tối, công đoạn đó 0 điểm ({n} công đoạn)",
    e_forgot: "Làm xong hoặc tan ca mà không bấm kết thúc (hoặc bấm sau 21:00), công đoạn đó 0 điểm ({n} công đoạn)", e_self: "Lỗi của chính bạn, công đoạn đó 0 điểm ({n} công đoạn)",
    w_title: "Số lần thiếu sót 4 tuần gần đây", w_sub: "Bấm vào một tuần để xem là vấn đề gì", w_times: "{n} lần", w_none: "✅ {l} tuần này không có thiếu sót 🎉", w_head: "Thiếu sót của {l} ({n} lần)",
    w_streak: "🎉 Đã {n} tuần liên tiếp không có thiếu sót, hãy giữ vững!", w_better: "👍 Tuần này ít hơn tuần trước, đang tiến bộ", w_worse: "⚠️ Tuần này nhiều hơn tuần trước, tuần sau cố gắng nhé", w_same: "Không đổi, cố gắng thêm chút nữa",
  },
};
const mt = (k, v) => {
  const d = MyStats.TX[window.LANG] || MyStats.TX.zh;
  let s = d[k] != null ? d[k] : (MyStats.TX.zh[k] != null ? MyStats.TX.zh[k] : k);
  if (v) for (const x in v) s = s.split("{" + x + "}").join(v[x]);
  return s;
};

MyStats.injectCss = function () {
  if (document.getElementById("msChartCss")) return;
  const st = document.createElement("style"); st.id = "msChartCss";
  st.textContent = `
  #myPtsBox{position:relative}
  .ms-score{display:flex;justify-content:flex-end;margin:0 0 6px;position:relative}
  .ms-score button{background:rgba(127,127,127,.14);border:1px solid rgba(127,127,127,.35);border-radius:12px;padding:8px 18px;color:inherit;cursor:pointer;text-align:center;line-height:1.3;font:inherit}
  .ms-score .l{display:block;font-size:12px;opacity:.7}.ms-score .st{color:#f0b24d;font-size:24px;letter-spacing:2px}.ms-score .pc{font-size:26px;font-weight:800;margin-left:6px}
  .ms-pop{position:absolute;right:0;top:100%;margin-top:6px;z-index:20;width:290px;max-width:88vw;background:#182030;color:#e8edf5;border:1px solid #2a3649;border-radius:12px;padding:12px;font-size:12px;line-height:1.6;box-shadow:0 8px 24px rgba(0,0,0,.5);text-align:left}
  .ms-ch{display:grid;grid-template-columns:1fr;gap:16px;margin-top:18px}
  @media(min-width:900px){.ms-ch{grid-template-columns:repeat(2,minmax(0,1fr))}}
  .ms-cx{background:rgba(127,127,127,.10);border:1px solid rgba(127,127,127,.28);border-radius:14px;padding:14px 16px;min-width:0}
  .ms-cx h4{margin:0 0 2px;font-size:16px}.ms-cx .sb{margin:0 0 10px;font-size:12px;opacity:.7;line-height:1.5}
  .ms-catr{margin:0 0 8px;padding:6px 8px;border-radius:10px;cursor:pointer}.ms-catr:hover,.ms-catr.sel{background:rgba(127,127,127,.2)}
  .ms-wk{cursor:pointer;border-radius:10px;padding:4px 2px}.ms-wk:hover,.ms-wk.sel{background:rgba(127,127,127,.2);outline:1px solid rgba(127,127,127,.4)}
  .ms-itm{border-left:5px solid #ff7a87;background:rgba(127,127,127,.14);border-radius:10px;padding:9px 12px;margin:6px 0}
  .ms-det>summary{cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:17px}.ms-det>summary::-webkit-details-marker{display:none}
  .ms-det>summary:after{content:"▾";opacity:.6}.ms-det[open]>summary:after{content:"▴"}`;
  document.head.appendChild(st);
};

MyStats.decorate = function (box, rows, issues) {
  MyStats.injectCss();
  const E = msEsc, N = msNum;
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const det = (r) => r.detail || {};
  const orig = sum(rows, (r) => Number(det(r).orig) || 0), real = sum(rows, (r) => Number(det(r).real) || 0);
  const lead = sum(rows, (r) => Number(det(r).lead) || 0), adj = sum(rows, (r) => Number(det(r).adj) || 0);
  const workReal = real - lead - adj, rate = orig ? Math.min(1, Math.max(0, workReal / orig)) : 0;
  const stars = rate >= 0.95 ? 5 : rate >= 0.85 ? 4 : rate >= 0.7 ? 3 : rate >= 0.5 ? 2 : 1;
  const rcol = rate >= 0.85 ? "#3ccf93" : rate >= 0.7 ? "#f0b24d" : "#ff7a87";

  // ① 右上角評分
  const score = orig ? `<div class="ms-score"><button type="button" id="msScBtn"><span class="l">${mt("score")}</span><span class="st">${"★".repeat(stars)}<span style="opacity:.25">${"★".repeat(5 - stars)}</span></span><span class="pc" style="color:${rcol}">${Math.round(rate * 100)}%</span></button>
    <div class="ms-pop hide" id="msScPop"><b style="font-size:13px">${mt("rate")} ${Math.round(rate * 100)}%</b><br>${mt("rate_eq")}（${N(workReal)} ÷ ${N(orig)}）<br>${mt("rate_note")}<br>${mt("stars_hint")}</div></div>` : "";

  // ② 每月點數折線
  const shipped = rows.filter((r) => r.bucket !== "unshipped").sort((a, b) => a.bucket.localeCompare(b.bucket));
  const flowRow = rows.find((r) => r.bucket === "unshipped");
  const pts = [...shipped.map((r) => ({ l: mt("m_ship", { m: Number(r.bucket.slice(5)) }), v: Number(r.points) || 0, est: false })), { l: mt("m_flow"), v: Number(flowRow && flowRow.points) || 0, est: true }];
  const LW = 420, LH = 190, lx = (i) => 40 + i * (LW - 80) / Math.max(1, pts.length - 1), lmx = Math.max(1, ...pts.map((p) => p.v)) * 1.18, ly = (v) => LH - 38 - (v / lmx) * (LH - 70);
  const solid = pts.filter((p) => !p.est), sp = solid.map((p, i) => (i ? "L" : "M") + lx(i).toFixed(1) + " " + ly(p.v).toFixed(1)).join(" "), lastS = solid.length - 1;
  const gotSum = sum(solid, (p) => p.v), flowV = pts[pts.length - 1].v;
  const line = `<div class="ms-cx"><h4>${mt("m_title")}</h4><p class="sb">${mt("m_sub")}</p>
    <svg viewBox="0 0 ${LW} ${LH}" width="100%"><defs><linearGradient id="msLg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3ccf93" stop-opacity=".35"/><stop offset="1" stop-color="#3ccf93" stop-opacity="0"/></linearGradient></defs>
    ${[0, 0.5, 1].map((t) => `<line x1="20" x2="${LW - 20}" y1="${(LH - 38 - t * (LH - 70)).toFixed(1)}" y2="${(LH - 38 - t * (LH - 70)).toFixed(1)}" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="3 4"/>`).join("")}
    ${solid.length > 1 ? `<path d="${sp} L${lx(lastS).toFixed(1)} ${LH - 38} L${lx(0).toFixed(1)} ${LH - 38} Z" fill="url(#msLg)"/>` : ""}
    ${solid.length ? `<path d="${sp}" fill="none" stroke="#3ccf93" stroke-width="3" stroke-linejoin="round"/>` : ""}
    ${solid.length && pts.length > solid.length ? `<path d="M${lx(lastS).toFixed(1)} ${ly(solid[lastS].v).toFixed(1)} L${lx(pts.length - 1).toFixed(1)} ${ly(flowV).toFixed(1)}" fill="none" stroke="#79a7ff" stroke-width="3" stroke-dasharray="6 5"/>` : ""}
    ${pts.map((p, i) => `<circle cx="${lx(i).toFixed(1)}" cy="${ly(p.v).toFixed(1)}" r="6" fill="${p.est ? "#182030" : "#3ccf93"}" stroke="${p.est ? "#79a7ff" : "#182030"}" stroke-width="3"/><text x="${lx(i).toFixed(1)}" y="${(ly(p.v) - 13).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="800" fill="${p.est ? "#79a7ff" : "currentColor"}">${N(p.v)}</text><text x="${lx(i).toFixed(1)}" y="${LH - 14}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".65">${E(p.l)}</text>`).join("")}</svg>
    <div style="display:flex;justify-content:space-around;text-align:center;margin-top:4px"><div><div style="font-size:12px;opacity:.7">${mt("m_got")}</div><b style="font-size:20px;color:#3ccf93">${N(gotSum)}</b></div><div><div style="font-size:12px;opacity:.7">${mt("m_acc")}</div><b style="font-size:20px;color:#79a7ff">${N(flowV)}</b></div></div></div>`;

  // ③ 扣點圓餅（點了看哪幾張工單）
  const cats = {};
  rows.forEach((r) => (det(r).items || []).forEach((it) => {
    if (!(it.k === "self" || it.k === "rework" || it.k === "team")) return;
    const key = it.k === "team" ? mt("k_team") : it.k === "rework" ? mt("k_rework") : MyStats.kindName(it.why || "違規");
    const o = cats[key] || (cats[key] = { pts: 0, n: 0, k: it.k, wos: new Set(), items: [] });
    o.pts += Math.abs(it.a); o.n++; o.wos.add(it.wo); o.items.push(it);
  }));
  const ce = Object.entries(cats).sort((a, b) => b[1].pts - a[1].pts); MyStats._cats = ce;
  const ct = sum(ce, (x) => x[1].pts), PAL = ["#ff7a87", "#f0b24d", "#79a7ff", "#b794f6", "#3ccf93", "#8892a6"];
  const EXP = (k, v) => v.k === "team" ? mt("e_team", { n: v.wos.size }) : v.k === "rework" ? mt("e_rework", { n: v.wos.size }) : /午休|nghỉ trưa|lunch/i.test(k) && /晚餐|ăn tối|dinner/i.test(k) ? mt("e_both", { n: v.n }) : /午休|nghỉ trưa/.test(k) ? mt("e_lunch", { n: v.n }) : /晚餐|ăn tối/.test(k) ? mt("e_dinner", { n: v.n }) : /忘記按結束|Quên|21:00/.test(k) ? mt("e_forgot", { n: v.n }) : mt("e_self", { n: v.n });
  const mine = sum(ce.filter(([k, v]) => v.k === "self"), (x) => x[1].pts), others = sum(ce.filter(([k, v]) => v.k === "team"), (x) => x[1].pts);
  let ang = -Math.PI / 2, paths = "";
  ce.forEach(([k, v], i) => { const fr = v.pts / ct, a2 = ang + fr * 2 * Math.PI;
    if (fr >= 0.9999) paths += `<circle cx="60" cy="60" r="55" fill="${PAL[i % 6]}"/>`;
    else { const x1 = 60 + 55 * Math.cos(ang), y1 = 60 + 55 * Math.sin(ang), x2 = 60 + 55 * Math.cos(a2), y2 = 60 + 55 * Math.sin(a2); paths += `<path d="M60,60 L${x1.toFixed(1)},${y1.toFixed(1)} A55,55 0 ${fr > 0.5 ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${PAL[i % 6]}" stroke="#182030" stroke-width="2"/>`; }
    ang = a2; });
  const pie = `<div class="ms-cx"><h4>${mt("p_title")}</h4><p class="sb">${ct ? mt("p_sub", { o: N(orig), c: N(ct) }) : mt("p_none")}</p>${ct ? `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 120 120" width="130" height="130" style="flex:none">${paths}<circle cx="60" cy="60" r="27" fill="#182030"/><text x="60" y="56" text-anchor="middle" fill="#93a1b5" font-size="8">${mt("p_total")}</text><text x="60" y="70" text-anchor="middle" fill="#e8edf5" font-size="15" font-weight="800">${N(ct)}</text><text x="60" y="81" text-anchor="middle" fill="#93a1b5" font-size="8">${mt("p_unit")}</text></svg>
    <div style="flex:1;min-width:200px">${ce.map(([k, v], i) => `<div class="ms-catr" data-cat="${i}"><div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;font-weight:700"><span><b style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${PAL[i % 6]};margin-right:7px"></b>${E(k)}</span><span style="white-space:nowrap">－${N(v.pts)} <span style="opacity:.6;font-weight:400">(${Math.round(v.pts / ct * 100)}%)</span></span></div><div style="font-size:12px;opacity:.7;margin:2px 0 0 18px;line-height:1.5">${E(EXP(k, v))}</div><div style="font-size:11px;color:#79a7ff;margin:3px 0 0 18px">${mt("p_tap")}</div></div>`).join("")}</div></div>
    <div style="font-size:12px;opacity:.75;margin-top:6px;border-top:1px solid rgba(127,127,127,.3);padding-top:8px">${mt("p_mine", { a: N(mine), b: N(others) })}</div><div id="msCatDetail" style="margin-top:8px"></div>` : ""}</div>`;

  // ④ 近 4 週缺失（點了看問題）
  const pen = (issues || []).filter((r) => r.kind !== "完成度未填");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = (d) => fmtDate(d), md = (d) => String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
  const wk = [];
  for (let w = 3; w >= 0; w--) { const end = new Date(today.getTime() - w * 7 * 864e5), st = new Date(end.getTime() - 6 * 864e5); wk.push({ l: md(st) + "～" + md(end), a: iso(st), b: iso(end) }); }
  wk.forEach((x) => { x.items = pen.filter((i) => i.work_date >= x.a && i.work_date <= x.b); x.n = x.items.length; }); MyStats._wk = wk;
  const wm = Math.max(2, ...wk.map((x) => x.n)); let streak = 0; for (let i = wk.length - 1; i >= 0 && wk[i].n === 0; i--) streak++;
  const last = wk[3], prev = wk[2];
  const msg = streak >= 1 ? mt("w_streak", { n: streak }) : last.n < prev.n ? mt("w_better") : last.n > prev.n ? mt("w_worse") : mt("w_same");
  const wkHtml = `<div class="ms-cx"><h4>${mt("w_title")}</h4><p class="sb">${mt("w_sub")}</p>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;align-items:end;height:160px;margin-top:6px">${wk.map((x, i) => `<div class="ms-wk" data-wk="${i}" style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">${x.n ? `<div style="font-weight:800;font-size:15px;color:#ff7a87;margin-bottom:4px">${mt("w_times", { n: x.n })}</div><div style="width:56%;max-width:54px;height:${Math.max(14, x.n / wm * 90)}px;border-radius:8px 8px 0 0;background:#ff7a87"></div>` : `<div style="font-size:26px;line-height:1;margin-bottom:6px;color:#3ccf93">✓</div><div style="width:56%;max-width:54px;height:6px;border-radius:4px;background:#3ccf93"></div>`}<div style="font-size:11px;opacity:.65;margin-top:8px;text-align:center;line-height:1.35">${E(x.l).replace("～", "<br>～")}</div></div>`).join("")}</div>
    <div id="msWkDetail" style="margin-top:10px"><div style="font-size:14px;font-weight:700;text-align:center;background:rgba(127,127,127,.14);border-radius:10px;padding:8px">${msg}</div></div></div>`;

  // 放進畫面
  const old = box.querySelector(".ms-score"); if (old) old.remove();
  const oldc = box.querySelector(".ms-ch"); if (oldc) oldc.remove();
  box.insertAdjacentHTML("afterbegin", score);
  box.insertAdjacentHTML("beforeend", `<div class="ms-ch">${line}${pie}${wkHtml}</div>`);

  // 互動
  const btn = box.querySelector("#msScBtn"); if (btn) btn.onclick = () => box.querySelector("#msScPop").classList.toggle("hide");
  box.onclick = (e) => {
    const c = e.target.closest("[data-cat]");
    if (c) {
      const i = Number(c.dataset.cat), cc = MyStats._cats[i]; box.querySelectorAll(".ms-catr").forEach((x, j) => x.classList.toggle("sel", j === i));
      const items = [...cc[1].items].sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
      box.querySelector("#msCatDetail").innerHTML = `<div style="font-size:12px;opacity:.7;margin:2px 0 6px">${E(mt("p_list", { k: cc[0], n: items.length }))}</div>` + items.map((it) => `<div class="ms-itm" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><div style="font-size:14px"><b>${E(it.wo)}</b> <span style="opacity:.65">${E(it.c || "")}</span></div><div style="font-size:12px;opacity:.65">${E(it.st || "")}${it.d ? " · " + E(it.d) : ""}</div></div><b style="color:#ff7a87;font-size:18px;white-space:nowrap">－${N(Math.abs(it.a))}</b></div>`).join("");
      return;
    }
    const w = e.target.closest("[data-wk]");
    if (w) {
      const i = Number(w.dataset.wk), x = MyStats._wk[i]; box.querySelectorAll(".ms-wk").forEach((el, j) => el.classList.toggle("sel", j === i));
      box.querySelector("#msWkDetail").innerHTML = !x.items.length ? `<div style="font-size:14px;text-align:center;background:rgba(127,127,127,.14);border-radius:10px;padding:10px">${E(mt("w_none", { l: x.l }))}</div>`
        : `<div style="font-size:12px;opacity:.7;margin-bottom:6px">${E(mt("w_head", { l: x.l, n: x.n }))}</div>` + x.items.map((it) => `<div class="ms-itm"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:14px">${E(MyStats.kindName(it.kind))}</b><span style="font-size:12px;opacity:.65">${E(String(it.work_date).slice(5).replace("-", "/"))}</span></div><div style="font-size:12px;opacity:.65;margin-top:2px">${E(it.work_order_no)} · ${E(it.station)}${it.machine ? " · " + E(it.machine) : ""}</div><div style="font-size:12px;color:#f0b24d;margin-top:3px">${E(it.detail || "")}</div></div>`).join("");
    }
  };

  // 「最近沒做好的事」收合（預設收起來）
  const ib = $("#myIssueBox"), card = ib && ib.closest(".card");
  if (card && !card.dataset.msDet) {
    card.dataset.msDet = "1";
    const h = card.querySelector("h3"), title = h ? h.textContent : t("ms_issue_title");
    card.innerHTML = `<details class="ms-det"><summary>${E(title)}</summary><div id="myIssueBox" style="margin-top:10px"></div></details>`;
  }
};
