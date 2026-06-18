// ============================================================
//  共用工具 + 登入/登出 + 導覽
// ============================================================
window.App = window.App || {};
App.ME = null;          // 目前登入員工 { id, account, name, team, role, lang }
App.activeView = "report";

// ---- 小工具 ----
window.$ = (sel, root) => (root || document).querySelector(sel);
window.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

window.toast = function (msg, type) {
  const box = $("#toast");
  box.textContent = msg;
  box.className = "toast show " + (type || "");
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(() => (box.className = "toast"), 3000);
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
  if (error) return toast(t("err") + ": " + error.message, "err");
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
  // 主管才看得到「管理」分頁
  $('#nav button[data-view="admin"]').classList.toggle("hide", data.role !== "主管");

  $("#loginView").classList.add("hide");
  $("#appView").classList.remove("hide");
  App.go("report");
};

App.logout = async function () {
  await sb.auth.signOut();
  App.ME = null;
  App.showLogin();
};

// 切換分頁
App.go = function (view) {
  App.activeView = view;
  if (view === "report") Report._remind = true;   // 進報工頁要提醒未完成
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("hide", v.id !== "view-" + view));
  window.renderActiveView();
};

window.renderActiveView = function () {
  if (!App.ME) return;
  // 離開管理頁就停掉看板自動更新
  if (App.activeView !== "admin" && window.Admin && Admin.dashTimer) {
    clearInterval(Admin.dashTimer); Admin.dashTimer = null;
  }
  if (App.activeView === "report") Report.render();
  else if (App.activeView === "incident") Incident.render();
  else if (App.activeView === "todo") Todo.render();
  else if (App.activeView === "score") Score.renderMine();
  else if (App.activeView === "team") Score.renderTeam();
  else if (App.activeView === "admin") Admin.render();
};

document.addEventListener("DOMContentLoaded", App.init);
