// ============================================================
//  主選單（分組側邊欄）
//  一個項目可以指向「頂層分頁」或「管理頁的某個子分頁」，
//  所以管理後台原本的左側 tab 就不需要了（CSS 已隱藏）。
//  mgr:true 的項目只有主管看得到；整組都看不到時，該組標題也不顯示。
// ============================================================
window.Nav = { groups: [] };

Nav.GROUPS = [
  { icon: "📋", label: "grp_mywork", items: [
    { view: "home", label: "nav_home" },
    { view: "cal", label: "nav_cal" },
    { view: "todo", label: "nav_todo" },
  ] },
  { icon: "🛠️", label: "grp_floor", items: [
    { view: "report", label: "nav_report" },
    { view: "admin", atab: "assign", label: "admin_assign", mgr: true },
    { view: "admin", atab: "jobs", label: "admin_jobs", mgr: true },
    { view: "incident", label: "nav_incident" },
    { view: "admin", atab: "incident", label: "admin_incident_review", mgr: true },
  ] },
  { icon: "📊", label: "grp_watch", items: [
    { view: "admin", atab: "dashboard", label: "admin_dash", mgr: true },
    { view: "admin", atab: "machine", label: "machine_usage", mgr: true },
    { view: "admin", atab: "progress", label: "admin_progress", mgr: true },
  ] },
  { icon: "📈", label: "grp_perf", items: [
    { view: "score", label: "nav_score" },
    { view: "team", label: "nav_team" },
    { view: "admin", atab: "overview", label: "admin_overview", mgr: true },
  ] },
];

// 系統管理：釘在側邊欄最下方，只有主管看得到
Nav.SYS = { icon: "⚙️", label: "grp_sys", items: [
  { view: "admin", atab: "emp", label: "admin_emp" },
  { view: "admin", atab: "machmgr", label: "admin_machmgr" },
  { view: "admin", atab: "scoreplan", label: "admin_scoreplan" },
  { view: "admin", atab: "wo", label: "admin_wo" },
  { view: "admin", atab: "todos", label: "admin_todos" },
  { view: "admin", atab: "download", label: "admin_download" },
] };

Nav.canSee = function (it) { return !it.mgr || (App.ME && App.ME.role === "主管"); };

Nav.render = function () {
  const mgr = App.ME && App.ME.role === "主管";
  const group = (g, cls) => {
    const items = g.items.filter(Nav.canSee);
    if (!items.length) return "";
    const btns = items.map((it) =>
      `<button class="nav-item" data-view="${it.view}"${it.atab ? ` data-atab="${it.atab}"` : ""}>${t(it.label)}</button>`
    ).join("");
    return `<div class="nav-group ${cls || ""}">
      <div class="nav-glabel">${g.icon} ${t(g.label)}</div>${btns}</div>`;
  };

  $("#nav").innerHTML =
    `<div class="nav-main">${Nav.GROUPS.map((g) => group(g)).join("")}</div>` +
    (mgr ? `<div class="nav-sys">${group(Nav.SYS, "sys")}</div>` : "");

  $$("#nav .nav-item").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.atab) Admin.tab = b.dataset.atab;
      App.go(b.dataset.view);
      document.body.classList.remove("nav-open");   // 手機：選完自動收起抽屜
    };
  });
  Nav.setActive();
};

// 目前在哪一項：管理頁還要比對子分頁
Nav.setActive = function () {
  $$("#nav .nav-item").forEach((b) => {
    const hit = b.dataset.view === App.activeView &&
      (b.dataset.atab ? b.dataset.atab === (window.Admin ? Admin.tab : null) : !b.dataset.atab);
    b.classList.toggle("active", hit);
  });
};

// 手機版抽屜
Nav.bindDrawer = function () {
  const btn = $("#btnMenu");
  if (btn) btn.onclick = (e) => { e.stopPropagation(); document.body.classList.toggle("nav-open"); };
  const sc = $("#navScrim");
  if (sc) sc.onclick = () => document.body.classList.remove("nav-open");
};
