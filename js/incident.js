// ============================================================
//  異常回報（員工端）
// ============================================================
window.Incident = {};

const incEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Incident.render = function () {
  const cat = $("#incCat");
  cat.onchange = () => $("#incOther").classList.toggle("hide", cat.value !== "其他");
  $("#incOther").classList.toggle("hide", cat.value !== "其他");
  $("#btnIncSubmit").onclick = Incident.submit;
  Incident.loadMine();
};

Incident.submit = async function () {
  let category = $("#incCat").value;
  if (category === "其他") {
    const o = $("#incOther").value.trim();
    if (!o) return toast(t("inc_other_ph"), "err");
    category = "其他：" + o;
  }
  const content = $("#incContent").value.trim();
  if (!content) return toast(t("inc_content_ph"), "err");
  const { error } = await sb.from("incidents").insert({ employee_id: App.ME.id, category, content });
  if (error) return toast(t("err") + ": " + error.message, "err");
  toast(t("inc_sent"), "ok");
  $("#incContent").value = ""; $("#incOther").value = "";
  $("#incCat").value = "品質異常"; $("#incOther").classList.add("hide");
  Incident.loadMine();
};

Incident.loadMine = async function () {
  const { data } = await sb.from("incidents")
    .select("category,content,status,created_at").eq("employee_id", App.ME.id)
    .order("created_at", { ascending: false }).limit(50);
  const rows = data || [];
  if (rows.length === 0) { $("#incMyList").innerHTML = `<p class="muted">${t("no_data")}</p>`; return; }
  const head = `<tr><th>${t("date")}</th><th>${t("inc_category")}</th><th>${t("inc_content")}</th><th>${t("status")}</th></tr>`;
  const body = rows.map((r) =>
    `<tr><td>${fmtDate(r.created_at)}</td><td>${incEsc(r.category)}</td>
     <td style="white-space:pre-wrap">${incEsc(r.content)}</td><td>${r.status}</td></tr>`
  ).join("");
  $("#incMyList").innerHTML = `<table>${head}${body}</table>`;
};
