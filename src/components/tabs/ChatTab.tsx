'use client';

import { useEffect, useRef } from 'react';
import { clockTime, dayLabel, relTime } from '@/lib/time';
import Empty from '@/components/ui/Empty';
import { Chat } from '@/components/ui/icons';
import { roomLabel, shortKey, type Message, type Room } from '@/components/types';

/**
 * 발화자 원판 색. 닉네임에서 결정적으로 뽑는다 — 오픈채팅은 프로필 이미지를 알 수 없고,
 * 색이 매번 바뀌면 사람을 눈으로 좇을 수 없다.
 */
function avatarHue(sender: string): number {
  let h = 0;
  for (let i = 0; i < sender.length; i++) h = (h * 31 + sender.charCodeAt(i)) % 360;
  return h;
}

function initial(sender: string): string {
  const t = sender.trim();
  return t ? t.slice(0, 1) : '?';
}

/**
 * 말풍선 하나. 본문·사진·파일이 여기서 갈린다.
 *
 * ★ 사진과 파일의 처지가 다르다. 사진은 봇이 알림에 실린 URI 로 바이트를 읽어 올린다.
 *   파일(PDF·한글…)은 **이름만** 올린다 — 실물은 사람이 자료실에 끌어다 넣는다.
 *
 * image 인데 URL 이 없는 것은 봇이 사진을 끝내 못 올린 경우다. 텍스트처럼 보이게 두지 않고
 * 그 사실을 적는다 — 이 프로젝트가 제일 경계하는 것이 조용한 실패다.
 */
