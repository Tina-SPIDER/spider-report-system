// ============================================================
//  我的待辦（員工自記、主管可看）
// ============================================================
window.Todo = {};

const todoEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Todo.render = function () {
  $("#btnTodoAdd").onclick = Todo.add;
  $("#todoInput").onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); Todo.add(); } };
  Todo.load();
};

Todo.priColor = (n) => ({ 1: "#dc2626", 2: "#ea580c", 3: "#d97706", 4: "#0891b2", 5: "#94a3b8" }[n] || "#94a3b8");

Todo.add = async function () {
  const c = $("#todoInput").value.trim();
  if (!c) return;
  const priority = Number($("#todoPri").value) || 3;
  const due = $("#todoDate").value || null;
  const { error } = await sb.from("todos").insert({ employee_id: App.ME.id, content: c, priority, due_date: due });
  if (error) return toast(t("err") + ": " + error.message, "err");
  $("#todoInput").value = ""; $("#todoDate").value = "";
  Todo.load();
};

Todo.load = async function () {
  const { data, error } = await sb.from("todos")
    .select("id,content,priority,progress,due_date,created_at").eq("employee_id", App.ME.id)
    .order("priority").order("created_at", { ascending: false });
  if (error) return toast(t("err") + ": " + error.message, "err");
  const rows = data || [];

  // 平均完成度
  const total = rows.length;
  const avg = total ? Math.round(rows.reduce((s, r) => s + (Number(r.progress) || 0), 0) / total) : 0;
  $("#todoSummary").innerHTML = total ? `
    <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px">
      <span class="muted">${t("completion")}</span><strong>${avg}%</strong></div>
    <div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden">
      <div style="height:100%;width:${avg}%;background:var(--go)"></div></div>` : "";

  if (rows.length === 0) { $("#todoList").innerHTML = `<p class="muted">${t("todo_empty")}</p>`; return; }
  $("#todoList").innerHTML = rows.map((r) => {
    const full = Number(r.progress) >= 100;
    return `
    <div class="todo-row" style="display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
      <input type="number" min="1" max="5" value="${r.priority}" data-pri="${r.id}" style="width:48px;text-align:center" title="${t("priority")}">
      <span class="todo-content" style="flex:1;min-width:120px;${full ? "text-decoration:line-through;color:#999" : ""}">${todoEsc(r.content)}</span>
      <input type="date" value="${r.due_date || ""}" data-due="${r.id}" style="width:150px" title="${t("todo_due")}">
      <input type="number" min="0" max="100" step="10" value="${Number(r.progress) || 0}" data-prog="${r.id}" style="width:66px;text-align:center">
      <span class="muted" style="font-size:13px">%</span>
      <button class="btn small" data-del="${r.id}" style="background:#fee2e2;color:#dc2626">${t("act_delete")}</button>
    </div>`;
  }).join("");
  $$("#todoList [data-pri]").forEach((inp) => {
    inp.onchange = async () => {
      const { error } = await sb.from("todos").update({ priority: Number(inp.value) || 3 }).eq("id", inp.dataset.pri);
      if (error) toast(t("err") + ": " + error.message, "err"); else Todo.load();
    };
  });
  $$("#todoList [data-prog]").forEach((inp) => {
    inp.onchange = async () => {
      let v = Number(inp.value) || 0; v = Math.max(0, Math.min(100, v));
      const { error } = await sb.from("todos").update({ progress: v, done: v >= 100 }).eq("id", inp.dataset.prog);
      if (error) toast(t("err") + ": " + error.message, "err"); else Todo.load();
    };
  });
  $$("#todoList [data-due]").forEach((inp) => {
    inp.onchange = async () => {
      const { error } = await sb.from("todos").update({ due_date: inp.value || null }).eq("id", inp.dataset.due);
      if (error) toast(t("err") + ": " + error.message, "err");
    };
  });
  $$("#todoList [data-del]").forEach((b) => {
    b.onclick = async () => {
      const { error } = await sb.from("todos").delete().eq("id", b.dataset.del);
      if (error) return toast(t("err") + ": " + error.message, "err");
      Todo.load();
    };
  });
};
