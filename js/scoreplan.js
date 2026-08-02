// ============================================================
//  計分比例（貨編層級）— 原型版
//  ⚠️ 這一版所有資料存在瀏覽器 localStorage，不會寫進線上資料庫。
//     流程確認後要正式上線，需改成 Supabase 資料表 + RPC（見 README 說明）。
//
//  流程：上傳 ERP 加工製程單 → 依「總標準工時」算出各站建議比例
//        → 指定的人調整 → 確認鎖定 → 之後同貨編沿用
//        → 要改須提出申請 → 主管核准後生效
// ============================================================
window.ScorePlan = { skus: [], current: null };

const spEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SP_KEY = "scoreplan_mock_v1";

// ---------- 資料層（已改為真的資料庫）----------
// 讀：sku_scores / sku_station_ratios / sku_ratio_status
// 寫：透過 RPC（權限檢查在資料庫端）
ScorePlan.db = {
  cache: { scores: {}, ratios: {}, status: {} },

  async loadFor(skus) {
    const c = { scores: {}, ratios: {}, status: {} };
    if (!skus.length) { ScorePlan.db.cache = c; return c; }
    for (const part of spChunk(skus, 100)) {
      const [a, b, s] = await Promise.all([
        sb.from("sku_scores").select("sku,score,graded_at").in("sku", part),
        sb.from("sku_station_ratios").select("sku,station,ratio").in("sku", part),
        sb.from("sku_ratio_status").select("sku,status,confirmed_at").in("sku", part),
      ]);
      (a.data || []).forEach((x) => (c.scores[x.sku] = x));
      (b.data || []).forEach((x) => ((c.ratios[x.sku] = c.ratios[x.sku] || {})[x.station] = Number(x.ratio)));
      (s.data || []).forEach((x) => (c.status[x.sku] = x));
    }
    ScorePlan.db.cache = c;
    return c;
  },
  total(sku) {
    const s = ScorePlan.db.cache.scores[sku];
    return s ? { score: Number(s.score), at: (s.graded_at || "").slice(0, 16).replace("T", " ") } : null;
  },
  ratios(sku) { return ScorePlan.db.cache.ratios[sku] || null; },
  status(sku) { return (ScorePlan.db.cache.status[sku] || {}).status || null; },
};

// ---------- 舊的瀏覽器暫存層（僅供修改申請沿用，之後會一併搬進資料庫）----------
ScorePlan.store = {
  read() {
    try { return JSON.parse(localStorage.getItem(SP_KEY)) || { rules: {}, requests: [] }; }
    catch (e) { return { rules: {}, requests: [] }; }
  },
  write(d) { localStorage.setItem(SP_KEY, JSON.stringify(d)); },
  rule(sku) { return this.read().rules[sku] || null; },
  saveRule(rule) { const d = this.read(); d.rules[rule.sku] = rule; this.write(d); },
  // 主管給的「訂單總分」，綁在貨編上（同貨編共用一個總分）
  total(sku) { return (this.read().totals || {})[sku] || null; },
  setTotal(sku, rec) {
    const d = this.read();
    d.totals = d.totals || {};
    if (rec == null) delete d.totals[sku]; else d.totals[sku] = rec;
    this.write(d);
  },
  addRequest(req) { const d = this.read(); d.requests.unshift(req); this.write(d); },
  updRequest(id, patch) {
    const d = this.read();
    const r = d.requests.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
    this.write(d);
  },
};

ScorePlan.render = function () {
  $("#spFile").onchange = ScorePlan.readFile;
  $("#btnSpReload").onclick = () => ScorePlan.loadFromDb();
  if (!ScorePlan.skus.length) ScorePlan.loadFromDb();
  else if (ScorePlan._pendingOpen) {
    const sku = ScorePlan._pendingOpen;
    ScorePlan._pendingOpen = null;
    ScorePlan.renderSkuList();
    if (ScorePlan.skus.some((s) => s.sku === sku)) ScorePlan.open(sku);
  }
  else ScorePlan.renderSkuList();
  ScorePlan.renderRequests();
};

