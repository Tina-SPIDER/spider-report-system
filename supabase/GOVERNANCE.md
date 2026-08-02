# 資料庫治理（GOVERNANCE.md）

## 問題背景：schema drift（版控與線上不一致）

版控裡的 `supabase/schema.sql` 是 **v1 基線**。線上正式 DB（v44）在這之後經歷了多次
手動改動（在 Dashboard SQL Editor 直接跑 DDL），但**這些改動沒有進版控**。結果：

- `schema.sql` 已經**不代表線上現況**。
- 前端 JS（report.js / admin.js / score.js / incident.js / todo.js）大量引用了
  `schema.sql` 裡根本不存在的表、欄位與 RPC。照 `schema.sql` 重建一套 DB，前端會直接壞掉。

### 前端用到、但 v1 基線缺少的物件（已盤點）

**新表**：`machines`、`work_order_routes`、`assignments`、`incidents`、`todos`

**既有表新增欄位**：
- `work_orders` ＋ `material_body` / `material_second` / `surface_treatment`
- `jobs` ＋ `machine` / `work_content`
- `stations` ＋ `weight`

**RPC**：
- `start_job` 多 `p_machine` 參數
- `end_job` 多 `p_work_content` 參數
- 新 `team_scores(p_year, p_month, p_today)`（取代舊 `team_scoreboard`）
- 新 `admin_reset_password(p_employee_id, p_new_password)`

**Storage**：`drawings` bucket（工單圖面）

**語意漂移（最需注意）**：後台「站別權重」從 `score_rules(sku,station,ratio)` 改成編輯
`stations.weight`，代表計分公式很可能已改寫，`schema.sql` 內的 `end_job` /
`recompute_pending` 本體恐已過時。

> 完整逐行盤點（表名/欄位/RPC/參數 對應到 `檔名:行號`）見
> `migrations/0002_v44_drift_RECONSTRUCTED.sql` 內每個物件的註解。

---

## migrations/ 資料夾用法

```
supabase/
├─ schema.sql        （保留：v1 基線的原始檔，等同 0001）
├─ seed.sql          （範例資料）
└─ migrations/
   ├─ 0001_baseline.sql                  ← schema.sql 原樣搬入
   ├─ 0002_v44_drift_RECONSTRUCTED.sql   ← 依前端反推的缺失物件（草稿）
   └─ 0003_rls_draft.sql                 ← 新表 RLS 政策（草稿）
```

- **0001** 是序列起點，等於已知基線，**不代表線上**。
- **0002 / 0003** 是**草稿**：欄位型別、預設、限制、RPC 本體、RLS 都是「合理推測」，
  每個物件都標了 `-- DRAFT: ...; MUST verify against live pg_dump` 與來源 `檔名:行號`。
  無法從前端重建的 RPC 本體（如 `team_scores`、`admin_reset_password`、`end_job` 計分段）
  只寫簽名，本體標 `-- TODO: body unknown, dump from live DB`。

### 這些草稿**還不能**直接拿去建庫或覆蓋線上

正確流程（詳見 `VERIFY.md`）：

1. `pg_dump --schema-only` 把線上真實 schema 匯出。
2. 與 `0002` / `0003` 逐項 diff，修正型別/限制/RPC 本體/RLS 到與線上一致。
3. 校準後移除 `DRAFT` 註記、去掉檔名的 `_RECONSTRUCTED`，提交。這時 migrations 才可信。

---

## 往後規則（避免再次漂移）

1. **不要再直接在 Dashboard 改線上 DB 就了事。** 任何 DDL 先寫成
   `supabase/migrations/NNNN_描述.sql`，套用後立刻提交。
2. 檔名採遞增編號 `NNNN_`，內容可重複執行（`if not exists` / `create or replace` /
   `drop policy if exists`）。
3. 定期用 `supabase db diff` 或 `pg_dump` 做「線上 vs 版控」對帳，發現漂移即補 migration。
4. RLS 是安全底線：新表一律 `enable row level security` 並明確寫政策；
   別留 `using (true)` 的**寫入**政策。

---

## 這批治理工作**沒有**做的事（重要）

- 沒有更動線上任何資料或結構。
- 沒有改任何前端行為。
- 沒有驗證草稿與線上是否真的一致——那一步要由掌握 DB 連線的人依 `VERIFY.md` 執行。
