import { createHash } from 'node:crypto';
import { db } from '@/lib/db';

/**
 * 민원실 — 과천 민원 게시글을 모아 상태를 따라가는 곳.
 *
 * 자료실(`files.ts`)과 나란히 서지만 **방에 매이지 않는다.** 과천시 민원은 특정 카톡방의
 * 소유물이 아니라 도시의 일이라, 팔로우 방을 바꿔도 같은 목록이 보여야 한다.
 *
 * 들어오는 길이 셋이다.
 *   crawl  robots.txt 가 허용하는 게시판·RSS 를 서버가 긁는다 (`complaint-crawl.ts`)
 *   paste  사람이 게시판 목록을 복사해 붙여넣는다 — 네이버 카페처럼 크롤이 막힌 곳의 길
 *   chat   수집된 오픈채팅 말풍선을 골라 담는다
 *
 * 어느 길로 들어와도 `dedup_key` 하나로 멱등이다. 같은 글을 다시 긁어도 한 건이고,
 * **사람이 붙인 상태·메모·분류는 덮이지 않는다** — 다시 긁었더니 "처리 완료" 가 "새 민원"
 * 으로 되돌아가는 것이 이 화면에서 제일 나쁜 실패다.
 */

export type ComplaintStatus = 'new' | 'doing' | 'done' | 'drop';

export const STATUS_LABEL: Record<ComplaintStatus, string> = {
  new: '새 민원',
  doing: '확인 중',
  done: '처리 완료',
  drop: '제외',
};

export type Complaint = {
  id: string;
  origin: 'crawl' | 'chat' | 'paste' | 'manual';
  title: string;
  url: string | null;
  author: string | null;
  board: string | null;
  postedAt: string | null;
  body: string | null;
  category: string | null;
  status: ComplaintStatus;
  note: string | null;
  roomId: string | null;
  messageId: number | null;
  createdAt: string;
};

/** 목록에 넣을 한 건. 크롤러와 붙여넣기 파서가 공통으로 만든다. */
export type ComplaintDraft = {
  title: string;
  url?: string | null;
  author?: string | null;
  board?: string | null;
  postedAt?: string | null;
  body?: string | null;
};

const TITLE_MAX = 300;

/* ─────────────────────────── 순수 함수 (테스트 있음) ─────────────────────────── */

/**
 * 같은 글이 두 건으로 갈리지 않게 주소를 다듬는다.
 *
 * 게시판 주소는 같은 글이라도 목록에서 눌렀는지 검색에서 눌렀는지에 따라 추적 파라미터가
 * 달라붙는다. 그걸 그대로 열쇠로 쓰면 같은 민원이 매 크롤마다 새 건으로 쌓인다.
 */
export function normalizeUrl(raw: string): string {
  const t = String(raw ?? '').trim();
  if (!t) return '';
  try {
    const u = new URL(t);
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.host = u.host.toLowerCase();
    const drop: string[] = [];
    u.searchParams.forEach((_v, k) => {
      if (/^(utm_|fbclid|gclid|inflow|from|ref|referrer)$|^utm/i.test(k)) drop.push(k);
    });
    for (const k of drop) u.searchParams.delete(k);
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return t;
  }
}

