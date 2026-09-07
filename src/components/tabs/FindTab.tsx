'use client';

import { useState } from 'react';
import { BOT_HEALTH_LABEL, botHealth, relTime } from '@/lib/time';
import Empty from '@/components/ui/Empty';
import { Inbox } from '@/components/ui/icons';
import { roomLabel, shortKey, type State } from '@/components/types';

/**
 * 방 찾기 — 봇이 새 방을 알려주게 잠깐 열어둔다.
 *
 * ★ 켜져 있는 동안 이 폰에 오는 **모든** 카톡방(개인 카톡 포함)의 발신자와 앞 12자가
 *   서버로 올라온다. 그래서 기본 경로는 이게 아니라 아래 channelId 직접 등록이다 —
 *   숫자를 이미 안다면 켤 이유가 없다.
 */
export default function FindTab({
  state,
  busy,
  now,
  selected,
  onSelect,
  onAct,
  onToggleDiscovery,
}: {
  state: State;
  busy: boolean;
  now: number;
  selected: string | null;
  onSelect: (id: string) => void;
  onAct: (body: Record<string, unknown>) => Promise<void>;
  onToggleDiscovery: (on: boolean) => void;
}) {
  const [cid, setCid] = useState('');
  const [name, setName] = useState('');

  const candidates = state.rooms.filter((r) => !r.followed);
  const followed = state.rooms.filter((r) => r.followed);
  const health = botHealth(state.bot.lastSeenAt, now);
  const left = state.discovery.until
    ? Math.max(0, Math.round((Date.parse(state.discovery.until) - now) / 60000))
    : 0;

  const add = async () => {
    if (!cid.trim()) return;
    await onAct({ action: 'add', channelId: cid, name });
    setCid('');
    setName('');
  };

  return (
    <div className="main">
      <div className="wrap" style={{ maxWidth: 720 }}>
        <h2 className="pg">방 찾기</h2>
        <p className="pg">
          수집할 카톡방을 등록합니다. channelId 를 알면 바로 넣고, 모르면 아래 찾기 모드를 잠깐 켭니다.
        </p>

        <div className="card">
          <h3>channelId 로 바로 등록</h3>
          <p>
            숫자는 폰의 다른 봇 로그에 <code>ch=[…]</code> 로 찍힙니다. 통째로 붙여넣어도 숫자만 뽑아
            씁니다. 등록하면 바로 수집이 켜집니다.
          </p>
          <input
            className="inp mono"
            value={cid}
            inputMode="numeric"
            placeholder="channelId (예: 18409238712050393)"
            onChange={(e) => setCid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <input
            className="inp"
            value={name}
            placeholder="방 이름 (비워도 됩니다 · 나중에 바꿀 수 있습니다)"
            style={{ marginTop: 10 }}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add();
            }}
          />
          <div style={{ marginTop: 12 }}>
            <button className="btn pri" disabled={busy || !cid.trim()} onClick={() => void add()}>
              방 등록
            </button>
          </div>
        </div>

        <div className="card">
          <div className="sw">
            <div>
              <div className="sw-t">방 찾기 모드</div>
              <div className="sw-d">
                {state.discovery.on
                  ? `켜짐. ${left}분 뒤 자동으로 닫힙니다. 개인 카톡까지 올라오니 찾으면 바로 끄세요.`
                  : '꺼짐. 켜면 20분 뒤 자동으로 닫히고, 닫히면 미리보기는 지워집니다.'}
              </div>
            </div>
            <button
              className="knob"
              data-on={state.discovery.on}
              disabled={busy}
              aria-label="방 찾기 모드"
              aria-pressed={state.discovery.on}
              onClick={() => onToggleDiscovery(!state.discovery.on)}
            />
          </div>
        </div>

        <div className="card">
          <h3>새로 들어온 방</h3>
          <p>수집하려면 등록하세요. 등록하지 않은 방의 메시지는 서버가 받지 않습니다.</p>
          {candidates.length === 0 ? (
            <Empty
              icon={<Inbox />}
              title="아직 후보가 없습니다"
              desc="찾기 모드를 켠 뒤 목표 방에 메시지가 와야 여기 나타납니다."
            />
          ) : (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>방</th>
                    <th>마지막 알림</th>
                    <th style={{ width: '1%' }} />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((r) => (
                    <tr key={r.id} onClick={() => onSelect(r.id)}>
                      <td className="k">
                        {roomLabel(r) || shortKey(r.channelId)}
                        {r.legacyKey && <span className="bg gry" style={{ marginLeft: 6 }}>옛 열쇠</span>}
                        {r.lastPreview && (
                          <div className="dim" style={{ fontWeight: 400, fontSize: 'var(--fs-xs)', marginTop: 2 }}>
                            {r.lastSender ? `${r.lastSender}: ` : ''}
                            {r.lastPreview}…
                          </div>
                        )}
                      </td>
                      <td>{relTime(r.lastSeenAt, now)}</td>
                      <td>
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button className="btn sm pri" disabled={busy} onClick={() => void onAct({ action: 'follow', id: r.id })}>
                            등록
                          </button>
                          <button
                            className="btn sm line danger"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm('이 후보를 목록에서 지울까요? (다시 오면 또 생깁니다)')) {
                                void onAct({ action: 'delete', id: r.id });
                              }
                            }}
                          >
                            지우기
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {followed.length > 0 && (
          <div className="card">
            <h3>수집 중</h3>
            <p>{followed.length}개. 끄면 그 시점부터 새 메시지가 저장되지 않습니다.</p>
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>방</th>
                    <th>저장</th>
                    <th>마지막</th>
                    <th style={{ width: '1%' }} />
                  </tr>
                </thead>
                <tbody>
                  {followed.map((r) => (
                    <tr key={r.id} data-on={r.id === selected}>
                      <td className="k">
                        {roomLabel(r) || shortKey(r.channelId)}
                        <div className="dim mono" style={{ fontWeight: 400, fontSize: 'var(--fs-xs)' }}>
                          ch {r.channelId}
                        </div>
                      </td>
                      <td>{r.messageCount.toLocaleString()}</td>
                      <td>{relTime(r.lastMessageAt, now)}</td>
                      <td>
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn sm line"
                            disabled={busy}
                            onClick={() => {
                              const n = window.prompt('이 방을 뭐라고 부를까요?', roomLabel(r));
                              if (n !== null) void onAct({ action: 'rename', id: r.id, name: n });
                            }}
                          >
                            이름
                          </button>
                          <button className="btn sm line" disabled={busy} onClick={() => void onAct({ action: 'unfollow', id: r.id })}>
                            중지
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="card">
          <h3>봇 상태</h3>
          <p>폰의 봇이 마지막으로 서버에 닿은 시각입니다. 30분 넘게 조용하면 수집이 멈춘 것입니다.</p>
          <div className="note" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, flexWrap: 'wrap' }}>
            <span className={`dot ${health}`} />
            <b style={{ fontWeight: 600 }}>
              {BOT_HEALTH_LABEL[health]} · {relTime(state.bot.lastSeenAt, now)}
            </b>
            <span className="dim">
              {state.bot.lastGapMs != null && `· 직전 간격 ${Math.round(state.bot.lastGapMs / 1000)}초 `}
              {state.bot.build && `· ${state.bot.build} `}
              {state.bot.api2 === true && state.bot.msgCount != null && `· 수신 ${state.bot.msgCount}건 `}
              {(state.bot.senderIdx != null || state.bot.senderAuth != null) &&
                `· 이름 알림 ${state.bot.senderIdx ?? 0}/API2 ${state.bot.senderAuth ?? 0}`}
            </span>
          </div>
          {state.bot.api2 === false && (
            <p className="note warn" style={{ marginTop: 8, marginBottom: 0 }}>
              API2 가 꺼져 있습니다. 폰의 메신저봇R 설정에서 켜야 방 판별이 됩니다.
            </p>
          )}
          {(state.bot.senderIdx ?? 0) === 0 && (state.bot.senderAuth ?? 0) >= 6 && (
            <p className="note warn" style={{ marginTop: 8, marginBottom: 0 }}>
              알림이 보낸 사람 이름을 주지 않고 있습니다. 이름이 한 사람으로 굳어 보일 수 있습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
