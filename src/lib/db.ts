import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 서버 전용 클라이언트. **브라우저는 Supabase 에 직접 말하지 않는다.**
 *
 * 테이블은 RLS 가 켜져 있고 정책이 하나도 없다(0001_init.sql). 즉 service-role 이 아니면
 * 아무것도 못 읽는다. 브라우저에 anon 키를 내보내지 않는 것이 이 앱의 접근 통제 전부다 —
 * NEXT_PUBLIC_SUPABASE_ANON_KEY 를 추가하지 말 것.
 */
let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env 없음 (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