// ---------- 0) 直接從資料庫載入貨編清單（不必再上傳 ERP 檔）----------
// 工單和製程站每小時都自動匯入了，這頁直接讀現成的。
// 上傳 ERP 檔仍保留，當成補充來源。
ScorePlan.loadFromDb = async function () {
  $("#spResult").textContent = t("sp_reading");
  const { data: wos, error } = await sb.from("work_orders")
    .select("work_order_no,sku,product_name")
    .order("work_order_no", { ascending: false }).limit(600);
  if (error) { $("#spResult").textContent = friendlyErr(error); return; }

  const bySku = {};
  const woOf = {};
  (wos || []).forEach((w) => {
    if (!w.sku) return;
    woOf[w.work_order_no] = w.sku;
    if (!bySku[w.sku]) bySku[w.sku] = { sku: w.sku, product_name: w.product_name || "", stations: [] };
  });

  const nos = Object.keys(woOf);
  for (const part of spChunk(nos, 200)) {
    const { data: rts } = await sb.from("work_order_routes")
      .select("work_order_no,seq,station,station_type,std_minutes").in("work_order_no", part);
    (rts || []).forEach((r) => {
      const s = bySku[woOf[r.work_order_no]];
      if (!s) return;
      // 依「站名」合併：像 拋光 可能在製程裡出現 3 次（050/070/090），
      // 但比例是綁站名的，只能設一次——重複列出還會讓存檔撞唯一鍵。
      // 合併時工時累加（做 3 次拋光就是 3 段工時），並記次數提示使用者。
      const exist = s.stations.find((x) => x.station === r.station);
      if (exist) {
        if (!exist._seqs.has(r.seq)) { exist._seqs.add(r.seq); exist.cnt++; exist.std += Number(r.std_minutes) || 0; }
      } else {
        s.stations.push({ seq: r.seq, station: r.station,
          station_type: r.station_type || "工作站", std: Number(r.std_minutes) || 0,
          cnt: 1, _seqs: new Set([r.seq]) });
      }
    });
  }

  ScorePlan.skus = Object.values(bySku)
    .filter((s) => s.stations.length)
    .map((s) => { s.stations.sort((a, b) => String(a.seq).localeCompare(String(b.seq))); return s; })
    .sort((a, b) => a.sku.localeCompare(b.sku));

  $("#spResult").textContent = t("sp_loading_actual");
  await ScorePlan.loadActual();
  await ScorePlan.db.loadFor(ScorePlan.skus.map((s) => s.sku));
  ScorePlan.skus.forEach((s) => ScorePlan.applySuggested(s.stations, s.sku));

  $("#spResult").textContent = t("sp_read_done", { n: ScorePlan.skus.length });
  ScorePlan.renderSkuList();

  // 從「工單給分」的「比例」鈕跳過來 → 直接打開那個貨編
  if (ScorePlan._pendingOpen) {
    const sku = ScorePlan._pendingOpen;
    ScorePlan._pendingOpen = null;
    if (ScorePlan.skus.some((s) => s.sku === sku)) ScorePlan.open(sku);
  }
};

// ---------- 1) 讀 ERP 檔，算各站建議比例 ----------
ScorePlan.readFile = function (e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  $("#spResult").textContent = t("sp_reading");
  const fr = new FileReader();
  fr.onload = async (ev) => {
    try {
      const wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: true });
      const hi = rows.findIndex((r) => r.some((c) => String(c).includes("工單號碼")));
      if (hi < 0) { $("#spResult").textContent = t("erp_no_header"); return; }

      // 欄位位置以表頭文字尋找，避免 ERP 改版就壞掉
      const head = rows[hi].map((c) => String(c).replace(/\s/g, ""));
      const col = (...names) => {
        for (const n of names) { const i = head.findIndex((h) => h === n); if (i >= 0) return i; }
        for (const n of names) { const i = head.findIndex((h) => h.includes(n)); if (i >= 0) return i; }
        return -1;
      };
      const I = {
        sku: col("產品編號"), name: col("產品名稱"), wo: col("工單號碼"),
        seq: col("代碼"), stType: col("站別"), stName: col("站名"),
        std: col("總標準工時"), t2: col("製程時間T"),
      };

      const bySku = {};
      for (let r = hi + 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        const sku = String(row[I.sku] || "").trim();
        const st = String(row[I.stName] || "").trim();
        if (!sku || !st) continue;
        const seq = String(row[I.seq] || "").trim();
        let std = Number(row[I.std]);
        if (!isFinite(std) || std <= 0) std = Number(row[I.t2]);
        if (!isFinite(std)) std = 0;
        if (!bySku[sku]) bySku[sku] = { sku, product_name: String(row[I.name] || "").trim(), stations: [] };
        // 依站名合併（理由同 loadFromDb：比例綁站名，只能設一次）
        const ex = bySku[sku].stations.find((x) => x.station === st);
        if (ex) { if (!ex._seqs.has(seq)) { ex._seqs.add(seq); ex.cnt++; ex.std += std; } }
        else {
          bySku[sku].stations.push({
            cnt: 1, _seqs: new Set([seq]),
            seq, station: st,
            station_type: String(row[I.stType] || "").trim() || "工作站",
            std,
          });
        }
      }

      ScorePlan.skus = Object.values(bySku).map((s) => {
        s.stations.sort((a, b) => String(a.seq).localeCompare(String(b.seq)));
        return s;
      }).sort((a, b) => a.sku.localeCompare(b.sku));

      $("#spResult").textContent = t("sp_loading_actual");
      await ScorePlan.loadActual();
      ScorePlan.skus.forEach((s) => ScorePlan.applySuggested(s.stations, s.sku));

      $("#spResult").textContent = t("sp_read_done", { n: ScorePlan.skus.length });
      ScorePlan.renderSkuList();
    } catch (err) {
      $("#spResult").textContent = t("err") + "：" + (err.message || err);
    }
  };
  fr.readAsArrayBuffer(f);
};

