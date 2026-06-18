// ============================================================
//  Supabase 連線設定
//  請到 Supabase Dashboard → Project Settings → API
//  把 Project URL 與 anon public key 貼到下面兩行。
// ============================================================
window.SUPABASE_URL      = "https://gnuelffwtemdgjeeaswp.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_iJ8rBrF-zoo_UxW0mbxt_A_Hw_s_aGi";

// 建立全域 Supabase client（供其他 js 使用）
window.sb = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

// Edge Function 端點（建帳號用）
window.FN_CREATE_EMPLOYEE = `${window.SUPABASE_URL}/functions/v1/create-employee`;
