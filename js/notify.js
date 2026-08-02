// ============================================================
//  通知（右上角鈴鐺）
//   員工：主管指派了工單給你
//   主管：有人回報異常（待處理）
//  「已讀」狀態存在瀏覽器 localStorage，不需要新增資料表。
//  換裝置會重新出現一次未讀，這是刻意取捨——寧可多提醒也不要漏掉。
// ============================================================
window.Notify = { items: [], timer: null, open: false };

const nEsc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const N_KEY = "notify_seen_v1";

Notify.seen = {
  all() { try { return JSON.parse(localStorage.getItem(N_KEY)) || {}; } catch (e) { return {}; } },
  get(kind) { return (this.all()[App.ME.id] || {})[kind] || "1970-01-01T00:00:00Z"; },
  markAll() {
    const a = this.all();
    const now = new Date().toISOString();
    a[App.ME.id] = { assign: now, incident: now };
    localStorage.setItem(N_KEY, JSON.stringify(a));
  },
};

Notify.start = function () {
  if (!App.ME) return;
  $("#btnBell").classList.remove("hide");
  $("#btnBell").onclick = Notify.toggle;
  document.addEventListener("click", (e) => {
    if (Notify.open && !e.target.closest("#notifyPanel") && !e.target.closest("#btnBell")) Notify.close();
  });
  Notify.load();
  clearInterval(Notify.timer);
  Notify.timer = setInterval(Notify.load, 60000);   // 每分鐘檢查一次
};

Notify.stop = function () {
  clearInterval(Notify.timer); Notify.timer = null;
  Notify.close();
  $("#btnBell").classList.add("hide");
};

Notify.load = async function () {
  if (!App.ME) return;
  const items = [];

  // 1) 指派給我的工單（自己指派給自己的不算）
  const { data: as } = await sb.from("assignments")
    .select("id,work_order_no,station,due_date,created_at,assigned_by")
    .eq("employee_id", App.ME.id)
    .order("created_at", { ascending: false }).limit(20);
  const list = (as || []).filter((a) => a.assigned_by !== App.ME.id);
  if (list.length) {
    const ids = [...new Set(list.map((a) => a.assigned_by).filter(Boolean))];
    const nameMap = {};
    if (ids.length) {
      const { data: es } = await sb.from("employees").select("id,name").in("id", ids);
      (es || []).forEach((e) => (nameMap[e.id] = e.name));
    }
    const seenAt = Notify.seen.get("assign");
    list.forEach((a) => items.push({
      kind: "assign", at: a.created_at, unread: a.created_at > seenAt,
      icon: "📌",
      title: t("nt_assigned", { wo: a.work_order_no }),
      sub: [a.station ? "🔧 " + a.station : "", a.due_date ? "📅 " + a.due_date : "",
        nameMap[a.assigned_by] ? t("assigner") + ": " + nameMap[a.assigned_by] : ""].filter(Boolean).join("　"),
      go: { view: "report", wo: a.work_order_no, st: a.station || "" },
    }));
  }

  // 2) 主管：待處理的異常回報
  if (["主管", "組長"].includes(App.ME.role)) {
    const { data: inc } = await sb.from("incidents")
      .select("id,category,content,created_at,status,employee_id")
      .eq("status", "待處理")
      .order("created_at", { ascending: false }).limit(20);
    const rows = inc || [];
    if (rows.length) {
      const ids = [...new Set(rows.map((r) => r.employee_id).filter(Boolean))];
      const nameMap = {};
      if (ids.length) {
        const { data: es } = await sb.from("employees").select("id,name").in("id", ids);
        (es || []).forEach((e) => (nameMap[e.id] = e.name));
      }
      const seenAt = Notify.seen.get("incident");
      rows.forEach((r) => items.push({
        kind: "incident", at: r.created_at, unread: r.created_at > seenAt,
        icon: "⚠️",
        title: t("nt_incident", { who: nameMap[r.employee_id] || "", cat: r.category || "" }),
        sub: String(r.content || "").slice(0, 60),
        go: { view: "admin", atab: "incident" },
      }));
    }
  }

  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  Notify.items = items;
  Notify.paintBadge();
  if (Notify.open) Notify.paintPanel();
};

Notify.paintBadge = function () {
  const n = Notify.items.filter((x) => x.unread).length;
  const b = $("#bellDot");
  if (!b) return;
  b.textContent = n > 99 ? "99+" : String(n);
  b.classList.toggle("hide", n === 0);
};

Notify.toggle = function (e) {
  if (e) e.stopPropagation();
  Notify.open ? Notify.close() : Notify.openPanel();
};

Notify.openPanel = function () {
  Notify.open = true;
  $("#notifyPanel").classList.remove("hide");
  Notify.paintPanel();
};

Notify.close = function () {
  Notify.open = false;
  $("#notifyPanel").classList.add("hide");
};

Notify.paintPanel = function () {
  const box = $("#notifyList");
  const items = Notify.items;
  if (!items.length) {
    box.innerHTML = `<p class="muted" style="padding:12px">${t("nt_empty")}</p>`;
  } else {
    box.innerHTML = items.slice(0, 30).map((it, i) => `
      <button class="nt-item${it.unread ? " unread" : ""}" data-i="${i}">
        <span class="nt-icon">${it.icon}</span>
        <span class="nt-body">
          <span class="nt-title">${nEsc(it.title)}</span>
          ${it.sub ? `<span class="nt-sub">${nEsc(it.sub)}</span>` : ""}
          <span class="nt-time">${it.at ? fmtDate(it.at) + " " + fmtTime(it.at) : ""}</span>
        </span>
      </button>`).join("");
    $$("#notifyList .nt-item").forEach((b) => {
      b.onclick = () => {
        const it = Notify.items[Number(b.dataset.i)];
        Notify.close();
        if (!it || !it.go) return;
        if (it.go.view === "report" && it.go.wo) Report._pendingWo = { wo: it.go.wo, st: it.go.st };
        if (it.go.atab) Admin.tab = it.go.atab;
        App.go(it.go.view);
      };
    });
  }
  $("#btnNotifyRead").onclick = () => {
    Notify.seen.markAll();
    Notify.items.forEach((x) => (x.unread = false));
    Notify.paintBadge(); Notify.paintPanel();
  };
};