// ---------- 實際工時（建議比例的主要依據）----------
// 用過去報工紀錄算每站「每顆工時」。取中位數而非平均：
// 忘了按結束的紀錄動輒上萬分鐘，用平均會被一筆吃掉整個比例。
ScorePlan.MAX_MIN_PER_PIECE = 480;   // 每顆超過 8 小時視為忘記結束，剔除
ScorePlan.actual = {};               // "貨編|站名" -> { median, n }

const spMedian = (arr) => {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const spChunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

ScorePlan.loadActual = async function () {
  ScorePlan.actual = {};
  const skus = ScorePlan.skus.map((s) => s.sku);
  if (!skus.length) return;

  // 貨編 → 工單號
  const skuOf = {};
  for (const part of spChunk(skus, 100)) {
    const { data } = await sb.from("work_orders").select("work_order_no,sku").in("sku", part);
    (data || []).forEach((w) => (skuOf[w.work_order_no] = w.sku));
  }
  const nos = Object.keys(skuOf);
  if (!nos.length) return;

  // 工單 → 已完成的報工
  const bag = {};
  for (const part of spChunk(nos, 200)) {
    const { data } = await sb.from("jobs")
      .select("work_order_no,station,work_minutes,qty,status")
      .eq("status", "done").in("work_order_no", part);
    (data || []).forEach((j) => {
      const sku = skuOf[j.work_order_no];
      const mins = Number(j.work_minutes);
      if (!sku || !isFinite(mins) || mins <= 0) return;
      const per = mins / Math.max(1, Number(j.qty) || 1);     // 換算成「每顆」才能跨批次比較
      if (per <= 0 || per > ScorePlan.MAX_MIN_PER_PIECE) return;   // 剔除離群
      const k = sku + "|" + j.station;
      (bag[k] = bag[k] || []).push(per);
    });
  }
  Object.entries(bag).forEach(([k, arr]) => {
    ScorePlan.actual[k] = { median: Math.round(spMedian(arr) * 10) / 10, n: arr.length };
  });
};

// 建議比例：優先用實際工時中位數，沒有就退回 ERP 標準工時，再沒有就平均分配。
// 只算廠內工作站，外包加工戶不計分。四捨五入的誤差補在最大的那一站。
ScorePlan.applySuggested = function (stations, sku) {
  const inHouse = stations.filter((s) => s.station_type !== "加工戶");
  stations.forEach((s) => {
    const a = ScorePlan.actual[(sku || s._sku) + "|" + s.station];
    s.actual = a ? a.median : null;
    s.samples = a ? a.n : 0;
    s.suggest = 0;
  });
  if (!inHouse.length) return;

  const known = inHouse.map((s) => Number(s.actual)).filter((v) => isFinite(v) && v > 0);
  let basis, weight;
  if (known.length) {
    // 有實際工時就以它為主。沒紀錄的站不能給 0（等於白做），
    // 依序用 ERP 工時 →「其他站實際工時的中位數」頂替，並標記為推估。
    basis = "actual";
    const fallback = spMedian(known);
    weight = (s) => {
      const a = Number(s.actual);
      if (isFinite(a) && a > 0) { s.est = false; return a; }
      const st = Number(s.std);
      if (isFinite(st) && st > 0) { s.est = true; return st; }
      s.est = true; return fallback;
    };
  } else if (inHouse.some((s) => Number(s.std) > 0)) {
    basis = "std";
    weight = (s) => Number(s.std) || 0;
  } else {
    basis = "even";
    weight = () => 1;
  }
  stations.forEach((s) => (s.basis = basis));

  const sum = inHouse.reduce((a, b) => a + weight(b), 0);
  inHouse.forEach((s) => (s.suggest = sum > 0 ? Math.round(weight(s) / sum * 1000) / 10 : 0));
  const diff = Math.round((100 - inHouse.reduce((a, b) => a + b.suggest, 0)) * 10) / 10;
  if (diff !== 0) {
    const big = inHouse.reduce((a, b) => (b.suggest > a.suggest ? b : a), inHouse[0]);
    big.suggest = Math.round((big.suggest + diff) * 10) / 10;
  }
};

// ---------- 2) 貨編清單 ----------
// 300 多個貨編用捲的找不到，打字立即過濾（純前端，不打資料庫）
ScorePlan.renderSkuList = function () {
  const box = $("#spSkuList");
  const inp = $("#spSearch");
  if (inp && !inp._bound) {
    inp._bound = true;
    inp.oninput = () => ScorePlan.renderSkuList();
  }
  if (!ScorePlan.skus.length) { box.innerHTML = `<p class="muted">${t("sp_no_file")}</p>`; if ($("#spCount")) $("#spCount").textContent = ""; return; }

  const q = (inp ? inp.value : "").trim().toLowerCase();
  const list = !q ? ScorePlan.skus
    : ScorePlan.skus.filter((s) =>
        s.sku.toLowerCase().includes(q) || (s.product_name || "").toLowerCase().includes(q));
  if ($("#spCount")) $("#spCount").textContent = t("jobs_total", { n: list.length });
  if (!list.length) { box.innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  return ScorePlan.paintSkuTable(list);
};

ScorePlan.paintSkuTable = function (list) {
  const box = $("#spSkuList");
  const head = `<tr><th>${t("sku")}</th><th>${t("product")}</th><th class="r">${t("sp_stations")}</th>
    <th class="r">${t("gd_total")}</th><th>${t("status")}</th><th>${t("actions")}</th></tr>`;
  const body = list.map((s) => {
    const st = ScorePlan.db.status(s.sku);
    const badge = st === "已確認" ? `<span class="badge go">${t("sp_confirmed")}</span>`
      : st === "草稿" ? `<span class="badge warn">${t("sp_draft")}</span>`
      : `<span class="badge mute">${t("sp_unset")}</span>`;
    const tot = ScorePlan.db.total(s.sku);
    const totCell = tot ? `<strong>${tot.score}</strong>` : `<span class="muted">—</span>`;
    return `<tr><td>${spEsc(s.sku)}</td><td>${spEsc(s.product_name)}</td>
      <td class="r">${s.stations.length}</td><td class="r">${totCell}</td><td>${badge}</td>
      <td><button class="btn small primary" data-sku="${spEsc(s.sku)}">${t("sp_edit")}</button></td></tr>`;
  }).join("");
  box.innerHTML = `<table>${head}${body}</table>`;
  $$("#spSkuList button[data-sku]").forEach((b) => { b.onclick = () => ScorePlan.open(b.dataset.sku); });
};

// ---------- 3) 單一貨編的比例編輯 ----------
ScorePlan.open = function (sku) {
  const s = ScorePlan.skus.find((x) => x.sku === sku);
  if (!s) return;
  // 已存的比例（資料庫）優先，其次用建議值
  const saved = ScorePlan.db.ratios(sku);
  const stations = s.stations.map((st) => ({
    ...st,
    ratio: saved && saved[st.station] != null ? Number(saved[st.station]) : st.suggest,
  }));
  const status = ScorePlan.db.status(sku);
  // 已確認就鎖定；主管例外（資料庫端允許主管直接覆蓋）
  const locked = status === "已確認" && !(App.ME && App.ME.role === "主管");
  ScorePlan.current = { sku, product_name: s.product_name, stations, locked, status };
  ScorePlan.paintEditor();
  $("#spEditor").classList.remove("hide");
  $("#spEditor").scrollIntoView({ behavior: "smooth", block: "start" });
};

ScorePlan.paintEditor = function () {
  const c = ScorePlan.current;
  if (!c) return;
  const locked = c.locked;
  const total = ScorePlan.total();
  const ok = Math.abs(total - 100) < 0.05;

  const st0 = ScorePlan.db.cache.status[c.sku] || {};
  const confirmInfo = c.status === "已確認"
    ? `<div class="job-sub">${t("sp_confirmed_at", { at: (st0.confirmed_at || "").slice(0, 16).replace("T", " ") })}</div>` : "";

  // 主管給的訂單總分（綁貨編）。沒給就沒辦法算出各站實得分數
  const tot = ScorePlan.db.total(c.sku);
  const totLine = tot
    ? `<div class="sp-total">${t("gd_total")}　<b>${tot.score}</b>　<small class="muted">${t("gd_at", { at: tot.at })}</small></div>`
    : `<div class="sp-total none">${t("sp_no_total")}</div>`;
  $("#spEditorHead").innerHTML = `
    <div style="font-size:20px;font-weight:800">${spEsc(c.sku)}</div>
    <div class="job-sub">${spEsc(c.product_name)}</div>${confirmInfo}${totLine}`;

  const head = `<tr><th>${t("sp_seq")}</th><th>${t("station")}</th><th>${t("sp_type")}</th>
    <th class="r">${t("sp_actual")}</th><th class="r">${t("sp_samples")}</th>
    <th class="r">${t("sp_std")}</th><th class="r">${t("sp_suggest")}</th><th class="r">${t("sp_ratio")}</th>
    <th class="r">${t("sp_st_score")}</th></tr>`;
  const body = c.stations.map((st, i) => {
    const out = st.station_type === "加工戶";
    const cell = out
      ? `<span class="muted">—</span>`
      : `<input type="number" class="cell r" style="max-width:90px" min="0" max="100" step="0.1"
           value="${st.ratio}" data-ri="${i}"${locked ? " disabled" : ""}>`;
    // 樣本 <3 筆的實際工時參考性低，標黃提醒
    const nCell = out ? "—" : (st.samples
      ? `<span class="badge ${st.samples >= 3 ? "go" : "warn"}">${st.samples}</span>` : `<span class="muted">0</span>`);
    // 同站名在製程出現多次（例如拋光×3）只設一次比例，標出次數
    const cntTag = st.cnt > 1 ? ` <span class="badge mute" title="${t("sp_multi_tip")}">×${st.cnt}</span>` : "";
    return `<tr${out ? ' style="opacity:.55"' : ""}>
      <td>${spEsc(st.seq)}</td><td>${spEsc(st.station)}${cntTag}</td>
      <td>${out ? t("outsourced") : t("sp_inhouse")}</td>
      <td class="r">${out ? "—" : (st.actual != null ? st.actual : (st.est ? `<span class="badge warn">${t("sp_est")}</span>` : "—"))}</td>
      <td class="r">${nCell}</td>
      <td class="r muted">${out ? "—" : (st.std || "—")}</td>
      <td class="r muted">${out ? "—" : st.suggest + "%"}</td>
      <td class="r">${cell}</td>
      <td class="r">${out || !tot ? `<span class="muted">—</span>`
        : `<strong style="color:var(--go)">${(tot.score * (Number(st.ratio) || 0) / 100).toFixed(2)}</strong>`}</td></tr>`;
  }).join("");
  const basis = (c.stations.find((s) => s.basis) || {}).basis || "even";
  const basisNote = `<p class="muted" style="font-size:13px;margin:8px 0 0">${t("sp_basis_" + basis)}</p>`;
  const totalRow = `<tr><td colspan="5" class="r"><strong>${t("total")}</strong></td>
    <td class="r"><strong style="color:${ok ? "var(--go)" : "var(--err)"}">${total.toFixed(1)}%</strong></td>
    <td class="r"><strong>${tot ? (tot.score * total / 100).toFixed(2) : "—"}</strong></td></tr>`;
  $("#spTable").innerHTML = `<table>${head}${body}${totalRow}</table>${basisNote}`;

  $("#spHint").innerHTML = ok ? "" : `<p style="color:var(--err);font-size:14px;margin:6px 0">${t("sp_must_100")}</p>`;

  // 按鈕列：未鎖定 = 草稿/確認；已鎖定 = 申請修改
  $("#spBtns").innerHTML = locked
    ? `<button class="btn ghost" id="btnSpUseSuggest" disabled>${t("sp_use_suggest")}</button>
       <button class="btn primary" id="btnSpRequest">${t("sp_request")}</button>`
    : `<button class="btn ghost" id="btnSpUseSuggest">${t("sp_use_suggest")}</button>
       <button class="btn" id="btnSpDraft">${t("sp_save_draft")}</button>
       <button class="btn go" id="btnSpConfirm"${ok ? "" : " disabled"}>${t("sp_confirm")}</button>`;

  $$("#spTable input[data-ri]").forEach((inp) => {
    inp.onchange = () => {
      const i = Number(inp.dataset.ri);
      let v = Number(inp.value);
      if (!isFinite(v) || v < 0) v = 0;
      if (v > 100) v = 100;
      ScorePlan.current.stations[i].ratio = Math.round(v * 10) / 10;
      ScorePlan.paintEditor();
    };
  });
  if ($("#btnSpUseSuggest")) $("#btnSpUseSuggest").onclick = () => {
    ScorePlan.current.stations.forEach((st) => (st.ratio = st.station_type === "加工戶" ? 0 : st.suggest));
    ScorePlan.paintEditor();
  };
  if ($("#btnSpDraft")) $("#btnSpDraft").onclick = () => ScorePlan.save("草稿");
  if ($("#btnSpConfirm")) $("#btnSpConfirm").onclick = () => {
    if (!confirm(t("sp_confirm_ask"))) return;
    ScorePlan.save("已確認");
  };
  if ($("#btnSpRequest")) $("#btnSpRequest").onclick = ScorePlan.openRequest;
};

ScorePlan.total = function () {
  return (ScorePlan.current.stations || [])
    .filter((s) => s.station_type !== "加工戶")
    .reduce((a, b) => a + (Number(b.ratio) || 0), 0);
};

// 寫進資料庫（save_sku_ratios RPC）。
// 合計 100% 的檢查資料庫端也會再擋一次——就算有人繞過畫面直接打 API 也存不進去。
ScorePlan.save = async function (status) {
  const c = ScorePlan.current;
  const confirm_ = status === "已確認";
  if (confirm_ && Math.abs(ScorePlan.total() - 100) >= 0.05) return toast(t("sp_must_100"), "err");
  const ratios = c.stations
    .filter((s) => s.station_type !== "加工戶")
    .map((s) => ({ station: s.station, ratio: Number(s.ratio) || 0 }));
  const { error } = await sb.rpc("save_sku_ratios", { p_sku: c.sku, p_ratios: ratios, p_confirm: confirm_ });
  if (error) return toast(rpcErr(error), "err");
  toast(confirm_ ? t("sp_confirmed_ok") : t("saved"), "ok");
  await ScorePlan.db.loadFor([c.sku]);
  ScorePlan.open(c.sku);
  ScorePlan.renderSkuList();
};

// ---------- 4) 申請修改 ----------
ScorePlan.openRequest = function () {
  const c = ScorePlan.current;
  $("#spReqSku").textContent = c.sku;
  $("#spReqReason").value = "";
  // 申請單裡帶入「想改成」的比例，預設沿用目前值
  $("#spReqBody").innerHTML = c.stations.filter((s) => s.station_type !== "加工戶").map((s, i) =>
    `<div class="row" style="align-items:center;margin-bottom:6px">
      <span class="grow">${spEsc(s.station)}</span>
      <input type="number" class="cell r" style="max-width:90px" min="0" max="100" step="0.1" value="${s.ratio}" data-req="${i}">
      <span class="muted">%</span></div>`).join("");
  $("#spReqModal").classList.remove("hide");
  $("#btnSpReqCancel").onclick = () => $("#spReqModal").classList.add("hide");
  $("#btnSpReqSend").onclick = ScorePlan.sendRequest;
};

ScorePlan.sendRequest = function () {
  const c = ScorePlan.current;
  const reason = $("#spReqReason").value.trim();
  if (!reason) return toast(t("sp_need_reason"), "err");
  const inHouse = c.stations.filter((s) => s.station_type !== "加工戶");
  const next = [];
  let sum = 0;
  $$("#spReqBody input[data-req]").forEach((inp) => {
    const i = Number(inp.dataset.req);
    const v = Math.round((Number(inp.value) || 0) * 10) / 10;
    sum += v;
    next.push({ station: inHouse[i].station, seq: inHouse[i].seq, from: inHouse[i].ratio, to: v });
  });
  if (Math.abs(sum - 100) >= 0.05) return toast(t("sp_must_100"), "err");
  ScorePlan.store.addRequest({
    id: "req" + Date.now(),
    sku: c.sku, product_name: c.product_name,
    reason, changes: next,
    requested_by: App.ME.name, requested_at: new Date().toISOString().slice(0, 16).replace("T", " "),
    status: "待審",
  });
  $("#spReqModal").classList.add("hide");
  toast(t("sp_request_sent"), "ok");
  ScorePlan.renderRequests();
};

// ---------- 5) 申請清單（主管可核准）----------
ScorePlan.renderRequests = function () {
  const box = $("#spReqList");
  if (!box) return;
  const reqs = ScorePlan.store.read().requests || [];
  if (!reqs.length) { box.innerHTML = `<p class="muted">${t("sp_no_request")}</p>`; return; }
  const isMgr = App.ME && App.ME.role === "主管";
  box.innerHTML = reqs.map((r) => {
    const badge = r.status === "待審" ? `<span class="badge warn">${t("sp_pending")}</span>`
      : r.status === "核准" ? `<span class="badge go">${t("sp_approved")}</span>`
      : `<span class="badge err">${t("sp_rejected")}</span>`;
    const chg = r.changes.map((c) => `${spEsc(c.station)} ${c.from}% → <strong>${c.to}%</strong>`).join("　·　");
    const btns = (r.status === "待審" && isMgr)
      ? `<div class="job-btns">
           <button class="btn small go" data-ok="${r.id}">${t("sp_approve")}</button>
           <button class="btn small danger" data-no="${r.id}">${t("sp_reject")}</button>
         </div>` : "";
    const done = r.reviewed_by ? `<div class="job-sub">${t("sp_reviewed_by", { who: spEsc(r.reviewed_by), at: r.reviewed_at })}</div>` : "";
    return `<div class="job-card">
      <div class="job-head"><strong>${spEsc(r.sku)}</strong>${badge}</div>
      <div class="job-sub">${spEsc(r.product_name)}</div>
      <div class="job-sub">${chg}</div>
      <div class="job-sub">📝 ${spEsc(r.reason)}</div>
      <div class="job-sub">${t("sp_requested_by", { who: spEsc(r.requested_by), at: r.requested_at })}</div>
      ${done}${btns}</div>`;
  }).join("");

  $$("#spReqList button[data-ok]").forEach((b) => { b.onclick = () => ScorePlan.review(b.dataset.ok, "核准"); });
  $$("#spReqList button[data-no]").forEach((b) => { b.onclick = () => ScorePlan.review(b.dataset.no, "駁回"); });
};

ScorePlan.review = function (id, status) {
  const reqs = ScorePlan.store.read().requests || [];
  const r = reqs.find((x) => x.id === id);
  if (!r) return;
  ScorePlan.store.updRequest(id, {
    status,
    reviewed_by: App.ME.name,
    reviewed_at: new Date().toISOString().slice(0, 16).replace("T", " "),
  });
  // 核准 → 直接把新比例寫回該貨編的規則
  if (status === "核准") {
    const rule = ScorePlan.store.rule(r.sku);
    if (rule) {
      r.changes.forEach((c) => {
        const st = rule.stations.find((s) => s.seq === c.seq && s.station === c.station);
        if (st) st.ratio = c.to;
      });
      rule.confirmed_by = App.ME.name;
      rule.confirmed_at = new Date().toISOString().slice(0, 16).replace("T", " ");
      ScorePlan.store.saveRule(rule);
    }
  }
  toast(status === "核准" ? t("sp_approved_ok") : t("sp_rejected_ok"), "ok");
  ScorePlan.renderRequests();
  ScorePlan.renderSkuList();
  if (ScorePlan.current && ScorePlan.current.sku === r.sku) ScorePlan.open(r.sku);
};
