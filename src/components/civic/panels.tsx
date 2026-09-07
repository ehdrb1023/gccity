'use client';

import { useState } from 'react';
import { relTime } from '@/lib/time';
import { AUTHOR_KIND, type Act, type CivicAuthor, type Complaint, type CrawlSource } from '@/components/types';

/* ── 카페 목록 붙여넣기 ──────────────────────────────────────────────────── */

export function PastePanel({ busy, act, onDone }: { busy: boolean; act: Act; onDone: (m: string) => void }) {
  const [board, setBoard] = useState('');
  const [text, setText] = useState('');

  return (
    <>
      <p>
        게시판 <b>목록</b>을 통째로 복사해 붙여넣으면 한 줄이 한 건이 됩니다. 댓글 수 <code>[3]</code> ·
        새 글 배지 <code>N</code> · 아이콘은 알아서 뗍니다. 글 <b>본문</b>을 요약해 담으려면 왼쪽{' '}
        <b>카페 글</b> 보드를 쓰세요.
      </p>
      <label className="lbl" htmlFor="pb">출처 이름</label>
      <input className="inp" id="pb" value={board} placeholder="예: 과천 카페 자유게시판" onChange={(e) => setBoard(e.target.value)} />
      <label className="lbl" htmlFor="pt" style={{ marginTop: 14 }}>목록</label>
      <textarea
        className="inp"
        id="pt"
        rows={12}
        value={text}
        placeholder={'제목이 한 줄씩 있는 형태 그대로 붙여넣으면 됩니다\n갈현삼거리 횡단보도 바꿔주세요. [3] N'}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="note" style={{ marginTop: 12 }}>
        붙여넣은 글은 초안으로 쌓입니다. 확정하기 전까지 목록과 준수율에 들어가지 않습니다.
      </p>
      <div className="acts">
        <button
          className="btn pri"
          disabled={busy || !text.trim()}
          onClick={async () => {
            const json = await act({ action: 'paste', text, board });
            if (!json) return;
            setText('');
            onDone(`${json.parsed}줄에서 ${json.added}건 담았습니다 (이미 있던 것 ${json.skipped}건)`);
          }}
        >
          파싱해서 초안으로
        </button>
      </div>
    </>
  );
}

/* ── 민원 직접 적기 ──────────────────────────────────────────────────────── */

export function ManualPanel({ busy, act, onDone }: { busy: boolean; act: Act; onDone: (m: string) => void }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  return (
    <>
      <p>게시판에도 카톡에도 없는 민원을 직접 넣습니다. 넣으면 바로 민원 목록에 섭니다.</p>
      <label className="lbl" htmlFor="mt">제목</label>
      <input className="inp" id="mt" value={title} placeholder="어디의 무엇이 문제인지 한 줄로" onChange={(e) => setTitle(e.target.value)} />
      <label className="lbl" htmlFor="mu" style={{ marginTop: 14 }}>링크</label>
      <input className="inp" id="mu" value={url} placeholder="없으면 비워두세요" onChange={(e) => setUrl(e.target.value)} />
      <p className="note" style={{ marginTop: 12 }}>
        본문·접수일·부서는 담은 뒤 그 줄을 펼쳐서 넣습니다. 접수일이 있어야 1·3·7 시계가 돕니다.
      </p>
      <div className="acts">
        <button
          className="btn pri"
          disabled={busy || !title.trim()}
          onClick={async () => {
            const json = await act({ action: 'manual', title, url });
            if (!json) return;
            setTitle('');
            setUrl('');
            onDone('한 건 담았습니다');
          }}
        >
          민원 목록에 넣기
        </button>
      </div>
    </>
  );
}

/* ── 1·3·7 단계 기록 ─────────────────────────────────────────────────────── */

/**
 * 배정·출동 시각을 손으로 적는다.
 *
 * ★ 모델이 채우지 않는다. 시청이 언제 무엇을 했는지는 사실 주장이고, 추측으로 채우면
 *   준수율이 조용히 거짓이 된다. 답변 시각은 [해결 내용] 에서 이미 들어오므로 여기 없다.
 */
