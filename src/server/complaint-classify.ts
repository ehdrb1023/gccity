/**
 * 민원 글을 성격별로 가른다 — 목적은 목록이 아니라 **흐름**이다.
 *
 *   report      주민이 올린 민원
 *   resolution  처리·회신 기록
 *   notice      공지·홍보·보도자료
 *   unknown     아직 모르는 작성자의 글. 화면에서 한 번 정해주면 그 뒤로 자동이다
 *
 * ★ 작성자만으로 가르면 틀린다. `조인길 정책관` 한 계정이 처리 기록과 보도자료를 함께 쓴다
 *   (실측 2026-08-21, 과천 카페 게시판). 그래서 **작성자 명부와 제목 규칙을 함께** 본다.
 *
 * ★ 제목의 날짜는 접수일, 글 작성일은 회신일이다.
 *     "2026년 8월 7일(금) 과천대로 관문체육공원 도로 민원"  작성일 08.11 → 4일
 *     "2026년 8월 20일(목) 양재천 냄새 민원"                작성일 08.20 → 당일
 *   이 차이가 곧 처리 소요일이라, 처리 글 하나만으로도 흐름을 잴 수 있다.
 *   짝짓기(resolution_of)는 그 위에 얹는 정밀도지 전제가 아니다.
 */

export type PostKind = 'report' | 'resolution' | 'notice' | 'unknown';
export type AuthorKind = 'official' | 'resident' | 'ignore';

export const KIND_LABEL: Record<PostKind, string> = {
  report: '민원',
  resolution: '처리',
  notice: '공지',
  unknown: '미분류',
};

export const AUTHOR_KIND_LABEL: Record<AuthorKind, string> = {
  official: '기관',
  resident: '주민',
  ignore: '숨김',
};

/** "2026년 8월 20일(목) 양재천 냄새 민원" 의 앞머리. 요일 괄호는 있을 수도 없을 수도 있다. */
const DATED_TITLE = /^\s*(20\d\d)\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:\(\s*[월화수목금토일]\s*\)\s*)?[-–—]?\s*(.*)$/;

/** 민원 처리 기록임을 알리는 낱말. 없으면 날짜꼴이어도 처리 기록이 아니다. */
const COMPLAINT_WORD = /(민원|청원|요청|신고|건의)/;

export type DatedTitle = { reportedAt: string; rest: string };

/**
 * 제목 앞머리의 날짜를 접수일로 읽는다.
 *
 * 시각까지는 모르므로 그 날 0시(KST)로 못 박는다 — 없는 정밀도를 지어내면
 * "0.4일 만에 처리" 같은 숫자가 나온다.
 */
