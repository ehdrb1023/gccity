import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from '@/lib/db';
import { parseResolutionBody } from './complaint-classify';

/**
 * 카톡 대화를 일정 시간마다 읽어 민원을 뽑는다.
 *
 * 사람이 말풍선마다 [민원] 을 누르는 길은 정확하지만 놓친다 — 오픈채팅은 하루에 수백 건이
 * 지나가고 민원은 그 사이에 흩어져 있다. 그래서 창(window) 단위로 모아 모델에게 묻고,
 * 결과를 민원실에 **초안**(`ai_draft = true`)으로 넣는다. 사람이 카페와 대조해 확정하거나 지운다.
 *
 * ★ 창의 시작점은 마지막 **성공한** 실행의 끝이다(`digest_runs`). 그래서 서버가 멈췄다
 *   살아나도 구멍이 나지 않고, 같은 구간을 두 번 읽어도 멱등키가 막는다.
 *
 * ★ 멱등키는 `chat:<앵커 메시지 id>` 다 — 사람이 손으로 담은 것과 **같은 열쇠 공간**이다.
 *   그래서 이미 사람이 담은 민원을 모델이 다시 넣지 않는다.
 *
 * ★ fail-closed: `ANTHROPIC_API_KEY` 가 없으면 아무것도 하지 않고 사유를 남긴다.
 *   "분석이 도는 줄 알았는데 아무것도 안 하고 있었다" 가 이 프로젝트가 제일 경계하는 실패다.
 */

/**
 * 기본 창 길이. **cron 주기와 같아야 한다** — `digestDue` 가 이 값으로 "밀렸다" 를 판정하기
 * 때문이다. cron 이 하루 한 번인데 6으로 두면 하루 중 18시간이 늘 경고 상태가 된다.
 * 거짓 경보는 경보가 없느니만 못하다.
 */
const DEFAULT_HOURS = Number(process.env.GCCITY_DIGEST_HOURS ?? 24);
/** 아무리 밀려도 이보다 뒤로는 안 간다. 며칠치를 한 번에 넣으면 창이 통째로 흐려진다. */
const MAX_LOOKBACK_H = 48;
/** 한 번에 모델에게 주는 메시지 상한. 넘으면 오래된 것부터 자르고 그 사실을 기록한다. */
const MAX_MESSAGES = 400;
const BODY_MAX = 500;

const MODEL = process.env.GCCITY_DIGEST_MODEL || 'claude-opus-5';

export type DigestResult = {
  ok: boolean;
  windowFrom: string;
  windowTo: string;
  messages: number;
  drafted: number;
  added: number;
  model: string;
  error: string | null;
};

/*
 * ★ enum 을 쓰지 않는다. SDK 가 구조화 출력 스키마를 만들 때 `enum`·`minimum` 같은
 *   키워드를 API 가 받는 부분집합에 맞춰 **description 문자열로 옮긴다**(실측 2026-08-21).
 *   즉 모델에게는 권고로만 전달되므로, 살짝 다른 값이 오면 zod 검증에서 **배치 전체가**
 *   날아간다. 그래서 문자열로 받고 아래에서 우리가 정규화한다 — 한 항목이 이상해서
 *   그 창의 민원을 통째로 잃는 것이 훨씬 나쁘다.
 */
const ItemSchema = z.object({
  kind: z.string().describe('"report"(민원 제기) 또는 "resolution"(담당자·시청의 회신) 둘 중 하나'),
  title: z.string().describe('민원 제목. 40자 이내의 명사구'),
  summary: z.string().describe('무엇을 요구하거나 알린 것인지 두 문장 이내'),
  category: z.string().describe('교통·환경·공원·재건축·행정 같은 짧은 분류 한 낱말'),
  anchorMessageId: z.number().describe('이 민원이 시작된 메시지의 id (대화록의 # 뒤 숫자)'),
  messageIds: z.array(z.number()).describe('이 민원을 이루는 메시지 id 전부'),
  confidence: z.string().describe('"high" · "medium" · "low" 중 하나'),
  reason: z.string().describe('왜 민원으로 봤는지 한 줄'),
});

