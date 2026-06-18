-- ============================================================
--  範例資料 + 第一位主管建立步驟
--  在 schema.sql 執行成功後，再執行本檔
-- ============================================================

-- ---------- 1) 工站 / 工序清單（請依貴公司實際製程調整） ----------
insert into public.stations (code, name_zh, name_vi, sort_order) values
  ('010','切割','Cắt',        10),
  ('020','鑽孔','Khoan',      20),
  ('030','折彎','Uốn',        30),
  ('040','焊接','Hàn',        40),
  ('050','研磨','Mài',        50),
  ('060','組裝','Lắp ráp',    60),
  ('070','檢驗','Kiểm tra',   70),
  ('080','包裝','Đóng gói',   80)
on conflict (code) do update
  set name_zh=excluded.name_zh, name_vi=excluded.name_vi, sort_order=excluded.sort_order;

-- ---------- 2) 範例工單（之後可在後台「工單匯入」批次匯入） ----------
insert into public.work_orders (work_order_no, sku, product_name, spec, customer) values
  ('WO-0001','SKU-A','鋁合金支架','120x80x3mm','客戶甲'),
  ('WO-0002','SKU-B','不鏽鋼托盤','300x200x20mm','客戶乙')
on conflict (work_order_no) do update
  set sku=excluded.sku, product_name=excluded.product_name,
      spec=excluded.spec, customer=excluded.customer;

-- ---------- 3) 範例製程分數表（同一貨編各站加總 = 1.0） ----------
insert into public.score_rules (sku, product_name, station, ratio) values
  ('SKU-A','鋁合金支架','010',0.2),
  ('SKU-A','鋁合金支架','020',0.2),
  ('SKU-A','鋁合金支架','060',0.3),
  ('SKU-A','鋁合金支架','070',0.1),
  ('SKU-A','鋁合金支架','080',0.2),
  ('SKU-B','不鏽鋼托盤','010',0.3),
  ('SKU-B','不鏽鋼托盤','040',0.4),
  ('SKU-B','不鏽鋼托盤','070',0.1),
  ('SKU-B','不鏽鋼托盤','080',0.2)
on conflict (sku, station) do update set ratio=excluded.ratio;

-- ============================================================
--  4) 建立第一位主管（無法純 SQL 完成，請照步驟）
-- ============================================================
--  步驟一：Supabase Dashboard → Authentication → Users → Add user
--          Email 填： admin@report.local
--          Password 自訂（例如 Admin@1234），勾選 Auto Confirm User
--          建立後點該使用者，複製其 User UID
--
--  步驟二：把下面 <貼上UID> 換成剛複製的 UID，執行這段：
--
--  insert into public.employees (id, account, name, team, role, lang)
--  values ('<貼上UID>', 'admin', '管理員', '管理', '主管', 'zh');
--
--  之後即可用「帳號 admin / 你設的密碼」登入，
--  再到後台「員工管理」用畫面新增其他員工（不必再進 Dashboard）。
-- ============================================================
