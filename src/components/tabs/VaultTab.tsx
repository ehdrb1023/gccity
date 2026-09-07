'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clockTime, dayLabel } from '@/lib/time';
import Empty, { Skeleton } from '@/components/ui/Empty';
import { Doc } from '@/components/ui/icons';
import { roomLabel, shortKey, type Room, type StoredFile } from '@/components/types';

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

/**
 * 자료실 — 카톡방별 문서 보관소.
 *
 * ★ 파일 바이트는 우리 서버를 지나가지 않는다. 서명 URL 을 받아 Storage 로 직접 올린다.
 *   Vercel 함수 본문 상한이 4.5MB 라 서버를 거치면 큰 PDF 가 전부 막힌다.
 */
export default function VaultTab({
  rooms,
  roomId,
  onPickRoom,
}: {
  rooms: Room[];
  roomId: string | null;
  onPickRoom: (id: string) => void;
}) {
  const [files, setFiles] = useState<StoredFile[] | null>(null);
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
      if (!json.ok) setErr(json.reason ?? '목록을 읽지 못했습니다');
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
            body: JSON.stringify({ action: 'confirm', roomId, path: sign.path, name: f.name, mime: f.type, size: f.size }),
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

  const act = useCallback(async (body: Record<string, unknown>) => {
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
  }, []);

  return (
    <section className="screen">
      <aside className="pane">
        <div className="pane-h">
          <h2>방</h2>
          <span className="n">방마다 따로 쌓입니다</span>
        </div>
        <div className="pane-b">
          {rooms.map((r) => (
            <button key={r.id} className="item" data-on={r.id === roomId} onClick={() => onPickRoom(r.id)}>
              <span className="t">{roomLabel(r) || shortKey(r.channelId)}</span>
            </button>
          ))}
        </div>
      </aside>

      <div className="main">
        <div className="wrap">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 18 }}>
            <div style={{ flex: 1 }}>
              <h2 className="pg">자료실</h2>
              <p className="pg" style={{ margin: 0 }}>카톡 사진은 만료되기 전에 여기로 옮겨둡니다.</p>
            </div>
            <button className="btn pri" disabled={!roomId} onClick={() => picker.current?.click()}>
              파일 올리기
            </button>
          </div>

          {err && <p className="note bad">{err}</p>}

          {rooms.length === 0 ? (
            <Empty
              icon={<Doc />}
              title="따라가는 방이 없습니다"
              desc="방 찾기 탭에서 방을 등록하면 그 방의 자료실이 생깁니다."
            />
          ) : (
            <>
              <div
                className="drop"
                data-on={drag}
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

              {files === null ? (
                <Skeleton rows={3} />
              ) : files.length === 0 ? (
                <Empty
                  icon={<Doc />}
                  title="아직 넣어둔 자료가 없습니다"
                  desc="카톡방에서 받은 문서를 여기에 모아두면 대화와 같은 자리에서 찾을 수 있습니다."
                />
              ) : (
                <div className="tbl">
                  <table>
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>메모</th>
                        <th>크기</th>
                        <th>올린 날</th>
                        <th style={{ width: '1%' }} />
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f) => (
                        <tr key={f.id}>
                          <td className="k">
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <span className="fkind">{fileKind(f)}</span>
                              {f.name}
                            </span>
                          </td>
                          <td className={f.note ? '' : 'dim'}>{f.note || '메모 없음'}</td>
                          <td>{humanSize(f.sizeBytes)}</td>
                          <td>
                            {dayLabel(f.createdAt)} {clockTime(f.createdAt)}
                          </td>
                          <td>
                            <span style={{ display: 'flex', gap: 4 }}>
                              <button
                                className="btn sm line"
                                onClick={async () => {
                                  const r = await act({ action: 'download', id: f.id });
                                  if (r?.url) window.open(r.url, '_blank', 'noopener');
                                }}
                              >
                                받기
                              </button>
                              <button
                                className="btn sm line"
                                onClick={async () => {
                                  const note = window.prompt('메모 (비우면 지웁니다)', f.note ?? '');
                                  if (note === null) return;
                                  await act({ action: 'note', id: f.id, note });
                                  await reload(roomId);
                                }}
                              >
                                메모
                              </button>
                              <button
                                className="btn sm line danger"
                                onClick={async () => {
                                  if (!window.confirm(`"${f.name}" 을 지울까요? 되돌릴 수 없습니다.`)) return;
                                  await act({ action: 'delete', id: f.id });
                                  await reload(roomId);
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
            </>
          )}
        </div>
      </div>
    </section>
  );
}
