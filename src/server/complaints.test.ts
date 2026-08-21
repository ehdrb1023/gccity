import { describe, expect, it } from 'vitest';
import { cleanTitle, dedupKeyFor, normalizeUrl, parseBoardDate, parsePastedList } from './complaints';

/** 2026-08-21 12:00 KST. 날짜 칸이 "8.20" 처럼 연도 없이 올 때의 기준. */
const NOW = Date.parse('2026-08-21T03:00:00Z');

describe('cleanTitle', () => {
  it('★ 댓글 수가 바뀌어도 제목은 그대로다 — 아니면 같은 글이 매번 새 민원으로 쌓인다', () => {
    expect(cleanTitle('갈현삼거리 횡단보도 바꿔주세요. [3]')).toBe('갈현삼거리 횡단보도 바꿔주세요.');
    expect(cleanTitle('갈현삼거리 횡단보도 바꿔주세요. [11]')).toBe('갈현삼거리 횡단보도 바꿔주세요.');
  });

  it('새 글 배지(N)와 아이콘 부스러기를 뗀다', () => {
    expect(cleanTitle('2026년 8월 20일(목) 양재천 냄새 민원 🖼 N')).toBe('2026년 8월 20일(목) 양재천 냄새 민원');
    expect(cleanTitle('[2026 과천공연예술축제] 공식 홍보영상 공개 🖼 ▶ 🔗 N')).toBe(
      '[2026 과천공연예술축제] 공식 홍보영상 공개',
    );
  });

  it('제목 앞의 목록 번호는 뗀다 — 번호는 글마다 밀린다', () => {
    expect(cleanTitle('12345. 지정타 근린3공원은 언제 완공될까요? [3]')).toBe('지정타 근린3공원은 언제 완공될까요?');
  });

  it('제목 안의 대괄호는 건드리지 않는다', () => {
    expect(cleanTitle('[갈현동 문화교육센터] 원데이클래스 수강생 모집')).toBe(
      '[갈현동 문화교육센터] 원데이클래스 수강생 모집',
    );
  });
});

describe('parsePastedList', () => {
  it('카페 목록을 복사해 붙여넣으면 한 줄이 한 건이 된다', () => {
    const text = [
      '과천 시민 모두 모여라!「제3회 과천시 자원봉사 이음축제」 개최 🖼 N',
      '2026년 8월 20일(목) 제비울천 부근 방치된 쇠파이프 및 바닥 절단면 민원 🖼 N',
      '',
      '위례과천선 3칸 경전철 개선 ==> 5량이상 설계 [2] N',
    ].join('\n');

    const out = parsePastedList(text, NOW);
    expect(out.map((c) => c.title)).toEqual([
      '과천 시민 모두 모여라!「제3회 과천시 자원봉사 이음축제」 개최',
      '2026년 8월 20일(목) 제비울천 부근 방치된 쇠파이프 및 바닥 절단면 민원',
      '위례과천선 3칸 경전철 개선 ==> 5량이상 설계',
    ]);
  });

  it('탭으로 갈린 표는 제목·글쓴이·날짜로 나눈다', () => {
    const out = parsePastedList('12345\t갈현삼거리 횡단보도 바꿔주세요.\t과천주민\t2026.08.20\t312', NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('갈현삼거리 횡단보도 바꿔주세요.');
    expect(out[0].author).toBe('과천주민');
    expect(out[0].postedAt).toBe(new Date(Date.parse('2026-08-20T00:00:00+09:00')).toISOString());
  });

  it('줄에 주소가 섞여 있으면 링크로 뗀다', () => {
    const out = parsePastedList('양재천 냄새 민원\thttps://example.gov/bbs/view?no=77', NOW);
    expect(out[0].title).toBe('양재천 냄새 민원');
    expect(out[0].url).toBe('https://example.gov/bbs/view?no=77');
  });

  it('표 머리글 줄은 민원이 아니다', () => {
    const out = parsePastedList(['번호\t제목\t글쓴이\t날짜\t조회', '1\t도로 파임 신고합니다\t시민\t8.20\t5'].join('\n'), NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('도로 파임 신고합니다');
  });

  it('한 번에 붙여넣은 안의 중복은 한 건이다', () => {
    const out = parsePastedList(['양재천 냄새 민원 [1]', '양재천 냄새 민원 [4] N'].join('\n'), NOW);
    expect(out).toHaveLength(1);
  });

  it('아이콘 부스러기만 남는 줄은 버린다', () => {
    expect(parsePastedList('🖼 N\n▶ 🔗', NOW)).toEqual([]);
  });
});

describe('parseBoardDate', () => {
  it('연도가 없는 날짜는 올해로 본다', () => {
    expect(parseBoardDate('8.20', NOW)).toBe(new Date(Date.parse('2026-08-20T00:00:00+09:00')).toISOString());
  });

  it('시각만 찍힌 글은 오늘이다', () => {
    expect(parseBoardDate('14:32', NOW)).toBe(new Date(Date.parse('2026-08-21T00:00:00+09:00')).toISOString());
  });

  it('날짜가 아닌 칸은 null 이다 — 조회수를 날짜로 읽지 않는다', () => {
    expect(parseBoardDate('312', NOW)).toBeNull();
    expect(parseBoardDate('과천주민', NOW)).toBeNull();
  });
});

describe('normalizeUrl / dedupKeyFor', () => {
  it('★ 추적 파라미터가 달라도 같은 글이다 — 아니면 크롤마다 같은 민원이 새로 쌓인다', () => {
    const a = 'https://Example.gov/bbs/view?no=77&utm_source=naver#top';
    const b = 'https://example.gov/bbs/view?no=77';
    expect(normalizeUrl(a)).toBe(normalizeUrl(b));
    expect(dedupKeyFor({ url: a, title: '가' })).toBe(dedupKeyFor({ url: b, title: '나' }));
  });

  it('주소가 없으면 (출처, 제목) 이 열쇠다 — 같은 제목이라도 게시판이 다르면 다른 글이다', () => {
    const one = dedupKeyFor({ title: '도로 파임 민원', board: '과천 카페' });
    const two = dedupKeyFor({ title: '도로 파임 민원', board: '시청 게시판' });
    expect(one).not.toBe(two);
    expect(one).toBe(dedupKeyFor({ title: ' 도로  파임 민원 ', board: '과천 카페' }));
  });

  it('카톡에서 담은 것은 메시지 하나가 한 건이다', () => {
    expect(dedupKeyFor({ title: '아무거나', messageId: 4021 })).toBe('chat:4021');
  });
});