function Bubble({ m }: { m: Message }) {
  const caption = m.body && !/^\[(사진|파일)\]/.test(m.body) ? m.body : '';

  if (m.attachmentType === 'image') {
    if (!m.attachmentUrl) {
      return (
        <span className="mt att bad">
          <b>사진 — 받지 못했다</b>
          <small>{m.attachmentName || '폰에서 사진을 꺼내지 못했거나 전송이 끝내 실패했다'}</small>
        </span>
      );
    }
    return (
      <span className="mt att">
        {/* next/image 를 쓰지 않는다 — 서명 URL 이라 주소가 매번 바뀌고 한 시간이면 만료된다 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.attachmentUrl} alt={m.attachmentName || '사진'} loading="lazy" />
        {caption && <span className="cap">{caption}</span>}
      </span>
    );
  }

  if (m.attachmentType === 'file') {
    return (
      <span className="mt att">
        <b>{m.attachmentName || '파일'}</b>
        <small>카톡 파일은 봇이 가져오지 못한다 — 필요하면 자료실에 직접 올릴 것</small>
        {caption && <span className="cap">{caption}</span>}
      </span>
    );
  }

  return <span className="mt">{m.body}</span>;
}

/**
 * 대화 — 방 목록(왼쪽)과 저장된 말(오른쪽).
 *
 * ★ 말풍선을 좌우로 가르지 않는다. 전부 왼쪽이다. 오픈채팅에는 '우리' 가 없다 —
 *   이 봇은 방에 한 글자도 쓰지 않으므로 내 말풍선이 존재할 수 없다.
 *
 * 연속 발화 묶음 규칙은 카톡과 같다 — 이름은 묶음의 처음에만, 시각은 마지막에만.
 */
export default function ChatTab({
  rooms,
  messages,
  selected,
  busy,
  now,
  clipped,
  onSelect,
  onClip,
  onAct,
}: {
  rooms: Room[];
  messages: Message[];
  selected: string | null;
  busy: boolean;
  now: number;
  clipped: Set<number>;
  onSelect: (id: string) => void;
  onClip: (m: Message) => void;
  onAct: (body: Record<string, unknown>) => Promise<void>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const followed = rooms.filter((r) => r.followed);
  const current = rooms.find((r) => r.id === selected) ?? null;

  // 새 메시지가 오면 아래로 붙인다. 위로 스크롤해 읽는 중이면 건드리지 않는다.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const rows = messages.map((m, i) => {
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const day = dayLabel(m.sentAt);
    const newDay = !prev || dayLabel(prev.sentAt) !== day;
    const headed = newDay || prev.sender !== m.sender;
    const tailed =
      !next ||
      next.sender !== m.sender ||
      dayLabel(next.sentAt) !== day ||
      clockTime(next.sentAt) !== clockTime(m.sentAt);
    return { m, day, newDay, headed, tailed };
  });

  return (
    <section className="screen">
      <aside className="pane">
        <div className="pane-h">
          <h2>방</h2>
          <span className="n">{followed.length}개 수집 중</span>
        </div>
        <div className="pane-b">
          {followed.length === 0 ? (
            <p className="dim" style={{ padding: '0 12px', fontSize: 'var(--fs-sm)' }}>
              따라가는 방이 없습니다. 위 <b>방 찾기</b> 에서 등록하세요.
            </p>
          ) : (
            followed.map((r) => (
              <button key={r.id} className="item" data-on={r.id === selected} onClick={() => onSelect(r.id)}>
                <span className="t">
                  {roomLabel(r) || shortKey(r.channelId)}
                  <span className="cnt">{r.messageCount.toLocaleString()}</span>
                </span>
                <span className="d">{r.lastPreview || relTime(r.lastMessageAt, now)}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="main" ref={scroller} onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}>
        {current?.followed && (
          <div className="top" style={{ borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 2 }}>
            <b style={{ fontSize: 'var(--fs-md)', letterSpacing: '-0.025em' }}>
              {roomLabel(current) || shortKey(current.channelId)}
            </b>
            <span className="dim" style={{ fontSize: 'var(--fs-xs)' }}>
              저장 {current.messageCount}건 · 마지막 {relTime(current.lastMessageAt, now)} · ch {current.channelId}
            </span>
            <div className="sp" />
            <button
              className="btn sm line"
              disabled={busy}
              onClick={() => {
                const name = window.prompt('이 방을 뭐라고 부를까요?', roomLabel(current));
                if (name !== null) void onAct({ action: 'rename', id: current.id, name });
              }}
            >
              이름
            </button>
            <button className="btn sm line" disabled={busy} onClick={() => void onAct({ action: 'unfollow', id: current.id })}>
              수집 중지
            </button>
          </div>
        )}

        <div className="msgs">
          {followed.length === 0 ? (
            <Empty
              icon={<Chat />}
              title="아직 따라가는 방이 없습니다"
              desc="방 찾기 탭에서 그 방의 channelId 를 넣으면 여기에 대화가 쌓입니다."
            />
          ) : !current ? (
            <Empty icon={<Chat />} title="방을 고르세요" desc="왼쪽 목록에서 방을 누르면 저장된 대화가 뜹니다." />
          ) : !current.followed ? (
            <Empty
              icon={<Chat />}
              title="수집하지 않는 방입니다"
              desc="이 방의 대화는 저장하지 않습니다. 수집을 켜면 그 시점부터 쌓입니다."
            />
          ) : messages.length === 0 ? (
            <Empty
              icon={<Chat />}
              title="아직 저장된 대화가 없습니다"
              desc="방에서 다음 메시지가 오면 몇 초 안에 여기 뜹니다."
            />
          ) : (
            rows.map(({ m, day, newDay, headed, tailed }) => (
              <div key={m.id}>
                {newDay && <div className="daysep">{day}</div>}
                <div className="msg">
                  {headed ? (
                    <span className="av" style={{ background: `hsl(${avatarHue(m.sender)} 42% 52%)` }}>
                      {initial(m.sender)}
                    </span>
                  ) : (
                    <span className="av blank" />
                  )}
                  <span className="mb">
                    {headed && <span className="mn">{m.sender || '(이름 없음)'}</span>}
                    <span className="mrow">
                      <Bubble m={m} />
                      {tailed && <time>{clockTime(m.sentAt)}</time>}
                    </span>
                  </span>
                  <button
                    className="btn sm line clip"
                    data-done={clipped.has(m.id)}
                    title="이 말을 민원실로 담습니다"
                    onClick={() => onClip(m)}
                  >
                    {clipped.has(m.id) ? '담김' : '민원으로'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