/** 모델이 준 kind 를 우리 값으로 못 박는다. 모르는 값은 민원 제기로 본다(사람이 고친다). */
export function normalizeKind(v: unknown): 'report' | 'resolution' {
  return String(v ?? '').trim().toLowerCase().startsWith('resol') ? 'resolution' : 'report';
}

/** 확신도. 모르는 값은 낮게 잡는다 — 높게 잡으면 사람이 덜 들여다본다. */
export function normalizeConfidence(v: unknown): 'high' | 'medium' | 'low' {
  const t = String(v ?? '').trim().toLowerCase();
  return t === 'high' ? 'high' : t === 'medium' ? 'medium' : 'low';
}

const OutSchema = z.object({
  items: z.array(ItemSchema).describe('찾아낸 민원. 없으면 빈 배열'),
});

const SYSTEM = [
  '너는 경기도 과천시 주민 오픈채팅방의 대화를 읽고 **민원**만 골라내는 일을 한다.',
  '',
  '민원이다:',
  '- 생활 불편 신고(도로 파임, 냄새, 소음, 쓰레기, 시설 고장, 안전 위험)',
  '- 시정에 대한 요구·질의(공사 일정, 교통 대책, 시설 확충, 정책 설명 요구)',
  '- 담당 부서의 회신·처리 결과 안내 → kind = "resolution"',
  '',
  '민원이 아니다:',
  '- 잡담·인사·이모지·감탄, 서로에 대한 비난, 정치 논쟁 자체',
  '- 뉴스 링크 공유나 소감만 있는 것 (구체적 요구가 없으면 제외)',
  '- 방 안내 공지, 입퇴장 알림',
  '',
  '규칙:',
  '- 같은 사안을 여러 사람이 이어서 말했으면 **하나로 묶는다.** 발언마다 쪼개지 말 것.',
  '- anchorMessageId 는 그 사안이 **처음 나온** 메시지의 id 다.',
  '- 확실하지 않으면 confidence 를 low 로 두고 넣어라. 사람이 지운다.',
  '- 대화에 민원이 없으면 items 를 빈 배열로 둔다. 억지로 만들어내지 말 것.',
  '- 제목·요약은 한국어로 쓴다. 원문 표현을 살리되 욕설·인신공격은 옮기지 않는다.',
].join('\n');

type Row = {
  id: number;
  room_id: string;
  sender: string;
  body: string;
  sent_at: string;
};

/** 다음 창의 시작점. 마지막 **성공** 실행의 끝에서 이어 붙인다. */
export async function nextWindowFrom(now = Date.now()): Promise<string> {
  const { data, error } = await db()
    .from('digest_runs')
    .select('window_to')
    .eq('ok', true)
    .order('window_to', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`분석 기록 조회 실패: ${error.message}`);

  const floor = now - MAX_LOOKBACK_H * 3600_000;
  const prev = data?.window_to ? Date.parse(data.window_to) : NaN;
  const from = Number.isNaN(prev) ? now - DEFAULT_HOURS * 3600_000 : prev;
  return new Date(Math.max(from, floor)).toISOString();
}

/** 창 안의 팔로우 방 메시지. 방을 가리지 않는 이유는 민원실이 방과 무관하기 때문이다. */
async function collectMessages(from: string, to: string): Promise<Row[]> {
  const { data, error } = await db()
    .from('messages')
    .select('id, room_id, sender, body, sent_at')
    .gt('sent_at', from)
    .lte('sent_at', to)
    .order('sent_at', { ascending: true })
    .limit(MAX_MESSAGES * 2);
  if (error) throw new Error(`메시지 조회 실패: ${error.message}`);

  const rows = (data ?? []) as unknown as Row[];
  // 빈 본문·사진 안내만 있는 줄은 모델에게 줄 이유가 없다
  const useful = rows.filter((r) => String(r.body ?? '').trim().length > 1);
  return useful.length > MAX_MESSAGES ? useful.slice(useful.length - MAX_MESSAGES) : useful;
}

