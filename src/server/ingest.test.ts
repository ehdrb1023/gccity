import { describe, expect, it } from 'vitest';
import {
  clampPreview,
  isLegacyKey,
  msgIdFor,
  normalizeChannelId,
  PREVIEW_MAX,
  sentAtFor,
  trimText,
} from './ingest';

describe('msgIdFor', () => {
  it('★ logId 가 있으면 그것만 본다 — 같은 메시지를 몇 번 다시 받아도 한 건이다', () => {
    const a = msgIdFor({ logId: '3345678901', tsMs: 1755500000000, sender: '김철수', text: '안녕' });
    const b = msgIdFor({ logId: '3345678901', tsMs: 1755500009999, sender: '김철수', text: '안녕' });
    expect(a).toBe(b);
    expect(a).toBe('log:3345678901');
  });

  it('logId 가 다르면 본문이 같아도 별개다', () => {
    expect(msgIdFor({ logId: '1', sender: 'A', text: 'ㅋㅋ' })).not.toBe(
      msgIdFor({ logId: '2', sender: 'A', text: 'ㅋㅋ' }),
    );
  });

  it('logId 가 없으면 (시각, 발신자, 본문) 해시로 떨어진다', () => {
    const a = msgIdFor({ tsMs: 1755500000000, sender: '김철수', text: '안녕하세요' });
    const b = msgIdFor({ tsMs: 1755500000000, sender: '김철수', text: '안녕하세요' });
    expect(a).toBe(b);
    expect(a.startsWith('msg:1755500000000:')).toBe(true);
  });

  it('★ 같은 사람이 같은 말을 다시 해도 시각이 다르면 별개다 (오픈채팅의 "ㅋㅋ" 문제)', () => {
    const a = msgIdFor({ tsMs: 1755500000000, sender: '김철수', text: 'ㅋㅋ' });
    const b = msgIdFor({ tsMs: 1755500003000, sender: '김철수', text: 'ㅋㅋ' }); // 3초 뒤
    expect(a).not.toBe(b);
  });

  it('발신자가 다르면 다른 키다', () => {
    expect(msgIdFor({ tsMs: 1, sender: 'A', text: '네' })).not.toBe(
      msgIdFor({ tsMs: 1, sender: 'B', text: '네' }),
    );
  });

  it('시각조차 없으면 초 단위 폴백으로 떨어지고 접두어가 다르다', () => {
    const id = msgIdFor({ sender: '김철수', text: '네' }, 1755500000000);
    expect(id.startsWith('fb:1755500000:')).toBe(true);
  });

  it('폴백은 같은 초 안의 동일 메시지를 합친다 — 이 한계를 알고 쓰는 것이다', () => {
    const a = msgIdFor({ sender: '김철수', text: 'ㅋㅋ' }, 1755500000100);
    const b = msgIdFor({ sender: '김철수', text: 'ㅋㅋ' }, 1755500000900);
    expect(a).toBe(b);
  });
});

describe('normalizeChannelId', () => {
  it('★ 로그에서 통째로 복사해 붙여도 숫자만 뽑는다 — 안 맞는 방이 조용히 등록되는 것을 막는다', () => {
    expect(normalizeChannelId('ch=[18409238712050393]')).toBe('18409238712050393');
    expect(normalizeChannelId('  18409238712050393  ')).toBe('18409238712050393');
  });

  it('숫자가 하나도 없으면 빈 값이다 (호출한 쪽이 거부한다)', () => {
    expect(normalizeChannelId('방 이름')).toBe('');
    expect(normalizeChannelId(undefined)).toBe('');
  });

  it('★ channelId 는 끝까지 문자열로 다룬다 — number 로 만지면 끝자리가 뭉개진다', () => {
    // 17자리는 JS number 의 안전 범위(2^53)를 넘는다. 숫자 리터럴로 받은 순간 이미 값이 바뀐다.
    expect(normalizeChannelId(18409238712050393)).toBe('18409238712050390');
    expect(normalizeChannelId('18409238712050393')).toBe('18409238712050393');
    expect(typeof normalizeChannelId('18409238712050393')).toBe('string');
  });
});

describe('isLegacyKey', () => {
  it('알림 열쇠 시절의 행을 알아본다 — 화면에서 구분해 보여주기 위한 것뿐이다', () => {
    expect(isLegacyKey('0|com.kakao.talk|1234|null|10123')).toBe(true);
    expect(isLegacyKey('18409238712050393')).toBe(false);
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

describe('sentAtFor', () => {
  it('봇이 못 박아 보낸 수신 시각을 쓴다 — 재전송으로 늦게 도착해도 원래 시각이 남는다', () => {
    expect(sentAtFor(1755500000000)).toBe(new Date(1755500000000).toISOString());
  });
  it('시각이 없으면 서버 수신 시각으로 떨어진다', () => {
    expect(sentAtFor(undefined, 1755500000000)).toBe(new Date(1755500000000).toISOString());
  });
});

describe('trimText', () => {
  it('문자열이 아니면 빈 문자열이다 — 봇이 보낸 값을 그대로 믿지 않는다', () => {
    expect(trimText(null)).toBe('');
    expect(trimText(123)).toBe('');
    expect(trimText('  네  ')).toBe('네');
  });
});
