import { db } from '@/lib/db';

export type AppState = {
  discoveryUntil: string | null;
  configVersion: number;
  botLastSeenAt: string | null;
  botLastGapMs: number | null;
  /** 폰에 실제로 올라가 있는 봇 스크립트의 빌드 표식. 붙여넣기가 먹었는지 화면에서 본다 */
  botBuild: string | null;
  /** 봇이 API2(BotManager·Event.MESSAGE)로 붙었는가. false 면 channelId 를 얻을 수 없다 */
  botApi2: boolean | null;
  /** 봇이 켜진 뒤 받은 카톡 메시지 수. API2 는 켜졌는데 0 이면 이벤트가 안 오는 것이다 */
  botMsgCount: number | null;
  /** 이름을 알림 색인에서 얻은 건수. 믿을 수 있는 쪽이다 */
  botSenderIdx: number | null;
  /** 이름을 API2 author.name 으로 때운 건수. 이쪽만 늘면 이름이 굳었을 수 있다 */
  botSenderAuth: number | null;
};

/** 봇이 심장박동에 얹어 보내는 자기 상태. 전부 선택 값이다 — 옛 봇도 그냥 돌아야 한다. */
export type BotNote = {
  build?: string | null;
  api2?: boolean | null;
  msgCount?: number | null;
  senderIdx?: number | null;
  senderAuth?: number | null;
};

const ROW = { id: 1 };

export async function getAppState(): Promise<AppState> {
  const { data, error } = await db()
    .from('app_state')
    // ★ 한 줄 리터럴로 둘 것 — 문자열을 이어붙이면 supabase-js 가 컬럼 타입을 못 읽는다
    .select('discovery_until, config_version, bot_last_seen_at, bot_last_gap_ms, bot_build, bot_api2, bot_msg_count, bot_sender_idx, bot_sender_auth')
    .eq('id', 1)
    .maybeSingle();
  // supabase-js 는 쿼리 실패를 throw 하지 않는다. 조용히 기본값으로 넘어가면
  // "방 찾기 모드가 안 켜진다" 를 코드에서 찾게 된다.
  if (error) throw new Error(`app_state 조회 실패: ${error.message}`);
  if (!data) throw new Error('app_state 행이 없다 — 0001_init.sql 의 insert 를 실행할 것');
  return {
    discoveryUntil: data.discovery_until,
    configVersion: Number(data.config_version),
    botLastSeenAt: data.bot_last_seen_at,
    botLastGapMs: data.bot_last_gap_ms,
    botBuild: data.bot_build ?? null,
    botApi2: data.bot_api2 ?? null,
    botMsgCount: data.bot_msg_count ?? null,
    botSenderIdx: data.bot_sender_idx ?? null,
    botSenderAuth: data.bot_sender_auth ?? null,
  };
}

export function discoveryOn(state: AppState, now = Date.now()): boolean {
  if (!state.discoveryUntil) return false;
  const t = Date.parse(state.discoveryUntil);
  return !Number.isNaN(t) && t > now;
}

/**
 * 봇이 서버를 두드린 시각을 남긴다. 봇 라우트 셋이 모두 이걸 부른다.
 *
 * 간격(gap)을 봇이 아니라 **서버가** 계산하는 이유: 봇이 죽었다 살아나면 자기 기준의
 * 간격은 리셋된다. 서버 기준이라야 "몇 분간 신호가 없었는가" 가 남는다.
 * 그 값이 Doze(간격만 벌어짐)와 죽음(끊김)을 가르는 유일한 단서다.
 */
