import { db } from '@/lib/db';
import { addDrafts, type ComplaintDraft } from './complaints';

/**
 * 민원 출처 크롤러 — 게시판·RSS 를 읽어 민원실에 담는다.
 *
 * ★ robots.txt 를 먼저 본다. 막혀 있으면 **긁지 않고 사유를 남긴다.**
 *   네이버 카페(cafe.naver.com)는 모든 봇에 `Disallow: /` 라 이 경로로는 못 가져온다.
 *   그런 곳은 사람이 목록을 복사해 붙여넣는 길(민원실의 붙여넣기 상자)로 처리한다.
 *   여기서 robots 검사를 빼지 말 것 — 상대 서버가 하지 말라고 적어둔 일이다.
 *
 * ★ 파서 의존성을 들이지 않는다(cheerio·xml2js 없음). RSS 는 태그를, HTML 은 앵커를
 *   정규식으로 훑는다. 게시판 HTML 은 어차피 사이트마다 달라서 CSS 선택자를 받아도
 *   유지보수가 되지 않는다 — 대신 "글 링크는 이런 주소꼴" 이라는 정규식 하나만 받는다.
 *
 * ★ 조용히 0건으로 끝내지 않는다. 실패는 `complaint_sources.last_error` 에 사유가 그대로
 *   남고 화면 출처 줄에 뜬다. 이 프로젝트가 제일 경계하는 것이 조용한 실패다.
 */

const UA = 'gccity-complaint-reader/1.0 (개인용 민원 정리; robots.txt 준수)';
const FETCH_TIMEOUT_MS = 15_000;
const ROBOTS_TIMEOUT_MS = 6_000;
const MAX_BYTES = 6 * 1024 * 1024;
/** 한 번에 담는 상한. 게시판 첫 페이지가 보통 15~30건이라 넉넉하다. */
const MAX_ITEMS = 60;

export type CrawlSource = {
  id: string;
  name: string;
  url: string;
  kind: 'auto' | 'rss' | 'html';
  linkPattern: string | null;
  keywords: string | null;
  enabled: boolean;
  everyMinutes: number;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastCount: number | null;
  lastNew: number | null;
};

export type CrawlResult = {
  sourceId: string;
  name: string;
  ok: boolean;
  found: number;
  added: number;
  error: string | null;
};

/* ─────────────────────────── 순수 함수 (테스트 있음) ─────────────────────────── */

type RobotRule = { allow: boolean; pattern: string };

/**
 * robots.txt 가 이 경로의 자동 수집을 막고 있는가.
 *
 * 규칙은 표준대로 **가장 긴 패턴이 이긴다.** 같은 길이면 Allow 가 이긴다.
 * 우리 UA 를 위한 블록이 있으면 그것만 보고, 없으면 `*` 블록을 본다.
 */
export function robotsDisallows(robotsTxt: string, path: string, agent = '*'): boolean {
  const groups = new Map<string, RobotRule[]>();
  let current: string[] = [];
  let sawRule = false;

  for (const line of String(robotsTxt ?? '').split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const idx = clean.indexOf(':');
    if (idx < 0) continue;
    const field = clean.slice(0, idx).trim().toLowerCase();
    const value = clean.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // 규칙이 한 번이라도 나온 뒤의 User-agent 는 새 블록이다
      if (sawRule) {
        current = [];
        sawRule = false;
      }
      current.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), []);
      continue;
    }
    if (field !== 'allow' && field !== 'disallow') continue;
    sawRule = true;
    for (const ua of current) {
      groups.get(ua)!.push({ allow: field === 'allow', pattern: value });
    }
  }

  const lower = agent.toLowerCase();
  const rules =
    [...groups.entries()].find(([ua]) => ua !== '*' && lower.includes(ua))?.[1] ?? groups.get('*') ?? [];

  let best: RobotRule | null = null;
  for (const r of rules) {
    if (!r.pattern) continue;              // "Disallow:" 는 전부 허용이라는 뜻이다
    if (!robotPathMatches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) {
      best = r;
    }
  }
  return best ? !best.allow : false;
}

function robotPathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const rx = body
    .split('*')
    .map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + rx + (anchored ? '$' : '')).test(path);
}