export function StagePanel({
  c,
  busy,
  act,
  onDone,
}: {
  c: Complaint;
  busy: boolean;
  act: Act;
  onDone: (m: string) => void;
}) {
  const cut = (iso: string | null) => (iso ? iso.slice(0, 16) : '');
  const [assign, setAssign] = useState(cut(c.assignedAt));
  const [visit, setVisit] = useState(cut(c.visitedAt));

  return (
    <>
      <p>
        <b>{c.title}</b>
      </p>
      <p className="note">
        접수 시각은 {c.reportedAt ? new Date(c.reportedAt).toLocaleString('ko-KR') : '아직 없습니다'}.
        {c.reportedAt
          ? ' 아래 두 시각까지의 간격으로 1·3·7 준수를 셉니다.'
          : ' 접수 시각이 없으면 단계를 재도 준수율에 들어가지 않습니다 — 줄을 펼쳐 [본문] 이나 [해결 내용] 으로 먼저 채우세요.'}
      </p>

      <label className="lbl" htmlFor="sa">1 · 배정 — 담당 부서가 정해진 시각 (한도 12시간)</label>
      <input className="inp" id="sa" type="datetime-local" value={assign} onChange={(e) => setAssign(e.target.value)} />

      <label className="lbl" htmlFor="sv" style={{ marginTop: 14 }}>
        3 · 출동 — 현장을 확인한 시각 (한도 36시간)
      </label>
      <input className="inp" id="sv" type="datetime-local" value={visit} onChange={(e) => setVisit(e.target.value)} />

      <p className="note" style={{ marginTop: 12 }}>
        7 · 답변 시각은 여기서 넣지 않습니다 — 줄을 펼쳐 <b>[해결 내용]</b> 에 회신문을 넣으면 거기서
        나옵니다. 칸을 비워 저장하면 그 단계 기록이 지워집니다.
      </p>

      <div className="acts">
        <button
          className="btn pri"
          disabled={busy}
          onClick={async () => {
            const a = await act({ action: 'stage', id: c.id, stage: 'assign', at: assign });
            if (!a) return;
            const v = await act({ action: 'stage', id: c.id, stage: 'visit', at: visit });
            if (!v) return;
            onDone('단계 시각을 기록했습니다');
          }}
        >
          단계 저장
        </button>
      </div>
    </>
  );
}

/* ── 크롤 소스 ───────────────────────────────────────────────────────────── */

