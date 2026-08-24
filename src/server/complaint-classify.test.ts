import { describe, expect, it } from 'vitest';
import { classify, flowStats, leadTimeDays, parseDatedTitle, parseResolutionBody } from './complaint-classify';

const kst = (s: string) => new Date(Date.parse(s)).toISOString();

/** 실측 2026-08-21, 과천 카페 게시판 목록에서 그대로 가져온 제목·작성자다. */
describe('classify — 실제 게시판 한 판', () => {
  it('★ 정책관의 처리 기록: 제목 날짜가 접수일, 작성일이 회신일이다', () => {
    const c = classify({
      title: '2026년 8월 7일(금) 과천대로 관문체육공원(서울방향) 도로 민원',
      authorKind: 'official',
      postedAt: kst('2026-08-11T00:00:00+09:00'),
    });
    expect(c.kind).toBe('resolution');
    expect(c.reportedAt).toBe(kst('2026-08-07T00:00:00+09:00'));
    expect(leadTimeDays(c.reportedAt, c.resolvedAt)).toBe(4);
  });

  it('같은 계정이라도 보도자료는 공지다 — 작성자만 보고 가르면 안 되는 이유', () => {
    expect(
      classify({ title: "과천시, 지역 기술기업 'CES 2028' 진출 지원 시동…글로벌 시장 공략 나선다", authorKind: 'official' }).kind,
    ).toBe('notice');
  });

  it('날짜꼴이어도 민원 낱말이 없으면 처리 기록이 아니다 (경로당 방문 기록)', () => {
    const c = classify({ title: '2026년 8월 19일 (수) - 과천 S10 포레드림 경로당 - 11회', authorKind: 'official' });
    expect(c.kind).toBe('notice');
    expect(c.reportedAt).toBeNull();
  });

  it('주민 글은 민원으로 본다', () => {
    const posted = kst('2026-08-20T08:36:00+09:00');
    const c = classify({ title: '지정타 근린3공원은 언제 완공될까요?', authorKind: 'resident', postedAt: posted });
    expect(c.kind).toBe('report');
    expect(c.reportedAt).toBe(posted);
    expect(c.resolvedAt).toBeNull();
  });

  it('모르는 작성자는 미분류로 남긴다 — 틀리게 자동 분류하지 않는다', () => {
    expect(classify({ title: '갈현삼거리 횡단보도 바꿔주세요.' }).kind).toBe('unknown');
  });

  it('숨김 처리한 작성자의 글은 공지로 내린다', () => {
    expect(classify({ title: '[2026 과천공연예술축제] 공식 홍보영상 공개', authorKind: 'ignore' }).kind).toBe('notice');
  });

  it('카톡에서 담은 것은 언제나 주민 민원이다', () => {
    const posted = kst('2026-08-21T14:45:00+09:00');
    const c = classify({ title: '솔직히 경마공원 이전을 막을 방법이 없다보니', origin: 'chat', postedAt: posted });
    expect(c.kind).toBe('report');
    expect(c.reportedAt).toBe(posted);
  });
});

describe('parseDatedTitle', () => {
  it('요일 괄호가 있든 없든, 하이픈이 끼어도 읽는다', () => {
    expect(parseDatedTitle('2026년 8월 20일(목) 양재천 냄새 민원')?.rest).toBe('양재천 냄새 민원');
    expect(parseDatedTitle('2026년 8월 12일(수) 펜타원 통근 버스 및 과천대로 12길 도로 민원')?.reportedAt).toBe(
      kst('2026-08-12T00:00:00+09:00'),
    );
    expect(parseDatedTitle('2026년 8월 19일 (수) - 과천 S10 포레드림 경로당 - 11회')?.rest).toBe(
      '과천 S10 포레드림 경로당 - 11회',
    );
  });

  it('제목 안에 날짜가 있어도 앞머리가 아니면 안 읽는다', () => {
    expect(parseDatedTitle('과천시, 9월2일 위례~과천 광역철도 민간투자사업 주민설명회')).toBeNull();
  });
});