export function decodeEntities(s: string): string {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

export function stripTags(html: string): string {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function absolutize(href: string, baseUrl: string): string | null {
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** RSS·Atom 한 판. 태그 이름만 보고 훑는다. */
export function parseFeed(xml: string, baseUrl: string): ComplaintDraft[] {
  const out: ComplaintDraft[] = [];
  const blocks = String(xml ?? '').match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];

  for (const block of blocks) {
    const title = stripTags(pick(block, 'title') ?? '');
    if (!title) continue;

    let link = pick(block, 'link') ?? '';
    if (!link.trim()) {
      // Atom 은 <link href="…"/> 꼴이다
      const href = /<link\b[^>]*href=["']([^"']+)["']/i.exec(block);
      link = href ? href[1] : '';
    }
    const url = link.trim() ? absolutize(decodeEntities(link.trim()), baseUrl) : null;

    const dateRaw = pick(block, 'pubDate') ?? pick(block, 'published') ?? pick(block, 'updated') ?? pick(block, 'dc:date');
    const parsed = dateRaw ? Date.parse(dateRaw.trim()) : NaN;

    out.push({
      title,
      url,
      author: stripTags(pick(block, 'author') ?? pick(block, 'dc:creator') ?? '') || null,
      postedAt: Number.isNaN(parsed) ? null : new Date(parsed).toISOString(),
    });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function pick(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!m) return null;
  return m[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1');
}

/** 글 링크로 보이는 주소꼴. 사이트마다 다르지만 게시판은 대개 이 중 하나를 쓴다. */
const DEFAULT_LINK_PATTERN =
  /(view|read|detail|artcl|bbs|board|article|notice|post)|(\b(no|idx|seq|nttId|articleNo|wr_id|bbsIdx)=)/i;

/** 목록에 섞인 페이지 이동·안내 링크. 제목처럼 보여도 글이 아니다. */
const NAV_WORDS = /^(다음|이전|처음|맨끝|목록|더보기|검색|글쓰기|답글|삭제|수정|home|next|prev|list|more|\d+)$/i;

/**
 * HTML 목록 판에서 글 링크를 뽑는다.
 *
 * 게시판 마크업은 사이트마다 다르므로 구조를 믿지 않고 **앵커만** 훑는다.
 * 대신 어떤 앵커가 글인지는 주소꼴로 가른다 — 출처마다 `link_pattern` 으로 바꿀 수 있다.
 */
export function parseHtmlList(html: string, baseUrl: string, linkPattern?: string | null): ComplaintDraft[] {
  let rx: RegExp;
  try {
    rx = linkPattern?.trim() ? new RegExp(linkPattern.trim(), 'i') : DEFAULT_LINK_PATTERN;
  } catch {
    throw new Error(`링크 패턴이 정규식이 아니다: ${linkPattern}`);
  }

  const out: ComplaintDraft[] = [];
  const seen = new Set<string>();
  const anchors = String(html ?? '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);

  for (const a of anchors) {
    const href = decodeEntities(a[1].trim());
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
    if (!rx.test(href)) continue;

    const url = absolutize(href, baseUrl);
    if (!url || seen.has(url)) continue;

    // 제목이 <a> 안에 없고 title 속성에만 있는 목록도 흔하다
    const title = stripTags(a[2]) || decodeEntities(/title=["']([^"']+)["']/i.exec(a[0])?.[1] ?? '');
    if (title.length < 4 || title.length > 200 || NAV_WORDS.test(title)) continue;

    seen.add(url);
    out.push({ title, url });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** 제목에 이 낱말 중 하나가 있어야 담는다. 비우면 전부 담는다. */
export function matchesKeywords(title: string, keywords: string | null | undefined): boolean {
  const words = String(keywords ?? '')
    .split(',')
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (words.length === 0) return true;
  const t = title.toLowerCase();
  return words.some((w) => t.includes(w));
}

/** 응답 바이트를 글자로 바꾼다. 관공서 게시판은 아직 EUC-KR 이 흔하다. */
export function decodeBody(buf: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 2048));
  const charset =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  const label = charset.toLowerCase().replace('ks_c_5601-1987', 'euc-kr').replace('cp949', 'euc-kr');
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // 모르는 인코딩이면 UTF-8 로 읽는다. 글자가 깨지는 편이 아무것도 안 담기는 것보다 낫다
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/* ─────────────────────────── 출처 CRUD ─────────────────────────── */

const SRC_SELECT =
  'id, name, url, kind, link_pattern, keywords, enabled, every_minutes, last_run_at, last_ok, last_error, last_count, last_new';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSource(r: any): CrawlSource {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    kind: r.kind,
    linkPattern: r.link_pattern,
    keywords: r.keywords,
    enabled: r.enabled,
    everyMinutes: r.every_minutes,
    lastRunAt: r.last_run_at,
    lastOk: r.last_ok,
    lastError: r.last_error,
    lastCount: r.last_count,
    lastNew: r.last_new,
  };
}

export async function listSources(): Promise<CrawlSource[]> {
  const { data, error } = await db().from('complaint_sources').select(SRC_SELECT).order('created_at').limit(50);
  if (error) throw new Error(`출처 목록 실패: ${error.message}`);
  return (data ?? []).map(toSource);
}

export async function addSource(input: {
  name: string;
  url: string;
  kind?: string;
  linkPattern?: string;
  keywords?: string;
  everyMinutes?: number;
}): Promise<string> {
  const url = input.url.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('주소가 올바르지 않다 (http… 로 시작해야 한다)');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('http/https 만 된다');

  // 등록 시점에 robots 를 한 번 본다. 못 긁을 곳을 목록에만 올려두면
  // "왜 아무것도 안 들어오지" 를 나중에 코드에서 찾게 된다
  const blocked = await robotsBlocked(parsed);
  if (blocked) throw new Error(blocked);

  const kind = ['auto', 'rss', 'html'].includes(String(input.kind)) ? String(input.kind) : 'auto';
  const { data, error } = await db()
    .from('complaint_sources')
    .insert({
      name: input.name.trim().slice(0, 80) || parsed.hostname,
      url,
      kind,
      link_pattern: input.linkPattern?.trim() || null,
      keywords: input.keywords?.trim() || null,
      every_minutes: Math.min(Math.max(Number(input.everyMinutes) || 360, 30), 10080),
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw new Error('같은 주소의 출처가 이미 있다');
    throw new Error(`출처 등록 실패: ${error.message}`);
  }
  return data!.id;
}

export async function editSource(id: string, patch: Record<string, unknown>): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = String(patch.name).trim().slice(0, 80);
  if (patch.enabled !== undefined) set.enabled = Boolean(patch.enabled);
  if (patch.keywords !== undefined) set.keywords = String(patch.keywords).trim() || null;
  if (patch.linkPattern !== undefined) set.link_pattern = String(patch.linkPattern).trim() || null;
  if (patch.everyMinutes !== undefined) {
    set.every_minutes = Math.min(Math.max(Number(patch.everyMinutes) || 360, 30), 10080);
  }
  if (Object.keys(set).length === 0) return;
  const { error } = await db().from('complaint_sources').update(set).eq('id', id);
  if (error) throw new Error(`출처 수정 실패: ${error.message}`);
}

export async function deleteSource(id: string): Promise<void> {
  // 담긴 민원은 남는다(complaints.source_id 는 on delete set null). 출처를 지웠다고
  // 정리해 둔 민원이 사라지면 그게 더 큰 손실이다
  const { error } = await db().from('complaint_sources').delete().eq('id', id);
  if (error) throw new Error(`출처 삭제 실패: ${error.message}`);
}

/* ─────────────────────────── 크롤 ─────────────────────────── */

async function fetchWithTimeout(url: string, timeoutMs: number, accept: string): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'user-agent': UA, accept, 'accept-language': 'ko-KR,ko;q=0.9' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** 막혀 있으면 사유 문자열, 아니면 null. robots 를 못 읽으면 허용으로 본다(표준). */
async function robotsBlocked(target: URL): Promise<string | null> {
  const robotsUrl = `${target.origin}/robots.txt`;
  let txt: string;
  try {
    const res = await fetchWithTimeout(robotsUrl, ROBOTS_TIMEOUT_MS, 'text/plain');
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) return null;
    txt = await res.text();
  } catch {
    return null;
  }
  if (!robotsDisallows(txt, target.pathname + target.search)) return null;
  return (
    `${target.host} 의 robots.txt 가 이 경로의 자동 수집을 막고 있다. ` +
    '이 출처는 크롤로 가져오지 않는다 — 목록을 복사해 아래 붙여넣기 상자에 넣을 것' +
    (target.host.includes('cafe.naver.com') ? ' (네이버 카페는 모든 봇에 Disallow: / 다)' : '')
  );
}

/**
 * 출처 하나를 긁는다. **던지지 않는다** — 실패도 결과로 돌려주고 행에 사유를 남긴다.
 * 한 출처가 죽었다고 나머지가 멈추면 안 되고, 실패가 화면에 안 보이면 더 안 된다.
 */
export async function runSource(source: CrawlSource): Promise<CrawlResult> {
  const started = new Date().toISOString();
  let found = 0;
  let added = 0;
  let error: string | null = null;

  try {
    const target = new URL(source.url);
    const blocked = await robotsBlocked(target);
    if (blocked) throw new Error(blocked);

    const res = await fetchWithTimeout(
      source.url,
      FETCH_TIMEOUT_MS,
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8',
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());

    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new Error(`응답이 너무 크다 (${Math.round(len / 1024 / 1024)}MB)`);
    const ctype = res.headers.get('content-type') ?? '';
    const body = decodeBody(await res.arrayBuffer(), ctype);

    const isFeed =
      source.kind === 'rss' ||
      (source.kind === 'auto' && (/xml/i.test(ctype) || /<(rss|feed)\b/i.test(body.slice(0, 2000))));

    const items = isFeed ? parseFeed(body, source.url) : parseHtmlList(body, source.url, source.linkPattern);
    found = items.length;
    if (found === 0) {
      throw new Error(
        isFeed
          ? '피드에서 글을 하나도 찾지 못했다 — 주소가 목록 페이지인지 확인할 것'
          : '목록에서 글 링크를 하나도 찾지 못했다 — 링크 패턴을 손봐야 한다(예: bbsIdx=)',
      );
    }

    const kept = items.filter((i) => matchesKeywords(i.title, source.keywords));
    const out = await addDrafts(kept, { origin: 'crawl', sourceId: source.id, board: source.name });
    added = out.added;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const { error: upErr } = await db()
    .from('complaint_sources')
    .update({
      last_run_at: started,
      last_ok: !error,
      last_error: error,
      last_count: found,
      last_new: added,
    })
    .eq('id', source.id);
  if (upErr) console.error('[gccity] 출처 상태 저장 실패:', upErr.message);

  if (error) console.error(`[gccity] 민원 크롤 실패 (${source.name}):`, error);
  return { sourceId: source.id, name: source.name, ok: !error, found, added, error };
}

/** 켜져 있는 출처를 전부 긁는다. 한 번에 하나씩 — 상대 서버를 두드리는 일이다. */
export async function runSources(only?: string): Promise<CrawlResult[]> {
  const all = await listSources();
  const list = only ? all.filter((s) => s.id === only) : all.filter((s) => s.enabled);
  if (only && list.length === 0) throw new Error('없는 출처다');

  const out: CrawlResult[] = [];
  for (const s of list) out.push(await runSource(s));
  return out;
}

/** 주기가 지난 출처만. cron 이 부른다. */
export async function runDueSources(now = Date.now()): Promise<CrawlResult[]> {
  const due = (await listSources()).filter(
    (s) => s.enabled && (!s.lastRunAt || now - Date.parse(s.lastRunAt) >= s.everyMinutes * 60_000),
  );
  const out: CrawlResult[] = [];
  for (const s of due) out.push(await runSource(s));
  return out;
}

/** 지금 긁을 때가 된 출처 수. 화면이 "출처 2곳이 갱신할 때가 됐다" 를 띄우는 근거다. */
export function countDue(sources: CrawlSource[], now = Date.now()): number {
  return sources.filter(
    (s) => s.enabled && (!s.lastRunAt || now - Date.parse(s.lastRunAt) >= s.everyMinutes * 60_000),
  ).length;
}