export function SourcesPanel({
  sources,
  busy,
  act,
  reload,
  onCrawl,
}: {
  sources: CrawlSource[];
  busy: boolean;
  act: Act;
  reload: () => Promise<void>;
  onCrawl: (id?: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [keywords, setKeywords] = useState('');
  const [linkPattern, setLinkPattern] = useState('');

  return (
    <>
      <p>
        <b>robots.txt 가 허용하는 게시판·RSS 만 긁습니다.</b> 막힌 곳(네이버 카페 등)은 등록할 때
        거부하고 사유를 알려줍니다. 자동 수집은 하루 한 번이고, 급하면 [긁기] 를 누릅니다.
      </p>

      <label className="lbl" htmlFor="sn">이름</label>
      <input className="inp" id="sn" value={name} placeholder="예: 과천시청 시민의소리" onChange={(e) => setName(e.target.value)} />
      <label className="lbl" htmlFor="su" style={{ marginTop: 14 }}>목록·RSS 주소</label>
      <input className="inp mono" id="su" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
      <label className="lbl" htmlFor="sk" style={{ marginTop: 14 }}>제목 낱말 거르기</label>
      <input className="inp" id="sk" value={keywords} placeholder="쉼표로. 비우면 전부 · 예: 민원,청원,요청" onChange={(e) => setKeywords(e.target.value)} />
      <label className="lbl" htmlFor="sl" style={{ marginTop: 14 }}>글 링크 패턴</label>
      <input className="inp mono" id="sl" value={linkPattern} placeholder="정규식. 비우면 자동 · 예: nttId=" onChange={(e) => setLinkPattern(e.target.value)} />

      <div className="acts">
        <button
          className="btn pri"
          disabled={busy || !url.trim()}
          onClick={async () => {
            const json = await act({ action: 'source-add', name, url, keywords, linkPattern });
            if (!json) return;
            setName(''); setUrl(''); setKeywords(''); setLinkPattern('');
            await reload();
          }}
        >
          출처 등록
        </button>
      </div>

      <h5 style={{ margin: '22px 0 8px', fontSize: 'var(--fs-sm)' }}>등록된 출처 {sources.length}곳</h5>
      {sources.length === 0 ? (
        <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
          아직 없습니다. RSS 주소가 있으면 그쪽이 가장 안 깨집니다.
        </p>
      ) : (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>게시판</th>
                <th>마지막 실행</th>
                <th style={{ width: '1%' }} />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td className="k">
                    {s.name} {!s.enabled && <span className="bg gry">꺼짐</span>}
                    <div className="dim mono" style={{ fontWeight: 400, fontSize: 'var(--fs-xs)' }}>{s.url}</div>
                    {s.keywords && <div className="dim" style={{ fontWeight: 400, fontSize: 'var(--fs-xs)' }}>낱말: {s.keywords}</div>}
                  </td>
                  {/* ★ 실패를 숨기지 않는다. 0건이 계속 나오는 출처는 패턴이 안 맞는 것이지 조용한 게시판이 아니다 */}
                  <td className={s.lastOk === false ? 'dim' : ''}>
                    {s.lastRunAt == null
                      ? '아직 안 긁었습니다'
                      : s.lastOk
                        ? `${relTime(s.lastRunAt)} · ${s.lastCount}건 중 ${s.lastNew}건 새로`
                        : `${relTime(s.lastRunAt)} · 실패 — ${s.lastError}`}
                  </td>
                  <td>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button className="btn sm line" disabled={busy} onClick={() => void onCrawl(s.id)}>긁기</button>
                      <button
                        className="btn sm line"
                        disabled={busy}
                        onClick={async () => {
                          await act({ action: 'source-edit', id: s.id, patch: { enabled: !s.enabled } });
                          await reload();
                        }}
                      >
                        {s.enabled ? '끄기' : '켜기'}
                      </button>
                      <button
                        className="btn sm line danger"
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`"${s.name}" 출처를 지울까요? 담아둔 민원은 남습니다.`)) return;
                          await act({ action: 'source-delete', id: s.id });
                          await reload();
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
  );
}

/* ── 작성자 등록부 ───────────────────────────────────────────────────────── */

/**
 * ★ 작성자만으로는 안 갈린다. 정책관 한 계정이 민원 회신과 보도자료를 함께 쓴다.
 *   명부는 기본값을 주고, 제목이 `날짜 + …민원` 꼴이면 기관 계정 글이라도 처리 기록으로 살린다.
 */
export function AuthorsPanel({
  authors,
  busy,
  act,
  reload,
  onMsg,
}: {
  authors: CivicAuthor[];
  busy: boolean;
  act: Act;
  reload: () => Promise<void>;
  onMsg: (m: string) => void;
}) {
  return (
    <>
      <p>
        여기 등록된 사람이 쓴 글은 그 종류로 먼저 봅니다. 다만 제목이{' '}
        <code>2026년 8월 20일(목) … 민원</code> 꼴이면 기관 계정 글이라도 <b>처리 기록</b>으로 살립니다 —
        정책관 계정 하나가 민원 회신과 보도자료를 함께 쓰기 때문입니다.
      </p>
      <div className="acts" style={{ marginTop: 0, marginBottom: 16 }}>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            const out = await act({ action: 'reclassify' });
            if (out) onMsg(`${out.scanned}건 중 ${out.changed}건 다시 갈랐습니다 (손으로 고친 행은 그대로)`);
            await reload();
          }}
        >
          지난 글 다시 가르기
        </button>
      </div>

      {authors.length === 0 ? (
        <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
          아직 작성자가 없습니다. 목록을 담으면 여기 이름이 모입니다.
        </p>
      ) : (
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>작성자</th>
                <th>글</th>
                <th style={{ width: '1%' }}>기본 종류</th>
              </tr>
            </thead>
            <tbody>
              {authors.map((a) => (
                <tr key={a.name}>
                  <td className="k">
                    {a.name}
                    {a.note && <div className="dim" style={{ fontWeight: 400, fontSize: 'var(--fs-xs)' }}>{a.note}</div>}
                  </td>
                  <td>{a.count ?? 0}건</td>
                  <td>
                    <span className="seg">
                      {AUTHOR_KIND.map((k) => (
                        <button
                          key={k.key}
                          data-on={a.kind === k.key}
                          disabled={busy}
                          onClick={async () => {
                            await act({ action: 'author-kind', name: a.name, kind: k.key });
                            await reload();
                          }}
                        >
                          {k.label}
                        </button>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
