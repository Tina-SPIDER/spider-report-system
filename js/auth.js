// ============================================================
//  共用工具 + 登入/登出 + 導覽
// ============================================================
window.App = window.App || {};
App.ME = null;          // 目前登入員工 { id, account, name, team, role, lang }
App.activeView = "home";

// ---- 小工具 ----
window.$ = (sel, root) => (root || document).querySelector(sel);
window.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

// 把技術性錯誤轉成白話
window.friendlyErr = function (e) {
  const m = ((e && e.message) ? e.message : String(e || "")).toLowerCase();
  if (m.includes("invalid login")) return t("err_login");
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed") || m.includes("fetch")) return t("err_network");
  if (m.includes("jwt") || m.includes("expired") || m.includes("not_authenticated") || m.includes("session")) return t("err_expired");
  return t("err_generic");
};

window.toast = function (msg, type) {
  const box = $("#toast");
  box.textContent = msg;
  box.className = "toast show " + (type || "");
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => (box.className = "toast"), 3000);
};

// work_orders.qty（工單總數量）目前可能還沒建欄位，探測一次並記住。
// 有欄位 → 顯示「已完成 2 / 5，還差 3」；沒有 → 只顯示「已完成 2 顆」。
App.hasWoQty = null;
App.checkWoQty = async function () {
  if (App.hasWoQty !== null) return App.hasWoQty;
  const { error } = await sb.from("work_orders").select("qty").limit(1);
  App.hasWoQty = !error;
  return App.hasWoQty;
};

// 某工單某站「已完成顆數」＝該站所有 done 報工的 qty 加總（分批報工會有多筆）
App.stationDone = function (jobs, station) {
  return (jobs || [])
    .filter((j) => j.station === station && j.status === "done")
    .reduce((a, j) => a + (Number(j.qty) || 0), 0);
};

// Excel 的日期欄可能是 Date 物件、序號(45000)或字串(2026/07/30)，統一轉成 YYYY-MM-DD
window.excelDate = function (v) {
  if (v == null || v === "") return null;
  let d = null;
  if (v instanceof Date) d = v;
  else if (typeof v === "number" && isFinite(v) && v > 20000 && v < 80000) {
    d = new Date(Math.round((v - 25569) * 86400000));       // Excel 1900 日期系統
  } else {
    const s = String(v).trim().replace(/\//g, "-");
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (!d || isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

window.fmtDate = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
window.fmtTime = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(x.getHours())}:${p(x.getMinutes())}`;
};

// ---- 啟動 ----
App.init = async function () {
  applyI18n();

  // 語言切換鈕
  $("#langZh").onclick = () => setLang("zh");
  $("#langVi").onclick = () => setLang("vi");

  // 登入表單
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    await App.login($("#inAccount").value.trim(), $("#inPassword").value);
  };
  // 密碼顯示/隱藏
  const pwBtn = $("#btnPwToggle");
  if (pwBtn) pwBtn.onclick = () => {
    const p = $("#inPassword");
    p.type = p.type === "password" ? "text" : "password";
    pwBtn.textContent = p.type === "password" ? "👁" : "🙈";
  };
  $("#btnLogout").onclick = App.logout;

  // 導覽
  $$("#nav button").forEach((b) => {
    b.onclick = () => App.go(b.dataset.view);
  });

  // 已登入？
  const { data: { session } } = await sb.auth.getSession();
  if (session) await App.loadProfile();
  else App.showLogin();
};

App.showLogin = function () {
  $("#loginView").classList.remove("hide");
  $("#appView").classList.add("hide");
  $("#btnLogout").classList.add("hide");
  $("#whoami").textContent = "";
};

App.login = async function (account, password) {
  if (!account || !password) return toast(t("err"), "err");
  const email = `${account}@report.local`;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return toast(friendlyErr(error), "err");
  await App.loadProfile();
};

App.loadProfile = async function () {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return App.showLogin();
  const { data, error } = await sb.from("employees").select("*").eq("id", user.id).single();
  if (error || !data) {
    toast(t("err") + ": profile", "err");
    await sb.auth.signOut();
    return App.showLogin();
  }
  App.ME = data;
  if (data.lang) setLang(data.lang);

  $("#whoami").textContent = `${t("welcome")}, ${data.name}` + (data.team ? ` (${data.team})` : "");
  $("#btnLogout").classList.remove("hide");
  $("#btnMenu").classList.remove("hide");
  // 「工具/下載」只有主管用得到
  const tools = $("#btnTools");
  tools.classList.toggle("hide", data.role !== "主管");
  tools.onclick = () => { Admin.tab = "download"; App.go("admin"); };

  Nav.render();
  Nav.bindDrawer();
  Notify.start();

  $("#loginView").classList.add("hide");
  $("#appView").classList.remove("hide");
  App.go("home");
};

App.logout = async function () {
  await sb.auth.signOut();
  App.ME = null;
  if (window.Notify) Notify.stop();
  document.body.classList.remove("nav-open");
  App.showLogin();
};

// 切換分頁
App.go = function (view) {
  App.activeView = view;
  if (view === "report") Report._remind = true;   // 進報工頁要提醒未完成
  $$(".view").forEach((v) => v.classList.toggle("hide", v.id !== "view-" + view));
  if (window.Nav) Nav.setActive();
  window.renderActiveView();
};

window.renderActiveView = function () {
  if (!App.ME) return;
  // 離開管理頁就停掉看板自動更新
  if (App.activeView !== "admin" && window.Admin && Admin.dashTimer) {
    clearInterval(Admin.dashTimer); Admin.dashTimer = null;
  }
  // 離開看板頁就停掉計時器
  if (App.activeView !== "home" && window.Home && Home.timer) {
    clearInterval(Home.timer); Home.timer = null;
  }
  if (App.activeView === "home") Home.render();
  else if (App.activeView === "report") Report.render();
  else if (App.activeView === "cal") Cal.render();
  else if (App.activeView === "incident") Incident.render();
  else if (App.activeView === "todo") Todo.render();
  else if (App.activeView === "score") Score.renderMine();
  else if (App.activeView === "team") Score.renderTeam();
  else if (App.activeView === "admin") Admin.render();
};

document.addEventListener("DOMContentLoaded", App.init);
