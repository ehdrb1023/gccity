'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BOT_HEALTH_LABEL, botHealth, clockTime, dayLabel, relTime } from '@/lib/time';

type Room = {
  id: string;
  channelId: string;
  legacyKey: boolean;
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
  /** 'image' | 'file' | null. file 은 **이름만** 온다 — 바이트는 사람이 자료실에 넣는다 */
  attachmentType: string | null;
  attachmentName: string | null;
  /** 사진의 서명 URL. image 인데 비어 있으면 봇이 사진을 못 올린 것이다 */
  attachmentUrl: string | null;
};

type State = {
  ok: boolean;
  bot: {
    lastSeenAt: string | null;
    lastGapMs: number | null;
    build: string | null;
    api2: boolean | null;
    msgCount: number | null;
  };
  discovery: { on: boolean; until: string | null };
  rooms: Room[];
  messages: Message[];
};

const POLL_MS = 3000;

function roomLabel(r: Room): string {
  return r.displayName || r.nameHint || '';
}

/**
 * 이름이 없는 방의 대체 표시.
 *
 * channelId 는 17~19자리 숫자라 그대로 쓰면 화면이 숫자 무더기가 된다. 방을 서로 구분할
 * 만큼만 보여주고, 전체 값은 방 카드의 메타 줄에 따로 적는다.
 * (사람이 [이름] 으로 붙인 이름이 있으면 그쪽이 언제나 우선이다.)
 */
function shortKey(channelId: string): string {
  return channelId.length <= 14 ? channelId : '#…' + channelId.slice(-8);
}

