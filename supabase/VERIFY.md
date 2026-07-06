# 線上 Schema 驗證手冊（VERIFY.md）

本專案的 `supabase/migrations/0002_v44_drift_RECONSTRUCTED.sql` 與 `0003_rls_draft.sql`
**全部是依前端 JS 用法反推的草稿**，型別、預設值、限制、RPC 本體、RLS 政策都可能與線上
v44 DB 不符。本手冊教你如何把線上 DB 的「真實 schema」匯出，並與草稿逐項比對。

> 目標：讓草稿 → 校準成與線上一致的「可信 migration」，之後再納入正式版控。

---

## 0. 前置：安裝 / 登入

```bash
# 安裝 Supabase CLI（擇一）
npm i -g supabase            # 或： brew install supabase/tap/supabase

supabase --version
supabase login               # 會開瀏覽器取得 access token
```

Project ref：`gnuelffwtemdgjeeaswp`（見 js/config.js 的 SUPABASE_URL）。

你需要 DB 連線字串或直連密碼：
Supabase Dashboard → Project Settings → Database → Connection string（URI）。
把它存成環境變數，避免留在指令歷史：

```bash
export DB_URL='postgresql://postgres:[YOUR-PASSWORD]@db.gnuelffwtemdgjeeaswp.supabase.co:5432/postgres'
```

---

## 1. 匯出線上 schema（只匯結構，不含資料）

用 `pg_dump`，只取 public schema 的結構：

```bash
pg_dump "$DB_URL" \
  --schema-only \
  --schema=public \
  --no-owner --no-privileges \
  --file=supabase/_live_public.sql
```

也建議另外單獨匯出 storage schema（bucket 定義）與 auth 相關（若需要）：

```bash
pg_dump "$DB_URL" --schema-only --schema=storage --no-owner --no-privileges \
  --file=supabase/_live_storage.sql
```

> `supabase/_live_*.sql` 已建議加入 .gitignore（見下方 §6），因為可能含機敏資訊，
> 僅作本機比對用，不要提交。

替代法（不裝 CLI）：Dashboard → Database → 直接看各表結構；或用 SQL Editor 執行 §3 的查詢。

---

## 2. 與 0002 草稿 diff

先把兩邊都「正規化」再比，避免排序/空白造成雜訊。最簡單是人工對照，或：

```bash
# 快速看線上有哪些 public 表 / 函式
grep -E 'CREATE TABLE' supabase/_live_public.sql
grep -E 'CREATE FUNCTION|CREATE OR REPLACE FUNCTION' supabase/_live_public.sql

# 與草稿並排（用你習慣的 diff 工具）
code --diff supabase/migrations/0002_v44_drift_RECONSTRUCTED.sql supabase/_live_public.sql
# 或
git diff --no-index supabase/migrations/0002_v44_drift_RECONSTRUCTED.sql supabase/_live_public.sql
```

**逐項檢查清單（草稿 vs 線上）：**

- [ ] `machines`：欄位（code/name/active/…）、型別、PK、預設值
- [ ] `work_order_routes`：seq 是文字還是整數？drawing_path 與 drawing_file 是否都存在、如何連動
- [ ] `assignments`：唯一鍵是否 (work_order_no, employee_id)、是否有 on delete cascade
- [ ] `incidents`：status 的 check 值是否只有「待處理/已處理」
- [ ] `todos`：是否有 done 欄、priority/progress 範圍限制
- [ ] `work_orders`：material_body / material_second / surface_treatment 是否存在、型別
- [ ] `jobs`：machine / work_content 是否存在、型別
- [ ] `stations`：weight 欄型別與預設值

**RPC 本體（草稿只是佔位，務必以線上為準）：**

```sql
-- 在 SQL Editor 執行，取出函式完整定義
select p.proname,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'start_job','end_job','team_scores','admin_reset_password',
    'recompute_pending','member_scoreboard','team_scoreboard',
    'pause_job','resume_job','is_manager'
  )
order by p.proname;
```

- [ ] `start_job`：參數是否為 (text,text,text)（含 p_machine）
- [ ] `end_job`：參數是否為 (uuid,numeric,numeric,text,text)（含 p_work_content）；**計分邏輯是否已改用 stations.weight**
- [ ] `team_scores`：回傳欄位是否 (team, today, month)、彙總邏輯
- [ ] `admin_reset_password`：實際如何改密碼（更新 auth.users？）
- [ ] `recompute_pending`：是否仍走 score_rules.ratio，還是改用 stations.weight

> ⚠️ 重點漂移：v44 後台「站別權重」改編輯 `stations.weight`，而 0001 基線的計分
> 走 `score_rules(sku,station,ratio)`。end_job / recompute_pending / team_scores 的
> 真實計分公式只能從線上函式本體確認，草稿不可信。

---

## 3. 逐表檢查 RLS（是否開啟 + 有哪些政策）

**(a) 每張表的 RLS 開關狀態：**

```sql
select n.nspname as schema,
       c.relname as table,
       c.relrowsecurity  as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
```

檢查：`machines, work_order_routes, assignments, incidents, todos, jobs,
score_log, employees, stations, work_orders, score_rules` 是否都 `rls_enabled = true`。
**任何一張 rls_enabled=false 的表都是資安漏洞（anon key 直連即可讀寫）。**

**(b) 列出所有政策明細：**

```sql
select schemaname, tablename, policyname,
       cmd,                      -- SELECT/INSERT/UPDATE/DELETE/ALL
       roles,
       qual        as using_expr,
       with_check  as check_expr
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;
```

拿這份結果對照 `0003_rls_draft.sql`：

- [ ] 每張新表都至少有一條 select 政策，且寫入政策符合「主管寫 / 本人寫」的預期
- [ ] `jobs` 是否真有主管的 update/delete 政策（後台直接改/刪報工需要）
- [ ] 沒有任何 `using (true)` 的 **寫入** 政策（那等於全開）
- [ ] insert 政策的 with_check 有綁 `employee_id = auth.uid()`（incidents/todos）

**(c) Storage（drawings bucket）：**

```sql
-- bucket 是否存在、是否 public
select id, name, public from storage.buckets;

-- drawings 的物件存取政策
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
```

- [ ] `drawings` bucket 存在，`public = false`（前端用 signed url，理應非公開）
- [ ] storage.objects 有限制：只有 authenticated 能讀 drawings、只有主管能上傳

---

## 4. 把校準後的結果回寫版控

1. 依 §2/§3 的實際差異，**修正** `0002` / `0003` 草稿，使其等同線上。
2. 移除已驗證物件上的 `-- DRAFT:` 註記，改標 `-- verified against live YYYY-MM-DD`。
3. RPC 本體用 §2 SQL 取出的 `pg_get_functiondef` 貼回，取代佔位版本。
4. 重新命名檔案去掉 `_RECONSTRUCTED`（例如 `0002_v44_drift.sql`），提交。

---

## 5. 之後如何避免再次漂移

- 任何線上改動一律先寫成 `supabase/migrations/NNNN_*.sql` 再套用（見 GOVERNANCE.md）。
- 用 `supabase db diff` 或定期 `pg_dump` 做「線上 vs 版控」對帳。

---

## 6. .gitignore 建議

把本機匯出的線上 dump 排除，避免誤提交機敏內容：

```
supabase/_live_public.sql
supabase/_live_storage.sql
```