/** ISO → "08.21 14:45" (KST 고정). 환경에 흔들리지 않게 직접 만든다. */
function kstStamp(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '??.?? ??:??';
  const d = new Date(t + 9 * 3600_000);   // UTC 에 +9 를 얹어 KST 벽시계를 만든다
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 모델에게 줄 대화록. id 를 앞에 달아야 앵커를 지목할 수 있다. */
export function buildTranscript(rows: { id: number; sender: string; body: string; sent_at: string }[]): string {
  return rows
    .map((r) => {
      // ★ toLocaleString 을 쓰지 않는다 — 로케일·ICU 판본에 따라 "08. 21." 처럼 모양이 바뀐다.
      //   모델에게 주는 형식이 환경마다 흔들리면 프롬프트 캐시도 깨지고 테스트도 못 쓴다
      const t = kstStamp(r.sent_at);
      const body = String(r.body ?? '').replace(/\s+/g, ' ').trim().slice(0, BODY_MAX);
      return `#${r.id} [${t}] ${r.sender || '(이름 없음)'}: ${body}`;
    })
    .join('\n');
}

/**
 * 한 창을 분석한다. **던지지 않는다** — 실패도 결과로 돌려주고 `digest_runs` 에 사유를 남긴다.
 * cron 이 부르는 경로라, 던져서 500 만 남기면 화면에 아무것도 안 뜬다.
 */
export async function runDigest(opts: { hours?: number; now?: number } = {}): Promise<DigestResult> {
  const now = opts.now ?? Date.now();
  const windowTo = new Date(now).toISOString();
  const windowFrom = opts.hours
    ? new Date(now - Math.min(opts.hours, MAX_LOOKBACK_H) * 3600_000).toISOString()
    : await nextWindowFrom(now);

  const out: DigestResult = {
    ok: false, windowFrom, windowTo, messages: 0, drafted: 0, added: 0, model: MODEL, error: null,
  };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY 미설정 — 분석을 돌리지 않는다');
    }

    const rows = await collectMessages(windowFrom, windowTo);
    out.messages = rows.length;

    // 대화가 없으면 모델을 부르지 않는다. 빈 요청도 돈이다
    if (rows.length === 0) {
      out.ok = true;
      await recordRun(out);
      return out;
    }

    const client = new Anthropic();
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: `아래는 ${kstStamp(windowFrom)} (KST) 부터 지금까지 오픈채팅방에 오간 대화다.\n여기서 민원을 골라내라.\n\n${buildTranscript(rows)}`,
        },
      ],
      output_config: { format: zodOutputFormat(OutSchema) },
    });

    const items = res.parsed_output?.items ?? [];
    out.drafted = items.length;

    const byId = new Map(rows.map((r) => [r.id, r]));
    const drafts = items
      .map((it) => {
        const anchor = byId.get(Math.trunc(Number(it.anchorMessageId)));
        if (!anchor) return null;   // 모델이 없는 id 를 지목했다. 지어내지 말고 버린다
        const quoted = (it.messageIds ?? [])
          .map((id) => byId.get(Math.trunc(Number(id))))
          .filter(Boolean)
          .map((m) => `${m!.sender}: ${String(m!.body ?? '').trim()}`)
          .join('\n');
        /*
         * ★ 부서는 모델에게 묻지 않고 규칙으로 뽑는다. 회신문이 "담당 부서인 ○○○에 문의한
         *   결과" 로 정형화돼 있어 정규식이 더 정확하고, **어느 부서가 처리했는가**가 이 앱이
         *   최종적으로 재려는 값이라 모델이 그럴듯하게 지어내면 통계가 조용히 틀어진다.
         */
        const parsed = parseResolutionBody(String(anchor.body ?? ''));
        return {
          dedup_key: `chat:${anchor.id}`,
          origin: 'chat',
          kind: normalizeKind(it.kind),
          title: it.title.trim().slice(0, 300),
          summary: it.summary.trim().slice(0, 1000),
          category: it.category.trim().slice(0, 60) || null,
          body: (quoted || String(anchor.body ?? '')).slice(0, 8000),
          author: anchor.sender || null,
          posted_at: anchor.sent_at,
          reported_at: normalizeKind(it.kind) === 'report' ? anchor.sent_at : null,
          resolved_at: normalizeKind(it.kind) === 'resolution' ? anchor.sent_at : null,
          department: parsed.department,
          // "…까지" 약속이 있으면 회신은 왔어도 아직 끝난 건이 아니다
          due_at: parsed.dueAt,
          room_id: anchor.room_id,
          message_id: anchor.id,
          ai_draft: true,
          ai_note: `${normalizeConfidence(it.confidence)} · ${it.reason}`.slice(0, 500),
          ai_model: MODEL,
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    if (drafts.length > 0) {
      // ★ ignoreDuplicates — 사람이 이미 담아 상태를 바꿔둔 민원을 초안이 덮지 않는다
      const { data: ins, error: insErr } = await db()
        .from('complaints')
        .upsert(drafts, { onConflict: 'dedup_key', ignoreDuplicates: true })
        .select('id');
      if (insErr) throw new Error(`민원 초안 저장 실패: ${insErr.message}`);
      out.added = (ins ?? []).length;
    }

    out.ok = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    console.error('[gccity] 민원 분석 실패:', out.error);
  }

  await recordRun(out);
  return out;
}

async function recordRun(r: DigestResult): Promise<void> {
  const { error } = await db().from('digest_runs').insert({
    window_from: r.windowFrom,
    window_to: r.windowTo,
    messages: r.messages,
    drafted: r.drafted,
    added: r.added,
    model: r.model,
    ok: r.ok,
    error: r.error,
  });
  if (error) console.error('[gccity] 분석 기록 저장 실패:', error.message);
}

export type DigestRun = {
  startedAt: string;
  windowFrom: string;
  windowTo: string;
  messages: number;
  drafted: number;
  added: number;
  ok: boolean;
  error: string | null;
};

/** 화면 맨 위에 마지막 실행 결과를 그대로 적기 위한 것. 실패를 숨기지 않는다. */
export async function lastRun(): Promise<DigestRun | null> {
  const { data, error } = await db()
    .from('digest_runs')
    .select('started_at, window_from, window_to, messages, drafted, added, ok, error')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`분석 기록 조회 실패: ${error.message}`);
  if (!data) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const d = data as any;
  return {
    startedAt: d.started_at,
    windowFrom: d.window_from,
    windowTo: d.window_to,
    messages: d.messages,
    drafted: d.drafted,
    added: d.added,
    ok: d.ok,
    error: d.error,
  };
}

/**
 * 분석할 때가 됐는가. cron 은 하루 한 번뿐이라(Hobby 요금제 제한) 그 사이의 공백을
 * 화면이 알려준다 — 몰래 돌리지 않고 [지금 분석] 을 누를 수 있게.
 */
export function digestDue(run: DigestRun | null, now = Date.now()): boolean {
  if (!run || !run.ok) return true;
  const t = Date.parse(run.windowTo);
  if (Number.isNaN(t)) return true;
  return now - t >= DEFAULT_HOURS * 3600_000;
}

/** 화면에 적을 창 길이(시간). */
export const DIGEST_HOURS = DEFAULT_HOURS;

/** 초안을 사람이 확정한다. 배지가 사라지고 보통 민원과 같아진다. */
export async function confirmDraft(id: string): Promise<void> {
  const { error } = await db()
    .from('complaints')
    .update({ ai_draft: false, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`확정 실패: ${error.message}`);
}