/** 제목 비교용 정규화. 띄어쓰기·대소문자 차이로 같은 글이 갈리지 않게. */
export function normalizeTitle(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 멱등키. 주소가 있으면 주소가, 없으면 (출처, 제목) 해시가 열쇠다.
 *
 * ★ 제목 해시에 출처를 섞는 이유: "도로 파임 민원" 같은 제목은 게시판마다 있다.
 *   출처를 빼면 다른 게시판의 다른 글이 한 건으로 뭉개진다.
 */
export function dedupKeyFor(d: { url?: string | null; title: string; board?: string | null; messageId?: number | null }): string {
  if (d.messageId != null) return `chat:${d.messageId}`;
  const u = d.url ? normalizeUrl(d.url) : '';
  if (u) return `url:${u}`;
  const digest = createHash('md5').update(`${d.board ?? ''}|${normalizeTitle(d.title)}`).digest('hex');
  return `title:${digest}`;
}

/** 목록 꼬리에 붙는 군더더기: 댓글 수 [3] · 새 글 배지 N · 사진·링크 아이콘 자리. */
const TRAILING_JUNK =
  /(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|\bNEW\b|\bN\b|[\s\u00b7\u3187|,\u200b-\u200f\ufe0f\ufffd\u2190-\u21ff\u2300-\u27bf\u2b00-\u2bff\ue000-\uf8ff]|[\ud800-\udbff][\udc00-\udfff])+$/i;

/**
 * 붙여넣은 목록 한 줄에서 제목만 남긴다.
 *
 * 게시판 목록을 브라우저에서 긁어오면 제목 뒤에 댓글 수·새 글 배지·아이콘이 딸려 온다.
 * 그대로 두면 같은 글이 댓글 수가 바뀔 때마다 새 민원으로 쌓인다(제목이 열쇠라서).
 */
export function cleanTitle(raw: string): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^\d{1,7}[.)]\s+/, '');       // 목록 번호 열이 제목 앞에 붙어 온 경우
  for (let i = 0; i < 4; i++) {
    const next = t.replace(TRAILING_JUNK, '').trim();
    if (next === t) break;
    t = next;
  }
  return t.slice(0, TITLE_MAX);
}

const DATE_FULL = /^(20\d\d)[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?\.?$/;
const DATE_SHORT = /^(\d{1,2})[.\-/](\d{1,2})\.?$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})$/;

/**
 * 게시판이 날짜 칸에 쓰는 세 가지 꼴을 ISO 로 바꾼다.
 * 시각까지는 모르므로 그 날 0시(KST)로 못 박는다 — 없는 정밀도를 지어내지 않는다.
 */