export function parseDatedTitle(title: string): DatedTitle | null {
  const m = DATED_TITLE.exec(String(title ?? ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = Date.parse(`${y}-${pad(mo)}-${pad(d)}T00:00:00+09:00`);
  if (Number.isNaN(t)) return null;
  return { reportedAt: new Date(t).toISOString(), rest: m[4].trim() };
}

export type ClassifyInput = {
  title: string;
  authorKind?: AuthorKind | null;
  /** 카톡에서 담은 것은 언제나 주민 민원이다 */
  origin?: 'crawl' | 'chat' | 'paste' | 'manual';
  /** 글이 올라온 시각. 처리 글이면 이게 회신 시각이 된다 */
  postedAt?: string | null;
};

export type Classified = {
  kind: PostKind;
  reportedAt: string | null;
  resolvedAt: string | null;
};

/**
 * 한 건을 가른다. 규칙은 셋뿐이고 순서가 전부다.
 *
 * 1. 제목이 `날짜 + …민원` 꼴이면 **처리 기록**이다. 작성자가 누구든 상관없다
 *    — 기관 계정이 쓴 것이든 사람이 옮겨 적은 것이든 그 글은 회신이다
 * 2. 아니고 작성자가 기관이면 공지·홍보다
 * 3. 아니면 주민 민원으로 본다. 작성자를 모르면 미분류로 남기고 사람에게 묻는다
 *
 * 주민 글 중에도 정보 공유·잡담이 섞인다. 규칙으로는 못 가르므로 report 로 두고
 * 화면에서 [공지] 로 내리게 한다 — 틀리게 자동 분류하느니 사람 손이 한 번 가는 편이 낫다.
 */
export function classify(input: ClassifyInput): Classified {
  const title = String(input.title ?? '');
  const postedAt = input.postedAt ?? null;

  if (input.origin === 'chat') {
    return { kind: 'report', reportedAt: postedAt, resolvedAt: null };
  }

  const dated = parseDatedTitle(title);
  if (dated && COMPLAINT_WORD.test(dated.rest)) {
    // 접수일은 제목에, 회신일은 작성일에 있다
    return { kind: 'resolution', reportedAt: dated.reportedAt, resolvedAt: postedAt };
  }

  if (input.authorKind === 'ignore') return { kind: 'notice', reportedAt: null, resolvedAt: null };
  if (input.authorKind === 'official') return { kind: 'notice', reportedAt: null, resolvedAt: null };
  if (input.authorKind === 'resident') return { kind: 'report', reportedAt: postedAt, resolvedAt: null };

  return { kind: 'unknown', reportedAt: postedAt, resolvedAt: null };
}

/**
 * 접수 → 회신 소요일. 날짜 단위로 반올림하지 않고 **버림**한다 —
 * 당일 처리를 "1일 걸림" 으로 부풀리지 않기 위해서다.
 */
export function leadTimeDays(reportedAt: string | null, resolvedAt: string | null): number | null {
  if (!reportedAt || !resolvedAt) return null;
  const a = Date.parse(reportedAt);
  const b = Date.parse(resolvedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const days = Math.floor((b - a) / 86_400_000);
  return days < 0 ? null : days;   // 회신이 접수보다 이르면 짝이 틀린 것이다. 숫자를 지어내지 않는다
}

export type FlowStats = {
  reports: number;
  resolutions: number;
  notices: number;
  unknown: number;
  /** 소요일을 잴 수 있었던 처리 건수. 평균·중앙값의 모수다 */
  measured: number;
  avgLeadDays: number | null;
  medianLeadDays: number | null;
  maxLeadDays: number | null;
  sameDay: number;
};

/**
 * 흐름 요약. ★ 모수(`measured`)를 함께 내보낸다 —
 * "평균 3일" 이 두 건에서 나온 값인지 백 건에서 나온 값인지 화면이 말해줘야 한다.
 */
export function flowStats(
  rows: { kind: PostKind; reportedAt: string | null; resolvedAt: string | null }[],
): FlowStats {
  const out: FlowStats = {
    reports: 0, resolutions: 0, notices: 0, unknown: 0,
    measured: 0, avgLeadDays: null, medianLeadDays: null, maxLeadDays: null, sameDay: 0,
  };
  const leads: number[] = [];

  for (const r of rows) {
    if (r.kind === 'report') out.reports++;
    else if (r.kind === 'resolution') out.resolutions++;
    else if (r.kind === 'notice') out.notices++;
    else out.unknown++;

    const lead = leadTimeDays(r.reportedAt, r.resolvedAt);
    if (lead != null) {
      leads.push(lead);
      if (lead === 0) out.sameDay++;
    }
  }

  out.measured = leads.length;
  if (leads.length > 0) {
    leads.sort((a, b) => a - b);
    out.avgLeadDays = Math.round((leads.reduce((s, n) => s + n, 0) / leads.length) * 10) / 10;
    const mid = leads.length >> 1;
    out.medianLeadDays = leads.length % 2 ? leads[mid] : (leads[mid - 1] + leads[mid]) / 2;
    out.maxLeadDays = leads[leads.length - 1];
  }
  return out;
}

/* ─────────────────── 처리 글 본문 파싱 ─────────────────── */

/**
 * 처리 글 본문에서 시각·부서·완료 예정일을 뽑는다. **LLM 없이 정규식으로 된다.**
 *
 * 실측 본문 한 건(2026-08-21, "2026년 8월 20일(목) 양재천 냄새 민원"):
 *
 *   양재천에서 의문의 냄새가 … 민원이 접수 되었습니다. 이에 담당 부서인
 *   과천시청 공원녹지과 정원도시팀에 문의한 결과 … 2026년 9월 11일(금)까지
 *   관로 공사를 작업할 예정이다 라는 회신을 받았습니다. …
 *
 *   - 2026년 8월 20일(목) 오전 9시 23분 -     ← 접수
 *   - 2026년 8월 21일(금) 오전 9시 21분 -     ← 부서 회신
 *
 * ★ 표본이 한 건이다. 형식이 다른 글이 나오면 뽑히는 게 없을 뿐,
 *   틀린 값을 지어내지는 않는다(전부 null 로 떨어진다). 그때 규칙을 늘릴 것.
 *
 * ★ 회신은 해결이 아니다. 위 건은 회신이 왔지만 실제 공사는 9월 11일 예정이라
 *   `dueAt` 이 남는다. 회신 시각만 보고 "처리 완료" 로 세면 통계가 부풀려진다.
 */
export type ParsedBody = {
  /** 본문 마커 중 첫 번째 — 민원이 접수된 시각 */
  receivedAt: string | null;
  /** 본문 마커 중 마지막 — 부서 회신이 붙은 시각. 마커가 하나뿐이면 null */
  repliedAt: string | null;
  /**
   * 배분 부서 — **시청 안**에서 이 민원을 맡은 곳. "담당 부서인 X에 문의한 결과" 꼴이거나,
   * 외부로 넘긴 건이면 "X에서 담당 기관인 …에게" 의 X 다.
   */
  department: string | null;
  /**
   * 회신 기관 — **시청 밖**에서 답을 준 곳(시공사·공기업 등). "담당 기관인 Y에게" 꼴이다.
   *
   * ★ 부서와 한 칸에 담지 말 것. 부서별 집계를 낼 때 시청 과·팀과 외부 기관이 한 줄에
   *   섞이면 사과와 오렌지를 함께 세게 된다. "우리가 처리한 것 / 남에게 넘긴 것" 을
   *   가르는 것 자체가 이 앱이 보려는 숫자다.
   */
  agency: string | null;
  /** "…까지" 로 약속된 조치 완료 예정일. 있으면 아직 안 끝난 건이다 */
  dueAt: string | null;
  /** 뽑아낸 시각 마커 전부(디버깅·표시용) */
  marks: string[];
};

const BODY_MARK =
  /^\s*[-–—]\s*(20\d\d)\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:\(\s*[월화수목금토일]\s*\))?\s*(오전|오후)?\s*(\d{1,2})\s*시\s*(\d{1,2})?\s*분?\s*[-–—]\s*$/gm;

/*
 * 회신문은 세 꼴로 온다. **부서**와 **기관**을 가르는 것이 이 세 줄의 전부다.
 *
 *   ① 담당 **부서**인 〈과천시청 공원녹지과 하천관리팀〉에서 현장 출동하여…   → 부서
 *   ② 담당 **부서**인 〈…도시조성1팀과 기획홍보담당관 기획팀〉에 문의한 결과…  → 부서
 *   ③ 본 민원을 〈과천시청 당직실〉에서 담당 **기관**인 〈넷마블 공사 관계자〉에게…
 *                    └ 부서(배분)                    └ 기관(회신)
 *
 * 조사(에서·에게·에·으로) 뒤에 **공백**이 오는 자리에서 끊는다 — 부서명 안의 '과'·'관' 을
 * 조사로 오인하지 않으려는 것이다(과천시청 도시조성과 도시조성1팀…).
 */
/*
 * ★ 기관명에 마침표·가운뎃점·하이픈·괄호가 들어간다. 실측 2026-08-24:
 *   "담당 기관인 **LH 의왕.과천 사업소**에 문의한 결과". 글자 범위에서 `.` 을 빼두면
 *   여기서 통째로 못 읽고 부서가 빈칸이 된다 — 화면에는 "배분 전" 으로 뜨는데,
 *   그건 "아직 안 정해졌다" 와 겉보기가 같아 **틀린 것을 틀린 줄 모른다.**
 */
const ORG = '[가-힣A-Za-z0-9·.\\-/()\\s]';

const DEPARTMENT = new RegExp(`담당\\s*부서(?:인|는|:)?\\s*(${ORG}{2,60}?)\\s*(?:에서|에게|에|으로|이)\\s+`);

/** ③ 의 뒤쪽 — 시청 밖에서 답을 준 곳. */
const AGENCY = new RegExp(`담당\\s*기관(?:인|는|:)?\\s*(${ORG}{2,60}?)\\s*(?:에서|에게|에|으로|이)\\s+`);

/*
 * ③ 의 앞쪽 — 외부로 넘긴 **시청 부서**.
 *
 * ★ 부서명이 여러 낱말이다("과천시청 공원녹지과 정원도시팀"). 한 낱말만 잡으면
 *   "정원도시팀" 처럼 소속이 잘려 나가고, 반대로 아무 낱말이나 이어 붙이면
 *   "본 민원을" 같은 앞머리가 딸려 온다. 그래서 **시청으로 시작하는 덩어리**를 먼저 보고,
 *   그게 없을 때만 조직 꼬리(과·팀·실…)로 끝나는 한 낱말로 떨어진다.
 */
const VIA_DEPARTMENT =
  /((?:과천시청|과천시)(?:\s+[가-힣A-Za-z0-9·.]+){0,3}|[가-힣A-Za-z0-9·.]{2,15}(?:과|팀|실|담당관|사업소|본부|센터))\s*에서\s+담당\s*기관/;

/*
 * 말머리 없이 바로 부서를 적는 회신. 반드시 **시청으로 시작**하고 조직 이름이 한 낱말
 * 이상 이어져야 한다 — 그러지 않으면 "과천시는 …" 같은 평범한 문장을 부서로 읽는다.
 */
const BARE_DEPARTMENT =
  /((?:과천시청|과천시)(?:\s+[가-힣A-Za-z0-9·.]+){1,3})\s*(?:에서|에게|에|으로|이)\s/;

const DUE_DATE =
  /(20\d\d)\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(?:\(\s*[월화수목금토일]\s*\))?\s*까지/;

function isoKstAt(y: number, mo: number, d: number, h = 0, mi = 0): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = Date.parse(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+09:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseResolutionBody(body: string): ParsedBody {
  const text = String(body ?? '');
  const out: ParsedBody = {
    receivedAt: null, repliedAt: null, department: null, agency: null, dueAt: null, marks: [],
  };

  BODY_MARK.lastIndex = 0;
  for (let m = BODY_MARK.exec(text); m; m = BODY_MARK.exec(text)) {
    let hour = Number(m[5]);
    if (m[4] === '오후' && hour < 12) hour += 12;
    if (m[4] === '오전' && hour === 12) hour = 0;
    const iso = isoKstAt(+m[1], +m[2], +m[3], hour, Number(m[6] ?? 0));
    if (iso) out.marks.push(iso);
  }
  out.marks.sort();
  if (out.marks.length > 0) out.receivedAt = out.marks[0];
  // 마커가 하나뿐이면 접수만 적힌 글이다. 그걸 회신으로 세면 소요 0일이 되어버린다
  if (out.marks.length > 1) out.repliedAt = out.marks[out.marks.length - 1];

  const clean = (v: string) => v.replace(/\s+/g, ' ').trim().slice(0, 60) || null;

  const dept = DEPARTMENT.exec(text);
  if (dept) out.department = clean(dept[1]);

  const agency = AGENCY.exec(text);
  if (agency) {
    out.agency = clean(agency[1]);
    // 외부로 넘긴 건이면 배분 부서는 그 앞에 적힌 시청 조직이다
    const via = VIA_DEPARTMENT.exec(text);
    if (via && !out.department) out.department = clean(via[1]);
  }

  /*
   * ★ "담당 부서인" 이라는 말머리를 아예 안 쓰는 회신도 있다. 실측 2026-08-24:
   *   "**과천시청 교통과 주차지도팀에서** 펜타원 관리단에 … 지도를 요청 하였으며".
   *   말머리에만 기대면 이런 글에서 부서가 통째로 빈다.
   *   그래서 마지막으로 **시청으로 시작하는 조직 덩어리**를 한 번 더 찾는다.
   *   앞의 두 규칙이 아무것도 못 찾았을 때만 — 말머리가 있으면 그쪽이 언제나 정확하다.
   */
  if (!out.department && !out.agency) {
    const bare = BARE_DEPARTMENT.exec(text);
    if (bare) out.department = clean(bare[1]);
  }

  const due = DUE_DATE.exec(text);
  if (due) out.dueAt = isoKstAt(+due[1], +due[2], +due[3]);

  return out;
}