export default function Dashboard() {
  const [state, setState] = useState<State | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 후보를 대화 옆에 두지 않는다 — 방 찾기 모드를 켜면 개인 카톡까지 계속 쌓여
  // 정작 보려던 대화창을 밀어낸다. 목적은 방 하나를 고르는 것이고, 그건 한 번뿐인 일이다.
  const [tab, setTab] = useState<'chat' | 'find' | 'vault' | 'civic'>('chat');
  // 민원실로 담은 말풍선. 담았다는 표시가 화면에 남아야 같은 말을 두 번 담지 않는다
  const [clipped, setClipped] = useState<Set<number>>(() => new Set());
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
   * 대화 한 줄을 민원실로 담는다.
   *
   * 멱등키가 `chat:<메시지 id>` 라 두 번 눌러도 한 건이다. 그래도 버튼에 "담김" 을 남기는
   * 이유는 사람 쪽이다 — 눌렀는지 아닌지 화면에 없으면 같은 말을 계속 다시 누른다.
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
        setError(json.reason ?? '민원 담기 실패');
        return;
      }
      setError(null);
      setClipped((prev) => new Set(prev).add(m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

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

  // ★ 수집이 멈춘 것을 화면에 드러낸다.
  //   channelId 는 카톡이 방에 붙인 고유 번호라 알림 열쇠와 달리 저절로 바뀌지 않는다.
  //   그래서 방이 조용하다면 원인은 대개 폰 쪽이다 — 알림 꺼짐·절전·강퇴·앱 죽음.
  //   이 경보가 없으면 수집이 멈춘 걸 몇 주 뒤에나 안다.
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
            {state.bot.build && ` · ${state.bot.build}`}
            {state.bot.api2 === false && ' · ⚠️ API2 꺼짐'}
            {state.bot.api2 === true && state.bot.msgCount != null && ` · 수신 ${state.bot.msgCount}건`}
          </small>
        </div>

        <nav className="tabs">
          <button data-on={tab === 'chat'} onClick={() => setTab('chat')}>대화</button>
          <button data-on={tab === 'vault'} onClick={() => setTab('vault')}>자료실</button>
          <button data-on={tab === 'civic'} onClick={() => setTab('civic')}>민원실</button>
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
            폰 쪽이 막힌 것일 수도 있다 — 그 방의 <b>카톡 알림이 꺼졌거나</b>, 메신저봇R 이 절전으로
            죽었거나, 봇 계정이 방에서 나가졌거나. 위 봇 상태 줄에 <b>수신 건수</b>가 안 오르면
            폰을 봐야 한다. channelId 자체는 저절로 바뀌지 않으니 다시 등록할 필요는 없다.
          </div>
        </div>
      )}

      <div className="stage">
        {tab === 'chat' ? (
          <section className="panel">
            <header>
              <h2>{current ? roomLabel(current) || shortKey(current.channelId) : '대화'}</h2>
              <span className="count">
                {current
                  ? `저장 ${current.messageCount}건 · 마지막 수집 ${relTime(current.lastMessageAt, now)}` +
                    ` · ch ${current.channelId}`
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
                    {roomLabel(r) || shortKey(r.channelId)}
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
                  위 <b>방 고르기</b> 탭에서 그 방의 <b>channelId</b> 를 넣으면 여기에 대화가 쌓인다.
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
                <Timeline messages={state.messages} clipped={clipped} onClip={clipToCivic} />
              )}
            </div>
          </section>
        ) : tab === 'vault' ? (
          <Vault
            rooms={followed}
            roomId={selected}
            onPickRoom={setSelected}
          />
        ) : tab === 'civic' ? (
          <Complaints />
        ) : (
          <section className="panel">
            <header>
              <h2>방 고르기</h2>
              <span className="count">channelId 를 알면 바로, 모르면 아래 방 찾기로</span>
            </header>

            <AddRoom busy={busy} onAct={act} />

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
              {roomLabel(r) || shortKey(r.channelId)}
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

/**
 * channelId 를 직접 쳐서 방을 등록한다. **이쪽이 기본 경로다.**
 *
 * 방 찾기 모드는 켜져 있는 동안 이 폰의 모든 방(개인 카톡 포함)의 발신자와 앞 12자를
 * 서버로 올린다. 숫자를 이미 안다면 그걸 켤 이유가 없다 — 여기서 한 번 치면 끝이다.
 *
 * 이름을 따로 받는 이유: channelId 를 방 이름으로 쓰면 화면이 숫자 무더기가 된다.
 * 비워두면 나중에 [이름] 버튼으로 붙일 수 있다.
 */
function AddRoom({
  busy,
  onAct,
}: {
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [cid, setCid] = useState('');
  const [name, setName] = useState('');

  const submit = async () => {
    if (!cid.trim()) return;
    await onAct({ action: 'add', channelId: cid, name });
    setCid('');
    setName('');
  };

  return (
    <div className="addroom">
      <div className="addroom-row">
        <input
          className="mono"
          value={cid}
          inputMode="numeric"
          placeholder="channelId (예: 18409238712050393)"
          onChange={(e) => setCid(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <input
          value={name}
          placeholder="방 이름 (비워도 된다 · 나중에 바꿀 수 있다)"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <button className="btn primary" disabled={busy || !cid.trim()} onClick={() => void submit()}>
          방 등록
        </button>
      </div>
      <p>
        숫자는 폰의 다른 봇 로그에 <b>ch=[…]</b> 로 찍힌다. 통째로 붙여넣어도 숫자만 뽑아 쓴다.
        등록하면 바로 팔로우까지 켜진다.
      </p>
    </div>
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
            {label || shortKey(room.channelId)}
          </span>
          {room.followed ? <span className="tag">수집 중</span> : <span className="tag muted">후보</span>}
          {room.legacyKey && <span className="tag muted">옛 열쇠</span>}
        </div>
        <div className="room-meta">
          <span className="mono">{room.legacyKey ? '알림 열쇠' : 'ch'} {room.channelId}</span>
          <span>수신 {room.seenCount}</span>
          {room.followed && <span>저장 {room.messageCount}</span>}
          <span>{relTime(room.lastSeenAt, now)}</span>
        </div>
        {room.legacyKey && (
          <div className="room-preview">
            알림 열쇠로 모으던 시절의 방이다. 봇이 channelId 로 바뀌어 여기엔 더 들어오지 않는다 —
            쌓인 대화를 보려면 그대로 두고, 필요 없으면 팔로우를 끄고 지운다.
          </div>
        )}
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
 * 말풍선 하나. 본문·사진·파일이 여기서 갈린다.
 *
 * ★ 사진과 파일의 처지가 다르다 (2026-08-20 결정).
 *   사진은 봇이 알림에 실린 URI 로 바이트를 읽어 올린다 → 여기 그대로 뜬다.
 *   파일(PDF·한글…)은 **이름만** 올린다 → 무엇이 왔는지만 남기고, 실물은 사람이 자료실에
 *   끌어다 넣는다. 이름조차 안 남기면 "그때 그 견적서" 를 찾을 실마리가 아무데도 없다.
 *
 * image 인데 URL 이 없는 것은 봇이 사진을 끝내 못 올린 경우다. 조용히 텍스트처럼 보이게
 * 두지 않고 그 사실을 적는다 — 이 프로젝트가 제일 경계하는 것이 조용한 실패다.
 */
function Bubble({ m }: { m: Message }) {
  const caption = m.body && !/^\[(사진|파일)\]/.test(m.body) ? m.body : '';

  if (m.attachmentType === 'image') {
    if (!m.attachmentUrl) {
      return (
        <div className="bubble att missing">
          <b>사진 — 받지 못했다</b>
          <small>{m.attachmentName || '폰에서 사진을 꺼내지 못했거나 전송이 끝내 실패했다'}</small>
        </div>
      );
    }
    return (
      <div className="bubble photo">
        {/* next/image 를 쓰지 않는다 — 서명 URL 이라 주소가 매번 바뀌고 한 시간이면 만료된다 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.attachmentUrl} alt={m.attachmentName || '사진'} loading="lazy" />
        {caption && <span className="cap">{caption}</span>}
      </div>
    );
  }

  if (m.attachmentType === 'file') {
    return (
      <div className="bubble att">
        <b>📎 {m.attachmentName || '파일'}</b>
        <small>카톡 파일은 봇이 가져오지 못한다 — 필요하면 자료실에 직접 올릴 것</small>
        {caption && <span className="cap">{caption}</span>}
      </div>
    );
  }

  return <div className="bubble">{m.body}</div>;
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
function Timeline({
  messages,
  clipped,
  onClip,
}: {
  messages: Message[];
  clipped: Set<number>;
  onClip: (m: Message) => void;
}) {
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
                <Bubble m={m} />
                {tailed && <time className="kat">{clockTime(m.sentAt)}</time>}
                <button
                  className="clip"
                  data-done={clipped.has(m.id)}
                  title="이 말을 민원실로 담는다"
                  onClick={() => void onClip(m)}
                >
                  {clipped.has(m.id) ? '담김' : '민원'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 민원실 ──────────────────────────────────────────────────────────────── */

type Complaint = {
  id: string;
  origin: 'crawl' | 'chat' | 'paste' | 'manual';
  title: string;
  url: string | null;
  author: string | null;
  board: string | null;
  postedAt: string | null;
  body: string | null;
  category: string | null;
  status: CivicStatus;
  note: string | null;
  createdAt: string;
  /* 흐름 — 민원이 언제 들어와 며칠 만에 처리됐는가 */
  kind: PostKind;
  kindLocked: boolean;
  reportedAt: string | null;
  resolvedAt: string | null;
  resolutionOf: string | null;
  summary: string | null;
  department: string | null;
  dueAt: string | null;
};

type PostKind = 'report' | 'resolution' | 'notice' | 'unknown';
type AuthorKind = 'official' | 'resident' | 'ignore';

type CivicAuthor = { name: string; kind: AuthorKind; note: string | null; count?: number };

type Flow = {
  reports: number;
  resolutions: number;
  notices: number;
  unknown: number;
  measured: number;
  avgLeadDays: number | null;
  medianLeadDays: number | null;
  maxLeadDays: number | null;
  sameDay: number;
};

type CrawlSource = {
  id: string;
  name: string;
  url: string;
  kind: 'auto' | 'rss' | 'html';
  linkPattern: string | null;
  keywords: string | null;
  enabled: boolean;
  everyMinutes: number;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastCount: number | null;
  lastNew: number | null;
};

type CivicStatus = 'new' | 'doing' | 'done' | 'drop';

/** 서버(`src/server/complaints.ts`)의 STATUS_LABEL 과 같은 값이다. 한쪽만 고치지 말 것. */
const CIVIC_STATUS: { key: CivicStatus; label: string }[] = [
  { key: 'new', label: '새 민원' },
  { key: 'doing', label: '확인 중' },
  { key: 'done', label: '처리 완료' },
  { key: 'drop', label: '제외' },
];
/** 서버(`complaint-classify.ts`)의 KIND_LABEL 과 같은 값이다. 한쪽만 고치지 말 것. */
const KIND: { key: PostKind; label: string }[] = [
  { key: 'report', label: '민원' },
  { key: 'resolution', label: '처리' },
  { key: 'notice', label: '공지' },
  { key: 'unknown', label: '미분류' },
];
const KIND_LABEL: Record<PostKind, string> = {
  report: '민원',
  resolution: '처리',
  notice: '공지',
  unknown: '미분류',
};
const AUTHOR_KIND: { key: AuthorKind; label: string }[] = [
  { key: 'resident', label: '주민' },
  { key: 'official', label: '기관' },
  { key: 'ignore', label: '숨김' },
];

/** "8/7 → 8/11 · 4일" — 접수에서 회신까지. 없으면 빈 문자열이다. */
function leadLabel(reportedAt: string | null, resolvedAt: string | null): string {
  if (!reportedAt) return '';
  const md = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  if (!resolvedAt) return `접수 ${md(reportedAt)}`;
  const days = Math.floor((Date.parse(resolvedAt) - Date.parse(reportedAt)) / 86_400_000);
  if (days < 0) return `접수 ${md(reportedAt)} · ⚠️ 회신이 더 이르다`;
  return `접수 ${md(reportedAt)} → 회신 ${md(resolvedAt)} · ${days === 0 ? '당일' : days + '일'}`;
}

const ORIGIN_LABEL: Record<Complaint['origin'], string> = {
  crawl: '크롤',
  paste: '붙여넣기',
  chat: '카톡',
  manual: '직접',
};

/**
 * 민원실 — 과천 민원 게시글을 모아 상태를 따라가는 화면.
 *
 * ★ 자료실과 달리 **방에 매이지 않는다.** 민원은 도시의 일이라 팔로우 방을 바꿔도
 *   같은 목록이 보여야 한다. 그래서 방 칩이 없다.
 *
 * ★ 대시보드 3초 폴링에 얹지 않는다. 목록이 저절로 흔들리면 읽던 자리를 놓치고,
 *   민원은 초 단위로 바뀌는 것이 아니다. 탭을 열 때와 조작한 뒤에만 다시 읽는다.
 */
function Complaints() {
  const [items, setItems] = useState<Complaint[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<CrawlSource[]>([]);
  const [authors, setAuthors] = useState<CivicAuthor[]>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [due, setDue] = useState(0);
  const [status, setStatus] = useState<'all' | CivicStatus>('all');
  const [kind, setKind] = useState<'all' | PostKind>('all');
  /** 잇기 중인 처리 글. 골라두면 민원 줄에 [여기에 잇기] 가 뜬다 */
  const [linking, setLinking] = useState<Complaint | null>(null);
  /** 본문을 붙이는 중인 민원. 카페는 서버가 못 읽으니 사람이 열어 복사해 넣는다 */
  const [bodyFor, setBodyFor] = useState<Complaint | null>(null);
  const [bodyText, setBodyText] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'paste' | 'sources' | 'authors'>('none');
  const [paste, setPaste] = useState('');
  const [board, setBoard] = useState('');

  const reload = useCallback(async (st: string, query: string, kd: string = 'all') => {
    try {
      const qs = new URLSearchParams({ status: st, q: query, kind: kd });
      const res = await fetch(`/api/complaints?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.reason ?? '민원 목록을 읽지 못했다');
        return;
      }
      setErr(null);
      setItems(json.complaints);
      setCounts(json.counts);
      setSources(json.sources);
      setAuthors(json.authors ?? []);
      setFlow(json.flow ?? null);
      setDue(json.due);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload(status, q, kind);
  }, [reload, status, q, kind]);

  const act = useCallback(
    async (body: Record<string, unknown>): Promise<Record<string, any> | null> => {
      setBusy(true);
      try {
        const res = await fetch('/api/complaints', {
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
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const after = useCallback(
    async (json: Record<string, any> | null, note?: string) => {
      if (json && note) setMsg(note);
      await reload(status, q, kind);
    },
    [reload, status, q, kind],
  );

  /** ★ 결과를 그대로 적는다 — 몇 곳을 긁어 몇 건이 새것인지, 실패면 사유까지. */
  const crawl = async (id?: string) => {
    setMsg('긁는 중…');
    const json = await act(id ? { action: 'crawl', id } : { action: 'crawl' });
    if (!json) {
      setMsg(null);
      return;
    }
    const results = (json.results ?? []) as { name: string; ok: boolean; found: number; added: number; error: string | null }[];
    if (results.length === 0) {
      setMsg('켜져 있는 출처가 없다 — 아래 [출처] 에서 게시판 주소를 등록할 것');
    } else {
      setMsg(
        results
          .map((r) => (r.ok ? `${r.name}: ${r.found}건 중 ${r.added}건 새로` : `${r.name}: 실패 — ${r.error}`))
          .join(' · '),
      );
    }
    await reload(status, q, kind);
  };

  const submitPaste = async () => {
    const json = await act({ action: 'paste', text: paste, board });
    if (!json) return;
    setPaste('');
    setMsg(`${json.parsed}줄에서 ${json.added}건 담았다 (이미 있던 것 ${json.skipped}건)`);
    await reload(status, q, kind);
  };

  return (
    <section className="panel">
      <header>
        <h2>민원실</h2>
        <span className="count">전체 {counts.all ?? 0}건 · 방과 무관한 하나의 목록이다</span>
        <div className="spacer" />
        <div className="hdr-actions">
          <button className="btn ghost" onClick={() => setPanel(panel === 'authors' ? 'none' : 'authors')}>
            작성자
          </button>
          <button className="btn ghost" onClick={() => setPanel(panel === 'paste' ? 'none' : 'paste')}>
            붙여넣기
          </button>
          <button className="btn ghost" onClick={() => setPanel(panel === 'sources' ? 'none' : 'sources')}>
            출처 {sources.length > 0 && `(${sources.length})`}
          </button>
          <button className="btn" disabled={busy} onClick={() => void crawl()}>
            지금 긁기
          </button>
        </div>
      </header>

      {err && (
        <div className="note">
          <b>오류</b> — {err}
        </div>
      )}
      {msg && (
        <div className="note">
          {msg}{' '}
          <button className="btn ghost" onClick={() => setMsg(null)}>
            닫기
          </button>
        </div>
      )}

      {/*
        흐름 요약. ★ 모수(measured)를 반드시 함께 적는다 — "평균 3일" 이 두 건에서 나온
        값인지 백 건에서 나온 값인지 모르면 그 숫자는 판단 근거가 못 된다.
      */}
      {flow && (
        <div className="flowbar">
          <div>
            <b>{flow.reports}</b>
            <span>민원</span>
          </div>
          <div>
            <b>{flow.resolutions}</b>
            <span>처리</span>
          </div>
          <div>
            <b>{flow.avgLeadDays == null ? '—' : `${flow.avgLeadDays}일`}</b>
            <span>평균 처리 ({flow.measured}건 기준)</span>
          </div>
          <div>
            <b>{flow.medianLeadDays == null ? '—' : `${flow.medianLeadDays}일`}</b>
            <span>중앙값</span>
          </div>
          <div>
            <b>{flow.maxLeadDays == null ? '—' : `${flow.maxLeadDays}일`}</b>
            <span>최장</span>
          </div>
          <div>
            <b>{flow.sameDay}</b>
            <span>당일 처리</span>
          </div>
          {flow.unknown > 0 && (
            <div className="warn">
              <b>{flow.unknown}</b>
              <span>미분류 — [작성자] 에서 정할 것</span>
            </div>
          )}
        </div>
      )}

      {linking && (
        <div className="note">
          <b>잇는 중:</b> {linking.title.slice(0, 40)} — 아래 민원 줄의 <b>[여기에 잇기]</b> 를 누르면 짝이 된다.{' '}
          <button className="btn ghost" onClick={() => setLinking(null)}>
            그만두기
          </button>
        </div>
      )}

      {bodyFor && (
        <div className="civic-panel">
          <p>
            <b>{bodyFor.title.slice(0, 50)}</b> 의 본문을 붙여넣으면 접수·회신 시각(분 단위) · 담당 부서 ·
            <code>…까지</code> 약속을 그 자리에서 뽑는다. <b>카페 글을 열어 Ctrl+A → Ctrl+C</b> 하면 된다.
          </p>
          <textarea
            value={bodyText}
            rows={8}
            placeholder="글 본문을 통째로 붙여넣기"
            onChange={(e) => setBodyText(e.target.value)}
          />
          <div className="civic-row">
            <button
              className="btn primary"
              disabled={busy || !bodyText.trim()}
              onClick={async () => {
                const json = await act({ action: 'body', id: bodyFor.id, body: bodyText });
                if (json) {
                  const p = json.parsed ?? {};
                  setMsg(
                    [
                      p.receivedAt ? `접수 ${new Date(p.receivedAt).toLocaleString('ko-KR')}` : '접수 시각 못 찾음',
                      p.repliedAt ? `회신 ${new Date(p.repliedAt).toLocaleString('ko-KR')}` : '회신 시각 못 찾음',
                      p.department ? `부서 ${p.department}` : null,
                      p.dueAt ? `⚠️ ${new Date(p.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정 — 아직 안 끝났다` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  );
                  setBodyFor(null);
                  setBodyText('');
                  await reload(status, q, kind);
                }
              }}
            >
              본문 저장
            </button>
            <button className="btn ghost" onClick={() => { setBodyFor(null); setBodyText(''); }}>
              그만두기
            </button>
          </div>
        </div>
      )}

      {/* 자동 수집은 하루 한 번이다(vercel.json). 밀린 것을 몰래 긁지 않고 사람에게 알린다 */}
      {due > 0 && (
        <div className="note">
          <b>출처 {due}곳이 갱신할 때가 됐다.</b> 위 <b>지금 긁기</b> 를 누르면 바로 가져온다.
        </div>
      )}

      {panel === 'paste' && (
        <div className="civic-panel">
          <p>
            <b>게시판 목록을 통째로 복사해 붙여넣으면 한 줄이 한 건이 된다.</b> 댓글 수 <code>[3]</code> ·
            새 글 배지 <code>N</code> · 아이콘은 알아서 뗀다. <b>네이버 카페는 robots.txt 가 자동 수집을
            막고 있어</b> 이 길이 유일하다 — 사람이 보고 복사하는 것이라 정책과 부딪히지 않는다.
          </p>
          <input
            value={board}
            placeholder="출처 이름 (예: 과천 카페 자유게시판)"
            onChange={(e) => setBoard(e.target.value)}
          />
          <textarea
            value={paste}
            rows={7}
            placeholder={'과천 시민 모두 모여라!「제3회 과천시 자원봉사 이음축제」 개최  N\n2026년 8월 20일(목) 양재천 냄새 민원  N\n갈현삼거리 횡단보도 바꿔주세요. [3] N'}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="civic-row">
            <button className="btn primary" disabled={busy || !paste.trim()} onClick={() => void submitPaste()}>
              목록 담기
            </button>
            <button
              className="btn ghost"
              disabled={busy}
              onClick={async () => {
                const title = window.prompt('민원 제목');
                if (!title?.trim()) return;
                const url = window.prompt('링크 (없으면 비워둘 것)') ?? '';
                await after(await act({ action: 'manual', title, url }), '한 건 담았다');
              }}
            >
              한 건만 직접 추가
            </button>
          </div>
        </div>
      )}

      {panel === 'authors' && (
        <Authors
          authors={authors}
          busy={busy}
          act={act}
          reload={() => reload(status, q, kind)}
          onMsg={setMsg}
        />
      )}

      {panel === 'sources' && <Sources sources={sources} busy={busy} act={act} reload={() => reload(status, q, kind)} onCrawl={crawl} />}

      <div className="chips">
        <button data-on={kind === 'all'} onClick={() => setKind('all')}>
          전체
        </button>
        {KIND.map((k) => (
          <button key={k.key} data-on={kind === k.key} onClick={() => setKind(k.key)}>
            {k.label}{' '}
            {flow
              ? k.key === 'report'
                ? flow.reports
                : k.key === 'resolution'
                  ? flow.resolutions
                  : k.key === 'notice'
                    ? flow.notices
                    : flow.unknown
              : ''}
          </button>
        ))}
      </div>

      <div className="chips">
        <button data-on={status === 'all'} onClick={() => setStatus('all')}>
          전체 {counts.all ?? 0}
        </button>
        {CIVIC_STATUS.map((s) => (
          <button key={s.key} data-on={status === s.key} onClick={() => setStatus(s.key)}>
            {s.label} {counts[s.key] ?? 0}
          </button>
        ))}
        <input
          className="civic-search"
          value={q}
          placeholder="제목·메모 검색"
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <b>{q || status !== 'all' ? '조건에 맞는 민원이 없다' : '아직 담아둔 민원이 없다'}</b>
          게시판 목록을 <b>붙여넣기</b> 하거나, <b>출처</b> 에 RSS·게시판 주소를 등록하거나,
          대화 탭에서 말풍선의 <b>민원</b> 버튼을 누르면 여기 쌓인다.
        </div>
      ) : (
        <ul className="civics">
          {items.map((c) => (
            <li key={c.id} data-kind={c.kind}>
              {/* 종류를 손으로 고치면 잠긴다 — 이후 재분류가 그 행을 덮지 않는다 */}
              <select
                className={`ckind k-${c.kind}`}
                value={c.kind}
                disabled={busy}
                title={c.kindLocked ? '손으로 정한 종류 (재분류가 덮지 않는다)' : '규칙이 정한 종류'}
                onChange={async (e) => {
                  await after(await act({ action: 'kind', id: c.id, kind: e.target.value }));
                }}
              >
                {KIND.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>

              <select
                className={`cstat s-${c.status}`}
                value={c.status}
                disabled={busy}
                onChange={async (e) => {
                  await after(await act({ action: 'status', id: c.id, status: e.target.value }));
                }}
              >
                {CIVIC_STATUS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>

              <div className="cmeta">
                <span className="ctitle">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer noopener">
                      {c.title}
                    </a>
                  ) : (
                    c.title
                  )}
                </span>
                <span className="csub">
                  {c.board ?? ORIGIN_LABEL[c.origin]}
                  {c.author && ` · ${c.author}`}
                  {` · ${dayLabel(c.postedAt ?? c.createdAt)}`}
                  {c.postedAt ? '' : ' (담은 날)'}
                  {c.category && ` · #${c.category}`}
                </span>
                {/* 접수 → 회신. 처리 글은 제목 날짜가 접수일이라 짝짓기 없이도 잡힌다 */}
                {leadLabel(c.reportedAt, c.resolvedAt) && (
                  <span className="clead">
                    {leadLabel(c.reportedAt, c.resolvedAt)}
                    {c.department && ` · ${c.department}`}
                    {/* ★ 회신이 왔어도 "…까지" 약속이 남아 있으면 끝난 게 아니다 */}
                    {c.dueAt && ` · ⏳ ${new Date(c.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정`}
                  </span>
                )}
                {c.body && <span className="cbody">{c.body.slice(0, 200)}</span>}
                {c.note && <span className="cnote">✎ {c.note}</span>}
              </div>

              {/* 짝짓기는 사람이 한다. 제목이 비슷하다고 자동으로 엮으면 통계가 조용히 틀린다 */}
              {c.kind === 'resolution' &&
                (c.resolutionOf ? (
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={async () => {
                      await after(await act({ action: 'unlink', id: c.id }));
                    }}
                  >
                    잇기 해제
                  </button>
                ) : (
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => setLinking(linking?.id === c.id ? null : c)}
                  >
                    {linking?.id === c.id ? '고르는 중' : '민원에 잇기'}
                  </button>
                ))}

              {linking && c.kind === 'report' && c.id !== linking.id && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    await after(
                      await act({ action: 'link', resolutionId: linking.id, reportId: c.id }),
                      '민원과 처리를 이었다',
                    );
                    setLinking(null);
                  }}
                >
                  여기에 잇기
                </button>
              )}

              <button
                className="btn ghost"
                disabled={busy}
                title="글 본문을 붙여넣어 시각·부서·예정일을 뽑는다"
                onClick={() => {
                  setBodyFor(c);
                  setBodyText(c.body ?? '');
                }}
              >
                본문{c.body ? ' ✓' : ''}
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  const note = window.prompt('메모 (비우면 지운다)', c.note ?? '');
                  if (note === null) return;
                  await after(await act({ action: 'edit', id: c.id, note }));
                }}
              >
                메모
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  const category = window.prompt('분류 (도로·환경·교통… 비우면 지운다)', c.category ?? '');
                  if (category === null) return;
                  await after(await act({ action: 'edit', id: c.id, category }));
                }}
              >
                분류
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(`"${c.title.slice(0, 40)}" 을 목록에서 지울까?`)) return;
                  await after(await act({ action: 'delete', id: c.id }));
                }}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * 작성자 명부 — 민원과 공지를 가르는 첫 번째 축.
 *
 * ★ 작성자만으로는 안 갈린다. `조인길 정책관` 한 계정이 민원 처리 기록과 보도자료를
 *   함께 쓴다(실측 2026-08-21). 명부는 "기본값" 을 주고, 제목이 `날짜 + …민원` 꼴이면
 *   기관 계정 글이라도 처리 기록으로 살린다(`complaint-classify.ts`).
 *
 * 정하고 나면 [지난 글 다시 가르기] 를 눌러야 이미 담긴 글에 적용된다 —
 * 저절로 돌지 않는다. 손으로 고쳐둔 행은 그때도 건드리지 않는다.
 */
function Authors({
  authors,
  busy,
  act,
  reload,
  onMsg,
}: {
  authors: CivicAuthor[];
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Record<string, any> | null>;
  reload: () => Promise<void>;
  onMsg: (m: string) => void;
}) {
  return (
    <div className="civic-panel">
      <p>
        <b>기관·홍보 계정을 한 번 찍어두면 그 뒤 올라오는 홍보글이 자동으로 공지로 내려간다.</b>{' '}
        단, 제목이 <code>2026년 8월 20일(목) … 민원</code> 꼴이면 기관 계정 글이라도 <b>처리 기록</b>으로
        살린다 — 정책관 계정 하나가 민원 회신과 보도자료를 함께 쓰기 때문이다.
      </p>
      <div className="civic-row">
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            const out = await act({ action: 'reclassify' });
            if (out) onMsg(`${out.scanned}건 중 ${out.changed}건 다시 갈랐다 (손으로 고친 행은 그대로)`);
            await reload();
          }}
        >
          지난 글 다시 가르기
        </button>
      </div>

      {authors.length === 0 ? (
        <p className="dim">아직 작성자가 없다. 목록을 담으면 여기 이름이 모인다.</p>
      ) : (
        <ul className="srcs">
          {authors.map((a) => (
            <li key={a.name}>
              <div className="cmeta">
                <span className="ctitle">{a.name}</span>
                <span className="csub">글 {a.count ?? 0}건{a.note ? ` · ${a.note}` : ''}</span>
              </div>
              {AUTHOR_KIND.map((k) => (
                <button
                  key={k.key}
                  className={`btn ${a.kind === k.key ? 'primary' : 'ghost'}`}
                  disabled={busy}
                  onClick={async () => {
                    await act({ action: 'author-kind', name: a.name, kind: k.key });
                    await reload();
                  }}
                >
                  {k.label}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 크롤 출처 관리.
 *
 * ★ 실패를 숨기지 않는다. 마지막 실행 결과(몇 건 찾고 몇 건 새것인지, 실패면 사유)를
 *   출처 줄에 그대로 적는다. 0건이 계속 나오는 출처는 링크 패턴이 안 맞는 것이지
 *   "게시판이 조용한 것" 이 아니다 — 그 둘을 화면에서 갈라준다.
 */
function Sources({
  sources,
  busy,
  act,
  reload,
  onCrawl,
}: {
  sources: CrawlSource[];
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Record<string, any> | null>;
  reload: () => Promise<void>;
  onCrawl: (id?: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [linkPattern, setLinkPattern] = useState('');

  const add = async () => {
    const json = await act({ action: 'source-add', name, url, keywords, linkPattern });
    if (!json) return;
    setName('');
    setUrl('');
    setKeywords('');
    setLinkPattern('');
    await reload();
  };

  return (
    <div className="civic-panel">
      <p>
        <b>robots.txt 가 허용하는 게시판·RSS 만 긁는다.</b> 막힌 곳(네이버 카페 등)은 등록할 때
        거부하고 사유를 알려준다. 자동 수집은 <b>하루 한 번</b>이고(서버 cron), 급하면 [지금 긁기] 를 누른다.
      </p>
      <div className="civic-row">
        <input value={name} placeholder="이름 (예: 과천시청 시민의소리)" onChange={(e) => setName(e.target.value)} />
        <input className="mono" value={url} placeholder="목록·RSS 주소 (https://…)" onChange={(e) => setUrl(e.target.value)} />
      </div>
      <div className="civic-row">
        <input
          value={keywords}
          placeholder="제목 낱말 거르기 (쉼표. 비우면 전부 · 예: 민원,청원,요청)"
          onChange={(e) => setKeywords(e.target.value)}
        />
        <input
          className="mono"
          value={linkPattern}
          placeholder="글 링크 패턴 (정규식. 비우면 자동 · 예: nttId=)"
          onChange={(e) => setLinkPattern(e.target.value)}
        />
        <button className="btn primary" disabled={busy || !url.trim()} onClick={() => void add()}>
          출처 등록
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="dim">등록된 출처가 없다. RSS 주소가 있으면 그쪽이 가장 안 깨진다.</p>
      ) : (
        <ul className="srcs">
          {sources.map((s) => (
            <li key={s.id}>
              <div className="cmeta">
                <span className="ctitle">
                  {s.name} {!s.enabled && <span className="tag muted">꺼짐</span>}
                </span>
                <span className="csub mono">{s.url}</span>
                <span className="csub">
                  {s.lastRunAt == null
                    ? '아직 안 긁었다'
                    : s.lastOk
                      ? `마지막 ${relTime(s.lastRunAt)} · ${s.lastCount}건 중 ${s.lastNew}건 새로`
                      : `⚠️ 마지막 ${relTime(s.lastRunAt)} · 실패 — ${s.lastError}`}
                  {s.keywords && ` · 낱말: ${s.keywords}`}
                </span>
              </div>
              <button className="btn ghost" disabled={busy} onClick={() => void onCrawl(s.id)}>
                긁기
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  await act({ action: 'source-edit', id: s.id, patch: { enabled: !s.enabled } });
                  await reload();
                }}
              >
                {s.enabled ? '끄기' : '켜기'}
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(`"${s.name}" 출처를 지울까? 담아둔 민원은 남는다.`)) return;
                  await act({ action: 'source-delete', id: s.id });
                  await reload();
                }}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
