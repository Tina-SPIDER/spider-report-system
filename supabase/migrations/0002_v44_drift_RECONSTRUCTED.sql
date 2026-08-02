-- ============================================================
--  0002_v44_drift_RECONSTRUCTED.sql
--
--  目的：把「線上 v44 DB 相對於 0001 基線多出來的物件」用 DDL 重建成草稿，
--        依據 100% 來自前端 JS 的實際用法（sb.from / sb.rpc / sb.storage）反推。
--
--  ⚠️ 全檔皆為 DRAFT。每個物件都標了來源檔:行號。
--     欄位型別、預設值、限制、索引多為「合理推測」，RPC 內部邏輯無法從前端得知。
--     >>> 上線前務必用線上 pg_dump --schema-only 比對，以線上為準。<<<
--     驗證步驟見 supabase/VERIFY.md。
--
--  盤點基準檔：
--    js/report.js  js/admin.js  js/score.js  js/incident.js  js/todo.js
--    js/auth.js    js/config.js  supabase/functions/create-employee/index.ts
-- ============================================================

-- ============================================================
--  A. 新資料表（0001 完全沒有）
-- ============================================================

-- ------------------------------------------------------------
-- machines：機台主檔
-- DRAFT: reconstructed from frontend usage
--   (report.js:13  select code,name,active / eq active / order code)
--   (admin.js:342 upsert {code,name,active} onConflict code ignoreDuplicates)
--   (admin.js:351 select code,name,active order code)
--   (admin.js:366 update {active} eq code / admin.js:373 delete eq code)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
create table if not exists public.machines (
  code        text primary key,                    -- DRAFT: 前端以 code 當唯一鍵 upsert/update/delete
  name        text not null,                        -- DRAFT: 顯示名稱；新增時 name=code
  active      boolean not null default true,
  created_at  timestamptz not null default now()    -- DRAFT: 前端未用，補上以利稽核
);

-- ------------------------------------------------------------
-- work_order_routes：工單製程路線（每張工單多個工序/工站）
-- DRAFT: reconstructed from frontend usage
--   (report.js:107 select seq,station,station_type,drawing_path eq work_order_no order seq)
--   (report.js:328 select work_order_no,station,drawing_path in work_order_no)
--   (admin.js:435 select seq,station eq work_order_no order seq)
--   (admin.js:514 select seq,station,station_type eq work_order_no order seq)
--   (admin.js:705 upsert {work_order_no,seq,station,station_type,drawing_file} onConflict work_order_no,seq)
--   MUST verify against live pg_dump
-- 注意：ERP 匯入寫入的是 drawing_file（圖檔檔名），但前端讀圖走 drawing_path
--       （storage 內的物件 key）。兩者為不同欄位，二者對應關係（何時/如何由
--       drawing_file 產生 drawing_path）在前端看不到 —— TODO: 向線上確認。
-- ------------------------------------------------------------
create table if not exists public.work_order_routes (
  work_order_no text not null,                        -- DRAFT: 對應 work_orders.work_order_no
  seq           text not null,                        -- DRAFT: 製程代碼/序（前端當字串顯示與排序 order seq）
  station       text not null,                        -- DRAFT: 站名（對應 stations.code，ERP 以站名為主）
  station_type  text,                                 -- DRAFT: 站別，前端用 '工作站' 判斷是否計入完成度（其餘視為委外）
  drawing_path  text,                                 -- DRAFT: storage bucket 'drawings' 內的物件路徑（讀圖用）
  drawing_file  text,                                 -- DRAFT: ERP 匯入的原始圖檔檔名
  created_at    timestamptz not null default now(),
  unique (work_order_no, seq)                          -- DRAFT: 前端 upsert onConflict=work_order_no,seq
);
create index if not exists idx_wor_wo on public.work_order_routes (work_order_no);

