// ============================================================
//  Edge Function: create-employee
//  主管在後台新增員工帳號時呼叫；以 service role 安全建立
//  auth 使用者並寫入 employees 主檔。
//
//  部署：
//    supabase functions deploy create-employee
//  （SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
//    為 Supabase 內建環境變數，無需另設）
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // 1) 驗證呼叫者並確認為主管
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { data: me } = await caller
      .from("employees").select("role").eq("id", user.id).single();
    if (!me || me.role !== "主管") return json({ error: "forbidden" }, 403);

    // 2) 讀取輸入
    const body = await req.json();
    const account = (body.account ?? "").trim();
    const password = body.password ?? "";
    const name = (body.name ?? "").trim();
    const team = body.team ?? null;
    const role = body.role === "主管" ? "主管" : "員工";
    const lang = body.lang === "vi" ? "vi" : "zh";

    if (!account || !password || !name) {
      return json({ error: "missing_fields" }, 400);
    }

    const email = `${account}@report.local`;
    const admin = createClient(url, service);

    // 3) 建立 auth 使用者
    const { data: created, error: ce } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (ce || !created?.user) {
      return json({ error: ce?.message ?? "create_user_failed" }, 400);
    }

    // 4) 寫入 employees 主檔
    const { error: ie } = await admin.from("employees").insert({
      id: created.user.id,
      account,
      name,
      team,
      role,
      lang,
    });
    if (ie) {
      // 回滾：刪除剛建立的 auth 使用者
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: ie.message }, 400);
    }

    return json({ ok: true, id: created.user.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
