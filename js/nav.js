// ============================================================
//  主選單（可收合的分組側邊欄）
//  預設只顯示大標，點大標展開；一次只開一組。
//  切換到某個頁面時，會自動把它所屬的那一組打開，才知道自己在哪。
//  一個項目可以指向「頂層分頁」或「管理頁的某個子分頁」。
//  mgr:true 只有主管看得到；整組都看不到時，該組標題也不顯示。
// ============================================================
window.Nav = { open: null };

Nav.GROUPS = [
  { key: "mywork", icon: "📋", label: "grp_mywork", items: [
    { view: "home", label: "nav_home" },
    { view: "cal", label: "nav_cal" },
    { view: "todo", label: "nav_todo" },
  ] },
  { key: "floor", icon: "🛠️", label: "grp_floor", items: [
    { view: "report", label: "nav_report" },
    { view: "admin", atab: "assign", label: "admin_assign", mgr: true },
    { view: "admin", atab: "jobs", label: "admin_jobs", mgr: true },
    { view: "admin", atab: "ship", label: "admin_ship", mgr: true },
    { view: "incident", label: "nav_incident" },
    { view: "admin", atab: "incident", label: "admin_incident_review", mgr: true },
  ] },
  { key: "watch", icon: "📊", label: "grp_watch", items: [
    { view: "admin", atab: "dashboard", label: "admin_dash", mgr: true },
    { view: "admin", atab: "machine", label: "machine_usage", mgr: true },
    { view: "admin", atab: "progress", label: "admin_progress", mgr: true },
    { view: "admin", atab: "load", label: "admin_load", mgr: true },
  ] },
  { key: "perf", icon: "📈", label: "grp_perf", items: [
    { view: "score", label: "nav_score" },
    { view: "team", label: "nav_team" },
    { view: "admin", atab: "overview", label: "admin_overview", mgr: true },
  ] },
];

// 系統管理：釘在側邊欄最下方，只有主管看得到，一樣預設收起
Nav.SYS = { key: "sys", icon: "⚙️", label: "grp_sys", items: [
  { view: "admin", atab: "emp", label: "admin_emp" },
  { view: "admin", atab: "machmgr", label: "admin_machmgr" },
  { view: "admin", atab: "scoreplan", label: "admin_scoreplan" },
  { view: "admin", atab: "wo", label: "admin_wo" },
  { view: "admin", atab: "todos", label: "admin_todos" },
  { view: "admin", atab: "download", label: "admin_download" },
] };

Nav.canSee = function (it) { return !it.mgr || (App.ME && App.ME.role === "主管"); };

Nav.isActive = function (it) {
  return it.view === App.activeView &&
    (it.atab ? it.atab === (window.Admin ? Admin.tab : null) : !it.atab);
};

// 目前所在頁面屬於哪一組
Nav.activeGroupKey = function () {
  const all = Nav.GROUPS.concat([Nav.SYS]);
  const g = all.find((x) => x.items.filter(Nav.canSee).some(Nav.isActive));
  return g ? g.key : null;
};

Nav.render = function () {
  const mgr = App.ME && App.ME.role === "主管";
  // 只有「第一次」進來才自動展開所在的那一組；
  // 否則使用者手動把它收起來時，這裡會馬上又把它打開。
  if (!Nav._inited) { Nav._inited = true; Nav.open = Nav.activeGroupKey(); }

  const group = (g) => {
    const items = g.items.filter(Nav.canSee);
    if (!items.length) return "";
    const btns = items.map((it) =>
      `<button class="nav-item" data-view="${it.view}"${it.atab ? ` data-atab="${it.atab}"` : ""}>${t(it.label)}</button>`
    ).join("");
    return `<div class="nav-group${Nav.open === g.key ? " open" : ""}" data-g="${g.key}">
      <button class="nav-glabel" data-g="${g.key}">
        <span class="nav-gtext">${g.icon} ${t(g.label)}</span><span class="nav-caret">▸</span>
      </button>
      <div class="nav-items">${btns}</div>
    </div>`;
  };

  $("#nav").innerHTML =
    `<div class="nav-main">${Nav.GROUPS.map(group).join("")}</div>` +
    (mgr ? `<div class="nav-sys">${group(Nav.SYS)}</div>` : "");

  // 點大標：展開／收合，一次只開一組
  $$("#nav .nav-glabel").forEach((b) => {
    b.onclick = () => {
      Nav.open = (Nav.open === b.dataset.g) ? null : b.dataset.g;
      Nav.render();
    };
  });
  $$("#nav .nav-item").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.atab) Admin.tab = b.dataset.atab;
      App.go(b.dataset.view);
      document.body.classList.remove("nav-open");   // 手機：選完自動收起抽屜
    };
  });
  Nav.markActive();
};

Nav.markActive = function () {
  $$("#nav .nav-item").forEach((b) => {
    const hit = b.dataset.view === App.activeView &&
      (b.dataset.atab ? b.dataset.atab === (window.Admin ? Admin.tab : null) : !b.dataset.atab);
    b.classList.toggle("active", hit);
  });
};

// 換頁時呼叫：所在的那一組沒開就幫忙打開
Nav.setActive = function () {
  const ag = Nav.activeGroupKey();
  if (ag && Nav.open !== ag) { Nav.open = ag; Nav.render(); return; }
  Nav.markActive();
};

// 手機版抽屜
Nav.bindDrawer = function () {
  const btn = $("#btnMenu");
  if (btn) btn.onclick = (e) => { e.stopPropagation(); document.body.classList.toggle("nav-open"); };
  const sc = $("#navScrim");
  if (sc) sc.onclick = () => document.body.classList.remove("nav-open");
};
