import { describe, expect, it } from 'vitest';
import { buildTranscript } from './digest';

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