export function parseBoardDate(cell: string, now = Date.now()): string | null {
  const t = String(cell ?? '').trim();
  const full = DATE_FULL.exec(t);
  if (full) return isoKst(+full[1], +full[2], +full[3]);

  const short = DATE_SHORT.exec(t);
  if (short) {
    const d = new Date(now);
    return isoKst(d.getFullYear(), +short[1], +short[2]);
  }

  // 오늘 올라온 글은 시각만 찍힌다. 날짜는 오늘로 본다.
  if (TIME_ONLY.test(t)) {
    const d = new Date(now);
    return isoKst(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

function isoKst(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = Date.parse(`${y}-${pad(m)}-${pad(d)}T00:00:00+09:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const HEADER_WORDS = ['번호', '제목', '글쓴이', '작성자', '닉네임', '날짜', '작성일', '조회', '추천', '등록일'];

/**
 * 게시판 목록을 통째로 복사해 붙여넣은 텍스트를 한 건씩 쪼갠다.
 *
 * ★ 네이버 카페처럼 robots.txt 가 자동 수집을 막은 곳의 유일한 길이다.
 *   사람이 브라우저에서 보고 복사하는 것이라 정책과 충돌하지 않는다.
 *
 * 두 가지 모양을 받는다.
 *   탭으로 갈린 표    번호 ⇥ 제목 ⇥ 글쓴이 ⇥ 날짜 ⇥ 조회
 *   제목만 있는 줄    "지정타 근린3공원은 언제 완공될까요? [3] N"
 * 주소가 줄에 섞여 있으면(http…) 떼어내 링크로 쓴다.
 */
export function parsePastedList(text: string, now = Date.now()): ComplaintDraft[] {
  const out: ComplaintDraft[] = [];
  const seen = new Set<string>();

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;

    const cells = raw.split('\t').map((c) => c.trim()).filter(Boolean);
    // 표를 복사하면 머리글 줄이 딸려 온다. 그걸 민원으로 만들지 않는다
    if (cells.length > 1 && cells.every((c) => HEADER_WORDS.includes(c))) continue;

    let url: string | null = null;
    let postedAt: string | null = null;
    let author: string | null = null;

    const rest: string[] = [];
    for (const cell of cells) {
      const link = /(https?:\/\/\S+)/.exec(cell);
      if (link && !url) {
        url = link[1];
        const without = cell.replace(link[1], '').trim();
        if (without) rest.push(without);
        continue;
      }
      const date = parseBoardDate(cell, now);
      if (date && !postedAt) {
        postedAt = date;
        continue;
      }
      if (/^\d{1,7}$/.test(cell)) continue;   // 번호·조회수 열
      rest.push(cell);
    }

    if (rest.length === 0) continue;
    // 제목은 가장 긴 칸이다. 글쓴이·날짜·조회수는 짧고 제목만 길다
    let titleCell = rest[0];
    for (const c of rest) if (c.length > titleCell.length) titleCell = c;
    for (const c of rest) {
      if (c !== titleCell && c.length <= 20 && !author) author = c;
    }

    const title = cleanTitle(titleCell);
    if (title.length < 4) continue;   // 아이콘 부스러기·빈 칸만 남은 줄

    const key = url ? normalizeUrl(url) : normalizeTitle(title);
    if (seen.has(key)) continue;      // 한 번에 붙여넣은 안에서의 중복
    seen.add(key);

    out.push({ title, url, author, postedAt });
  }

  return out;
}

/* ─────────────────────────── DB ─────────────────────────── */

const SELECT =
  'id, origin, title, url, author, board, posted_at, body, category, status, note, room_id, message_id, created_at';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toComplaint(r: any): Complaint {
  return {
    id: r.id,
    origin: r.origin,
    title: r.title,
    url: r.url,
    author: r.author,
    board: r.board,
    postedAt: r.posted_at,
    body: r.body,
    category: r.category,
    status: r.status,
    note: r.note,
    roomId: r.room_id,
    messageId: r.message_id == null ? null : Number(r.message_id),
    createdAt: r.created_at,
  };
}

export async function listComplaints(opts: { status?: string; q?: string; limit?: number } = {}): Promise<Complaint[]> {
  let query = db().from('complaints').select(SELECT);
  if (opts.status && opts.status !== 'all') query = query.eq('status', opts.status);
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim().replace(/[%,]/g, ' ')}%`;
    query = query.or(`title.ilike.${like},note.ilike.${like},body.ilike.${like},category.ilike.${like}`);
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 300, 500));
  if (error) throw new Error(`민원 목록 실패: ${error.message}`);
  // 원글 시각이 있으면 그 순, 없으면 담은 순. 목록을 게시판과 같은 차례로 읽게 한다
  return (data ?? [])
    .map(toComplaint)
    .sort((a, b) => Date.parse(b.postedAt ?? b.createdAt) - Date.parse(a.postedAt ?? a.createdAt));
}

export async function countByStatus(): Promise<Record<string, number>> {
  const { data, error } = await db().from('complaints').select('status').limit(5000);
  if (error) throw new Error(`민원 집계 실패: ${error.message}`);
  const out: Record<string, number> = { all: 0, new: 0, doing: 0, done: 0, drop: 0 };
  for (const r of data ?? []) {
    out.all++;
    out[(r as any).status] = (out[(r as any).status] ?? 0) + 1;
  }
  return out;
}

/**
 * 여러 건을 한 번에 담는다. 크롤러·붙여넣기가 함께 쓴다.
 *
 * ★ upsert 가 아니라 `ignoreDuplicates` 다. 이미 있는 글은 **손대지 않는다** —
 *   사람이 "처리 완료" 로 옮겨둔 민원이 다음 크롤에 "새 민원" 으로 되돌아가면
 *   이 화면을 아무도 믿지 않게 된다.
 */
export async function addDrafts(
  drafts: ComplaintDraft[],
  meta: { origin: 'crawl' | 'paste' | 'manual'; sourceId?: string | null; board?: string | null },
): Promise<{ added: number; skipped: number }> {
  const rows = drafts
    .filter((d) => d.title.trim())
    .map((d) => {
      const board = d.board ?? meta.board ?? null;
      return {
        dedup_key: dedupKeyFor({ url: d.url, title: d.title, board }),
        origin: meta.origin,
        source_id: meta.sourceId ?? null,
        title: d.title.trim().slice(0, TITLE_MAX),
        url: d.url ? normalizeUrl(d.url).slice(0, 1000) : null,
        author: d.author?.slice(0, 80) || null,
        board: board?.slice(0, 120) || null,
        posted_at: d.postedAt ?? null,
        body: d.body?.slice(0, 4000) || null,
      };
    });
  if (rows.length === 0) return { added: 0, skipped: 0 };

  // 한 배치 안의 중복은 DB 가 아니라 여기서 거른다(같은 배치의 중복은 upsert 가 에러를 낸다)
  const uniq = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!uniq.has(r.dedup_key)) uniq.set(r.dedup_key, r);
  const list = [...uniq.values()];

  const { data, error } = await db()
    .from('complaints')
    .upsert(list, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(`민원 등록 실패: ${error.message}`);

  const added = (data ?? []).length;
  return { added, skipped: list.length - added };
}

/** 손으로 한 건 추가. 제목만 있어도 된다. */
export async function addManual(input: { title: string; url?: string; category?: string; note?: string }) {
  const title = input.title.trim();
  if (!title) throw new Error('제목이 없다');
  const { added } = await addDrafts([{ title, url: input.url?.trim() || null }], { origin: 'manual', board: '직접 입력' });
  if (added === 0) throw new Error('같은 민원이 이미 있다');
  if (input.category || input.note) {
    const key = dedupKeyFor({ url: input.url?.trim() || null, title, board: '직접 입력' });
    const { error } = await db()
      .from('complaints')
      .update({ category: input.category?.trim() || null, note: input.note?.trim() || null, updated_at: new Date().toISOString() })
      .eq('dedup_key', key);
    if (error) throw new Error(`민원 저장 실패: ${error.message}`);
  }
}

/**
 * 수집된 카톡 말풍선 하나를 민원으로 담는다.
 *
 * 제목은 본문 첫 줄에서 뽑고 원문은 body 에 통째로 남긴다 — 오픈채팅 민원은 대개 한 덩어리
 * 로 오고, 제목만 남기면 나중에 "무슨 얘기였더라" 가 된다.
 */
export async function clipMessage(messageId: number): Promise<void> {
  const { data: m, error } = await db()
    .from('messages')
    .select('id, room_id, sender, body, sent_at, attachment_type, attachment_name')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw new Error(`메시지 조회 실패: ${error.message}`);
  if (!m) throw new Error('없는 메시지다');

  const body = String((m as any).body ?? '').trim();
  const firstLine = body.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const title =
    firstLine.trim().slice(0, 120) ||
    `[${(m as any).attachment_type === 'image' ? '사진' : (m as any).attachment_name || '첨부'}] ${(m as any).sender}`;

  const { data: room } = await db().from('rooms').select('display_name, name_hint').eq('id', (m as any).room_id).maybeSingle();
  const board = (room as any)?.display_name || (room as any)?.name_hint || '카톡';

  const { error: insErr } = await db()
    .from('complaints')
    .upsert(
      {
        dedup_key: `chat:${messageId}`,
        origin: 'chat',
        title,
        body: body.slice(0, 4000) || null,
        author: (m as any).sender || null,
        board: board.slice(0, 120),
        posted_at: (m as any).sent_at,
        room_id: (m as any).room_id,
        message_id: messageId,
      },
      { onConflict: 'dedup_key', ignoreDuplicates: true },
    );
  if (insErr) throw new Error(`민원 담기 실패: ${insErr.message}`);
}

export async function setStatus(id: string, status: ComplaintStatus): Promise<void> {
  if (!STATUS_LABEL[status]) throw new Error(`모르는 상태다: ${status}`);
  const { error } = await db()
    .from('complaints')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(`상태 변경 실패: ${error.message}`);
}

export async function editComplaint(
  id: string,
  patch: { title?: string; note?: string; category?: string; url?: string },
): Promise<void> {
  const set: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) throw new Error('제목은 비울 수 없다');
    set.title = t.slice(0, TITLE_MAX);
  }
  if (patch.note !== undefined) set.note = patch.note.trim().slice(0, 1000) || null;
  if (patch.category !== undefined) set.category = patch.category.trim().slice(0, 60) || null;
  if (patch.url !== undefined) set.url = patch.url.trim() ? normalizeUrl(patch.url).slice(0, 1000) : null;

  const { error } = await db().from('complaints').update(set).eq('id', id);
  if (error) throw new Error(`민원 수정 실패: ${error.message}`);
}

export async function deleteComplaint(id: string): Promise<void> {
  const { error } = await db().from('complaints').delete().eq('id', id);
  if (error) throw new Error(`민원 삭제 실패: ${error.message}`);
}
