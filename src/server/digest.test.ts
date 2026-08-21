import { describe, expect, it } from 'vitest';
import { buildTranscript, normalizeConfidence, normalizeKind } from './digest';

/**
 * 대화록에 **메시지 id 를 앞에 다는 것**이 이 함수의 전부다.
 * id 가 없으면 모델이 "이 민원은 몇 번 발언에서 시작됐다" 를 지목할 수 없고,
 * 그러면 앵커가 없어 멱등키(`chat:<id>`)를 만들 수 없다 — 돌릴 때마다 중복이 쌓인다.
 */
describe('buildTranscript', () => {
  const rows = [
    { id: 48, sender: '우는 라이언', body: '솔직히 경마공원 이전을 막을 방법이 없다보니ㅜㅜ', sent_at: '2026-08-21T05:45:30Z' },
    { id: 49, sender: '갈현동 화이팅!', body: '무조건\n막아야합니다  절대 용납할 수 없어요', sent_at: '2026-08-21T05:49:07Z' },
  ];

  it('id · 시각(KST) · 발화자 · 본문 한 줄로 편다', () => {
    const out = buildTranscript(rows).split('\n');
    expect(out[0]).toBe('#48 [08.21 14:45] 우는 라이언: 솔직히 경마공원 이전을 막을 방법이 없다보니ㅜㅜ');
    // 줄바꿈·연속 공백을 접는다 — 접지 않으면 한 발언이 여러 줄로 보여 앵커가 흔들린다
    expect(out[1]).toBe('#49 [08.21 14:49] 갈현동 화이팅!: 무조건 막아야합니다 절대 용납할 수 없어요');
  });

  it('이름이 비어도 자리를 남긴다', () => {
    expect(buildTranscript([{ id: 1, sender: '', body: '테스트', sent_at: '2026-08-21T00:00:00Z' }])).toContain(
      '(이름 없음): 테스트',
    );
  });
});

/**
 * ★ 구조화 출력에 enum 을 못 쓴다 — SDK 가 그 키워드를 description 으로 옮기기 때문에
 *   모델에게는 권고로만 간다. 그래서 우리가 정규화한다. 한 항목이 이상해서 그 창의
 *   민원을 통째로 잃는 것이 훨씬 나쁘다.
 */
describe('normalizeKind / normalizeConfidence', () => {
  it('회신 계열은 resolution, 나머지는 전부 report 로 떨어뜨린다', () => {
    expect(normalizeKind('resolution')).toBe('resolution');
    expect(normalizeKind('RESOLUTION ')).toBe('resolution');
    expect(normalizeKind('report')).toBe('report');
    expect(normalizeKind('민원')).toBe('report');
    expect(normalizeKind(undefined)).toBe('report');
  });

  it('모르는 확신도는 낮게 잡는다 — 높게 잡으면 사람이 덜 들여다본다', () => {
    expect(normalizeConfidence('high')).toBe('high');
    expect(normalizeConfidence('Medium')).toBe('medium');
    expect(normalizeConfidence('아주 확실')).toBe('low');
    expect(normalizeConfidence(null)).toBe('low');
  });
});