describe('leadTimeDays', () => {
  it('당일 처리는 0일이다 — 반올림해서 1일로 부풀리지 않는다', () => {
    expect(leadTimeDays(kst('2026-08-20T00:00:00+09:00'), kst('2026-08-20T09:48:00+09:00'))).toBe(0);
  });

  it('회신이 접수보다 이르면 null 이다 — 짝이 틀린 것이라 숫자를 지어내지 않는다', () => {
    expect(leadTimeDays(kst('2026-08-20T00:00:00+09:00'), kst('2026-08-18T00:00:00+09:00'))).toBeNull();
  });

  it('한쪽이 없으면 null', () => {
    expect(leadTimeDays(null, kst('2026-08-20T00:00:00+09:00'))).toBeNull();
  });
});

describe('flowStats', () => {
  const rows = [
    { kind: 'resolution' as const, reportedAt: kst('2026-08-07T00:00:00+09:00'), resolvedAt: kst('2026-08-11T00:00:00+09:00') }, // 4
    { kind: 'resolution' as const, reportedAt: kst('2026-08-12T00:00:00+09:00'), resolvedAt: kst('2026-08-13T00:00:00+09:00') }, // 1
    { kind: 'resolution' as const, reportedAt: kst('2026-08-20T00:00:00+09:00'), resolvedAt: kst('2026-08-20T09:48:00+09:00') }, // 0
    { kind: 'report' as const, reportedAt: kst('2026-08-20T08:36:00+09:00'), resolvedAt: null },
    { kind: 'notice' as const, reportedAt: null, resolvedAt: null },
    { kind: 'unknown' as const, reportedAt: null, resolvedAt: null },
  ];

  it('종류별 개수와 소요일 통계를 함께 낸다', () => {
    const s = flowStats(rows);
    expect([s.reports, s.resolutions, s.notices, s.unknown]).toEqual([1, 3, 1, 1]);
    expect(s.measured).toBe(3);
    expect(s.avgLeadDays).toBe(1.7);
    expect(s.medianLeadDays).toBe(1);
    expect(s.maxLeadDays).toBe(4);
    expect(s.sameDay).toBe(1);
  });

  it('★ 모수를 함께 낸다 — "평균 3일" 이 몇 건에서 나온 값인지 화면이 말해야 한다', () => {
    const s = flowStats([{ kind: 'report', reportedAt: null, resolvedAt: null }]);
    expect(s.measured).toBe(0);
    expect(s.avgLeadDays).toBeNull();
    expect(s.medianLeadDays).toBeNull();
  });
});

/**
 * 실측 본문 한 건 (2026-08-21, 과천 카페 "2026년 8월 20일(목) 양재천 냄새 민원").
 * 사람이 글을 열어 복사해 붙여넣은 것 — 카페는 서버가 못 읽는다.
 */
describe('parseResolutionBody — 실측 본문 한 건', () => {
  const BODY = [
    '양재천에서 의문의 냄새가 발생하여 산책하기 불쾌하다 라는 민원이 접수 되었습니다. 이에 담당 부서인 과천시청 공원녹지과 정원도시팀에 문의한 결과 중앙동에 위치한 모 음식점의 오수관이 범람하여 앙재천으로 유입되어 2026년 9월 11일(금)까지 관로 공사를 작업할 예정이다 라는 회신을 받았습니다. 관내 쾌적한 환경 조성 및 "The N.E.X.T CITY! 과천!"의 시민 중심 행정을 위한 현장 민원 청취에 앞장서 주신 정원도시팀에 감사합니다.',
    '',
    '- 2026년 8월 20일(목) 오전 9시 23분 -',
    '',
    '- 2026년 8월 21일(금) 오전 9시 21분 -',
  ].join('\n');

  it('★ 첫 마커가 접수, 마지막 마커가 회신이다 — 분 단위로 잡힌다', () => {
    const p = parseResolutionBody(BODY);
    expect(p.receivedAt).toBe(new Date(Date.parse('2026-08-20T09:23:00+09:00')).toISOString());
    expect(p.repliedAt).toBe(new Date(Date.parse('2026-08-21T09:21:00+09:00')).toISOString());
    expect(p.marks).toHaveLength(2);
  });

  it('담당 부서를 뽑는다 — 부서별 처리 속도를 보려면 이게 있어야 한다', () => {
    expect(parseResolutionBody(BODY).department).toBe('과천시청 공원녹지과 정원도시팀');
  });

  it('★ 회신은 해결이 아니다 — "…까지" 약속이 있으면 아직 안 끝난 건이다', () => {
    expect(parseResolutionBody(BODY).dueAt).toBe(new Date(Date.parse('2026-09-11T00:00:00+09:00')).toISOString());
  });

  it('마커가 하나뿐이면 회신은 비운다 — 접수만 적힌 글을 "당일 처리" 로 세지 않는다', () => {
    const p = parseResolutionBody('접수되었습니다.\n\n- 2026년 8월 20일(목) 오전 9시 23분 -');
    expect(p.receivedAt).not.toBeNull();
    expect(p.repliedAt).toBeNull();
  });

  it('형식이 다른 본문에서는 아무것도 지어내지 않는다', () => {
    const p = parseResolutionBody('민원 잘 처리했습니다. 감사합니다.');
    expect([p.receivedAt, p.repliedAt, p.department, p.agency, p.dueAt]).toEqual([null, null, null, null, null]);
  });
});