-- ------------------------------------------------------------
-- assignments：工單指派（主管派工給員工）
-- DRAFT: reconstructed from frontend usage
--   (report.js:276 select work_order_no,station,due_date,assigned_by eq employee_id order due_date)
--   (admin.js:448 upsert {work_order_no,employee_id,station,due_date,assigned_by} onConflict work_order_no,employee_id)
--   (admin.js:455 select id,work_order_no,station,due_date,assigned_by,created_at)
--   (admin.js:477 delete eq id)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),  -- DRAFT: 前端以 id 刪除
  work_order_no text not null,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  station       text,                                        -- DRAFT: 可為空（前端 station 可為 null＝任意站）
  due_date      date,                                        -- DRAFT: 前端 <input type=date>
  assigned_by   uuid references public.employees(id),        -- DRAFT: 指派人
  created_at    timestamptz not null default now(),
  unique (work_order_no, employee_id)                          -- DRAFT: 前端 upsert onConflict=work_order_no,employee_id
);
create index if not exists idx_assign_emp on public.assignments (employee_id);

-- ------------------------------------------------------------
-- incidents：異常回報（員工提報，主管處理）
-- DRAFT: reconstructed from frontend usage
--   (incident.js:26 insert {employee_id,category,content})
--   (incident.js:35 select category,content,status,created_at eq employee_id order created_at)
--   (admin.js:383 select id,category,content,status,created_at,employees(name,team) order created_at)
--   (admin.js:405 update {status} eq id  /  admin.js:412 delete eq id)
--   status 值：前端出現 '待處理'（預設）與 '已處理'
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
create table if not exists public.incidents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  category     text not null,                          -- DRAFT: 類別（可含「其他：xxx」）
  content      text not null,
  status       text not null default '待處理'          -- DRAFT: check 值由前端字串推得
                 check (status in ('待處理','已處理')),
  created_at   timestamptz not null default now()
);
create index if not exists idx_incidents_emp on public.incidents (employee_id, created_at);

-- ------------------------------------------------------------
-- todos：員工待辦（員工自記，主管可看）
-- DRAFT: reconstructed from frontend usage
--   (todo.js:22 insert {employee_id,content,priority,due_date})
--   (todo.js:29 select id,content,priority,progress,due_date,created_at eq employee_id order priority,created_at)
--   (todo.js:59 update {priority} / todo.js:66 update {progress,done} / todo.js:72 update {due_date} / todo.js:78 delete)
--   (admin.js:312 select content,priority,progress,due_date,created_at,employees(name,team) order created_at)
--   MUST verify against live pg_dump
-- ------------------------------------------------------------
create table if not exists public.todos (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  content      text not null,
  priority     int not null default 3,                 -- DRAFT: 前端 1~5
  progress     int not null default 0,                 -- DRAFT: 0~100（%）
  done         boolean not null default false,         -- DRAFT: todo.js:66 與 progress>=100 連動寫入
  due_date     date,
  created_at   timestamptz not null default now()
);
create index if not exists idx_todos_emp on public.todos (employee_id);

-- ============================================================
--  B. 既有資料表新增欄位（0001 已有表，v44 加了欄）
-- ============================================================

-- work_orders：ERP 匯入的材質/表面處理
-- DRAFT: reconstructed from frontend usage
--   (report.js:101-103 讀 material_body / material_second / surface_treatment)
--   (admin.js:676-677 ERP 匯入寫入這三欄)
--   MUST verify against live pg_dump
alter table public.work_orders add column if not exists material_body      text;  -- DRAFT: 材質(本體)
alter table public.work_orders add column if not exists material_second    text;  -- DRAFT: 第二添加材質
alter table public.work_orders add column if not exists surface_treatment  text;  -- DRAFT: 表面處理

