'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BOT_HEALTH_LABEL, botHealth, clockTime, dayLabel, relTime } from '@/lib/time';

type Room = {
  id: string;
  roomKey: string;
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

type Message = {
  id: number;
  sender: string;
  body: string;
  sentAt: string;
};

type State = {
  ok: boolean;
  bot: { lastSeenAt: string | null; lastGapMs: number | null };
  discovery: { on: boolean; until: string | null };
  rooms: Room[];
  messages: Message[];
};

const POLL_MS = 3000;

function roomLabel(r: Room): string {
  return r.displayName || r.nameHint || '';
}

/** 열쇠는 길다. 화면에는 뒤 12자만 — 후보끼리 구분되기만 하면 된다. */
function shortKey(key: string): string {
  return key.length <= 14 ? key : '…' + key.slice(-12);
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  const load = useCallback(async (roomId: string | null) => {
    try {
      const qs = roomId ? `?room=${encodeURIComponent(roomId)}` : '';
      const res = await fetch(`/api/state${qs}`, { cache: 'no-store' });
      const json = (await res.json()) as State & { reason?: string };
      if (!json.ok) {
        setError(json.reason ?? '상태를 읽지 못했다');
        return;
      }
      setError(null);
      setState(json);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 첫 팔로우 방을 자동 선택한다. 방이 하나뿐인 게 기본이라 매번 고르게 할 이유가 없다.
  useEffect(() => {
    if (selected || !state) return;
    const first = state.rooms.find((r) => r.followed);
    if (first) setSelected(first.id);
  }, [state, selected]);

  useEffect(() => {
    void load(selected);
    const t = setInterval(() => void load(selected), POLL_MS);
    return () => clearInterval(t);
  }, [load, selected]);

  // 새 메시지가 오면 아래로 붙인다. 단, 사용자가 위로 스크롤해 읽는 중이면 건드리지 않는다.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [state?.messages.length]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) setError(json.reason ?? '실패');
        else setError(null);
        await load(selected);
      } finally {
        setBusy(false);
      }
    },
    [load, selected],
  );

  if (!state) {
    return (
      <main className="shell">
        <div className="panel">
          <div className="empty">{error ? `오류: ${error}` : '불러오는 중…'}</div>
        </div>
      </main>
    );
  }

  const health = botHealth(state.bot.lastSeenAt, now);
  const followed = state.rooms.filter((r) => r.followed);
  const candidates = state.rooms.filter((r) => !r.followed);
  const current = state.rooms.find((r) => r.id === selected) ?? null;

  const discoveryLeft = state.discovery.until
    ? Math.max(0, Math.round((Date.parse(state.discovery.until) - now) / 60000))
    : 0;

  // ★ 열쇠가 바뀌었을 가능성을 화면에 드러낸다.
  //   팔로우 방이 조용해진 사이 새 후보가 나타났다면, 그건 카톡 알림의 tag·id 가 바뀌어
  //   같은 방이 다른 방으로 보이는 상황일 수 있다. 이 경보가 없으면 수집이 멈춘 걸
  //   몇 주 뒤에나 안다.
  const followedStale =
    followed.length > 0 &&
    followed.every((r) => !r.lastSeenAt || now - Date.parse(r.lastSeenAt) > 6 * 3600_000);

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">
          gccity<span>카톡 오픈채팅 수집</span>
        </div>

        <div className="health">
          <i className={`dot ${health}`} />
          <b>봇 {BOT_HEALTH_LABEL[health]}</b>
          <small>
            마지막 신호 {relTime(state.bot.lastSeenAt, now)}
            {state.bot.lastGapMs != null && ` · 직전 간격 ${Math.round(state.bot.lastGapMs / 1000)}초`}
          </small>
        </div>

        <div className="spacer" />

        <button
          className={`btn ${state.discovery.on ? 'primary' : ''}`}
          disabled={busy}
          onClick={() => void act({ action: 'discovery', on: !state.discovery.on })}
        >
          {state.discovery.on ? `방 찾기 켜짐 · ${discoveryLeft}분 남음` : '방 찾기 모드'}
        </button>
      </div>

      {error && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="note">
            <b>오류</b> — {error}
          </div>
        </div>
      )}

      {followedStale && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="note">
            <b>⚠️ 팔로우 중인 방이 6시간 넘게 조용하다.</b> 방이 정말 조용한 것일 수도 있지만,
            카톡 알림의 방 열쇠가 바뀌어 <b>같은 방이 새 후보로 잡히고 있는</b> 것일 수도 있다.
            방 찾기 모드를 켜서 후보 목록에 그 방이 새로 뜨는지 확인할 것.
          </div>
        </div>
      )}

      <div className="cols">
        <section className="panel">
          <header>
            <h2>방</h2>
            <span className="count">
              팔로우 {followed.length} · 후보 {candidates.length}
            </span>
          </header>

          {state.discovery.on ? (
            <div className="note">
              <b>방 찾기 모드가 켜져 있다.</b> 이 폰에 오는 모든 카톡방의 발신자와 본문 앞 12자가
              올라온다(개인 카톡 포함). 목표 방을 찾으면 <b>바로 끌 것</b> — {discoveryLeft}분 뒤
              자동으로 꺼지고, 꺼지면 미리보기는 지워진다.
            </div>
          ) : candidates.length === 0 && followed.length === 0 ? (
            <div className="note">
              아직 아는 방이 없다. <b>방 찾기 모드</b>를 켜고 목표 오픈채팅방에서 메시지가 오길
              기다린 뒤, 목록에서 그 방을 팔로우한다.
            </div>
          ) : null}

          {followed.map((r) => (
            <RoomRow
              key={r.id}
              room={r}
              active={r.id === selected}
              busy={busy}
              now={now}
              onSelect={() => setSelected(r.id)}
              onAct={act}
            />
          ))}

          {candidates.length > 0 && (
            <header style={{ borderTop: '1px solid var(--line)' }}>
              <h2>후보</h2>
              <span className="count">팔로우하면 그때부터 대화가 저장된다</span>
            </header>
          )}

          {candidates.map((r) => (
            <RoomRow
              key={r.id}
              room={r}
              active={r.id === selected}
              busy={busy}
              now={now}
              onSelect={() => setSelected(r.id)}
              onAct={act}
            />
          ))}
        </section>

        <section className="panel">
          <header>
            <h2>{current ? roomLabel(current) || shortKey(current.roomKey) : '대화'}</h2>
            <span className="count">
              {current
                ? `저장 ${current.messageCount}건 · 마지막 수집 ${relTime(current.lastMessageAt, now)}`
                : ''}
            </span>
          </header>

          <div
            className="timeline"
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}
          >
            {!current ? (
              <div className="empty">
                <b>방을 고르세요</b>
                왼쪽 목록에서 방을 누르면 저장된 대화가 여기 뜬다.
              </div>
            ) : !current.followed ? (
              <div className="empty">
                <b>팔로우하지 않은 방이다</b>
                이 방의 대화는 저장하지 않는다. 팔로우를 켜면 그 시점부터 쌓인다.
              </div>
            ) : state.messages.length === 0 ? (
              <div className="empty">
                <b>아직 저장된 대화가 없다</b>
                방에서 다음 메시지가 오면 몇 초 안에 여기 뜬다.
              </div>
            ) : (
              <Timeline messages={state.messages} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function RoomRow({
  room,
  active,
  busy,
  now,
  onSelect,
  onAct,
}: {
  room: Room;
  active: boolean;
  busy: boolean;
  now: number;
  onSelect: () => void;
  onAct: (body: Record<string, unknown>) => Promise<void>;
}) {
  const label = roomLabel(room);

  return (
    <div>
      <button className="room" data-active={active} onClick={onSelect}>
        <div className="room-top">
          <span className={`room-name ${label ? '' : 'unnamed'}`}>
            {label || shortKey(room.roomKey)}
          </span>
          {room.followed ? <span className="tag">수집 중</span> : <span className="tag muted">후보</span>}
        </div>
        <div className="room-meta">
          <span>알림 {room.seenCount}</span>
          {room.followed && <span>저장 {room.messageCount}</span>}
          <span>{relTime(room.lastSeenAt, now)}</span>
        </div>
        {!room.followed && room.lastPreview && (
          <div className="room-preview">
            {room.lastSender ? `${room.lastSender}: ` : ''}
            {room.lastPreview}…
          </div>
        )}
      </button>

      {active && (
        <div className="room-actions">
          {room.followed ? (
            <button className="btn" disabled={busy} onClick={() => void onAct({ action: 'unfollow', id: room.id })}>
              팔로우 끄기
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void onAct({ action: 'follow', id: room.id })}
            >
              이 방 팔로우
            </button>
          )}
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              const name = window.prompt('이 방을 뭐라고 부를까?', label);
              if (name !== null) void onAct({ action: 'rename', id: room.id, name });
            }}
          >
            이름
          </button>
          {!room.followed && (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() => {
                if (window.confirm('이 후보를 목록에서 지울까? (다시 오면 또 생긴다)')) {
                  void onAct({ action: 'delete', id: room.id });
                }
              }}
            >
              지우기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Timeline({ messages }: { messages: Message[] }) {
  let lastDay = '';
  let lastSender = '';

  return (
    <>
      {messages.map((m) => {
        const day = dayLabel(m.sentAt);
        const newDay = day !== lastDay;
        if (newDay) {
          lastDay = day;
          lastSender = '';
        }
        const same = m.sender === lastSender;
        lastSender = m.sender;

        return (
          <div key={m.id}>
            {newDay && <div className="daysep">{day}</div>}
            <div className={`msg ${same ? 'same' : ''}`}>
              <span className="who">{m.sender || '(이름 없음)'}</span>
              <span className="body">{m.body}</span>
              <span className="at">{clockTime(m.sentAt)}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}
