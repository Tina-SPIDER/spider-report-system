# 報工 + 績效計分系統（Supabase 版，不用 Apps Script）

純網頁系統，手機與電腦用瀏覽器即可操作。中文 / 越南文雙語。

## 功能
- 帳號密碼登入（雙語）
- 報工：輸入工單號自動帶出品名/規格/貨編 → 選工序站 → 開始/暫停/繼續/結束，可同時開多張工單
- 個人績效：今日 / 本月得分與明細（沿用工單得分制：各工站比例分數加總）
- 團體績效：班組排行（= 組員個人得分加總）
- 主管後台：員工管理、工單匯入、製程分數表、全員總覽

---

## 檔案結構
```
report-system/
├─ index.html              主頁（登入＋報工＋績效＋後台）
├─ css/style.css
├─ js/ config.js i18n.js auth.js report.js score.js admin.js
└─ supabase/
   ├─ schema.sql           建表 + 權限 + 計分函式
   ├─ seed.sql             工站/範例資料 + 建第一位主管步驟
   └─ functions/create-employee/index.ts   建帳號 Edge Function
```

---

## 部署步驟

### 1. 建 Supabase 專案
1. 到 https://supabase.com 註冊、New Project（免費方案即可）。
2. 專案建好後到 **Project Settings → API**，記下：
   - **Project URL**
   - **anon public key**

### 2. 建資料庫
1. 左側 **SQL Editor → New query**，把 `supabase/schema.sql` 整段貼上 → **Run**。
2. 再新開一個 query，貼 `supabase/seed.sql` → **Run**（建立工站與範例資料）。

### 3. 建第一位主管
1. **Authentication → Users → Add user**
   - Email：`admin@report.local`
   - Password：自訂（例 `Admin@1234`），勾 **Auto Confirm User**
2. 點該使用者，複製 **User UID**。
3. SQL Editor 執行（把 UID 換掉）：
   ```sql
   insert into public.employees (id, account, name, team, role, lang)
   values ('貼上UID', 'admin', '管理員', '管理', '主管', 'zh');
   ```

### 4. 部署建帳號 Edge Function
需先安裝 Supabase CLI（https://supabase.com/docs/guides/cli）。
```bash
supabase login
supabase link --project-ref <你的專案ref>
supabase functions deploy create-employee
```
> 之後主管在後台「員工管理」新增員工，就會呼叫這個函式自動建帳號。

### 5. 設定前端連線
編輯 `js/config.js`，把兩行換成你的：
```js
window.SUPABASE_URL      = "https://xxxx.supabase.co";
window.SUPABASE_ANON_KEY = "你的 anon public key";
```

### 6. 上線（擇一）
- **GitHub Pages**：把 `report-system` 整個資料夾推到 GitHub repo → Settings → Pages → 選分支 → 取得網址。
- **Netlify**：到 app.netlify.com 直接把資料夾拖進去 → 立即有網址。
- 本機測試：用 VS Code「Live Server」開 `index.html`（不要用 file:// 直接開，登入會被瀏覽器擋）。

---

## 開始使用
1. 用 `admin / 你設的密碼` 登入。
2. 後台 **員工管理** → 新增員工（設帳號、密碼、班組、語言、角色）。
3. 後台 **工單匯入** → 每行一筆：`工單號,貨編,品名,規格,客戶`。
4. 後台 **製程分數表** → 設定各貨編每個工站的比例分數（同貨編各站加總建議＝1.0）。
5. 員工登入 → **報工** → 查工單 → 選工序 → 開始/暫停/結束。
6. 績效自動計算，於 **我的績效 / 團體績效** 查看。

## 計分規則
- 結束報工時，依 `(貨編, 工站)` 在製程分數表取得該站比例分數。
- 狀態：**有效**（正常得分）/ **待設定**（缺貨編或未設比例，0 分）/ **重複**（同人同工單同工站重做，0 分）/ **已轉移**（換人做同工單同工站，分數歸新人）。
- 設定好比例後，後台「重算待設定」可把待設定紀錄補算回去。
- 個人月得分 = 當月所有「有效」分數加總；班組得分 = 組員個人得分加總。
