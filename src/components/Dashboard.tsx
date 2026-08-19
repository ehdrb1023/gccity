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
  // 후보를 대화 옆에 두지 않는다 — 방 찾기 모드를 켜면 개인 카톡까지 계속 쌓여
  // 정작 보려던 대화창을 밀어낸다. 목적은 방 하나를 고르는 것이고, 그건 한 번뿐인 일이다.
  const [tab, setTab] = useState<'chat' | 'find' | 'vault'>('chat');
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

  /**
   * 방 찾기를 켜고 끌 때 탭도 같이 옮긴다.
   * 탭에 숫자 배지를 달지 않기로 했으므로(방 하나만 고르면 끝나는 일이라 상시 알림이
   * 필요 없다), 후보가 생겼다는 걸 알려주는 경로는 이 자동 전환이 전부다.
   */
  const toggleDiscovery = async (on: boolean) => {
    setTab(on ? 'find' : 'chat');
    await act({ action: 'discovery', on });
  };

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

        <nav className="tabs">
          <button data-on={tab === 'chat'} onClick={() => setTab('chat')}>대화</button>
          <button data-on={tab === 'vault'} onClick={() => setTab('vault')}>자료실</button>
          <button data-on={tab === 'find'} onClick={() => setTab('find')}>방 찾기</button>
        </nav>

        <div className="spacer" />

        <button
          className={`btn ${state.discovery.on ? 'primary' : ''}`}
          disabled={busy}
          onClick={() => void toggleDiscovery(!state.discovery.on)}
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

      <div className="stage">
        {tab === 'chat' ? (
          <section className="panel">
            <header>
              <h2>{current ? roomLabel(current) || shortKey(current.roomKey) : '대화'}</h2>
              <span className="count">
                {current
                  ? `저장 ${current.messageCount}건 · 마지막 수집 ${relTime(current.lastMessageAt, now)}`
                  : ''}
              </span>
              <div className="spacer" />
              {current?.followed && (
                <div className="hdr-actions">
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => {
                      const name = window.prompt('이 방을 뭐라고 부를까?', roomLabel(current));
                      if (name !== null) void act({ action: 'rename', id: current.id, name });
                    }}
                  >
                    이름
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void act({ action: 'unfollow', id: current.id })}
                  >
                    팔로우 끄기
                  </button>
                </div>
              )}
            </header>

            {/* 방을 여러 개 팔로우해도 코드가 버티게 둔다(CLAUDE.md). 하나뿐이면 칩은 안 뜬다. */}
            {followed.length > 1 && (
              <div className="chips">
                {followed.map((r) => (
                  <button
                    key={r.id}
                    data-on={r.id === selected}
                    onClick={() => setSelected(r.id)}
                  >
                    {roomLabel(r) || shortKey(r.roomKey)}
                  </button>
                ))}
              </div>
            )}

            <div
              className="timeline"
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
            >
              {followed.length === 0 ? (
                <div className="empty">
                  <b>아직 따라가는 방이 없다</b>
                  위 <b>방 찾기</b> 탭에서 목표 오픈채팅방을 골라 팔로우하면 여기에 대화가 쌓인다.
                </div>
              ) : !current ? (
                <div className="empty">
                  <b>방을 고르세요</b>
                  위 목록에서 방을 누르면 저장된 대화가 여기 뜬다.
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
        ) : tab === 'vault' ? (
          <Vault
            rooms={followed}
            roomId={selected}
            onPickRoom={setSelected}
          />
        ) : (
          <section className="panel">
            <header>
              <h2>방 찾기</h2>
              <span className="count">후보에서 목표 방을 골라 팔로우한다</span>
            </header>

            {state.discovery.on ? (
              <div className="note">
                <b>방 찾기 모드가 켜져 있다.</b> 이 폰에 오는 모든 카톡방의 발신자와 본문 앞 12자가
                올라온다(개인 카톡 포함). 목표 방을 찾으면 <b>바로 끌 것</b> — {discoveryLeft}분 뒤
                자동으로 꺼지고, 꺼지면 미리보기는 지워진다.
              </div>
            ) : (
              <div className="note">
                <b>방 찾기 모드가 꺼져 있다.</b> 오른쪽 위 <b>방 찾기 모드</b> 버튼을 켜고 목표
                오픈채팅방에서 메시지가 오길 기다리면, 그 방이 아래 후보로 뜬다.
              </div>
            )}

            {candidates.length === 0 ? (
              <div className="empty">
                <b>아직 후보가 없다</b>
                방 찾기 모드를 켠 뒤 목표 방에 메시지가 와야 여기 나타난다.
              </div>
            ) : (
              candidates.map((r) => (
                <RoomRow
                  key={r.id}
                  room={r}
                  active={r.id === selected}
                  busy={busy}
                  now={now}
                  onSelect={() => setSelected(r.id)}
                  onAct={act}
                />
              ))
            )}

            {followed.length > 0 && (
              <>
                <header style={{ borderTop: '1px solid var(--line)' }}>
                  <h2>따라가는 중</h2>
                  <span className="count">{followed.length}개</span>
                </header>
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
              </>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

/**
 * 자료실 — 카톡방별 문서 보관소.
 *
 * 봇은 아직 파일을 올리지 않는다. 여기 쌓이는 것은 사람이 손으로 넣은 것이다.
 * (알림에서 PDF·DOCX 를 꺼내는 것 자체는 가능하다 — speciai-kakao-bot 에 실증 코드가 있다.
 *  붙이게 되면 봇이 같은 files 테이블에 쌓으면 된다.)
 *
 * ★ 파일 바이트는 우리 서버를 지나가지 않는다. 서명 URL 을 받아 Storage 로 직접 올린다.
 *   Vercel 함수 본문 상한이 4.5MB 라 서버를 거치면 큰 PDF 가 전부 막힌다.
 */
type StoredFile = {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  note: string | null;
  createdAt: string;
};

function humanSize(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

/** 확장자로 갈래를 잡는다. mime 이 비어 오는 경우가 흔하다. */
function fileKind(f: StoredFile): string {
  const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'DOC';
  if (ext === 'xls' || ext === 'xlsx') return 'XLS';
  if (ext === 'ppt' || ext === 'pptx') return 'PPT';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext)) return 'IMG';
  if (ext === 'hwp' || ext === 'hwpx') return 'HWP';
  if (ext === 'zip' || ext === 'rar' || ext === '7z') return 'ZIP';
  if (ext === 'txt' || ext === 'md') return 'TXT';
  return ext.slice(0, 4).toUpperCase() || 'FILE';
}

function Vault({
  rooms,
  roomId,
  onPickRoom,
}: {
  rooms: Room[];
  roomId: string | null;
  onPickRoom: (id: string) => void;
}) {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const reload = useCallback(async (id: string | null) => {
    if (!id) {
      setFiles([]);
      return;
    }
    try {
      const res = await fetch(`/api/files?room=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) setErr(json.reason ?? '목록을 읽지 못했다');
      else {
        setErr(null);
        setFiles(json.files);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload(roomId);
  }, [reload, roomId]);

  /**
   * sign → Storage 직행 업로드 → confirm.
   * 실패하면 어느 걸음에서 깨졌는지 그대로 보여준다. 조용히 성공한 척하지 않는다.
   */
  const upload = useCallback(
    async (list: FileList | null) => {
      if (!roomId || !list || list.length === 0) return;
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        setProgress(`${f.name} 올리는 중… (${i + 1}/${list.length})`);
        try {
          const sres = await fetch('/api/files', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'sign', roomId, name: f.name, size: f.size }),
          });
          const sign = await sres.json();
          if (!sign.ok) throw new Error(sign.reason ?? '서명 URL 실패');

          const put = await fetch(sign.signedUrl, {
            method: 'PUT',
            headers: { 'content-type': f.type || 'application/octet-stream' },
            body: f,
          });
          if (!put.ok) throw new Error(`Storage 업로드 실패 (${put.status})`);

          const cres = await fetch('/api/files', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              action: 'confirm',
              roomId,
              path: sign.path,
              name: f.name,
              mime: f.type,
              size: f.size,
            }),
          });
          const conf = await cres.json();
          if (!conf.ok) throw new Error(conf.reason ?? '등록 실패');
          setErr(null);
        } catch (e) {
          setErr(`${f.name} — ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setProgress(null);
      await reload(roomId);
    },
    [roomId, reload],
  );

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.reason ?? '실패');
        return null;
      }
      setErr(null);
      return json;
    },
    [],
  );

  return (
    <section className="panel">
      <header>
        <h2>자료실</h2>
        <span className="count">방마다 따로 쌓인다 · 파일 {files.length}개</span>
      </header>

      {rooms.length > 1 && (
        <div className="chips">
          {rooms.map((r) => (
            <button key={r.id} data-on={r.id === roomId} onClick={() => onPickRoom(r.id)}>
              {roomLabel(r) || shortKey(r.roomKey)}
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className="note">
          <b>오류</b> — {err}
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="empty">
          <b>따라가는 방이 없다</b>
          방 찾기 탭에서 방을 팔로우하면 그 방의 자료실이 생긴다.
        </div>
      ) : (
        <>
          <div
            className={`drop${drag ? ' on' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void upload(e.dataTransfer.files);
            }}
            onClick={() => picker.current?.click()}
          >
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = '';
              }}
            />
            {progress ? (
              <b>{progress}</b>
            ) : (
              <>
                <b>여기에 파일을 끌어다 놓거나 눌러서 고르세요</b>
                <span>PDF · Word · 한글 · 이미지 — 한 개 50MB 까지</span>
              </>
            )}
          </div>

          {files.length === 0 ? (
            <div className="empty">
              <b>아직 넣어둔 자료가 없다</b>
              카톡방에서 받은 문서를 여기에 모아두면 대화와 같은 자리에서 찾을 수 있다.
            </div>
          ) : (
            <ul className="files">
              {files.map((f) => (
                <li key={f.id}>
                  <span className="kind" data-k={fileKind(f)}>{fileKind(f)}</span>
                  <div className="fmeta">
                    <span className="fname">{f.name}</span>
                    <span className="fsub">
                      {humanSize(f.sizeBytes)} · {dayLabel(f.createdAt)} {clockTime(f.createdAt)}
                      {f.note ? ` · ${f.note}` : ''}
                    </span>
                  </div>
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      const r = await act({ action: 'download', id: f.id });
                      if (r?.url) window.open(r.url, '_blank', 'noopener');
                    }}
                  >
                    받기
                  </button>
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      const note = window.prompt('메모 (비우면 지운다)', f.note ?? '');
                      if (note === null) return;
                      await act({ action: 'note', id: f.id, note });
                      await reload(roomId);
                    }}
                  >
                    메모
                  </button>
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      if (!window.confirm(`"${f.name}" 을 지울까? 되돌릴 수 없다.`)) return;
                      await act({ action: 'delete', id: f.id });
                      await reload(roomId);
                    }}
                  >
                    지우기
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
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

/**
 * 발화자 원판 색. 닉네임에서 결정적으로 뽑는다 —
 * 오픈채팅은 프로필 이미지를 알 수 없고, 색이 매번 바뀌면 사람을 눈으로 좇을 수 없다.
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
 * 카톡 화면 모양의 타임라인.
 *
 * ★ 말풍선을 좌우로 가르지 않는다. 전부 왼쪽이다.
 *   오픈채팅에는 '우리' 가 없다 — 이 봇은 방에 한 글자도 쓰지 않으므로 내 말풍선이
 *   존재할 수 없고, 참가자는 전부 동등한 남이다. side='us'/'partner' 판정을 넣지 말 것.
 *   (speciai-kakao-bot 은 거래처 방이라 그 구분이 있다. 그 화면을 그대로 옮겨오지 말 것.)
 *
 * 연속 발화 묶음 규칙은 카톡과 같다 — 이름·프로필은 묶음의 **처음**에만,
 * 시각은 **마지막**에만 적는다. 같은 사람이 같은 분에 여러 줄 치는 일이 잦은데
 * 줄마다 시각을 달면 화면이 시각으로 뒤덮인다.
 */
function Timeline({ messages }: { messages: Message[] }) {
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
    <div className="chat">
      {rows.map(({ m, day, newDay, headed, tailed }) => (
        <div key={m.id}>
          {newDay && (
            <div className="daysep">
              <span>{day}</span>
            </div>
          )}
          <div className={`kmsg${headed ? ' headed' : ''}`}>
            {headed ? (
              <div className="avatar" style={{ background: `hsl(${avatarHue(m.sender)} 42% 62%)` }}>
                {initial(m.sender)}
              </div>
            ) : (
              <div className="avatar blank" />
            )}
            <div className="kbody">
              {headed && <div className="kname">{m.sender || '(이름 없음)'}</div>}
              <div className="krow">
                <div className="bubble">{m.body}</div>
                {tailed && <time className="kat">{clockTime(m.sentAt)}</time>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
