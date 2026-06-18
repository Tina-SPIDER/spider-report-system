-- ============================================================
--  報工 + 績效計分系統  資料庫結構 (Supabase / PostgreSQL)
--  使用方式：Supabase Dashboard → SQL Editor → 整段貼上 → Run
--  可重複執行（含 drop / create or replace）
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 資料表 ----------

-- 員工主檔（id 對應 auth.users）
create table if not exists public.employees (
  id          uuid primary key references auth.users(id) on delete cascade,
  account     text unique not null,                 -- 帳號（工號）
  name        text not null,                         -- 姓名
  team        text,                                  -- 班組（A組/B組…）
  role        text not null default '員工' check (role in ('員工','主管')),
  lang        text not null default 'zh'  check (lang in ('zh','vi')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 工站 / 工序清單
create table if not exists public.stations (
  code        text primary key,    -- 代號 010
  name_zh     text not null,       -- 中文名
  name_vi     text not null,       -- 越南文名
  sort_order  int default 0
);

-- 工單主檔（由主管匯入）
create table if not exists public.work_orders (
  work_order_no text primary key,  -- 工單號碼
  sku           text,              -- 貨編
  product_name  text,              -- 品名
  spec          text,              -- 規格
  customer      text,              -- 客戶
  created_at    timestamptz not null default now()
);

-- 貨編製程分數表（每個貨編的各工站比例分數，整張工單滿分=各站加總=1.0）
create table if not exists public.score_rules (
  id           bigint generated always as identity primary key,
  sku          text not null,
  product_name text,
  station      text not null,      -- 對應 stations.code
  ratio        numeric(5,3),       -- 比例分數 0~1（空白=待設定）
  note         text,
  unique (sku, station)
);

-- 報工紀錄（核心）
create table if not exists public.jobs (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees(id),
  work_order_no  text not null,
  station        text not null,
  status         text not null default 'running' check (status in ('running','paused','done')),
  start_at       timestamptz not null default now(),
  paused_at      timestamptz,                       -- 目前暫停起點（null=未暫停）
  paused_minutes numeric(10,2) not null default 0,  -- 累計暫停分鐘
  end_at         timestamptz,
  work_minutes   numeric(10,2),                     -- 實際工時（已扣暫停）
  qty            numeric,                           -- 生產數量（選填）
  scrap_qty      numeric,                           -- 報廢數量（選填）
  note           text,
  created_at     timestamptz not null default now()
);

-- 得分紀錄（結束報工時自動產生）
create table if not exists public.score_log (
  id            bigint generated always as identity primary key,
  job_id        uuid references public.jobs(id) on delete cascade,
  employee_id   uuid not null references public.employees(id),
  work_order_no text not null,
  sku           text,
  product_name  text,
  station        text not null,
  score         numeric(5,3) not null default 0,
  status        text not null check (status in ('有效','待設定','重複','已轉移')),
  created_at    timestamptz not null default now()
);

create index if not exists idx_jobs_emp_status on public.jobs (employee_id, status);
create index if not exists idx_scorelog_emp     on public.score_log (employee_id, created_at);
create index if not exists idx_scorelog_wo_st   on public.score_log (work_order_no, station);

-- ---------- 權限判斷小工具 ----------
create or replace function public.is_manager()
returns boolean language sql security definer stable as $$
  select exists(select 1 from public.employees where id = auth.uid() and role = '主管');
$$;

-- ============================================================
--  Row Level Security（資料列權限）
-- ============================================================
alter table public.employees   enable row level security;
alter table public.stations    enable row level security;
alter table public.work_orders enable row level security;
alter table public.score_rules enable row level security;
alter table public.jobs        enable row level security;
alter table public.score_log   enable row level security;

-- employees：所有登入者可讀（看姓名/班組）；主管可改
drop policy if exists emp_select on public.employees;
create policy emp_select on public.employees for select to authenticated using (true);
drop policy if exists emp_mgr on public.employees;
create policy emp_mgr on public.employees for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- 主檔（工站/工單/分數表）：登入者可讀；主管可增刪改
drop policy if exists st_select on public.stations;
create policy st_select on public.stations for select to authenticated using (true);
drop policy if exists st_mgr on public.stations;
create policy st_mgr on public.stations for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select to authenticated using (true);
drop policy if exists wo_mgr on public.work_orders;
create policy wo_mgr on public.work_orders for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists sr_select on public.score_rules;
create policy sr_select on public.score_rules for select to authenticated using (true);
drop policy if exists sr_mgr on public.score_rules;
create policy sr_mgr on public.score_rules for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- jobs：本人或主管可讀（寫入一律走 RPC 函式）
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
  using (employee_id = auth.uid() or public.is_manager());

-- score_log：本人或主管可讀
drop policy if exists sl_select on public.score_log;
create policy sl_select on public.score_log for select to authenticated
  using (employee_id = auth.uid() or public.is_manager());

-- ============================================================
--  報工流程 RPC（security definer，內含本人/主管檢查）
-- ============================================================

-- 開始工單
create or replace function public.start_job(p_work_order_no text, p_station text)
returns public.jobs language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_job public.jobs;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  insert into public.jobs(employee_id, work_order_no, station, status, start_at)
  values (v_uid, p_work_order_no, p_station, 'running', now())
  returning * into v_job;
  return v_job;
end; $$;

-- 暫停
create or replace function public.pause_job(p_job_id uuid)
returns public.jobs language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_job public.jobs;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.employee_id <> v_uid and not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  if v_job.status <> 'running' then return v_job; end if;
  update public.jobs set status='paused', paused_at=now() where id=p_job_id returning * into v_job;
  return v_job;
end; $$;

-- 繼續
create or replace function public.resume_job(p_job_id uuid)
returns public.jobs language plpgsql security definer as $$
declare v_uid uuid := auth.uid(); v_job public.jobs; v_add numeric;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.employee_id <> v_uid and not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  if v_job.status <> 'paused' then return v_job; end if;
  v_add := extract(epoch from (now() - v_job.paused_at)) / 60.0;
  update public.jobs
     set status='running', paused_minutes = paused_minutes + coalesce(v_add,0), paused_at=null
   where id=p_job_id returning * into v_job;
  return v_job;
end; $$;

-- 結束報工（同時計分）
create or replace function public.end_job(
  p_job_id uuid, p_qty numeric default null, p_scrap numeric default null, p_note text default null)
returns public.score_log language plpgsql security definer as $$
declare
  v_uid uuid := auth.uid();
  v_job public.jobs;
  v_add numeric := 0;
  v_minutes numeric;
  v_sku text; v_product text;
  v_ratio numeric;
  v_status text;
  v_score numeric := 0;
  v_existing public.score_log;
  v_has_existing boolean := false;
  v_log public.score_log;
begin
  select * into v_job from public.jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.employee_id <> v_uid and not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  if v_job.status = 'done' then raise exception 'ALREADY_DONE'; end if;

  -- 若結束時仍在暫停，補上最後一段暫停時間
  if v_job.status = 'paused' and v_job.paused_at is not null then
    v_add := extract(epoch from (now() - v_job.paused_at)) / 60.0;
  end if;
  v_minutes := extract(epoch from (now() - v_job.start_at)) / 60.0 - v_job.paused_minutes - v_add;
  if v_minutes < 0 then v_minutes := 0; end if;

  update public.jobs
     set status='done', end_at=now(),
         paused_minutes = paused_minutes + v_add, paused_at=null,
         work_minutes = round(v_minutes, 2),
         qty=p_qty, scrap_qty=p_scrap, note=p_note
   where id=p_job_id returning * into v_job;

  -- 帶出品名/貨編
  select sku, product_name into v_sku, v_product
    from public.work_orders where work_order_no = v_job.work_order_no;

  -- 查比例分數
  if v_sku is not null then
    select ratio into v_ratio from public.score_rules
      where sku = v_sku and station = v_job.station;
  end if;

  -- 找同工單同工站既有「有效」紀錄
  select * into v_existing from public.score_log
    where work_order_no = v_job.work_order_no and station = v_job.station and status = '有效'
    order by created_at desc limit 1;
  v_has_existing := found;

  if v_sku is null or v_ratio is null then
    v_status := '待設定'; v_score := 0;
  elsif v_has_existing and v_existing.employee_id = v_job.employee_id then
    v_status := '重複'; v_score := 0;
  elsif v_has_existing and v_existing.employee_id <> v_job.employee_id then
    update public.score_log set status='已轉移' where id = v_existing.id;
    v_status := '有效'; v_score := v_ratio;
  else
    v_status := '有效'; v_score := v_ratio;
  end if;

  insert into public.score_log(job_id, employee_id, work_order_no, sku, product_name, station, score, status)
  values (v_job.id, v_job.employee_id, v_job.work_order_no, v_sku, v_product, v_job.station, v_score, v_status)
  returning * into v_log;

  return v_log;
end; $$;

-- ============================================================
--  績效查詢 RPC
-- ============================================================

-- 班組排行（所有登入者可看；只回總分，不含個資明細）
create or replace function public.team_scoreboard(p_year int, p_month int)
returns table(team text, total numeric)
language sql security definer stable as $$
  select coalesce(e.team,'(未分組)') as team, coalesce(sum(s.score),0) as total
  from public.score_log s
  join public.employees e on e.id = s.employee_id
  where s.status = '有效'
    and extract(year  from s.created_at) = p_year
    and extract(month from s.created_at) = p_month
  group by coalesce(e.team,'(未分組)')
  order by total desc;
$$;

-- 全員總覽（僅主管）
create or replace function public.member_scoreboard(p_year int, p_month int)
returns table(employee_id uuid, name text, team text, total numeric)
language plpgsql security definer stable as $$
begin
  if not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  return query
    select e.id, e.name, e.team,
           coalesce(sum(s.score) filter (where s.status='有效'), 0) as total
    from public.employees e
    left join public.score_log s on s.employee_id = e.id
      and extract(year  from s.created_at) = p_year
      and extract(month from s.created_at) = p_month
    where e.active
    group by e.id, e.name, e.team
    order by total desc;
end; $$;

-- 重算「待設定」紀錄（主管設定好 ratio 後呼叫）
create or replace function public.recompute_pending()
returns int language plpgsql security definer as $$
declare r record; v_ratio numeric; v_cnt int := 0; v_existing public.score_log; v_has boolean;
begin
  if not public.is_manager() then raise exception 'FORBIDDEN'; end if;
  for r in select * from public.score_log where status = '待設定' loop
    if r.sku is null then continue; end if;
    select ratio into v_ratio from public.score_rules where sku = r.sku and station = r.station;
    if v_ratio is null then continue; end if;
    select * into v_existing from public.score_log
      where work_order_no = r.work_order_no and station = r.station and status='有效' and id <> r.id
      order by created_at desc limit 1;
    v_has := found;
    if v_has and v_existing.employee_id = r.employee_id then
      update public.score_log set status='重複', score=0 where id = r.id;
    elsif v_has then
      update public.score_log set status='已轉移' where id = v_existing.id;
      update public.score_log set status='有效', score=v_ratio where id = r.id;
    else
      update public.score_log set status='有效', score=v_ratio where id = r.id;
    end if;
    v_cnt := v_cnt + 1;
  end loop;
  return v_cnt;
end; $$;

-- ---------- RPC 執行權限 ----------
grant execute on function public.start_job(text,text)              to authenticated;
grant execute on function public.pause_job(uuid)                   to authenticated;
grant execute on function public.resume_job(uuid)                  to authenticated;
grant execute on function public.end_job(uuid,numeric,numeric,text)to authenticated;
grant execute on function public.team_scoreboard(int,int)          to authenticated;
grant execute on function public.member_scoreboard(int,int)        to authenticated;
grant execute on function public.recompute_pending()               to authenticated;
grant execute on function public.is_manager()                      to authenticated;

-- 完成。接著請執行 seed.sql 建立工站與第一位主管。
