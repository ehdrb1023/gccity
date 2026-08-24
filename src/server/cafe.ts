import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { parseDatedTitle, parseResolutionBody } from './complaint-classify';
import { normalizeConfidence, normalizeKind } from './digest';

/**
 * 카페 글 보관함 → 민원 초안.
 * ==================================================================
 * 네이버 카페는 `robots.txt` 가 모든 봇에 `Disallow: /` 라 서버가 긁지 못한다.
 * 그래서 사람이 글을 열어 본문을 복사해 넣는다. 이 파일은 그 원문을 받아 두고
 * 모델에게 요약을 시켜 **민원 초안**을 만든다.
 *
 * ★ 원문을 먼저 저장하고, 그다음에 모델을 부른다. 순서를 뒤집지 말 것 —
 *   모델 호출은 실패한다(키 없음·타임아웃·과금 한도). 사람이 애써 복사한 본문이
 *   그 실패와 함께 사라지면 다시 카페에 들어가 복사해 오라는 뜻이 된다.
 *
 * ★ 부서·완료예정일은 모델이 아니라 규칙(`parseResolutionBody`)이 뽑는다.
 *   회신문이 정형화돼 있어 정규식이 더 정확하고, 이 값은 이 앱이 최종적으로 재려는
 *   숫자라 모델이 그럴듯하게 지어내면 통계가 조용히 틀어진다.
 */

const MODEL = process.env.GCCITY_DIGEST_MODEL || 'claude-opus-5';
/** 한 글에서 모델에게 주는 본문 상한. 카페 글은 길어야 수천 자다. */
const BODY_MAX = 20_000;

export type CafePost = {
  id: string;
  title: string | null;
  url: string | null;
  body: string;
  /** 사람이 적어 넣은 **게시판 작성일**. 본문에 시각 마커가 없는 글이 훨씬 많다 */
  postedAt: string | null;
  createdAt: string;
  summarizedAt: string | null;
  ok: boolean | null;
  error: string | null;
  drafted: number;
};

const ItemSchema = z.object({
  kind: z.string().describe('"report"(주민이 제기한 민원) 또는 "resolution"(시청·담당자의 회신·처리 결과)'),
  title: z.string().describe('민원 제목. 40자 이내의 명사구'),
  summary: z.string().describe('무엇을 요구하거나 알린 것인지 세 문장 이내. 장황한 원문을 사람이 훑을 수 있게 줄인다'),
  category: z.string().describe('교통·환경·공원·재건축·행정 같은 짧은 분류 한 낱말'),
  confidence: z.string().describe('"high" · "medium" · "low" 중 하나'),
  reason: z.string().describe('왜 그렇게 봤는지 한 줄'),
});

const OutSchema = z.object({
  items: z.array(ItemSchema).describe('이 글에서 뽑아낸 민원. 민원이 아니면 빈 배열'),
});

const SYSTEM = [
  '너는 경기도 과천시 주민 커뮤니티(네이버 카페)에 올라온 글 하나를 읽고 **민원**을 뽑아내는 일을 한다.',
  '',
  '민원이다:',
  '- 생활 불편 신고(도로 파임, 냄새, 소음, 쓰레기, 시설 고장, 안전 위험)',
  '- 시정에 대한 요구·질의(공사 일정, 교통 대책, 시설 확충, 정책 설명 요구)',
  '- 담당 부서의 회신·처리 결과 안내 → kind = "resolution"',
  '',
  '민원이 아니다:',
  '- 보도자료·홍보·행사 안내, 모집 공고',
  '- 뉴스 스크랩과 소감만 있는 것 (구체적 요구가 없으면 제외)',
  '- 잡담·인사·후기',
  '',
  '규칙:',
  '- 글 하나에 민원이 하나면 items 도 하나다. 문단마다 쪼개지 말 것.',
  '- 한 글이 서로 다른 사안 여럿을 담고 있을 때만 나눈다.',
  '- 주민이 길게 쓴 글일수록 **무엇을 해달라는 것인지**를 요약의 첫 문장에 둔다.',
  '- 민원이 아니면 items 를 빈 배열로 둔다. 억지로 만들어내지 말 것.',
  '- 한국어로 쓴다. 원문 표현을 살리되 욕설·인신공격·개인 신상은 옮기지 않는다.',
].join('\n');

