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
    /** 이름을 알림 색인에서 얻은 건수 / API2 author 로 때운 건수 */
    senderIdx: number | null;
    senderAuth: number | null;
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
            {/*
              ★ 이름을 무엇으로 붙였는지. author 쪽만 늘면 API2 이름이 굳었을 수 있다 —
                화면에서는 "한 사람이 혼자 떠드는 방" 과 구분이 안 된다.
            */}
            {(state.bot.senderIdx != null || state.bot.senderAuth != null) &&
              ` · 이름 알림 ${state.bot.senderIdx ?? 0}/API2 ${state.bot.senderAuth ?? 0}`}
            {(state.bot.senderIdx ?? 0) === 0 && (state.bot.senderAuth ?? 0) >= 6 && ' ⚠️ 알림이 이름을 주지 않는다'}
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
  agency: string | null;
  dueAt: string | null;
  aiDraft: boolean;
  aiNote: string | null;
  cafePostId: string | null;
  /** 같은 사안이 다른 경로로 한 번 더 들어온 것 */
  duplicateOf: string | null;
  /** 해결 내용 — 이 민원이 어떻게 처리됐는가. 부서·기관·예정일이 여기서 나온다 */
  resolutionText: string | null;
  resolutionSummary: string | null;
};

type PairSide = { id: string; title: string; kind: string; at: string | null; origin: string };
type PairSuggestion = {
  id: string;
  relation: 'resolves' | 'duplicate';
  confidence: string | null;
  reason: string | null;
  left: PairSide;
  right: PairSide;
};

