// ============================================================
//  我的看板（登入後首頁）：今天要做的事
// ============================================================
window.Home = {
  data: { running: [], wos: [], todos: [], score: 0, future: 0 },
  timer: null,
};

const homeEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const homeAttr = (s) => String(s == null ? "" : s).replace(/"/g, "&quot;");

Home.render = async function () {
  if (!App.ME) return;
  await Report.ensureStations();

  const now = new Date();
  Home.today = fmtDate(now);
  $("#homeHead").innerHTML = `
    <div class="home-date">${Home.today} · ${t("wd" + now.getDay())}</div>
    <div class="home-hello">${t("welcome")}，${homeEsc(App.ME.name)}${App.ME.team ? ` <span class="muted">(${homeEsc(App.ME.team)})</span>` : ""}</div>`;

  // 「我要報工」直達報工頁——不用再去選單裡找
  const rb = $("#btnHomeReport");
  if (rb) rb.onclick = () => App.go("report");

  await Promise.all([Home.loadRunning(), Home.loadWos(), Home.loadTodos(), Home.loadScore()]);
  Home.paint();

  clearInterval(Home.timer);
  Home.timer = setInterval(Home.tick, 1000);
};

// 進行中／暫停中的報工
Home.loadRunning = async function () {
  const { data, error } = await sb.from("jobs")
    .select("*").eq("employee_id", App.ME.id)
    .in("status", ["running", "paused"])
    .order("start_at", { ascending: true });
  if (error) { Home.data.running = []; return; }
  Home.data.running = data || [];
  Home.woMap = {};
  const nos = [...new Set(Home.data.running.map((j) => j.work_order_no))];
  if (nos.length) {
    const { data: wos } = await sb.from("work_orders")
      .select("work_order_no,customer,product_name").in("work_order_no", nos);
    (wos || []).forEach((w) => (Home.woMap[w.work_order_no] = w));
  }
};

// 指派給我的工單 → 只留「今天要做的」（逾期 / 今天 / 未指定日期）
Home.loadWos = async function () {
  const { data, error } = await sb.from("assignments")
    .select("work_order_no,station,due_date")
    .eq("employee_id", App.ME.id)
    .order("due_date", { ascending: true, nullsFirst: false });
  if (error) { Home.data.wos = []; return; }
  const all = data || [];
  const today = Home.today;

  // 未來才要做的，只顯示數量提示
  Home.data.future = all.filter((a) => a.due_date && a.due_date > today).length;
  const list = all.filter((a) => !a.due_date || a.due_date <= today);
  if (!list.length) { Home.data.wos = []; return; }

  const nos = [...new Set(list.map((a) => a.work_order_no))];
  // 這裡要抓「所有人」的完成顆數，因為一批貨可能是兩個人接力做完的
  const [{ data: wos }, { data: done }] = await Promise.all([
    sb.from("work_orders").select("*").in("work_order_no", nos),
    sb.from("jobs").select("work_order_no,station,qty,status").eq("status", "done").in("work_order_no", nos),
  ]);
  const wMap = {}; (wos || []).forEach((w) => (wMap[w.work_order_no] = w));
  const qtyMap = {};   // 工單|站 -> 已完成顆數
  (done || []).forEach((j) => {
    const k = j.work_order_no + "|" + j.station;
    qtyMap[k] = (qtyMap[k] || 0) + (Number(j.qty) || 0);
  });

  const rank = { over: 0, today: 1, none: 2 };
  Home.data.woDone = 0;
  Home.data.wos = list.map((a) => {
    const w = wMap[a.work_order_no] || {};
    const when = !a.due_date ? "none" : (a.due_date < today ? "over" : "today");
    const total = Number(w.qty);
    const hasTotal = isFinite(total) && total > 0;
    const doneQty = a.station ? (qtyMap[a.work_order_no + "|" + a.station] || 0) : 0;
    // 只有「數量做滿」才算完成；沒有總數就一律不標完成，免得分批做的被誤判
    const finished = !!(a.station && hasTotal && doneQty >= total);
    return { ...a, customer: w.customer, product_name: w.product_name, when, finished, doneQty, total: hasTotal ? total : null };
  }).filter((a) => { if (a.finished) { Home.data.woDone++; return false; } return true; })   // 做完的不用再擋在看板上
    .sort((x, y) => rank[x.when] - rank[y.when]);
};

// 待辦 → 待辦多半不是一天能做完的，所以不用日期篩，
// 只取「未完成、優先序最高」的前 3 項放在看板上。
Home.TODO_TOP = 3;
Home.loadTodos = async function () {
  const { data, error } = await sb.from("todos")
    .select("id,content,priority,progress,due_date")
    .eq("employee_id", App.ME.id)
    .order("priority");
  if (error) { Home.data.todos = []; Home.data.todoTotal = 0; return; }
  const today = Home.today;
  const undone = (data || [])
    .filter((r) => Number(r.progress) < 100)
    .map((r) => ({
      ...r,
      when: !r.due_date ? "none" : (r.due_date < today ? "over" : (r.due_date === today ? "today" : "future")),
    }))
    .sort((a, b) =>
      (Number(a.priority) || 3) - (Number(b.priority) || 3) ||          // 1 最重要
      String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")));
  Home.data.todoTotal = undone.length;
  Home.data.todos = undone.slice(0, Home.TODO_TOP);
};

// 月目標（⚠️ 原型：存瀏覽器 localStorage。正式版要改成 employees.month_target
// 或 score_targets(employee_id, year, month, target) 資料表）
Home.TARGET_KEY = "score_targets_mock_v1";
Home.targets = {
  all() { try { return JSON.parse(localStorage.getItem(Home.TARGET_KEY)) || {}; } catch (e) { return {}; } },
  get(id) { const v = Number(this.all()[id]); return (isFinite(v) && v > 0) ? v : null; },
  set(id, v) {
    const a = this.all();
    if (v == null || v === "" || !isFinite(Number(v)) || Number(v) <= 0) delete a[id];
    else a[id] = Number(v);
    localStorage.setItem(Home.TARGET_KEY, JSON.stringify(a));
  },
};

// 今日得分 + 本月得分
Home.loadScore = async function () {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const monStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const { data } = await sb.from("score_log")
    .select("score,status,created_at").eq("employee_id", App.ME.id)
    .gte("created_at", monStart.toISOString());
  const valid = (data || []).filter((r) => r.status === "有效");
  Home.data.month = valid.reduce((s, r) => s + Number(r.score || 0), 0);
  Home.data.score = valid
    .filter((r) => new Date(r.created_at) >= dayStart)
    .reduce((s, r) => s + Number(r.score || 0), 0);
};

Home.paintTarget = function () {
  const box = $("#homeTarget");
  if (!box) return;
  const got = Home.data.month || 0;
  const target = Home.targets.get(App.ME.id);
  if (!target) {
    box.innerHTML = `<p class="muted">${t("home_no_target")}</p>
      <div style="font-size:22px;font-weight:800">${t("home_month_got", { n: got.toFixed(2) })}</div>`;
    return;
  }
  const pct = Math.min(100, Math.round(got / target * 1000) / 10);
  const gap = Math.round((target - got) * 100) / 100;
  const hit = gap <= 0;
  const color = hit ? "var(--go)" : (pct >= 60 ? "var(--warn)" : "var(--err)");
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:6px">
      <span style="font-size:26px;font-weight:800">${got.toFixed(2)}
        <span class="muted" style="font-size:17px;font-weight:400">/ ${target}</span></span>
      <span style="font-size:20px;font-weight:800;color:${color}">${pct}%</span>
    </div>
    <div style="height:14px;background:var(--track);border-radius:999px;overflow:hidden;margin:8px 0">
      <div style="height:100%;width:${pct}%;background:${color};transition:width .4s"></div></div>
    <div class="job-sub">${hit ? t("home_target_hit") : t("home_target_gap", { n: gap.toFixed(2) })}</div>`;
};

// ---------- 畫面 ----------
Home.paint = function () {
  const d = Home.data;
  const undoneWo = d.wos.filter((a) => !a.finished).length;

  // 待辦不列進統計：待辦通常跨好幾天，放「今天幾件」會誤導
  $("#homeStats").innerHTML = `
    <div class="stat"><div class="num">${d.running.length}</div><div class="lbl">${t("status_running")}</div></div>
    <div class="stat"><div class="num">${undoneWo}</div><div class="lbl">${t("home_wo")}</div></div>
    <div class="stat"><div class="num">${d.score.toFixed(2)}</div><div class="lbl">${t("today_score")}</div></div>`;

  Home.paintTarget();
  Home.paintRunning();
  Home.paintWos();
  Home.paintTodos();
};

Home.paintRunning = function () {
  const box = $("#homeRunning");
  const list = Home.data.running;
  if (!list.length) { box.innerHTML = `<p class="muted">${t("no_running")}</p>`; return; }
  const stMap = {};
  (Report.stations || []).forEach((s) => (stMap[s.code] = s));
  box.innerHTML = list.map((j) => {
    const st = stMap[j.station];
    let stName = st ? stationName(st) : j.station;
    if (j.machine) stName += ` · 🛠 ${j.machine}`;
    const paused = j.status === "paused";
    const w = Home.woMap[j.work_order_no] || {};
    const sub = (w.customer || w.product_name)
      ? `<div class="job-sub">${homeEsc(w.customer || "")}${w.product_name ? " · " + homeEsc(w.product_name) : ""}</div>` : "";
    const mins = (Date.now() - new Date(j.start_at).getTime()) / 60000 - Number(j.paused_minutes || 0);
    const over = !paused && mins > 480;
    return `
    <div class="job-card ${paused ? "paused" : ""}${over ? " over" : ""}" data-id="${j.id}">
      <div class="job-head"><strong>${homeEsc(j.work_order_no)}</strong>
        <span class="badge ${paused ? "warn" : "go"}">${paused ? t("status_paused") : t("status_running")}</span>
        ${over ? `<span class="badge err">⚠ ${t("overtime")}</span>` : ""}</div>
      ${sub}
      <div class="job-sub">${homeEsc(stName)}</div>
      <div class="job-timer" data-timer>${t("elapsed")}: …</div>
      <div class="job-btns">
        ${paused
          ? `<button class="btn small" data-act="resume">${t("resume")}</button>`
          : `<button class="btn small ghost" data-act="pause">${t("pause")}</button>`}
        <button class="btn small primary" data-act="finish">${t("finish")}</button>
      </div>
    </div>`;
  }).join("");

  $$("#homeRunning .job-card").forEach((card) => {
    const id = card.dataset.id;
    card.querySelectorAll("button[data-act]").forEach((b) => {
      b.onclick = () => Report.action(id, b.dataset.act);
    });
  });
  Home.tick();
};

Home.paintWos = function () {
  const box = $("#homeWo");
  const list = Home.data.wos;
  const notes = [
    Home.data.woDone ? t("as_done_hidden", { n: Home.data.woDone }) : "",
    Home.data.future ? t("home_future_n", { n: Home.data.future }) : "",
  ].filter(Boolean);
  const more = notes.length
    ? `<p class="muted" style="font-size:14px;margin:10px 0 0">${notes.join("　·　")}</p>` : "";
  if (!list.length) { box.innerHTML = `<p class="muted">${t("home_no_wo")}</p>` + more; return; }

  box.innerHTML = list.map((a) => {
    const tag = a.when === "over"
      ? `<span class="badge err">${t("home_overdue")} ${a.due_date}</span>`
      : a.when === "today"
        ? `<span class="badge go">${t("home_today")}</span>`
        : `<span class="badge mute">${t("home_no_date")}</span>`;
    const stTag = a.station ? ` · 🔧 ${homeEsc(a.station)}` : "";
    // 就算做完了也保留報工鈕：可能要補做、或退貨重做
    const btn = `<button class="btn small ${a.finished ? "ghost" : "primary"}" data-wo="${homeAttr(a.work_order_no)}" data-st="${homeAttr(a.station || "")}">${t("act_report")}</button>`;
    // 顆數進度：有總數就顯示 2 / 5，沒有就只在做過時顯示已完成幾顆
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
    return `<div class="job-card${a.finished ? " home-done" : ""}" style="border-left-color:${a.finished ? "var(--muted)" : (a.when === "over" ? "var(--err)" : "var(--c1)")}">
      <div class="job-head"><strong>${homeEsc(a.work_order_no)}</strong>${btn}</div>
      <div class="job-sub">${homeEsc(a.customer || "")} ${homeEsc(a.product_name || "")}${stTag}</div>
      <div class="job-sub">${tag} ${qtyTag}</div>
    </div>`;
  }).join("") + more;

  $$("#homeWo button[data-wo]").forEach((b) => {
    b.onclick = () => {
      Report._pendingWo = { wo: b.dataset.wo, st: b.dataset.st };
      App.go("report");
    };
  });
};

Home.paintTodos = function () {
  const box = $("#homeTodo");
  const list = Home.data.todos;
  const total = Home.data.todoTotal || 0;
  const more = total > list.length
    ? `<p class="muted" style="font-size:14px;margin:10px 0 0">${t("home_todo_more", { n: total - list.length })}</p>` : "";
  if (!list.length) { box.innerHTML = `<p class="muted">${t("home_no_todo")}</p>`; return; }
  box.innerHTML = list.map((r) => {
    const tag = r.when === "over"
      ? `<span class="badge err">${t("home_overdue")} ${r.due_date}</span>`
      : r.when === "today" ? `<span class="badge go">${t("home_today")}</span>`
      : r.when === "future" ? `<span class="badge mute">📅 ${r.due_date}</span>` : "";
    return `<div class="home-todo">
      <span class="home-pri" style="background:${Todo.priColor(r.priority)}">${r.priority}</span>
      <span class="home-todo-txt">${homeEsc(r.content)}</span>
      <span class="home-todo-tag">${tag}<span class="muted" style="font-size:14px">${Number(r.progress) || 0}%</span></span>
      <button class="btn small go" data-done="${r.id}">${t("home_mark_done")}</button>
    </div>`;
  }).join("") + more;

  $$("#homeTodo button[data-done]").forEach((b) => {
    b.onclick = async () => {
      const { error } = await sb.from("todos").update({ progress: 100, done: true }).eq("id", b.dataset.done);
      if (error) return toast(friendlyErr(error), "err");
      toast(t("ok"), "ok");
      await Home.loadTodos();
      Home.paint();
    };
  });
};

// 每秒更新進行中卡片的計時
Home.tick = function () {
  const list = Home.data.running;
  if (!list || !list.length) return;
  const now = Date.now();
  const p2 = (n) => String(n).padStart(2, "0");
  $$("#homeRunning .job-card").forEach((card) => {
    const j = list.find((x) => x.id === card.dataset.id);
    if (!j) return;
    let openPauseMs = 0;
    if (j.status === "paused" && j.paused_at) openPauseMs = now - new Date(j.paused_at).getTime();
    const ms = (now - new Date(j.start_at).getTime()) - Number(j.paused_minutes || 0) * 60000 - openPauseMs;
    let sec = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(sec / 3600); sec %= 3600;
    const el = card.querySelector("[data-timer]");
    if (el) el.textContent = `⏱ ${p2(hh)}:${p2(Math.floor(sec / 60))}:${p2(sec % 60)}`;
  });
};

// 報工動作（暫停/繼續/結束）完成後，若人在看板頁就即時刷新
Home.refreshIfActive = function () {
  if (App.activeView === "home" && App.ME) Home.render();
};
