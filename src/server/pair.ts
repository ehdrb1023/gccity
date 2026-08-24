import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { db } from '@/lib/db';
import { linkResolution } from './complaints';
import { normalizeConfidence } from './digest';

/**
 * 짝 찾기 — 같은 사안이 두 번 들어온 것을 모아준다.
 * ==================================================================
 * 이 방에서는 한 사안이 두 갈래로 들어온다.
 *
 *   ① 주민이 카톡에 민원을 올린다        →  kind='report'
 *   ② 정책관이 카톡에 회신을 올린다      →  kind='resolution'
 *   ③ 정책관이 그 회신을 카페에도 올린다 →  ②와 같은 내용이 한 건 더
 *
 * ①②는 **잇고**(resolves), ②③은 **중복**(duplicate)이다. 둘 다 모아야
 * "민원이 언제 들어와 며칠 만에 어떻게 처리됐나" 가 한 줄로 읽힌다.
 *
 * ★ 자동으로 잇지 않는다. 모델은 **제안만** 하고 사람이 누른다.
 *   제목이 비슷하다고 엮으면 틀린 짝이 조용히 통계에 섞이는데, 그렇게 어긋난
 *   "평균 처리 3일" 은 아무도 못 알아챈다. 이 프로젝트가 제일 경계하는 실패다.
 *
 * ★ 거절도 남긴다(`decided='rejected'`). 안 남기면 다음 실행 때 같은 짝을 또 제안해
 *   사람이 매번 같은 것을 물리쳐야 하고, 그러면 이 화면을 안 보게 된다.
 */

const MODEL = process.env.GCCITY_DIGEST_MODEL || 'claude-opus-5';
/** 한 번에 모델에게 보여주는 민원 수. 늘리면 짝의 품질이 아니라 값만 오른다. */
const MAX_ITEMS = 120;
const SNIPPET = 240;

export type PairRelation = 'resolves' | 'duplicate';

export type PairSuggestion = {
  id: string;
  relation: PairRelation;
  confidence: string | null;
  reason: string | null;
  createdAt: string;
  left: { id: string; title: string; kind: string; at: string | null; origin: string };
  right: { id: string; title: string; kind: string; at: string | null; origin: string };
};

const ItemSchema = z.object({
  relation: z.string().describe('"resolves"(회신↔민원) 또는 "duplicate"(같은 글이 두 경로로 들어옴)'),
  leftId: z.string().describe('resolves 면 **처리 글**의 id, duplicate 면 **나중에 들어온 글**의 id'),
  rightId: z.string().describe('resolves 면 **민원 글**의 id, duplicate 면 **먼저 들어온 글**의 id'),
  confidence: z.string().describe('"high" · "medium" · "low" 중 하나'),
  reason: z.string().describe('왜 같은 사안으로 봤는지 한 줄. 근거가 되는 낱말을 적을 것'),
});

const OutSchema = z.object({
  pairs: z.array(ItemSchema).describe('찾아낸 짝. 없으면 빈 배열'),
});

const SYSTEM = [
  '너는 과천시 민원 목록에서 **같은 사안**을 가리키는 글 두 개를 찾아 짝지어 주는 일을 한다.',
  '',
  '짝은 두 종류다:',
  '- "resolves" — 주민이 올린 민원(report)과, 그에 대한 시청·담당자의 회신(resolution).',
  '  회신문이 그 민원의 대상·장소·현상을 다시 말하고 있으면 짝이다.',
  '- "duplicate" — **같은 내용**이 두 경로(카톡·카페)로 들어와 두 건이 된 것.',
  '  정책관이 카톡에 쓴 회신을 카페에도 그대로 올리기 때문에 자주 생긴다.',
  '',
  '규칙:',
  '- **확실하지 않으면 넣지 마라.** 틀린 짝은 빠뜨린 짝보다 훨씬 나쁘다 —',
  '  사람이 못 알아채는 채로 처리 기간 통계가 어긋난다.',
  '- 같은 장소·같은 시설이라도 **다른 사안**이면 짝이 아니다.',
  '  (예: 제비울천 전지 작업 / 제비울천 쇠파이프 방치 → 서로 다른 민원이다)',
  '- 회신은 민원보다 **늦거나 같은 날**이어야 한다. 회신이 더 이르면 짝이 아니다.',
  '- 한 글은 한 짝에만 넣는다. 같은 id 를 여러 짝에 쓰지 마라.',
  '- 목록에 없는 id 를 지어내지 마라.',
  '- 짝이 없으면 pairs 를 빈 배열로 둔다.',
].join('\n');

/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = {
  id: string;
  title: string;
  kind: string;
  origin: string;
  summary: string | null;
  body: string | null;
  department: string | null;
  posted_at: string | null;
  reported_at: string | null;
  created_at: string;
};

const when = (r: Row) => r.reported_at ?? r.posted_at ?? r.created_at;

