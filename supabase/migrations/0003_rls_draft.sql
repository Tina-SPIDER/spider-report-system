-- ============================================================
--  0003_rls_draft.sql
--
--  為 0002 重建的新表補 Row Level Security 政策草稿。
--
--  ⚠️ 全檔 DRAFT。政策依前端「誰讀誰寫」的行為反推：
--     - 主檔（machines / work_order_routes / assignments）：
--         authenticated 皆可讀；只有 is_manager() 可寫。
--     - 員工自填（incidents / todos）：
--         本人可 insert；本人或主管可讀；更新/刪除依前端行為分別開放。
--  上線前務必以線上 pg_dump 的實際 policies 比對（VERIFY.md 附查詢）。
--
--  依賴：public.is_manager()（見 0001）。
-- ============================================================

-- ------------------------------------------------------------
-- machines：登入者可讀；主管可增刪改
-- DRAFT: policy inferred from frontend (report.js reads; admin.js machmgr writes via 主管後台)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
alter table public.machines enable row level security;
drop policy if exists mac_select on public.machines;
create policy mac_select on public.machines for select to authenticated using (true);
drop policy if exists mac_mgr on public.machines;
create policy mac_mgr on public.machines for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ------------------------------------------------------------
-- work_order_routes：登入者可讀（報工/看板需要）；主管可寫（ERP 匯入）
-- DRAFT: policy inferred from frontend (report.js/admin.js read; admin.js:705 ERP upsert)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
alter table public.work_order_routes enable row level security;
drop policy if exists wor_select on public.work_order_routes;
create policy wor_select on public.work_order_routes for select to authenticated using (true);
drop policy if exists wor_mgr on public.work_order_routes;
create policy wor_mgr on public.work_order_routes for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ------------------------------------------------------------
-- assignments：本人可讀自己的派工；主管可讀全部並增刪改
-- DRAFT: policy inferred from frontend
--   (report.js:276 員工只讀 eq employee_id=自己；admin.js 主管 upsert/select/delete 全部)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
alter table public.assignments enable row level security;
drop policy if exists assign_select on public.assignments;
create policy assign_select on public.assignments for select to authenticated
  using (employee_id = auth.uid() or public.is_manager());
drop policy if exists assign_mgr on public.assignments;
create policy assign_mgr on public.assignments for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- ------------------------------------------------------------
-- incidents：本人可 insert 並讀自己的；主管可讀全部並更新/刪除
-- DRAFT: policy inferred from frontend
--   (incident.js:26 員工 insert 本人；incident.js:35 讀 eq employee_id=自己)
--   (admin.js:383/405/412 主管讀全部、update status、delete)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
alter table public.incidents enable row level security;
drop policy if exists inc_select on public.incidents;
create policy inc_select on public.incidents for select to authenticated
  using (employee_id = auth.uid() or public.is_manager());
drop policy if exists inc_insert on public.incidents;
create policy inc_insert on public.incidents for insert to authenticated
  with check (employee_id = auth.uid());
drop policy if exists inc_mgr_update on public.incidents;
create policy inc_mgr_update on public.incidents for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists inc_mgr_delete on public.incidents;
create policy inc_mgr_delete on public.incidents for delete to authenticated
  using (public.is_manager());

-- ------------------------------------------------------------
-- todos：本人 insert/更新/刪除自己的；本人或主管可讀
-- DRAFT: policy inferred from frontend
--   (todo.js 全部操作皆 eq employee_id=自己；admin.js:312 主管只讀)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
alter table public.todos enable row level security;
drop policy if exists todo_select on public.todos;
create policy todo_select on public.todos for select to authenticated
  using (employee_id = auth.uid() or public.is_manager());
drop policy if exists todo_insert on public.todos;
create policy todo_insert on public.todos for insert to authenticated
  with check (employee_id = auth.uid());
drop policy if exists todo_update on public.todos;
create policy todo_update on public.todos for update to authenticated
  using (employee_id = auth.uid()) with check (employee_id = auth.uid());
drop policy if exists todo_delete on public.todos;
create policy todo_delete on public.todos for delete to authenticated
  using (employee_id = auth.uid());

-- ============================================================
--  補充：0001 既有表在 v44 疑似新增的寫入政策
--  （前端直接對 jobs 做 update/delete，但 0001 只有 jobs_select）
-- ============================================================
-- DRAFT: policy inferred from frontend
--   (admin.js:268 sb.from('jobs').delete()  /  admin.js:286 sb.from('jobs').update())
--   0001 的 jobs 只有 select 政策，寫入全走 RPC；但後台「報工紀錄」分頁
--   直接 update/delete jobs，代表線上很可能已加主管寫入政策。
--   MUST verify against live pg_dump
drop policy if exists jobs_mgr_update on public.jobs;
create policy jobs_mgr_update on public.jobs for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
drop policy if exists jobs_mgr_delete on public.jobs;
create policy jobs_mgr_delete on public.jobs for delete to authenticated
  using (public.is_manager());

-- ============================================================
--  完。Storage（drawings bucket）的 storage.objects 政策未知，
--  請於線上確認後補上（見 VERIFY.md）。
-- ============================================================
