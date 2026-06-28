// ============================================================
//  雙語字典（中文 zh / 越南文 vi）
// ============================================================
window.I18N = {
  zh: {
    app_title: "通產工業 生產報工系統",
    login: "登入", logout: "登出",
    account: "帳號", password: "密碼", login_btn: "登入",
    welcome: "歡迎",

    nav_report: "報工", nav_score: "我的績效", nav_team: "團體績效", nav_admin: "管理",
    nav_incident: "異常回報", nav_todo: "我的待辦",
    todo_ph: "輸入待辦事項…", todo_empty: "目前沒有待辦事項", admin_todos: "員工待辦",
    priority: "優先", completion: "平均完成度", progress_col: "完成%", todo_due: "預計完成日",
    inc_category: "類別", inc_quality: "品質異常", inc_equipment: "設備異常", inc_hours: "時數異常", inc_other: "其他",
    inc_other_ph: "請說明類別", inc_content: "內容", inc_content_ph: "請描述異常情形…",
    submit: "送出", inc_sent: "已送出回報", inc_my: "我的回報紀錄", admin_incident: "異常回報",

    // 報工
    wo_no: "工單號碼", query: "查詢",
    product: "品名", spec: "規格", sku: "貨編",
    material_body: "材質:本體", material_second: "材質:第二添加&拋光",
    surface: "表面處理", customer: "客戶",
    work_content: "作業內容", work_content_ph: "現場填寫作業內容",
    new_station: "➕ 新增站名…", new_station_ph: "輸入新的站名",
    machine: "使用機台", select_machine: "請選擇機台（可不選）", view_drawing: "📐 查看圖面", no_drawing: "（此站無圖面）",
    new_machine: "➕ 新增機台…", new_machine_ph: "輸入機台名稱",
    machine_usage: "機台使用率", in_use: "使用中", idle: "閒置",
    admin_machmgr: "機台管理", mach_add_hint: "一行一台，可一次貼上多台機台名稱", machine_list: "機台清單",
    today_use_min: "今日使用(分)", util: "使用率%", unspecified: "(未指定)",
    station: "工序站", select_station: "請選擇工序",
    start: "開始工作", pause: "暫停", resume: "繼續", finish: "結束報工",
    running_jobs: "進行中工單",
    qty: "完成數量", scrap: "報廢數量", note: "備註",
    confirm: "確認", cancel: "取消",
    elapsed: "已工作", minutes: "分鐘",
    status_running: "進行中", status_paused: "已暫停",
    wo_not_found: "查無此工單", no_running: "目前沒有進行中的工單",
    my_assignments: "我的指派工單", no_assignments: "目前沒有指派的工單",
    act_report: "報工", admin_assign: "工單指派", assign: "指派",
    select_employee: "選擇員工", assigned_list: "已指派清單", any_station: "（不指定站別）", due_date: "製作日期", assigner: "指派人",
    finish_title: "結束報工",

    // 績效
    today_score: "今日得分", month_score: "本月得分", score_detail: "得分明細",
    date: "日期", score: "分數", status: "狀態",
    team: "班組", team_rank: "班組排行", total: "合計", member: "成員",
    your_team: "你的班組",
    valid: "有效", pending: "待設定", duplicate: "重複", transferred: "已轉移",

    // 管理
    admin_emp: "員工管理", admin_wo: "工單匯入", admin_score: "站別權重", admin_overview: "全員總覽",
    weight: "權重", weight_hint: "一張工單滿分 10 分，依各站權重分配給該工單的廠內製程站。改完權重請按「重算待設定」補算先前未計分的紀錄。",
    admin_jobs: "報工紀錄", work_min: "工時(分)", status_done: "已完成", from: "起", to: "迄",
    actions: "操作", act_edit: "編輯", act_delete: "刪除", act_forceend: "強制結束",
    export_excel: "匯出 Excel", confirm_delete: "確定刪除這筆報工？",
    edit_job: "更正報工", saved_del: "已刪除",
    reset_pw: "重設密碼", enter_new_pw: "請輸入新密碼（至少 6 碼）", pw_reset_ok: "密碼已重設",
    admin_progress: "工單進度", progress_pct: "完成度", maker_done: "完成者", done_time: "完成時間",
    progress_done: "完成", progress_undone: "未完成", outsourced: "委外", query_wo_first: "請輸入查詢內容",
    pg_search_ph: "工單號碼 / 客戶 / 品名", found_n: "找到 {n} 筆，點選查看", act_view: "查看",
    grp_monitor: "即時監看", grp_records: "派工與紀錄", grp_data: "基本資料",
    admin_dash: "即時看板", dash_running: "進行中", dash_done: "完成筆數", dash_min: "時數(分)",
    yield: "良率%", dash_auto: "每 20 秒自動更新", dash_people: "在線人數", dash_total_qty: "今日總產量",
    dash_total_min: "今日總時數(分)",
    dash_now: "目前正在製作", dash_status_block: "今日報工狀態", dash_attend: "應報工 / 未報工",
    dash_maker: "製作者", dash_duration: "已製作(分)", dash_cumulative: "累計時數(分)",
    reported: "已報工", not_reported: "未報工",
    remind_title: "⚠️ 上次未完成的報工", got_it: "知道了",
    name: "姓名", role: "角色", lang: "語言", active: "啟用",
    add: "新增", save: "儲存", ratio: "比例分數", recompute: "重算待設定",
    import: "匯入", import_hint: "每行一筆，以逗號分隔：工單號,貨編,品名,規格,客戶",
    erp_title: "每日匯入：加工製程明細表 (.xls)",
    erp_hint: "直接選 ERP 匯出的「加工製程單明細」檔，系統自動讀取工單、製程站、材質、表面處理並更新。",
    erp_importing: "讀取與匯入中，請稍候…",
    erp_done: "✅ 匯入完成：工單 {wo} 張、製程 {r} 筆、新站 {s} 個",
    erp_no_header: "❌ 找不到表頭，請確認是 ERP 的「加工製程明細表」檔",
    other_import: "其他匯入方式（簡易格式）",
    wo_file_title: "方式一：上傳 Excel 檔",
    wo_file_hint: "選擇 .xlsx / .csv 檔，欄位順序：工單號、貨編、品名、規格、客戶（有標題列會自動跳過）",
    wo_paste_title: "方式二：手打或從 Excel 複製貼上",
    wo_file_preview: "讀到 {n} 筆，將匯入…",
    manager: "主管", employee: "員工",
    add_emp: "新增員工", emp_account: "帳號", emp_password: "密碼",
    add_rule: "新增分數列",

    // 通用
    err: "錯誤", ok: "完成", no_data: "無資料", loading: "載入中…",
    err_login: "帳號或密碼錯誤", err_network: "網路不穩，請稍後再試", err_expired: "登入已過期，請重新登入", err_generic: "操作失敗，請再試一次",
    detail: "詳細資料", overtime: "逾時未結束", show_pw: "顯示/隱藏密碼",
    saved: "已儲存", created: "已建立", recomputed_n: "已重算 {n} 筆",
  },
  vi: {
    app_title: "Thông Sản · Hệ thống báo công sản xuất",
    login: "Đăng nhập", logout: "Đăng xuất",
    account: "Tài khoản", password: "Mật khẩu", login_btn: "Đăng nhập",
    welcome: "Xin chào",

    nav_report: "Báo công", nav_score: "Thành tích", nav_team: "Thành tích nhóm", nav_admin: "Quản lý",
    nav_incident: "Báo bất thường", nav_todo: "Việc cần làm",
    todo_ph: "Nhập việc cần làm…", todo_empty: "Chưa có việc cần làm", admin_todos: "Việc của NV",
    priority: "Ưu tiên", completion: "Hoàn thành TB", progress_col: "Hoàn thành%", todo_due: "Ngày dự kiến",
    inc_category: "Loại", inc_quality: "Bất thường chất lượng", inc_equipment: "Bất thường thiết bị", inc_hours: "Bất thường giờ công", inc_other: "Khác",
    inc_other_ph: "Nhập loại khác", inc_content: "Nội dung", inc_content_ph: "Mô tả tình huống…",
    submit: "Gửi", inc_sent: "Đã gửi báo cáo", inc_my: "Lịch sử báo cáo", admin_incident: "Báo bất thường",

    wo_no: "Số lệnh SX", query: "Tra cứu",
    product: "Tên SP", spec: "Quy cách", sku: "Mã hàng",
    material_body: "Vật liệu: thân", material_second: "VL: phụ gia & đánh bóng",
    surface: "Xử lý bề mặt", customer: "Khách hàng",
    work_content: "Nội dung công việc", work_content_ph: "Nhập nội dung công việc",
    new_station: "➕ Thêm công đoạn…", new_station_ph: "Nhập tên công đoạn mới",
    machine: "Máy sử dụng", select_machine: "Chọn máy (có thể bỏ qua)", view_drawing: "📐 Xem bản vẽ", no_drawing: "(Trạm này không có bản vẽ)",
    new_machine: "➕ Thêm máy…", new_machine_ph: "Nhập tên máy",
    machine_usage: "Tỷ lệ sử dụng máy", in_use: "Đang dùng", idle: "Nhàn rỗi",
    admin_machmgr: "Quản lý máy", mach_add_hint: "Mỗi dòng một máy, có thể dán nhiều máy", machine_list: "Danh sách máy",
    today_use_min: "Dùng hôm nay (phút)", util: "Tỷ lệ%", unspecified: "(Chưa chọn)",
    station: "Công đoạn", select_station: "Chọn công đoạn",
    start: "Bắt đầu", pause: "Tạm dừng", resume: "Tiếp tục", finish: "Kết thúc",
    running_jobs: "Đơn đang làm",
    qty: "Số lượng hoàn thành", scrap: "Số phế", note: "Ghi chú",
    confirm: "Xác nhận", cancel: "Hủy",
    elapsed: "Đã làm", minutes: "phút",
    status_running: "Đang làm", status_paused: "Tạm dừng",
    wo_not_found: "Không tìm thấy lệnh", no_running: "Không có đơn đang làm",
    my_assignments: "Đơn được giao", no_assignments: "Chưa có đơn được giao",
    act_report: "Báo công", admin_assign: "Giao lệnh SX", assign: "Giao",
    select_employee: "Chọn nhân viên", assigned_list: "Danh sách đã giao", any_station: "(Không chỉ định)", due_date: "Ngày làm", assigner: "Người giao",
    finish_title: "Kết thúc báo công",

    today_score: "Điểm hôm nay", month_score: "Điểm tháng này", score_detail: "Chi tiết điểm",
    date: "Ngày", score: "Điểm", status: "Trạng thái",
    team: "Nhóm", team_rank: "Xếp hạng nhóm", total: "Tổng", member: "Thành viên",
    your_team: "Nhóm của bạn",
    valid: "Hợp lệ", pending: "Chờ thiết lập", duplicate: "Trùng", transferred: "Đã chuyển",

    admin_emp: "Quản lý NV", admin_wo: "Nhập lệnh SX", admin_score: "Trọng số CĐ", admin_overview: "Tổng quan",
    weight: "Trọng số", weight_hint: "Mỗi lệnh SX tối đa 10 điểm, chia theo trọng số các công đoạn nội bộ. Sửa xong bấm \"Tính lại\" để cập nhật bản ghi chưa tính.",
    admin_jobs: "Hồ sơ báo công", work_min: "Phút", status_done: "Hoàn thành", from: "Từ", to: "Đến",
    actions: "Thao tác", act_edit: "Sửa", act_delete: "Xóa", act_forceend: "Kết thúc",
    export_excel: "Xuất Excel", confirm_delete: "Xóa bản ghi này?",
    edit_job: "Sửa báo công", saved_del: "Đã xóa",
    reset_pw: "Đặt lại MK", enter_new_pw: "Nhập mật khẩu mới (≥6)", pw_reset_ok: "Đã đặt lại mật khẩu",
    admin_progress: "Tiến độ lệnh SX", progress_pct: "Tiến độ", maker_done: "Người làm", done_time: "Thời gian xong",
    progress_done: "Xong", progress_undone: "Chưa", outsourced: "Gia công ngoài", query_wo_first: "Nhập nội dung tìm",
    pg_search_ph: "Số lệnh / Khách hàng / Tên SP", found_n: "Tìm thấy {n}, bấm để xem", act_view: "Xem",
    grp_monitor: "Theo dõi", grp_records: "Giao việc & hồ sơ", grp_data: "Dữ liệu cơ bản",
    admin_dash: "Bảng theo dõi", dash_running: "Đang làm", dash_done: "Số đơn xong", dash_min: "Phút",
    yield: "Tỷ lệ đạt%", dash_auto: "Tự cập nhật mỗi 20 giây", dash_people: "Đang làm việc", dash_total_qty: "Tổng SL hôm nay",
    dash_total_min: "Tổng phút hôm nay",
    dash_now: "Đang sản xuất", dash_status_block: "Tình trạng báo công hôm nay", dash_attend: "Cần báo / Chưa báo",
    dash_maker: "Người làm", dash_duration: "Đã làm (phút)", dash_cumulative: "Tổng phút",
    reported: "Đã báo", not_reported: "Chưa báo",
    remind_title: "⚠️ Báo công chưa hoàn thành", got_it: "Đã hiểu",
    name: "Họ tên", role: "Vai trò", lang: "Ngôn ngữ", active: "Kích hoạt",
    add: "Thêm", save: "Lưu", ratio: "Hệ số điểm", recompute: "Tính lại",
    import: "Nhập", import_hint: "Mỗi dòng một bản ghi, ngăn bởi dấu phẩy: số lệnh,mã hàng,tên SP,quy cách,khách hàng",
    erp_title: "Nhập hàng ngày: bảng chi tiết công đoạn (.xls)",
    erp_hint: "Chọn tệp \"加工製程單明細\" xuất từ ERP, hệ thống tự đọc lệnh SX, công đoạn, vật liệu, xử lý bề mặt.",
    erp_importing: "Đang đọc và nhập, vui lòng đợi…",
    erp_done: "✅ Hoàn tất: {wo} lệnh SX, {r} công đoạn, {s} trạm mới",
    erp_no_header: "❌ Không tìm thấy tiêu đề, hãy kiểm tra đúng tệp ERP",
    other_import: "Cách nhập khác (định dạng đơn giản)",
    wo_file_title: "Cách 1: Tải tệp Excel",
    wo_file_hint: "Chọn tệp .xlsx / .csv, thứ tự cột: số lệnh, mã hàng, tên SP, quy cách, khách hàng (tự bỏ qua dòng tiêu đề)",
    wo_paste_title: "Cách 2: Gõ tay hoặc dán từ Excel",
    wo_file_preview: "Đọc được {n} dòng, đang nhập…",
    manager: "Quản lý", employee: "Nhân viên",
    add_emp: "Thêm nhân viên", emp_account: "Tài khoản", emp_password: "Mật khẩu",
    add_rule: "Thêm dòng điểm",

    err: "Lỗi", ok: "Xong", no_data: "Không có dữ liệu", loading: "Đang tải…",
    err_login: "Sai tài khoản hoặc mật khẩu", err_network: "Mạng không ổn định, thử lại sau", err_expired: "Phiên đăng nhập hết hạn, đăng nhập lại", err_generic: "Thao tác thất bại, thử lại",
    detail: "Chi tiết", overtime: "Quá giờ chưa kết thúc", show_pw: "Hiện/ẩn mật khẩu",
    saved: "Đã lưu", created: "Đã tạo", recomputed_n: "Đã tính lại {n} bản ghi",
  },
};

window.LANG = localStorage.getItem("lang") || "zh";

window.t = function (k, vars) {
  const dict = window.I18N[window.LANG] || window.I18N.zh;
  let s = dict[k] != null ? dict[k] : (window.I18N.zh[k] != null ? window.I18N.zh[k] : k);
  if (vars) for (const key in vars) s = s.replace("{" + key + "}", vars[key]);
  return s;
};

// 取工站在目前語言下的名稱
window.stationName = function (st) {
  if (!st) return "";
  return window.LANG === "vi" ? (st.name_vi || st.name_zh) : (st.name_zh || st.name_vi);
};

window.setLang = function (l) {
  window.LANG = l;
  localStorage.setItem("lang", l);
  window.applyI18n();
  if (typeof window.renderActiveView === "function") window.renderActiveView();
};

// 套用所有 data-i18n 標籤
window.applyI18n = function () {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = window.t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    el.placeholder = window.t(el.getAttribute("data-i18n-ph"));
  });
  document.documentElement.lang = window.LANG === "vi" ? "vi" : "zh-Hant";
};