-- jobs：機台與工作內容
-- DRAFT: reconstructed from frontend usage
--   (report.js:54,346,351 讀 j.machine / j.work_content；loadRunning select *)
--   (admin.js:87,217 select ... machine, work_content)
--   (admin.js:281 update {work_content,...}；report.js:441 end_job 傳 p_work_content 寫入)
--   MUST verify against live pg_dump
alter table public.jobs add column if not exists machine       text;  -- DRAFT: 機台代碼（對應 machines.code，可空）
alter table public.jobs add column if not exists work_content  text;  -- DRAFT: 工作內容（結束報工時填）

-- stations：站別權重
-- DRAFT: reconstructed from frontend usage
--   (admin.js:807 select code,name_zh,weight order name_zh)
--   (admin.js:823 update {weight} eq code；前端預設值 1，step 0.5)
--   MUST verify against live pg_dump
-- ⚠️ 語意漂移：0001 的計分模型走 score_rules(sku,station,ratio)，但 v44 後台
--    「站別權重」改成編輯 stations.weight。這代表 end_job / recompute_pending /
--    team_scores 的計分邏輯很可能已改用 stations.weight，schema.sql 內的
--    end_job / recompute_pending 本體恐已過時。務必以線上 pg_dump 為準。
alter table public.stations add column if not exists weight numeric(6,2) default 1;  -- DRAFT

-- ============================================================
--  C. RPC（函式）
-- ============================================================

-- ------------------------------------------------------------
-- start_job：v44 多了 p_machine 參數（0001 只有 p_work_order_no, p_station）
-- DRAFT: reconstructed from frontend usage
--   (report.js:259 sb.rpc('start_job',{p_work_order_no,p_station,p_machine}))
--   簽名可重建；本體為在 0001 版基礎上把 machine 一併寫入 jobs。
--   MUST verify against live pg_dump（本體邏輯以線上為準）
-- ------------------------------------------------------------
create or replace function public.start_job(
  p_work_order_no text, p_station text, p_machine text default null)
returns public.jobs language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_job public.jobs;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  insert into public.jobs(employee_id, work_order_no, station, machine, status, start_at)
  values (v_uid, p_work_order_no, p_station, p_machine, 'running', now())
  returning * into v_job;
  return v_job;
end; $$;
grant execute on function public.start_job(text,text,text) to authenticated;

-- ------------------------------------------------------------
-- end_job：v44 多了 p_work_content 參數（0001 為 uuid,numeric,numeric,text）
-- DRAFT: reconstructed from frontend usage
--   (report.js:440 sb.rpc('end_job',{p_job_id,p_qty,p_scrap,p_note,p_work_content}))
--   (admin.js:272 強制結束只傳 {p_job_id} → 其餘參數需有預設值)
--   ⚠️ 計分本體無法從前端重建，且很可能已改用 stations.weight（見上）。
--   下方本體僅在 0001 版上補寫 work_content，計分段落原樣保留＝很可能與線上不符。
--   TODO: dump real body from live DB
-- ------------------------------------------------------------
create or replace function public.end_job(
  p_job_id uuid, p_qty numeric default null, p_scrap numeric default null,
  p_note text default null, p_work_content text default null)
returns public.score_log language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
  v_add numeric := 0;
  v_minutes numeric;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.employee_id <> v_uid and not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  if v_job.status = 'done' then raise exception 'ALREADY_DONE'; end if;

  if v_job.status = 'paused' and v_job.paused_at is not null then
    v_add := extract(epoch from (now() - v_job.paused_at)) / 60.0;
  end if;
  v_minutes := extract(epoch from (now() - v_job.start_at)) / 60.0 - v_job.paused_minutes - v_add;
  if v_minutes < 0 then v_minutes := 0; end if;

  update public.jobs
     set status='done', end_at=now(),
         paused_minutes = paused_minutes + v_add, paused_at=null,
         work_minutes = round(v_minutes, 2),
         qty=p_qty, scrap_qty=p_scrap, note=p_note,
         work_content = p_work_content       -- DRAFT: v44 新增
   where id=p_job_id returning * into v_job;

  -- TODO: body unknown, dump from live DB
  --   計分/寫 score_log 的實際邏輯（是否改用 stations.weight、如何處理重複/轉移）
  --   請以線上 pg_dump 的 end_job 本體為準，勿沿用本草稿。
  raise exception 'END_JOB_BODY_IS_DRAFT: dump real body from live DB before use';
