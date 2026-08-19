import { describe, expect, it } from 'vitest';
import { clampPreview, msgIdFor, PREVIEW_MAX, sentAtFor, trimText } from './ingest';

describe('msgIdFor', () => {
  it('같은 (시각, 발신자, 본문)이면 같은 키다 — 알림 재게시가 중복 저장되지 않는다', () => {
    const a = msgIdFor(1755500000000, '김철수', '안녕하세요');
    const b = msgIdFor(1755500000000, '김철수', '안녕하세요');
    expect(a).toBe(b);
  });

  it('★ 같은 사람이 같은 말을 다시 해도 시각이 다르면 별개다 (오픈채팅의 "ㅋㅋ" 문제)', () => {
    const a = msgIdFor(1755500000000, '김철수', 'ㅋㅋ');
    const b = msgIdFor(1755500003000, '김철수', 'ㅋㅋ'); // 3초 뒤
    expect(a).not.toBe(b);
  });

  it('발신자가 다르면 다른 키다', () => {
    expect(msgIdFor(1, 'A', '네')).not.toBe(msgIdFor(1, 'B', '네'));
  });

  it('시각을 못 얻으면 초 단위 폴백으로 떨어지고 접두어가 다르다', () => {
    const id = msgIdFor(undefined, '김철수', '네', 1755500000000);
    expect(id.startsWith('fb:1755500000:')).toBe(true);
  });

  it('폴백은 같은 초 안의 동일 메시지를 합친다 — 이 한계를 알고 쓰는 것이다', () => {
    const a = msgIdFor(0, '김철수', 'ㅋㅋ', 1755500000100);
    const b = msgIdFor(0, '김철수', 'ㅋㅋ', 1755500000900);
    expect(a).toBe(b);
  });
});

describe('sentAtFor', () => {
  it('알림이 준 메시지 시각을 쓴다 — 재전송으로 늦게 도착해도 원래 시각이 남는다', () => {
    expect(sentAtFor(1755500000000)).toBe(new Date(1755500000000).toISOString());
  });
  it('시각이 없으면 수신 시각으로 떨어진다', () => {
    expect(sentAtFor(undefined, 1755500000000)).toBe(new Date(1755500000000).toISOString());
  });
});

describe('clampPreview', () => {
  it(`${PREVIEW_MAX}자를 넘겨 보내도 서버가 다시 자른다 — 저장하는 쪽이 책임진다`, () => {
    const long = '가'.repeat(100);
    expect(clampPreview(long)).toHaveLength(PREVIEW_MAX);
  });
  it('줄바꿈·연속 공백은 한 칸으로 접는다', () => {
    expect(clampPreview('안녕\n\n  하세요')).toBe('안녕 하세요');
  });
  it('빈 값은 null 이다', () => {
    expect(clampPreview('   ')).toBeNull();
    expect(clampPreview(undefined)).toBeNull();
  });
});

describe('trimText', () => {
  it('문자열이 아니면 빈 문자열이다 — 봇이 보낸 값을 그대로 믿지 않는다', () => {
    expect(trimText(null)).toBe('');
    expect(trimText(123)).toBe('');
    expect(trimText('  네  ')).toBe('네');
  });
});