/** 모델에게 보여줄 한 줄. id 를 앞에 세워 되짚기 쉽게 한다. */
function line(r: Row): string {
  const t = (when(r) ?? '').slice(0, 10);
  const text = (r.summary || r.body || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET);
  return [
    `[${r.id}] (${r.kind}/${r.origin}) ${t} ${r.title}`,
    r.department ? `    부서: ${r.department}` : '',
    text ? `    ${text}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export type PairResult = { ok: boolean; scanned: number; found: number; added: number; error: string | null };

export async function suggestPairs(): Promise<PairResult> {
  const out: PairResult = { ok: false, scanned: 0, found: 0, added: 0, error: null };

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY 미설정 — 짝 찾기를 돌리지 않는다');
    }

    /*
     * 대상은 **아직 안 묶인 것**뿐이다. 이미 이어둔 회신·중복으로 판정된 글까지 보여주면
     * 모델이 그 자리를 다시 제안하고, 사람은 같은 것을 또 물리쳐야 한다.
     */
    const { data, error } = await db()
      .from('complaints')
      .select('id, title, kind, origin, summary, body, department, posted_at, reported_at, created_at')
      .in('kind', ['report', 'resolution'])
      .is('resolution_of', null)
      .is('duplicate_of', null)
      .order('created_at', { ascending: false })
      .limit(MAX_ITEMS);
    if (error) throw new Error(`민원 조회 실패: ${error.message}`);

    const rows = (data ?? []) as unknown as Row[];
    out.scanned = rows.length;
    if (rows.length < 2) {
      out.ok = true;
      return out;
    }

    const client = new Anthropic();
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: `아래는 아직 짝이 없는 민원 목록이다.\n\n${rows.map(line).join('\n\n')}` }],
      output_config: { format: zodOutputFormat(OutSchema) },
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    const seen = new Set<string>();
    const proposals = [];

    for (const p of res.parsed_output?.pairs ?? []) {
      const left = byId.get(String(p.leftId).trim());
      const right = byId.get(String(p.rightId).trim());
      // 모델이 없는 id 를 지목했다. 지어내지 말고 버린다
      if (!left || !right || left.id === right.id) continue;
      const relation: PairRelation = String(p.relation).trim().toLowerCase().startsWith('dup')
        ? 'duplicate'
        : 'resolves';

      // 회신이 민원보다 이르면 짝이 아니다. 규칙으로 한 번 더 거른다
      if (relation === 'resolves') {
        const lt = Date.parse(when(left) ?? '');
        const rt = Date.parse(when(right) ?? '');
        if (Number.isFinite(lt) && Number.isFinite(rt) && lt < rt - 86_400_000) continue;
      }

      // 한 글은 한 짝에만. 모델이 같은 글을 여러 번 써도 첫 짝만 남긴다
      if (seen.has(left.id) || seen.has(right.id)) continue;
      seen.add(left.id);
      seen.add(right.id);

      proposals.push({
        left_id: left.id,
        right_id: right.id,
        relation,
        confidence: normalizeConfidence(p.confidence),
        reason: String(p.reason ?? '').slice(0, 400),
        model: MODEL,
      });
    }

    out.found = proposals.length;

    if (proposals.length > 0) {
      // ★ ignoreDuplicates — 사람이 이미 물리친 짝(rejected)을 되살리지 않는다
      const { data: ins, error: insErr } = await db()
        .from('complaint_pairs')
        .upsert(proposals, { onConflict: 'left_id,right_id', ignoreDuplicates: true })
        .select('id');
      if (insErr) throw new Error(`짝 제안 저장 실패: ${insErr.message}`);
      out.added = (ins ?? []).length;
    }

    out.ok = true;
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    console.error('[gccity] 짝 찾기 실패:', out.error);
  }

  return out;
}

/** 아직 사람이 판단하지 않은 제안. 화면 맨 위에 뜬다. */
export async function listPairs(): Promise<PairSuggestion[]> {
  const { data, error } = await db()
    .from('complaint_pairs')
    .select(
      'id, relation, confidence, reason, created_at, ' +
        'left:complaints!complaint_pairs_left_id_fkey(id, title, kind, origin, posted_at, reported_at, created_at), ' +
        'right:complaints!complaint_pairs_right_id_fkey(id, title, kind, origin, posted_at, reported_at, created_at)',
    )
    .eq('decided', 'pending')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`짝 제안 조회 실패: ${error.message}`);

  const side = (r: any) => ({
    id: r?.id ?? '',
    title: r?.title ?? '(지워진 글)',
    kind: r?.kind ?? 'unknown',
    origin: r?.origin ?? '',
    at: r?.reported_at ?? r?.posted_at ?? r?.created_at ?? null,
  });

  return (data ?? [])
    .filter((p: any) => p.left && p.right)
    .map((p: any) => ({
      id: p.id,
      relation: p.relation,
      confidence: p.confidence,
      reason: p.reason,
      createdAt: p.created_at,
      left: side(p.left),
      right: side(p.right),
    }));
}

async function decide(id: string, decided: 'accepted' | 'rejected'): Promise<void> {
  const { error } = await db()
    .from('complaint_pairs')
    .update({ decided, decided_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`짝 판정 저장 실패: ${error.message}`);
}

/** 사람이 [묶기] 를 눌렀다. 그때야 비로소 실제로 이어진다. */
export async function acceptPair(id: string): Promise<{ relation: PairRelation }> {
  const { data, error } = await db()
    .from('complaint_pairs')
    .select('id, relation, left_id, right_id, decided')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`짝 조회 실패: ${error.message}`);
  if (!data) throw new Error('그런 제안이 없다');
  const p = data as any;

  if (p.relation === 'resolves') {
    await linkResolution(p.left_id, p.right_id);
  } else {
    // 중복은 지우지 않는다. 가리키기만 한다 — 두 경로로 들어왔다는 사실 자체가 정보다
    const { error: e } = await db()
      .from('complaints')
      .update({ duplicate_of: p.right_id, status: 'drop', updated_at: new Date().toISOString() })
      .eq('id', p.left_id);
    if (e) throw new Error(`중복 표시 실패: ${e.message}`);
  }

  await decide(id, 'accepted');
  return { relation: p.relation };
}

/** 사람이 [아니다] 를 눌렀다. 남겨둬야 다음 실행에서 또 묻지 않는다. */
export async function rejectPair(id: string): Promise<void> {
  await decide(id, 'rejected');
}
