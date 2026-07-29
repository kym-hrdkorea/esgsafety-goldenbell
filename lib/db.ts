import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 서버 전용 모듈. 브라우저 번들에 섞이면 service role 키가 유출된다 (CLAUDE.md 규칙 1).
if (typeof window !== "undefined") {
  throw new Error("lib/db.ts는 서버에서만 import할 수 있습니다.");
}

let client: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다."
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
