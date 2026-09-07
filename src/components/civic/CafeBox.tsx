'use client';

import { useState } from 'react';
import { dayLabel } from '@/lib/time';
import Empty from '@/components/ui/Empty';
import { Doc } from '@/components/ui/icons';
import type { Act, CafePost } from '@/components/types';

/**
 * 카페 글 보관함 — 본문을 넣는 곳.
 *
 * ★ 네이버 카페는 `robots.txt` 가 모든 봇을 막아 **서버가 긁지 못한다.** 사람이 글을 열어
 *   복사해 넣는 것이 유일한 길이다. 막힌 것을 우회하지 않는 것이 이 앱의 규칙이다.
 *
 * ★ 저장이 먼저고 요약이 나중이다. 모델 호출이 실패해도 애써 복사한 본문은 남는다.
 */
export default function CafeBox({
  posts,
  busy,
  act,
  reload,
  onMsg,
  onDone,
}: {
  posts: CafePost[];
  busy: boolean;
  act: Act;
  reload: () => Promise<void>;
  onMsg: (m: string | null) => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  /* 게시판 작성일. 비워두면 접수·회신 시각이 통째로 빈다 — 목록이 담은 날로 줄을 서서 게시판과 어긋난다 */
  const [postedAt, setPostedAt] = useState('');
  const [body, setBody] = useState('');
  /* 회신을 본문 칸에 몰아 넣으면 모델이 한 건으로 뭉개서 민원이 통째로 사라진다. 칸을 가른다 */
  const [reply, setReply] = useState('');
  const [replyPostedAt, setReplyPostedAt] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState(false);

  const submit = async () => {
    onMsg('저장하고 요약하는 중… (수십 초 걸릴 수 있습니다)');
    const json = await act({ action: 'cafe-add', title, url, postedAt, body, reply, replyPostedAt });
    if (!json) {
      onMsg(null);
      return;
    }
    if (json.duplicate) {
      onMsg('이미 담아둔 글입니다 — 같은 본문은 한 번만 들어갑니다');
      await reload();
      return;
    }
    setTitle('');
    setUrl('');
    setBody('');
    setReply('');   // 날짜 두 칸은 남긴다 — 같은 날 글을 여러 건 이어 넣는 일이 많다
    const s = json.summary as { ok: boolean; drafted: number; added: number; linked: boolean; error: string | null } | null;
    if (s?.error) {
      // 본문은 저장됐다는 것을 분명히 말한다. 사람이 다시 복사하지 않아도 된다
      onMsg(`본문은 저장했지만 요약이 실패했습니다 — ${s.error}. 아래 [다시 요약] 으로 재시도할 수 있습니다`);
      await reload();
      return;
    }
    onMsg(`저장하고 ${s?.added ?? 0}건을 초안으로 올렸습니다${s?.linked ? ' — 민원과 해결 결과를 이어 붙였습니다' : ''}`);
    await reload();
    if ((s?.added ?? 0) > 0) onDone();
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h2 className="pg">카페 글</h2>
          <p className="pg" style={{ margin: 0 }}>
            붙여넣은 원문을 그대로 보관합니다. 요약은 붙여넣을 때 한 번 만듭니다.
          </p>
        </div>
        <button className="btn pri" onClick={() => setForm(!form)}>
          {form ? '넣기 접기' : '카페 글 넣기'}
        </button>
      </div>

      {form && (
        <div className="card">
          <p>
            카페 글을 열어 본문을 통째로 복사해 넣으면 모델이 요약해 <b>초안</b>으로 올립니다.
            제목과 주소는 없어도 됩니다. 네이버 카페는 robots.txt 가 자동 수집을 막고 있어 이 길이
            유일합니다 — 사람이 보고 복사하는 것이라 정책과 부딪히지 않습니다.
          </p>
          <input className="inp" value={title} placeholder="제목 (없으면 비워두세요)" onChange={(e) => setTitle(e.target.value)} />
          <input className="inp" value={url} placeholder="주소 (없으면 비워두세요)" style={{ marginTop: 10 }} onChange={(e) => setUrl(e.target.value)} />
          <label className="field">
            <span>작성일</span>
            <input className="inp sm" type="date" value={postedAt} onChange={(e) => setPostedAt(e.target.value)} />
            <em>게시판에 적힌 날짜. 비우면 접수·회신 시각이 빈 채로 담깁니다</em>
          </label>
          <textarea
            className="inp"
            value={body}
            rows={9}
            placeholder="글 본문을 통째로 붙여넣기 (Ctrl+A → Ctrl+C)"
            onChange={(e) => setBody(e.target.value)}
          />
          <p className="note" style={{ marginTop: 12 }}>
            이 민원이 <b>어떻게 처리됐는지</b>가 있으면 아래에 따로 넣으세요 — 정책관 댓글, 본문 아래
            덧붙은 답변, 담당자가 알려온 결론 어느 것이든 됩니다. 본문에 섞으면 한 건으로 뭉개집니다.
          </p>
          <textarea
            className="inp"
            value={reply}
            rows={5}
            placeholder="회신 · 처리 결과 (없으면 비워두세요)"
            onChange={(e) => setReply(e.target.value)}
          />
          {reply.trim() && (
            <label className="field">
              <span>회신일</span>
              <input className="inp sm" type="date" value={replyPostedAt} onChange={(e) => setReplyPostedAt(e.target.value)} />
              <em>작성일과의 차이가 곧 처리 소요일입니다</em>
            </label>
          )}
          <div className="acts">
            <button className="btn pri" disabled={busy || body.trim().length < 20} onClick={() => void submit()}>
              저장하고 요약
            </button>
            <span className="dim" style={{ alignSelf: 'center', fontSize: 'var(--fs-sm)' }}>
              본문 {body.trim().length}자{reply.trim() && ` · 회신 ${reply.trim().length}자`}
            </span>
          </div>
        </div>
      )}

      {posts.length === 0 ? (
        <Empty
          icon={<Doc />}
          title="아직 담아둔 카페 글이 없습니다"
          desc="본문을 붙여넣으면 원문이 여기 남고, 요약은 초안으로 올라갑니다."
          action={
            <button className="btn pri sm" onClick={() => setForm(true)}>
              카페 글 넣기
            </button>
          }
        />
      ) : (
        <div className="rows">
          {posts.map((p) => (
            <div className="rw" key={p.id} data-open={openId === p.id}>
              <button className="rw-h" onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                {/* ★ 실패를 숨기지 않는다. 0건인 것과 안 돌아간 것은 겉보기가 같다 */}
                <span className={`bg ${p.summarizedAt == null ? 'gry' : p.ok ? 'grn' : 'red'}`}>
                  {p.summarizedAt == null ? '요약 전' : p.ok ? `초안 ${p.drafted}` : '요약 실패'}
                </span>
                <span className="col">
                  <span className="ttl">{p.title || '(제목 없음)'}</span>
                  <span className="met">
                    <span>{p.postedAt ? `작성 ${dayLabel(p.postedAt)}` : `담은 날 ${dayLabel(p.createdAt)} · 작성일 없음`}</span>
                    <span>{p.body.length}자{p.reply ? ` · 회신 ${p.reply.length}자` : ''}</span>
                  </span>
                </span>
              </button>
              {openId === p.id && (
                <div className="rw-b">
                  {p.ok === false && p.error && <p className="note bad">{p.error}</p>}
                  <div className="body-txt">{p.body}</div>
                  {p.reply && (
                    <div className="part">
                      <h5>회신</h5>
                      <div className="body-txt">{p.reply}</div>
                    </div>
                  )}
                  <div className="acts">
                    {p.url && (
                      <a className="btn sm line" href={p.url} target="_blank" rel="noreferrer noopener">
                        원글 열기
                      </a>
                    )}
                    <button
                      className="btn sm line"
                      disabled={busy}
                      title="같은 초안은 다시 만들지 않습니다 — 사람이 확정해둔 것을 덮지 않습니다"
                      onClick={async () => {
                        onMsg('다시 요약하는 중…');
                        const json = await act({ action: 'cafe-summarize', id: p.id });
                        const s = json?.summary as { drafted: number; added: number; error: string | null } | undefined;
                        onMsg(s?.error ? `요약 실패 — ${s.error}` : `${s?.drafted ?? 0}건 뽑아 ${s?.added ?? 0}건 새로 담았습니다`);
                        await reload();
                      }}
                    >
                      다시 요약
                    </button>
                    <button
                      className="btn sm line danger"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm('이 카페 글 원문을 지울까요? (이미 만들어진 초안은 남습니다)')) return;
                        await act({ action: 'cafe-delete', id: p.id });
                        await reload();
                      }}
                    >
                      지우기
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