type DigestRun = {
  startedAt: string;
  windowFrom: string;
  windowTo: string;
  messages: number;
  drafted: number;
  added: number;
  ok: boolean;
  error: string | null;
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

type CafePost = {
  id: string;
  title: string | null;
  url: string | null;
  body: string;
  postedAt: string | null;
  reply: string | null;
  replyPostedAt: string | null;
  createdAt: string;
  summarizedAt: string | null;
  ok: boolean | null;
  error: string | null;
  drafted: number;
};

/** 왼쪽 보드의 세 칸. 화면이 하는 일이 셋으로 갈린다 — 확정된 것 / 검토할 것 / 넣는 곳. */
type Board = 'list' | 'drafts' | 'cafe';

/**
 * 민원실 — 과천 민원을 모아 흐름을 따라가는 화면.
 *
 * ★ 왼쪽 보드가 **일의 방향**이다. 카페 글을 넣으면(카페) 모델이 초안을 만들고(AI 초안),
 *   사람이 확정한 것만 목록에 남는다(민원 목록). 되돌아가는 화살표는 없다 —
 *   초안과 확정본을 한 목록에 섞으면 무엇을 아직 안 봤는지 알 수 없게 된다.
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
  const [cafePosts, setCafePosts] = useState<CafePost[]>([]);
  const [pairs, setPairs] = useState<PairSuggestion[]>([]);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [digest, setDigest] = useState<DigestRun | null>(null);
  const [digestDue, setDigestDue] = useState(false);
  const [digestHours, setDigestHours] = useState(24);
  const [due, setDue] = useState(0);
  const [board, setBoard] = useState<Board>('list');
  /** 펼쳐 본 민원. 게시판처럼 제목만 보이다가 누르면 아래에 내용이 뜬다 */
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | CivicStatus>('all');
  const [kind, setKind] = useState<'all' | PostKind>('all');
  /** 잇기 중인 처리 글. 골라두면 민원 줄에 [여기에 잇기] 가 뜬다 */
  const [linking, setLinking] = useState<Complaint | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'none' | 'paste' | 'sources' | 'authors'>('none');
  const [paste, setPaste] = useState('');
  const [pasteBoard, setPasteBoard] = useState('');

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
      setCafePosts(json.cafePosts ?? []);
      setPairs(json.pairs ?? []);
      setFlow(json.flow ?? null);
      setDigest(json.digest ?? null);
      setDigestDue(Boolean(json.digestDue));
      setDigestHours(json.digestHours ?? 24);
      setDue(json.due);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /*
   * ★ 검색어는 잠깐 기다렸다 보낸다. 글자마다 바로 쏘면 "과천대로" 를 치는 동안 요청이
   *   네 번 날아가고, 늦게 도착한 앞 글자의 응답이 뒤 글자의 결과를 덮어쓴다.
   *   화면이 느려 보이는 것도 대부분 이 자리다.
   */
  useEffect(() => {
    const t = setTimeout(() => void reload(status, q, kind), q ? 260 : 0);
    return () => clearTimeout(t);
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
    const json = await act({ action: 'paste', text: paste, board: pasteBoard });
    if (!json) return;
    setPaste('');
    setMsg(`${json.parsed}줄에서 ${json.added}건 담았다 (이미 있던 것 ${json.skipped}건)`);
    await reload(status, q, kind);
  };

  /* 보드를 옮길 때 걸러둔 것을 풀어준다 — "민원이 하나도 없다" 로 보이는 착시를 막는다 */
  const goto = (b: Board) => {
    setBoard(b);
    setOpenId(null);
    setPanel('none');
    if (b !== 'list') {
      setStatus('all');
      setKind('all');
      setQ('');
    }
  };

  /*
   * ★ 이어진 회신은 목록에 **따로 세우지 않는다.** 민원과 회신이 두 줄로 나란히 있으면
   *   같은 사안이 두 건으로 읽히고, "무엇이 어떻게 끝났나" 를 보려고 두 줄을 눈으로
   *   짝지어야 한다. 이어둔 것은 민원 줄 하나로 합쳐 보여준다.
   * ★ 중복으로 판정된 글도 목록에서 내린다. 지운 것은 아니고 가려둔 것이다.
   */
  const resolutionFor = new Map<string, Complaint>();
  for (const c of items) if (c.resolutionOf) resolutionFor.set(c.resolutionOf, c);

  const confirmed = items.filter((c) => !c.aiDraft && !c.duplicateOf && !c.resolutionOf);
  /*
   * ★ 초안은 합치지 않는다. 회신 초안이 민원 줄 안으로 접혀 들어가면 [확정] 버튼이
   *   초안 보드에서 사라져, 사람이 검토할 길이 없어진다. 검토 대기열은 끝까지 평평하게 둔다.
   */
  const drafts = items.filter((c) => c.aiDraft && !c.duplicateOf);
  const hidden = items.filter((c) => c.duplicateOf || (c.resolutionOf && !c.aiDraft)).length;
  const chatDrafts = drafts.filter((c) => c.origin === 'chat');
  const cafeDrafts = drafts.filter((c) => c.origin !== 'chat');

  const rowProps = { busy, act, after, linking, setLinking, onMsg: setMsg };

  return (
    <section className="panel">
      <header>
        <h2>민원실</h2>
        <span className="count">
          확정 {confirmed.length}건 · 초안 {drafts.length}건
          {hidden > 0 && ` · 합쳐지거나 중복으로 내린 것 ${hidden}건`}
        </span>
        <div className="spacer" />
        <div className="hdr-actions">
          <button className="btn ghost" onClick={() => setPanel(panel === 'authors' ? 'none' : 'authors')}>
            작성자
          </button>
          <button className="btn ghost" onClick={() => setPanel(panel === 'paste' ? 'none' : 'paste')}>
            목록 붙여넣기
          </button>
          <button className="btn ghost" onClick={() => setPanel(panel === 'sources' ? 'none' : 'sources')}>
            출처 {sources.length > 0 && `(${sources.length})`}
          </button>
          <button className="btn" disabled={busy} onClick={() => void crawl()}>
            지금 긁기
          </button>
          <button
            className="btn"
            disabled={busy}
            title="쌓인 카톡을 읽어 민원 초안을 만든다"
            onClick={async () => {
              setMsg('카톡을 분석하는 중… (수십 초 걸릴 수 있다)');
              const json = await act({ action: 'digest' });
              if (!json) { setMsg(null); return; }
              const d = json.digest as DigestRun & { error: string | null };
              setMsg(
                d.error
                  ? `분석 실패 — ${d.error}`
                  : `${d.messages}건 읽어 ${d.drafted}건 뽑았고 ${d.added}건 새로 담았다`,
              );
              if (!d.error && d.added > 0) goto('drafts');
              await reload(status, q, kind);
            }}
          >
            지금 분석
          </button>
          <button
            className="btn"
            disabled={busy}
            title="같은 사안이 두 번 들어온 것을 찾아 제안한다 (이어지지는 않는다)"
            onClick={async () => {
              setMsg('짝을 찾는 중…');
              const json = await act({ action: 'pair-suggest' });
              if (!json) { setMsg(null); return; }
              const r = json.pair as { scanned: number; found: number; added: number; error: string | null };
              setMsg(
                r.error
                  ? `짝 찾기 실패 — ${r.error}`
                  : r.added > 0
                    ? `${r.scanned}건을 보고 ${r.added}건을 제안했다 — 아래에서 확인할 것`
                    : `${r.scanned}건을 봤지만 새로 제안할 짝이 없다`,
              );
              if ((r.added ?? 0) > 0) goto('list');
              await reload(status, q, kind);
            }}
          >
            짝 찾기
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
        ★ 자동 분석은 하루 한 번뿐이다(Vercel Hobby 는 cron 을 하루 1회로 제한한다).
          그 사이 공백을 몰래 메우지 않고 사람에게 알린다.
      */}
      {digestDue && (
        <div className="note">
          <b>카톡 분석이 밀렸다</b> — 마지막 분석 이후 {digestHours}시간이 지났다. 위{' '}
          <b>지금 분석</b> 을 누르면 그동안 쌓인 대화에서 민원을 뽑는다.
        </div>
      )}

      {/*
        마지막 카톡 분석. ★ 실패를 숨기지 않는다 — 0건이 "조용한 하루" 인지
        "키가 없어서 아예 안 돌았다" 인지 화면에서 갈라야 한다.
      */}
      {digest && (
        <div className="note">
          {digest.ok ? (
            <>
              <b>마지막 카톡 분석</b> {relTime(digest.startedAt)} — {digest.messages}건 읽어{' '}
              {digest.drafted}건 뽑았고 {digest.added}건 새로 담았다
            </>
          ) : (
            <>
              <b>⚠️ 마지막 카톡 분석 실패</b> ({relTime(digest.startedAt)}) — {digest.error}
            </>
          )}
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
            <b>게시판 <u>목록</u>을 통째로 복사해 붙여넣으면 한 줄이 한 건이 된다.</b> 댓글 수 <code>[3]</code> ·
            새 글 배지 <code>N</code> · 아이콘은 알아서 뗀다. 글 <b>본문</b>을 요약해 담으려면 왼쪽{' '}
            <b>카페 글</b> 보드를 쓸 것.
          </p>
          <input
            value={pasteBoard}
            placeholder="출처 이름 (예: 과천 카페 자유게시판)"
            onChange={(e) => setPasteBoard(e.target.value)}
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
        <Authors authors={authors} busy={busy} act={act} reload={() => reload(status, q, kind)} onMsg={setMsg} />
      )}

      {panel === 'sources' && (
        <Sources sources={sources} busy={busy} act={act} reload={() => reload(status, q, kind)} onCrawl={crawl} />
      )}

      {/*
        ★ 모델이 찾아낸 짝은 **제안일 뿐**이다. 사람이 누르기 전에는 아무것도 이어지지 않는다.
          자동으로 엮으면 틀린 짝이 조용히 통계에 섞이고, 그렇게 어긋난 "평균 처리 3일" 은
          아무도 못 알아챈다.
      */}
      {pairs.length > 0 && (
        <div className="pairbox">
          <p>
            <b>모델이 같은 사안으로 본 짝 {pairs.length}건</b> — 아직 이어지지 않았다.
            맞으면 [묶기], 아니면 [아니다]. <b>물리친 짝은 다시 제안하지 않는다.</b>
          </p>
          <ul>
            {pairs.map((p) => (
              <li key={p.id}>
                <span className={`ptag ${p.relation}`}>
                  {p.relation === 'resolves' ? '민원 ↔ 해결' : '같은 글 중복'}
                </span>
                <span className="pmeta">
                  <span className="pline">
                    {p.relation === 'resolves' ? '민원' : '먼저'} · {p.right.title}
                  </span>
                  <span className="pline">
                    {p.relation === 'resolves' ? '해결' : '나중'} · {p.left.title}
                  </span>
                  {/* 왜 같은 사안으로 봤는지. 누를지 말지 판단하는 근거다 */}
                  <span className="preason">
                    🤖 {p.confidence} · {p.reason}
                  </span>
                </span>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={async () => {
                    await after(
                      await act({ action: 'pair-accept', id: p.id }),
                      p.relation === 'resolves' ? '민원과 해결을 합쳤다' : '중복으로 내렸다',
                    );
                  }}
                >
                  묶기
                </button>
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={async () => {
                    await after(await act({ action: 'pair-reject', id: p.id }));
                  }}
                >
                  아니다
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {linking && (
        <div className="note">
          <b>잇는 중:</b> {linking.title.slice(0, 40)} — 민원 줄의 <b>[여기에 잇기]</b> 를 누르면 짝이 된다.{' '}
          <button className="btn ghost" onClick={() => setLinking(null)}>
            그만두기
          </button>
        </div>
      )}

      <div className="civic-board">
        {/* 왼쪽 보드 — 일이 흘러가는 차례대로 위에서 아래로 놓는다 */}
        <nav className="civic-nav">
          <button data-on={board === 'list'} onClick={() => goto('list')}>
            <b>민원 목록</b>
            <span>{confirmed.length}건 · 사람이 확정한 것</span>
          </button>
          <button data-on={board === 'drafts'} onClick={() => goto('drafts')}>
            <b>AI 초안</b>
            <span>
              {drafts.length}건 · 카톡 {chatDrafts.length} / 카페 {cafeDrafts.length}
            </span>
          </button>
          <button data-on={board === 'cafe'} onClick={() => goto('cafe')}>
            <b>카페 글</b>
            <span>{cafePosts.length}건 보관 · 붙여넣으면 요약한다</span>
          </button>

          {/*
            흐름 요약. ★ 모수(measured)를 반드시 함께 적는다 — "평균 3일" 이 두 건에서
            나온 값인지 백 건에서 나온 값인지 모르면 그 숫자는 판단 근거가 못 된다.
          */}
          {flow && (
            <div className="civic-stat">
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
                <span>평균 ({flow.measured}건 기준)</span>
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
        </nav>

        <div className="civic-main">
          {board === 'list' && (
            <>
              <div className="chips">
                <button data-on={kind === 'all'} onClick={() => setKind('all')}>
                  전체
                </button>
                {KIND.map((k) => (
                  <button key={k.key} data-on={kind === k.key} onClick={() => setKind(k.key)}>
                    {k.label}
                  </button>
                ))}
                <span className="dim">|</span>
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
                  placeholder="제목·본문 검색"
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              {confirmed.length === 0 ? (
                <div className="empty">
                  <b>{q || status !== 'all' || kind !== 'all' ? '조건에 맞는 민원이 없다' : '확정된 민원이 아직 없다'}</b>
                  <b>AI 초안</b> 에서 [확정] 을 누르면 여기로 온다.
                </div>
              ) : (
                <ul className="civic-list">
                  {confirmed.map((c) => (
                    <CivicLine
                      key={c.id}
                      c={c}
                      fix={resolutionFor.get(c.id)}
                      open={openId === c.id}
                      onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                      {...rowProps}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          {board === 'drafts' && (
            <>
              <p className="dim">
                모델이 뽑은 <b>초안</b>이다. 카페와 대조해 <b>[확정]</b> 하면 민원 목록으로 가고,
                아니면 <b>[지우기]</b>. 확정하기 전에는 통계에 들어가지 않는다.
              </p>

              <h4 className="civic-h">카톡에서 <span className="dim">{chatDrafts.length}건</span></h4>
              {chatDrafts.length === 0 ? (
                <p className="dim">없다. 위 [지금 분석] 을 누르면 쌓인 대화에서 뽑는다.</p>
              ) : (
                <ul className="civic-list">
                  {chatDrafts.map((c) => (
                    <CivicLine
                      key={c.id}
                      c={c}
                      open={openId === c.id}
                      onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                      {...rowProps}
                    />
                  ))}
                </ul>
              )}

              <h4 className="civic-h">카페에서 <span className="dim">{cafeDrafts.length}건</span></h4>
              {cafeDrafts.length === 0 ? (
                <p className="dim">없다. 왼쪽 [카페 글] 에 본문을 붙여넣으면 여기 쌓인다.</p>
              ) : (
                <ul className="civic-list">
                  {cafeDrafts.map((c) => (
                    <CivicLine
                      key={c.id}
                      c={c}
                      open={openId === c.id}
                      onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                      {...rowProps}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          {board === 'cafe' && (
            <CafeBox
              posts={cafePosts}
              busy={busy}
              act={act}
              reload={() => reload(status, q, kind)}
              onMsg={setMsg}
              onDone={() => goto('drafts')}
            />
          )}
        </div>
      </div>
    </section>
  );
}

type RowProps = {
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Record<string, any> | null>;
  after: (json: Record<string, any> | null, note?: string) => Promise<void>;
  linking: Complaint | null;
  setLinking: (c: Complaint | null) => void;
  onMsg: (m: string | null) => void;
};

/**
 * 목록의 한 줄. 게시판처럼 **부서 · 제목 · 날짜** 만 보이다가, 누르면 그 자리에서 펼쳐진다.
 *
 * ★ 민원 목록과 AI 초안이 **같은 줄 모양**을 쓴다. 초안에서 줄곧 펼쳐 보여주다가
 *   확정하면 접히는 식이면, 확정이 무엇을 바꾸는지 사람이 예측하지 못한다.
 *   초안에서 달라지는 것은 `AI 초안` 배지와 [확정] 버튼 둘뿐이어야 한다.
 */
function CivicLine({
  c,
  fix,
  open,
  onToggle,
  ...rest
}: { c: Complaint; fix?: Complaint; open: boolean; onToggle: () => void } & RowProps) {
  /* 해결 내용이 민원 행에 있으면 그 값이 먼저다. 이어둔 처리 글은 그 다음 */
  const dept = c.department ?? fix?.department;
  const agency = c.agency ?? fix?.agency;
  const dueAt = c.dueAt ?? fix?.dueAt;
  const solved = Boolean(c.resolutionText || fix);
  const days =
    c.reportedAt && c.resolvedAt
      ? Math.floor((Date.parse(c.resolvedAt) - Date.parse(c.reportedAt)) / 86_400_000)
      : null;

  return (
    <li data-kind={c.kind} data-open={open} data-fixed={fix ? 'true' : 'false'}>
      <button className="civic-line" onClick={onToggle}>
        {/*
          ★ 부서 칸에 외부 기관을 그냥 적지 않는다. 시청 과·팀과 한 줄에 섞이면
            "어느 과로 가나" 를 눈으로 세는 순간 답이 틀어진다. 넘긴 건은 넘겼다고 적는다.
        */}
        <span className={`cdept ${dept ? '' : agency ? 'ext' : 'none'}`}>
          {dept ?? (agency ? `외부 · ${agency}` : c.kind === 'report' ? '배분 전' : '—')}
        </span>
        <span className="cline-title">
          {c.aiDraft && <span className="aibadge">AI 초안</span>}
          <span className={`ktag k-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
          {c.title}
          {dueAt && <span className="cdue">⏳</span>}
        </span>
        {/* 해결된 민원은 걸린 날수를 줄에 적는다 — 목록을 훑는 것만으로 흐름이 읽힌다 */}
        {solved && <span className="cfix">해결{days === null ? '' : days === 0 ? ' · 당일' : ` · ${days}일`}</span>}
        <span className="cline-date">{dayLabel(c.reportedAt ?? c.postedAt ?? c.createdAt)}</span>
      </button>

      {open && (
        <div className="civic-detail">
          <CivicDetail c={c} {...rest} />
          {/*
            해결 내용은 이제 민원 행의 열이라 `CivicDetail` 안에서 이미 보인다.
            여기 남는 것은 **이어둔 처리 글**뿐이다 — 열을 못 채운 옛 짝만 통째로 펼치고,
            채워졌으면 한 줄로 줄여 [잇기 해제] 만 남긴다. 같은 글을 두 번 보이지 않게.
          */}
          {fix &&
            (c.resolutionText ? (
              <div className="civic-fixlink">
                <span>이어둔 처리 글 · {fix.title.slice(0, 40)}</span>
                <button
                  className="btn ghost"
                  disabled={rest.busy}
                  onClick={async () => {
                    await rest.after(await rest.act({ action: 'unlink', id: fix.id }));
                  }}
                >
                  잇기 해제
                </button>
              </div>
            ) : (
              <div className="civic-fix">
                <h5>해결 내용 · {dayLabel(fix.postedAt ?? fix.createdAt)}</h5>
                <CivicDetail c={fix} {...rest} />
              </div>
            ))}
        </div>
      )}
    </li>
  );
}

/**
 * 민원 한 건의 속살. 목록에서는 제목을 눌렀을 때만 펼쳐지고, AI 초안 보드에서는 늘 펼쳐져 있다.
 * ★ 두 곳이 같은 컴포넌트를 쓴다 — 초안과 확정본에서 보이는 정보가 달라지면
 *   "확정하면 뭐가 바뀌는지" 를 사람이 예측할 수 없게 된다.
 */
function CivicDetail({
  c,
  busy,
  act,
  after,
  linking,
  setLinking,
  onMsg,
}: { c: Complaint } & RowProps) {
  /*
   * ★ 글 상자는 **그 줄 안에서** 연다. 예전에는 화면 맨 위 한 자리에서 열렸는데,
   *   목록 아래쪽 민원에서 버튼을 누르면 상자가 스크롤 밖에 뜨고 화면은 아무 반응이
   *   없어 보였다. 버튼과 상자가 떨어져 있으면 안 된다.
   */
  const [editing, setEditing] = useState<'none' | 'fix' | 'body'>('none');
  const [text, setText] = useState('');
  const [at, setAt] = useState('');
  const close = () => { setEditing('none'); setText(''); };

  return (
    /*
     * ★ 두 줄로 못 박는다 — 내용 줄과 버튼 줄. 한 줄에 몰아넣으면 버튼이 제 너비를
     *   고집하는 동안 본문 칸이 0 까지 쭈그러들어 글자가 세로로 한 자씩 떨어진다
     *   (실측 2026-08-24, 왼쪽 보드가 생겨 본문 칸이 좁아지자 바로 터졌다).
     */
    <div className="citem">
      <div className="citem-head">
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
        {/* 제목은 바로 위 줄에 이미 있다. 여기서는 출처·시각·짝만 다시 적는다 */}
        <span className="csub">
          {c.board ?? ORIGIN_LABEL[c.origin]}
          {c.author && ` · ${c.author}`}
          {` · ${dayLabel(c.postedAt ?? c.createdAt)}`}
          {c.postedAt ? '' : ' (담은 날)'}
          {c.category && ` · #${c.category}`}
          {c.url && (
            <>
              {' · '}
              <a href={c.url} target="_blank" rel="noreferrer noopener">
                원글 열기
              </a>
            </>
          )}
        </span>
        {/* 접수 → 회신. 처리 글은 제목 날짜가 접수일이라 짝짓기 없이도 잡힌다 */}
        {(leadLabel(c.reportedAt, c.resolvedAt) || c.department || c.agency) && (
          <span className="clead">
            {[
              leadLabel(c.reportedAt, c.resolvedAt),
              c.department && `배분 ${c.department}`,
              // 시청 밖에서 답이 온 건. 부서와 나란히 두되 이름표로 갈라 적는다
              c.agency && `회신 ${c.agency}`,
              // ★ 회신이 왔어도 "…까지" 약속이 남아 있으면 끝난 게 아니다
              c.dueAt && `⏳ ${new Date(c.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}

        {/*
          ★ 요약과 원문에 이름표를 붙인다. 둘 다 문단 모양이라 이름표가 없으면
            어디까지가 모델이 줄인 것이고 어디부터가 사람이 쓴 말인지 갈리지 않는다.
        */}
        {c.summary && (
          <div className="cpart">
            <h5>요약{c.aiDraft && <span className="dim"> · 모델이 줄인 것</span>}</h5>
            <p>{c.summary}</p>
          </div>
        )}
        {c.body && (
          <div className="cpart">
            <h5>원문{c.origin === 'chat' && <span className="dim"> · 카톡 그대로</span>}</h5>
            <p className="cfull">{c.body}</p>
          </div>
        )}
        {/*
          해결 내용 — 이 민원이 어떻게 처리됐는가. 민원 행에 붙어 있으므로 짝을 짓지 않아도
          한 자리에서 읽힌다. 부서·회신 기관·완료 예정일이 전부 이 글에서 나온 값이다.
        */}
        {c.resolutionText && (
          <div className="cpart cfixpart">
            <h5>해결 내용{c.resolvedAt && <span className="dim"> · {dayLabel(c.resolvedAt)}</span>}</h5>
            {c.resolutionSummary && <p>{c.resolutionSummary}</p>}
            <p className="cfull dim">{c.resolutionText}</p>
          </div>
        )}
        {/* 왜 이걸 민원으로 봤는지. 확정할지 지울지 판단하는 근거다 */}
        {c.aiDraft && c.aiNote && <span className="cnote dim">🤖 {c.aiNote}</span>}
        {c.note && <span className="cnote">✎ {c.note}</span>}
      </div>
      </div>

      <div className="citem-acts">
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
          <button className="btn ghost" disabled={busy} onClick={() => setLinking(linking?.id === c.id ? null : c)}>
            {linking?.id === c.id ? '고르는 중' : '민원에 잇기'}
          </button>
        ))}

      {linking && c.kind === 'report' && c.id !== linking.id && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            await after(await act({ action: 'link', resolutionId: linking.id, reportId: c.id }), '민원과 처리를 이었다');
            setLinking(null);
          }}
        >
          여기에 잇기
        </button>
      )}

      {c.aiDraft && (
        <button
          className="btn primary"
          disabled={busy}
          title={c.aiNote ?? '확정하면 민원 목록으로 간다'}
          onClick={async () => {
            await after(await act({ action: 'confirm', id: c.id }), '민원 목록으로 옮겼다');
          }}
        >
          확정
        </button>
      )}
      {/* ★ 부서가 정해지는 유일한 자리다. 처리 글 자신에게는 뜻이 없어 민원에만 붙인다 */}
      {c.kind !== 'resolution' && (
        <button
          className={c.resolutionText ? 'btn' : 'btn ghost'}
          disabled={busy}
          title="이 민원이 어떻게 처리됐는지 적는다 — 부서·기관·예정일을 그 글에서 뽑는다"
          onClick={() => {
            if (editing === 'fix') return close();
            setEditing('fix');
            setText(c.resolutionText ?? '');
            setAt(c.resolvedAt ? c.resolvedAt.slice(0, 10) : '');
          }}
        >
          해결 내용{c.resolutionText ? ' ✓' : ''}
        </button>
      )}
      <button
        className="btn ghost"
        disabled={busy}
        title="글 본문을 붙여넣어 시각·부서·예정일을 뽑는다"
        onClick={() => {
          if (editing === 'body') return close();
          setEditing('body');
          setText(c.body ?? '');
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
      </div>

      {/*
        ★ 이 앱에서 **부서가 정해지는 유일한 자리**다. 저장하는 순간 담당 부서 · 회신 기관 ·
          완료 예정일 · 회신 시각을 이 글에서 규칙이 뽑아 채우고, 무엇이 채워졌는지
          그 자리에서 알려준다. 조용히 성공하지 않는다.
      */}
      {editing === 'fix' && (
        <div className="rowbox">
          <p>
            이 민원이 <b>어떻게 처리됐는지</b> 적는다. 담당자 회신문을 그대로 붙여넣으면{' '}
            <b>담당 부서 · 회신 기관 · 완료 예정일 · 회신 시각</b>을 그 자리에서 뽑는다.
            비워서 저장하면 해결 내용과 거기서 나온 값이 함께 지워지고 <b>확인 중</b>으로 돌아간다.
          </p>
          <textarea
            value={text}
            rows={6}
            autoFocus
            placeholder="담당자 회신문을 그대로 붙여넣기 (예: 본 민원의 담당 부서인 과천시청 공원녹지과 하천관리팀에서 …)"
            onChange={(e) => setText(e.target.value)}
          />
          <label className="civic-field">
            <span>회신일</span>
            <input type="date" value={at} onChange={(e) => setAt(e.target.value)} />
            <em>본문에 시각 마커가 있으면 그게 이긴다. 둘 다 없으면 소요일이 안 나온다</em>
          </label>
          <div className="civic-row">
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                const json = await act({ action: 'resolution', id: c.id, text, at });
                if (!json) return;
                const p = json.parsed ?? {};
                onMsg(
                  text.trim()
                    ? [
                        p.department ? `부서 ${p.department}` : '⚠️ 담당 부서를 못 찾았다',
                        p.agency ? `회신 기관 ${p.agency}` : null,
                        p.resolvedAt ? `회신 ${new Date(p.resolvedAt).toLocaleDateString('ko-KR')}` : '⚠️ 회신 시각 없음',
                        p.dueAt
                          ? `⏳ ${new Date(p.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정 — 아직 안 끝났다`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : '해결 내용을 지웠다',
                );
                close();
                await after(null);
              }}
            >
              해결 내용 저장
            </button>
            <button className="btn ghost" onClick={close}>
              그만두기
            </button>
          </div>
        </div>
      )}

      {editing === 'body' && (
        <div className="rowbox">
          <p>
            글 본문을 붙여넣으면 접수·회신 시각(분 단위) · 담당 부서 · <code>…까지</code> 약속을
            그 자리에서 뽑는다. <b>카페 글을 열어 Ctrl+A → Ctrl+C</b> 하면 된다.
          </p>
          <textarea
            value={text}
            rows={7}
            autoFocus
            placeholder="글 본문을 통째로 붙여넣기"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="civic-row">
            <button
              className="btn primary"
              disabled={busy || !text.trim()}
              onClick={async () => {
                const json = await act({ action: 'body', id: c.id, body: text });
                if (!json) return;
                const p = json.parsed ?? {};
                onMsg(
                  [
                    p.receivedAt ? `접수 ${new Date(p.receivedAt).toLocaleString('ko-KR')}` : '접수 시각 못 찾음',
                    p.repliedAt ? `회신 ${new Date(p.repliedAt).toLocaleString('ko-KR')}` : '회신 시각 못 찾음',
                    p.department ? `부서 ${p.department}` : null,
                    p.dueAt
                      ? `⚠️ ${new Date(p.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정 — 아직 안 끝났다`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                );
                close();
                await after(null);
              }}
            >
              본문 저장
            </button>
            <button className="btn ghost" onClick={close}>
              그만두기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 카페 글 보관함 — 본문을 넣는 곳.
 *
 * ★ 네이버 카페는 `robots.txt` 가 모든 봇을 막아 **서버가 긁지 못한다.** 그래서 사람이
 *   글을 열어 복사해 넣는 것이 유일한 길이다. 막힌 것을 우회하지 않는 것이 이 앱의 규칙이다.
 *
 * ★ 저장이 먼저고 요약이 나중이다. 모델 호출이 실패해도 애써 복사한 본문은 남는다 —
 *   실패했다고 원문까지 버리면 카페에 다시 들어가 복사해 오라는 뜻이 된다.
 */
function CafeBox({
  posts,
  busy,
  act,
  reload,
  onMsg,
  onDone,
}: {
  posts: CafePost[];
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Record<string, any> | null>;
  reload: () => Promise<void>;
  onMsg: (m: string | null) => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  /*
   * 게시판 작성일. ★ 비워두면 접수·회신 시각이 통째로 빈다(본문에 시각 마커가 있는 글은
   * 드물다). 그러면 목록이 "담은 날" 로 줄을 서서 게시판과 차례가 어긋난다.
   * 여러 건을 이어 넣는 일이 많아 저장한 뒤에도 이 칸만 남겨둔다.
   */
  const [postedAt, setPostedAt] = useState('');
  const [body, setBody] = useState('');
  /*
   * 회신·처리 결과. 댓글일 수도, 본문 아래 덧붙은 답변일 수도, 담당자가 따로 알려온
   * 결론일 수도 있다. 본문 칸에 몰아 넣으면 모델이 한 건으로 뭉개서 민원이 통째로
   * 사라진다. 칸을 가르면 "본문=민원, 회신=처리 결과" 라는 구조를 사람이 알려주는
   * 셈이라 모델이 추측할 일이 없고, 그 둘이 그 자리에서 이어진다.
   */
  const [reply, setReply] = useState('');
  const [replyPostedAt, setReplyPostedAt] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const submit = async () => {
    onMsg('저장하고 요약하는 중… (수십 초 걸릴 수 있다)');
    const json = await act({ action: 'cafe-add', title, url, postedAt, body, reply, replyPostedAt });
    if (!json) {
      onMsg(null);
      return;
    }
    if (json.duplicate) {
      onMsg('이미 담아둔 글이다 — 같은 본문은 한 번만 들어간다');
      await reload();
      return;
    }
    setTitle('');
    setUrl('');
    setBody('');
    setReply('');   // 날짜 두 칸은 남긴다 — 같은 날 글을 여러 건 이어 넣는 일이 많다
    const s = json.summary as
      | { ok: boolean; drafted: number; added: number; linked: boolean; error: string | null }
      | null;
    if (s?.error) {
      // 본문은 저장됐다는 것을 분명히 말한다. 사람이 다시 복사하지 않아도 된다
      onMsg(`본문은 저장했지만 요약이 실패했다 — ${s.error}. 아래 [다시 요약] 으로 재시도할 수 있다`);
      await reload();
      return;
    }
    onMsg(
      `저장하고 ${s?.added ?? 0}건을 AI 초안으로 올렸다` +
        (s?.linked ? ' — 민원과 해결 결과를 이어 붙였다' : ''),
    );
    await reload();
    if ((s?.added ?? 0) > 0) onDone();
  };

  return (
    <>
      <div className="civic-panel">
        <p>
          <b>카페 글을 열어 본문을 통째로 복사해 넣으면</b> 모델이 요약해 <b>AI 초안</b> 으로 올린다.
          제목과 주소는 없어도 된다. <b>네이버 카페는 robots.txt 가 자동 수집을 막고 있어</b> 이 길이
          유일하다 — 사람이 보고 복사하는 것이라 정책과 부딪히지 않는다.
        </p>
        <input value={title} placeholder="제목 (없으면 비워둘 것)" onChange={(e) => setTitle(e.target.value)} />
        <input value={url} placeholder="주소 (없으면 비워둘 것)" onChange={(e) => setUrl(e.target.value)} />
        <label className="civic-field">
          <span>작성일</span>
          <input type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} />
          <em>게시판에 적힌 날짜. 비우면 접수·회신 시각이 빈 채로 담긴다</em>
        </label>
        <textarea
          value={body}
          rows={9}
          placeholder="글 본문을 통째로 붙여넣기 (Ctrl+A → Ctrl+C)"
          onChange={(e) => setBody(e.target.value)}
        />

        {/*
          ★ 회신은 본문 칸에 섞지 말 것. 섞으면 모델이 한 건으로 뭉개 민원이 사라진다.
            여기 넣으면 민원 한 건 + 해결 한 건이 되고 그 자리에서 이어진다.
        */}
        <p className="dim">
          이 민원이 <b>어떻게 처리됐는지</b>가 있으면 아래에 따로 넣을 것 — 정책관 댓글,
          본문 아래 덧붙은 답변, 담당자가 알려온 결론 어느 것이든 된다. 본문에 섞으면 한 건으로
          뭉개진다. 넣으면 <b>민원 + 해결</b> 로 갈라 담고 그 자리에서 이어 붙인다.
        </p>
        <textarea
          value={reply}
          rows={5}
          placeholder="회신 · 처리 결과 (없으면 비워둘 것)"
          onChange={(e) => setReply(e.target.value)}
        />
        {reply.trim() && (
          <label className="civic-field">
            <span>회신일</span>
            <input type="date" value={replyPostedAt} onChange={(e) => setReplyPostedAt(e.target.value)} />
            <em>작성일과의 차이가 곧 처리 소요일이다</em>
          </label>
        )}

        <div className="civic-row">
          <button className="btn primary" disabled={busy || body.trim().length < 20} onClick={() => void submit()}>
            저장하고 요약
          </button>
          <span className="dim">
            본문 {body.trim().length}자{reply.trim() && ` · 회신 ${reply.trim().length}자`}
          </span>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="empty">
          <b>아직 담아둔 카페 글이 없다</b>
          위 상자에 본문을 붙여넣으면 원문이 여기 남고, 요약은 <b>AI 초안</b> 으로 올라간다.
        </div>
      ) : (
        <ul className="civics">
          {posts.map((p) => (
            <li key={p.id}>
              <div className="cmeta">
                <span className="ctitle">
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer noopener">
                      {p.title || '(제목 없음)'}
                    </a>
                  ) : (
                    p.title || '(제목 없음)'
                  )}
                </span>
                <span className="csub">
                  {p.postedAt ? `작성 ${dayLabel(p.postedAt)}` : `담은 날 ${dayLabel(p.createdAt)} · ⚠️ 작성일 없음`}
                  {' · '}
                  {p.body.length}자{p.reply ? ` · 회신 ${p.reply.length}자` : ''}
                  {/* ★ 실패를 숨기지 않는다. 0건인 것과 안 돌아간 것은 겉보기가 같다 */}
                  {p.summarizedAt == null
                    ? ' · 아직 요약 안 함'
                    : p.ok
                      ? ` · 초안 ${p.drafted}건`
                      : ` · ⚠️ 요약 실패`}
                </span>
                {p.ok === false && p.error && <span className="cnote">⚠️ {p.error}</span>}
                <span className="cbody dim">
                  {openId === p.id ? p.body : `${p.body.slice(0, 200)}${p.body.length > 200 ? '…' : ''}`}
                </span>
              </div>
              <button className="btn ghost" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                {openId === p.id ? '접기' : '원문'}
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                title="같은 초안은 다시 만들지 않는다 — 사람이 확정해둔 것을 덮지 않는다"
                onClick={async () => {
                  onMsg('다시 요약하는 중…');
                  const json = await act({ action: 'cafe-summarize', id: p.id });
                  const s = json?.summary as { drafted: number; added: number; error: string | null } | undefined;
                  onMsg(s?.error ? `요약 실패 — ${s.error}` : `${s?.drafted ?? 0}건 뽑아 ${s?.added ?? 0}건 새로 담았다`);
                  await reload();
                }}
              >
                다시 요약
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm('이 카페 글 원문을 지울까? (이미 만들어진 민원 초안은 남는다)')) return;
                  await act({ action: 'cafe-delete', id: p.id });
                  await reload();
                }}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