export async function touchHeartbeat(note?: BotNote): Promise<void> {
  const now = new Date();
  const { data } = await db().from('app_state').select('bot_last_seen_at').eq('id', 1).maybeSingle();
  const prev = data?.bot_last_seen_at ? Date.parse(data.bot_last_seen_at) : null;
  const gap = prev && !Number.isNaN(prev) ? Math.max(0, now.getTime() - prev) : null;

  const patch: Record<string, unknown> = {
    bot_last_seen_at: now.toISOString(),
    bot_last_gap_ms: gap,
    updated_at: now.toISOString(),
  };
  // 봇이 실어 보낸 것만 덮는다. 안 보낸 칸을 null 로 밀면 인입 요청이 설정 요청이 남긴
  // 값을 지워, 화면의 빌드·API2 표시가 몇 초마다 깜빡인다.
  if (note?.build != null) patch.bot_build = String(note.build).slice(0, 40);
  if (note?.api2 != null) patch.bot_api2 = note.api2;
  if (note?.msgCount != null && Number.isFinite(note.msgCount)) patch.bot_msg_count = note.msgCount;
  if (note?.senderIdx != null && Number.isFinite(note.senderIdx)) patch.bot_sender_idx = note.senderIdx;
  if (note?.senderAuth != null && Number.isFinite(note.senderAuth)) patch.bot_sender_auth = note.senderAuth;

  const { error } = await db().from('app_state').update(patch).match(ROW);
  if (error) console.error('[gccity] heartbeat 갱신 실패:', error.message);
}

/** 봇 요청의 쿼리에 실려 오는 자기 상태를 읽는다 (`?build=…&api2=1&msgs=12`). */
export function botNoteFrom(req: Request): BotNote {
  const q = new URL(req.url).searchParams;
  const api2 = q.get('api2');
  const msgs = q.get('msgs');
  const sidx = q.get('sidx');
  const sauth = q.get('sauth');
  return {
    build: q.get('build'),
    api2: api2 === null ? null : api2 === '1' || api2 === 'true',
    msgCount: msgs === null ? null : Number(msgs),
    senderIdx: sidx === null ? null : Number(sidx),
    senderAuth: sauth === null ? null : Number(sauth),
  };
}

/** 봇이 설정을 다시 받아가게 만드는 신호. 팔로우·방 찾기 모드가 바뀔 때마다 올린다. */
export async function bumpConfigVersion(): Promise<number> {
  const state = await getAppState();
  const next = state.configVersion + 1;
  const { error } = await db()
    .from('app_state')
    .update({ config_version: next, updated_at: new Date().toISOString() })
    .match(ROW);
  if (error) throw new Error(`config_version 갱신 실패: ${error.message}`);
  return next;
}

export function discoveryMinutes(): number {
  const raw = Number(process.env.GCCITY_DISCOVERY_MINUTES ?? 30);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 180) : 30;
}

/**
 * 방 찾기 모드를 켜고 끈다.
 *
 * ★ 반드시 시한부다. 켜져 있는 동안에는 팔로우하지 않은 방(=개인 카톡)의 발신자명과
 *   본문 앞 몇 자가 서버로 올라온다. 사람이 끄는 걸 잊으면 그게 계속 쌓인다.
 *   그래서 서버가 시각을 못 박고, 지나면 스스로 꺼진다. 무기한 옵션을 만들지 말 것.
 */
export async function setDiscovery(on: boolean): Promise<string | null> {
  const until = on ? new Date(Date.now() + discoveryMinutes() * 60000).toISOString() : null;
  const { error } = await db()
    .from('app_state')
    .update({ discovery_until: until, updated_at: new Date().toISOString() })
    .match(ROW);
  if (error) throw new Error(`방 찾기 모드 변경 실패: ${error.message}`);
  await bumpConfigVersion();
  return until;
}

/**
 * 시한이 지난 미리보기를 지운다. 대시보드가 볼 때마다 부른다.
 *
 * 방 찾기 모드가 꺼졌는데 화면에 개인 카톡 미리보기가 남아 있으면, 그건 저장하지 않기로
 * 한 것을 저장해둔 것이다. 후보 목록 자체(열쇠·횟수)는 남기고 본문 단서만 지운다.
 */
export async function expireStalePreviews(): Promise<void> {
  const { error } = await db()
    .from('rooms')
    .update({ last_sender: null, last_preview: null, preview_expires_at: null })
    .lt('preview_expires_at', new Date().toISOString());
  if (error) console.error('[gccity] 미리보기 만료 처리 실패:', error.message);
}