/**
 * 사람이 친 날짜(`2026-08-21`)를 한국시간 그날 0시로 읽는다.
 * ★ 시간대를 붙이지 않으면 브라우저·서버 시간대에 따라 하루가 밀린다 —
 *   그러면 소요일이 통째로 하루씩 어긋난다.
 */
export function isoFromDay(day: string | undefined | null): string | null {
  const d = String(day ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00+09:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** 같은 글을 두 번 붙여넣어도 한 건이다. 공백 차이로 갈리지 않게 정규화한 뒤 해시한다. */
export function bodyHash(body: string): string {
  return createHash('md5').update(body.replace(/\s+/g, ' ').trim()).digest('hex');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPost(r: any): CafePost {
  return {
    id: r.id,
    title: r.title ?? null,
    url: r.url ?? null,
    body: r.body ?? '',
    postedAt: r.posted_at ?? null,
    createdAt: r.created_at,
    summarizedAt: r.summarized_at ?? null,
    ok: r.ok ?? null,
    error: r.error ?? null,
    drafted: r.drafted ?? 0,
  };
}

export async function listCafePosts(limit = 100): Promise<CafePost[]> {
  const { data, error } = await db()
    .from('cafe_posts')
    .select('id, title, url, body, posted_at, created_at, summarized_at, ok, error, drafted')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`카페 글 조회 실패: ${error.message}`);
  return (data ?? []).map(toPost);
}

/**
 * 본문을 보관한다. **모델을 부르기 전에** 저장이 끝난다.
 * 이미 있는 글이면 그 행을 그대로 돌려준다 — 같은 글이 두 건으로 늘지 않는다.
 */
export async function addCafePost(input: {
  title?: string;
  url?: string;
  /** 게시판에 적힌 작성일 (`YYYY-MM-DD`). 없어도 된다 */
  postedAt?: string;
  body: string;
}): Promise<{ post: CafePost; duplicate: boolean }> {
  const body = input.body.trim();
  if (body.length < 20) throw new Error('본문이 너무 짧다 — 글을 통째로 붙여넣을 것');

  const hash = bodyHash(body);
  const { data: existing } = await db()
    .from('cafe_posts')
    .select('id, title, url, body, posted_at, created_at, summarized_at, ok, error, drafted')
    .eq('body_hash', hash)
    .maybeSingle();
  if (existing) return { post: toPost(existing), duplicate: true };

  const { data, error } = await db()
    .from('cafe_posts')
    .insert({
      title: input.title?.trim() || null,
      url: input.url?.trim() || null,
      body: body.slice(0, 100_000),
      body_hash: hash,
      posted_at: isoFromDay(input.postedAt),
    })
    .select('id, title, url, body, posted_at, created_at, summarized_at, ok, error, drafted')
    .single();
  if (error) throw new Error(`카페 글 저장 실패: ${error.message}`);
  return { post: toPost(data), duplicate: false };
}

export async function deleteCafePost(id: string): Promise<void> {
  const { error } = await db().from('cafe_posts').delete().eq('id', id);
  if (error) throw new Error(`카페 글 삭제 실패: ${error.message}`);
}

export type SummarizeResult = {
  ok: boolean;
  drafted: number;
  added: number;
  error: string | null;
};

/**
 * 보관해 둔 글 하나를 모델에게 주고 민원 초안을 만든다.
 * **던지지 않는다** — 실패도 결과로 돌려주고 그 사유를 글 행에 남긴다.
 * 조용히 0건이 되는 것이 이 프로젝트가 제일 경계하는 실패다.
 */
export async function summarizeCafePost(id: string): Promise<SummarizeResult> {
  const out: SummarizeResult = { ok: false, drafted: 0, added: 0, error: null };

  const { data: post, error: readErr } = await db()
    .from('cafe_posts')
    .select('id, title, url, body, posted_at')
    .eq('id', id)
    .maybeSingle();
  if (readErr) throw new Error(`카페 글 조회 실패: ${readErr.message}`);
  if (!post) throw new Error('그런 글이 없다');

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY 미설정 — 요약을 돌리지 않는다');
    }

    const body = String((post as any).body ?? '').slice(0, BODY_MAX);
    const client = new Anthropic();
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      messages: [
        {
          role: 'user',
          content: [
            (post as any).title ? `제목: ${(post as any).title}` : '제목: (없음)',
            (post as any).url ? `주소: ${(post as any).url}` : '',
            '',
            '본문:',
            body,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
      output_config: { format: zodOutputFormat(OutSchema) },
    });

    const items = res.parsed_output?.items ?? [];
    out.drafted = items.length;

    // 부서·완료예정일·접수/회신 시각은 규칙이 뽑는다. 모델에게 묻지 않는다
    const parsed = parseResolutionBody(body);
    /*
     * 시각을 정하는 차례가 셋이다. 위가 이길수록 정확하다.
     *   ① 본문의 시각 마커      분 단위. 있으면 이게 답이다
     *   ② 사람이 친 작성일       날짜 단위. 마커 없는 글이 훨씬 많다
     *   ③ 제목의 날짜            처리 글에서 **접수일**을 준다 ("2026년 8월 20일(목) … 민원")
     * 아무것도 없으면 비운다. 담은 날을 접수일로 쓰지 않는다 — 소요일이 통째로 거짓이 된다.
     */
    const typedAt = (post as any).posted_at ?? null;
    const titleAt = parseDatedTitle(String((post as any).title ?? ''))?.reportedAt ?? null;

    const drafts = items.map((it, i) => {
      const kind = normalizeKind(it.kind);
      return {
        // 한 글에서 여러 건이 나와도 열쇠가 갈린다. 다시 요약해도 같은 자리를 덮지 않는다
        dedup_key: i === 0 ? `cafe:${post.id}` : `cafe:${post.id}:${i}`,
        origin: 'paste',
        kind,
        title: (it.title || (post as any).title || '제목 없음').trim().slice(0, 300),
        summary: it.summary.trim().slice(0, 1000),
        category: it.category.trim().slice(0, 60) || null,
        body: body.slice(0, 8000),
        url: (post as any).url || null,
        board: '과천 카페',
        department: parsed.department,
        agency: parsed.agency,
        due_at: parsed.dueAt,
        posted_at: typedAt ?? parsed.receivedAt,
        // 처리 글이면 제목 날짜가 접수일이다. 본문 마커가 있으면 그게 이긴다
        reported_at: parsed.receivedAt ?? (kind === 'resolution' ? titleAt : typedAt),
        // 회신 시각 — 마커가 없으면 그 글이 올라온 날이 회신 날이다
        resolved_at: kind === 'resolution' ? (parsed.repliedAt ?? typedAt) : null,
        cafe_post_id: post.id,
        ai_draft: true,
        ai_note: `${normalizeConfidence(it.confidence)} · ${it.reason} (카페 본문 요약)`.slice(0, 500),
        ai_model: MODEL,
      };
    });

    if (drafts.length > 0) {
      // ★ ignoreDuplicates — 사람이 이미 확정해 상태를 바꿔둔 민원을 다시 요약해도 덮지 않는다
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
    console.error('[gccity] 카페 글 요약 실패:', out.error);
  }

  const { error: upErr } = await db()
    .from('cafe_posts')
    .update({
      summarized_at: new Date().toISOString(),
      ok: out.ok,
      error: out.error,
      drafted: out.drafted,
      model: MODEL,
    })
    .eq('id', id);
  if (upErr) console.error('[gccity] 카페 글 상태 기록 실패:', upErr.message);

  return out;
}
