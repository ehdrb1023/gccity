'use client';

import { useCallback, useEffect, useState } from 'react';
import { BOT_HEALTH_LABEL, botHealth, relTime } from '@/lib/time';
import Wing from './ui/Wing';
import ChatTab from './tabs/ChatTab';
import VaultTab from './tabs/VaultTab';
import FindTab from './tabs/FindTab';
import CivicTab from './civic/CivicTab';
import type { Message, State } from './types';

const POLL_MS = 3000;

const TABS: { key: Tab; label: string }[] = [
  { key: 'civic', label: '민원실' },
  { key: 'chat', label: '대화' },
  { key: 'vault', label: '자료실' },
  { key: 'find', label: '방 찾기' },
];

type Tab = 'civic' | 'chat' | 'vault' | 'find';

/**
 * 콘솔 껍데기 — 상단바와 탭 넷.
 *
 * ★ 민원실이 첫 탭이다. 이 도구가 답하는 질문은 "이 민원이 기준 안에 처리됐는가" 이고,
 *   대화는 그 재료다. 열자마자 보여야 하는 것은 결론 쪽이다.
 *
 * ★ 탭별 화면은 각자 파일로 나가 있다. 예전에는 이 파일 하나가 2571줄이었고,
 *   한 탭을 고치면 다른 탭이 함께 흔들렸다.
 */
export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('civic');
  // 민원실로 담은 말풍선. 담았다는 표시가 화면에 남아야 같은 말을 두 번 담지 않는다
  const [clipped, setClipped] = useState<Set<number>>(() => new Set());
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (roomId: string | null) => {
    try {
      const qs = roomId ? `?room=${encodeURIComponent(roomId)}` : '';
      const res = await fetch(`/api/state${qs}`, { cache: 'no-store' });
      const json = (await res.json()) as State & { reason?: string };
      if (!json.ok) {
        setError(json.reason ?? '상태를 읽지 못했습니다');
        return;
      }
      setError(null);
      setState(json);
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // 첫 수집 방을 자동 선택한다. 방이 하나뿐인 게 기본이라 매번 고르게 할 이유가 없다.
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
        if (!json.ok) setError(json.reason ?? '실패했습니다');
        else setError(null);
        await load(selected);
      } finally {
        setBusy(false);
      }
    },
    [load, selected],
  );

  /**
   * 대화 한 줄을 민원실로 담는다.
   *
   * 멱등키가 `chat:<메시지 id>` 라 두 번 눌러도 한 건이다. 그래도 버튼에 "담김" 을 남기는
   * 이유는 사람 쪽이다 — 눌렀는지 화면에 없으면 같은 말을 계속 다시 누른다.
   */
  const clipToCivic = useCallback(async (m: Message) => {
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clip', messageId: m.id }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.reason ?? '민원 담기에 실패했습니다');
        return;
      }
      setError(null);
      setClipped((prev) => new Set(prev).add(m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const toggleDiscovery = (on: boolean) => {
    setTab('find');
    void act({ action: 'discovery', on });
  };

  if (!state) {
    return (
      <main className="app">
        <div className="main">
          <div className="wrap">
            {error ? <p className="note bad">{error}</p> : <p className="dim">불러오는 중…</p>}
          </div>
        </div>
      </main>
    );
  }

  const health = botHealth(state.bot.lastSeenAt, now);
  const followed = state.rooms.filter((r) => r.followed);

  /*
   * ★ 수집이 멈춘 것을 화면에 드러낸다. channelId 는 저절로 바뀌지 않으므로 방이 조용하면
   *   원인은 대개 폰 쪽이다 — 알림 꺼짐·절전·강퇴·앱 죽음. 이 경보가 없으면 수집이 멈춘 걸
   *   몇 주 뒤에나 안다.
   */
  const stale =
    followed.length > 0 &&
    followed.every((r) => !r.lastSeenAt || now - Date.parse(r.lastSeenAt) > 6 * 3600_000);

  return (
    <main className="app">
      <header className="top">
        <div className="mark">
          <Wing />
          과천시 <em>민원 콘솔</em>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} data-on={tab === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="sp" />
        <button className="pulse" onClick={() => setTab('find')} style={{ border: 0, background: 'transparent' }} title="봇 상태를 봅니다">
          <span className={`dot ${health}`} />
          봇 {BOT_HEALTH_LABEL[health]} · {relTime(state.bot.lastSeenAt, now)}
        </button>
        <a className="btn sm line" href="/login" style={{ marginLeft: 4 }}>
          나가기
        </a>
      </header>

      {error && <p className="note bad" style={{ margin: '12px 20px 0' }}>{error}</p>}
      {stale && (
        <p className="note warn" style={{ margin: '12px 20px 0' }}>
          수집 중인 방이 6시간 넘게 조용합니다. 방이 정말 조용한 것일 수도 있지만, 폰 쪽이 막힌
          것일 수도 있습니다 — 그 방의 카톡 알림이 꺼졌거나, 메신저봇R 이 절전으로 죽었거나,
          봇 계정이 방에서 나가졌거나. <b>방 찾기</b> 탭의 수신 건수가 안 오르면 폰을 보세요.
        </p>
      )}

      {tab === 'civic' ? (
        <CivicTab now={now} />
      ) : tab === 'chat' ? (
        <ChatTab
          rooms={state.rooms}
          messages={state.messages}
          selected={selected}
          busy={busy}
          now={now}
          clipped={clipped}
          onSelect={setSelected}
          onClip={clipToCivic}
          onAct={act}
        />
      ) : tab === 'vault' ? (
        <VaultTab rooms={followed} roomId={selected} onPickRoom={setSelected} />
      ) : (
        <FindTab
          state={state}
          busy={busy}
          now={now}
          selected={selected}
          onSelect={setSelected}
          onAct={act}
          onToggleDiscovery={toggleDiscovery}
        />
      )}
    </main>
  );
}
