/**
 * 화면이 쓰는 자료 모양.
 *
 * ★ `@/server/*` 에서 가져오지 않는다. 서버 모듈은 `db()` 를 물고 있어 한 줄만 import 해도
 *   supabase 클라이언트가 브라우저 번들로 딸려 들어온다. 두 곳에서 같은 모양을 쓰되
 *   서로 import 하지 않는 것이 이 프로젝트의 규칙이다 (`src/lib/complaint-view.ts` 와 같은 이유).
 */

export type Room = {
  id: string;
  channelId: string;
  legacyKey: boolean;
  displayName: string | null;
  nameHint: string | null;
  followed: boolean;
  isGroup: boolean;
  seenCount: number;
  messageCount: number;
  lastSeenAt: string | null;
  lastMessageAt: string | null;
  lastSender: string | null;
  lastPreview: string | null;
};

export type Message = {
  id: number;
  sender: string;
  body: string;
  sentAt: string;
  /** 'image' | 'file' | null. file 은 **이름만** 온다 — 바이트는 사람이 자료실에 넣는다 */
  attachmentType: string | null;
  attachmentName: string | null;
  /** 사진의 서명 URL. image 인데 비어 있으면 봇이 사진을 못 올린 것이다 */
  attachmentUrl: string | null;
};

export type State = {
  ok: boolean;
  bot: {
    lastSeenAt: string | null;
    lastGapMs: number | null;
    build: string | null;
    api2: boolean | null;
    msgCount: number | null;
    /** 이름을 알림 색인에서 얻은 건수 / API2 author 로 때운 건수 */
    senderIdx: number | null;
    senderAuth: number | null;
  };
  discovery: { on: boolean; until: string | null };
  rooms: Room[];
  messages: Message[];
};

export type StoredFile = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  note: string | null;
  createdAt: string;
};

export type CivicStatus = 'new' | 'doing' | 'done' | 'drop';
export type PostKind = 'report' | 'resolution' | 'notice' | 'unknown';
export type AuthorKind = 'official' | 'resident' | 'ignore';

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
  status: CivicStatus;
  note: string | null;
  createdAt: string;
  kind: PostKind;
  kindLocked: boolean;
  reportedAt: string | null;
  resolvedAt: string | null;
  /* 1·3·7 단계 시각. 사람이 [단계 기록] 으로 넣는다 — 모델이 채우지 않는다 */
  assignedAt: string | null;
  visitedAt: string | null;
  resolutionOf: string | null;
  summary: string | null;
  department: string | null;
  agency: string | null;
  dueAt: string | null;
  aiDraft: boolean;
  aiNote: string | null;
  cafePostId: string | null;
  /** 같은 사안이 다른 경로로 한 번 더 들어온 것 */
  duplicateOf: string | null;
  /** 해결 내용 — 이 민원이 어떻게 처리됐는가. 부서·기관·예정일이 여기서 나온다 */
  resolutionText: string | null;
  resolutionSummary: string | null;
};

export type PairSide = { id: string; title: string; kind: string; at: string | null; origin: string };
export type PairSuggestion = {
  id: string;
  relation: 'resolves' | 'duplicate';
  confidence: string | null;
  reason: string | null;
  left: PairSide;
  right: PairSide;
};

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

export type CivicAuthor = { name: string; kind: AuthorKind; note: string | null; count?: number };

export type Flow = {
  reports: number;
  resolutions: number;
  notices: number;
  unknown: number;
  measured: number;
  avgLeadDays: number | null;
  medianLeadDays: number | null;
  maxLeadDays: number | null;
  sameDay: number;
};

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

export type CafePost = {
  id: string;
  title: string | null;
  url: string | null;
  body: string;
  postedAt: string | null;
  reply: string | null;
  replyPostedAt: string | null;
  createdAt: string;
  summarizedAt: string | null;
  ok: boolean | null;
  error: string | null;
  drafted: number;
};

/* ── 라벨 ────────────────────────────────────────────────────────────────── */

/** 서버(`src/server/complaints.ts`)의 STATUS_LABEL 과 같은 값이다. 한쪽만 고치지 말 것. */
export const CIVIC_STATUS: { key: CivicStatus; label: string; tone: string }[] = [
  { key: 'new', label: '접수', tone: 'blue' },
  { key: 'doing', label: '진행', tone: 'amb' },
  { key: 'done', label: '완료', tone: 'grn' },
  { key: 'drop', label: '보류', tone: 'gry' },
];

/** 서버(`complaint-classify.ts`)의 KIND_LABEL 과 같은 값이다. 한쪽만 고치지 말 것. */
export const KIND: { key: PostKind; label: string }[] = [
  { key: 'report', label: '민원' },
  { key: 'resolution', label: '처리' },
  { key: 'notice', label: '공지' },
  { key: 'unknown', label: '미분류' },
];

export const KIND_LABEL: Record<PostKind, string> = {
  report: '민원',
  resolution: '처리',
  notice: '공지',
  unknown: '미분류',
};

export const AUTHOR_KIND: { key: AuthorKind; label: string }[] = [
  { key: 'resident', label: '주민' },
  { key: 'official', label: '기관' },
  { key: 'ignore', label: '숨김' },
];

export const ORIGIN_LABEL: Record<Complaint['origin'], string> = {
  crawl: '크롤',
  paste: '붙여넣기',
  chat: '카톡',
  manual: '직접',
};

/** 접힌 줄에 붙는 짧은 출처 표. 어디서 온 민원인지가 목록에서 바로 보여야 한다 */
export const ORIGIN_TAG: Record<Complaint['origin'], string> = {
  chat: '카톡',
  paste: '카페',
  crawl: '크롤',
  manual: '직접',
};

export function statusOf(c: Complaint): { label: string; tone: string } {
  const s = CIVIC_STATUS.find((x) => x.key === c.status);
  return s ? { label: s.label, tone: s.tone } : { label: c.status, tone: 'gry' };
}

/** 방 이름. 사람이 붙인 이름이 언제나 우선이다 */
export function roomLabel(r: Room): string {
  return r.displayName || r.nameHint || '';
}

/**
 * 이름이 없는 방의 대체 표시.
 * channelId 는 17~19자리 숫자라 그대로 쓰면 화면이 숫자 무더기가 된다.
 */
export function shortKey(channelId: string): string {
  return channelId.length <= 14 ? channelId : '#…' + channelId.slice(-8);
}

/** 화면에서 여러 곳이 쓰는 서버 호출 묶음 */
export type Act = (body: Record<string, unknown>) => Promise<Record<string, any> | null>;