end; $$;
grant execute on function public.end_job(uuid,numeric,numeric,text,text) to authenticated;

-- ------------------------------------------------------------
-- team_scores：v44 新 RPC，取代 0001 的 team_scoreboard
-- DRAFT: reconstructed from frontend usage
--   (score.js:78 sb.rpc('team_scores',{p_year,p_month,p_today}))
--   前端讀取回傳欄位：team, today, month（score.js:87-91）
--   簽名＋回傳型別可重建；彙總本體（今日/本月分數如何計算）不可得。
--   TODO: body unknown, dump from live DB
-- ------------------------------------------------------------
create or replace function public.team_scores(p_year int, p_month int, p_today text)
returns table(team text, today numeric, month numeric)
language sql security definer stable as $$
  -- TODO: body unknown, dump from live DB.
  -- 下列為佔位查詢，只為讓簽名/回傳結構成立，計分邏輯未必正確：
  select coalesce(e.team,'(未分組)') as team,
         coalesce(sum(s.score) filter (where to_char(s.created_at,'YYYY-MM-DD') = p_today), 0) as today,
         coalesce(sum(s.score), 0) as month
  from public.score_log s
  join public.employees e on e.id = s.employee_id
  where s.status = '有效'
    and extract(year  from s.created_at) = p_year
    and extract(month from s.created_at) = p_month
  group by coalesce(e.team,'(未分組)')
  order by month desc;
$$;
grant execute on function public.team_scores(int,int,text) to authenticated;

-- ------------------------------------------------------------
-- admin_reset_password：v44 新 RPC，主管重設員工密碼
-- DRAFT: reconstructed from frontend usage
--   (admin.js:576 sb.rpc('admin_reset_password',{p_employee_id,p_new_password}))
--   本體無法從前端重建：需更新 auth.users 密碼（通常於 security definer
--   函式內 update auth.users set encrypted_password=crypt(...)，或由後端處理）。
--   下方僅寫出簽名＋主管檢查，實作留白。
--   TODO: body unknown, dump from live DB
-- ------------------------------------------------------------
create or replace function public.admin_reset_password(p_employee_id uuid, p_new_password text)
returns void language plpgsql security definer as $$
begin
  if not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  -- TODO: body unknown, dump from live DB.
  -- 實作可能為： update auth.users
  --   set encrypted_password = crypt(p_new_password, gen_salt('bf'))
  --   where id = p_employee_id;  （需 pgcrypto，且函式屬 postgres/service 角色）
  raise exception 'ADMIN_RESET_PASSWORD_BODY_IS_DRAFT: dump real body from live DB before use';
end; $$;
grant execute on function public.admin_reset_password(uuid,text) to authenticated;

-- ============================================================
--  D. Storage bucket
-- ============================================================
-- DRAFT: reconstructed from frontend usage
--   (report.js:156,246 sb.storage.from('drawings').createSignedUrl(path,3600))
--   工單圖面存於此 bucket；drawing_path 為物件 key。
--   Storage bucket 與其 storage.objects RLS 政策需在線上確認。
--   MUST verify against live pg_dump / Storage settings
insert into storage.buckets (id, name, public)
values ('drawings', 'drawings', false)     -- DRAFT: 假設為 private（前端用 signed url）
on conflict (id) do nothing;
-- TODO: drawings 的 storage.objects RLS 政策未知，dump from live DB。

-- ============================================================
--  完。RLS 政策草稿見 0003_rls_draft.sql。
-- ============================================================