/**
 * 실측 2026-08-21: 카톡 메시지 #21 — 카페 글의 **원본**이다.
 * 카페 본문의 회신 마커(오전 9시 21분)와 이 메시지 시각(09:21:43)이 같은 글이었다.
 * 카톡 답변에는 시각 마커가 없으므로 회신 시각은 메시지 시각을 쓴다.
 */
describe('parseResolutionBody — 카톡으로 온 같은 답변', () => {
  const CHAT = '본 민원의 담당 부서인 과천시청 공원녹지과 하천관리팀에서 현장 출동하여 점검한 결과 중앙동 모 음식점의 오수관이 범람하여 양재천으로 유입 되어 2026년 9월 11일(금)까지 관로 공사를 작업할 예정이다 라는 회신을 받았습니다.';

  it('부서와 완료 예정일은 카톡 본문에서도 그대로 뽑힌다', () => {
    const p = parseResolutionBody(CHAT);
    expect(p.department).toBe('과천시청 공원녹지과 하천관리팀');
    expect(p.dueAt).toBe(new Date(Date.parse('2026-09-11T00:00:00+09:00')).toISOString());
  });

  it('카톡엔 시각 마커가 없다 — 없는 값을 지어내지 않는다', () => {
    const p = parseResolutionBody(CHAT);
    expect(p.receivedAt).toBeNull();
    expect(p.repliedAt).toBeNull();
  });
});

/** 실측 카톡 #56 — 부서가 둘이고 오타(";문의")가 섞인 실제 답변. */
describe('parseResolutionBody — 부서가 여럿인 답변', () => {
  it('부서명을 통째로 잡는다 (부서명 안의 "과"를 조사로 오인하지 않는다)', () => {
    const p = parseResolutionBody(
      '본 민원의 담당 부서인 과천시청 도시조성과 도시조성1팀과 기획홍보담당관 기획팀에 ;문의한 결과 과천시는 경마 공원 이전과 관련되어 … 라는 회신을 받았습니다.',
    );
    expect(p.department).toBe('과천시청 도시조성과 도시조성1팀과 기획홍보담당관 기획팀');
  });
});

/** 실측 카톡 #162 (2026-08-22) — 처리 주체가 시청 밖이라 "담당 기관" 으로 온다. */
describe('parseResolutionBody — 외부 기관으로 넘어간 건', () => {
  const CRANE =
    '본 민원을 과천시청 당직실에서 담당 기관인 넷마블 공사 관계자에게 문의한 결과 크레인 특성상 철물이 없을 시 붕괴 위험이 있어 부득이하게 매달아 놓았다 라는 회신을 받았습니다.';

  it('★ 배분 부서와 회신 기관을 가른다 — 한 칸에 담으면 부서별 집계가 섞인다', () => {
    const p = parseResolutionBody(CRANE);
    expect(p.department).toBe('과천시청 당직실');   // 시청 안에서 맡은 곳
    expect(p.agency).toBe('넷마블 공사 관계자');     // 시청 밖에서 답을 준 곳
  });

  it('앞머리("본 민원을")를 부서명으로 딸려 오지 않게 한다', () => {
    expect(parseResolutionBody(CRANE).department).not.toMatch(/민원/);
  });

  it('시청 안에서 끝난 건은 회신 기관이 비어 있다 — 없는 값을 지어내지 않는다', () => {
    const p = parseResolutionBody(
      '본 민원의 담당 부서인 과천시청 공원녹지과 하천관리팀에서 현장 출동하여 점검한 결과 오수관이 범람하였습니다.',
    );
    expect(p.department).toBe('과천시청 공원녹지과 하천관리팀');
    expect(p.agency).toBeNull();
  });
});
