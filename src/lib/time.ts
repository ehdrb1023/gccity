/** "3분 전" 같은 상대 시각. 시간대 문제를 피하려고 화면에서는 이쪽을 기본으로 쓴다. */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '없음';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '없음';
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 10) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.round(hr / 24)}일 전`;
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
}

export type BotHealth = 'ok' | 'lagging' | 'down' | 'unknown';

/**
 * 봇이 살아 있는가.
 *
 * "마지막 수집"(팔로우 방의 최근 메시지 시각)과 **헷갈리지 말 것**. 방이 조용하면 수집
 * 시각은 며칠 전이어도 봇은 멀쩡하다. 이 판정은 봇이 서버를 두드린 시각만 본다.
 */
export function botHealth(lastSeenAt: string | null | undefined, now = Date.now()): BotHealth {
  if (!lastSeenAt) return 'unknown';
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) return 'unknown';
  const min = (now - t) / 60000;
  if (min <= 3) return 'ok';
  if (min <= 30) return 'lagging';
  return 'down';
}

export const BOT_HEALTH_LABEL: Record<BotHealth, string> = {
  ok: '정상',
  lagging: '지연',
  down: '끊김',
  unknown: '신호 없음',
};
