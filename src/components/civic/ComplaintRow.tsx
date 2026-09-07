'use client';

import { useState } from 'react';
import { dayLabel } from '@/lib/time';
import { Check, Chevron } from '@/components/ui/icons';
import { SlaChips } from './StdBand';
import {
  CIVIC_STATUS,
  KIND,
  KIND_LABEL,
  ORIGIN_LABEL,
  ORIGIN_TAG,
  statusOf,
  type Act,
  type Complaint,
} from '@/components/types';

export type RowShared = {
  busy: boolean;
  now: number;
  act: Act;
  after: (json: Record<string, any> | null, note?: string) => Promise<void>;
  linking: Complaint | null;
  setLinking: (c: Complaint | null) => void;
  onMsg: (m: string | null) => void;
  onStage: (c: Complaint) => void;
};

/** "8/7 → 8/11 · 4일" — 접수에서 회신까지. 없으면 빈 문자열이다. */
function leadLabel(reportedAt: string | null, resolvedAt: string | null): string {
  if (!reportedAt) return '';
  const md = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  if (!resolvedAt) return `접수 ${md(reportedAt)}`;
  const days = Math.floor((Date.parse(resolvedAt) - Date.parse(reportedAt)) / 86_400_000);
  if (days < 0) return `접수 ${md(reportedAt)} · 회신이 더 이릅니다`;
  return `접수 ${md(reportedAt)} → 회신 ${md(resolvedAt)} · ${days === 0 ? '당일' : days + '일'}`;
}

/**
 * 목록의 한 줄. 접혀 있을 때는 상태·제목·메타·1·3·7 칩만 보이고, 누르면 그 자리에서 펼쳐진다.
 *
 * ★ 민원 목록과 초안 보드가 **같은 줄 모양**을 쓴다. 초안에서만 다른 것은 배지와
 *   [확정] 버튼 둘뿐이어야 한다 — 그래야 확정이 무엇을 바꾸는지 사람이 예측한다.
 */
export default function ComplaintRow({
  c,
  fix,
  open,
  onToggle,
  ...rest
}: { c: Complaint; fix?: Complaint; open: boolean; onToggle: () => void } & RowShared) {
  const st = c.aiDraft ? { label: '초안', tone: 'gry' } : statusOf(c);
  const dept = c.department ?? fix?.department;
  const agency = c.agency ?? fix?.agency;

  return (
    <div className="rw" data-open={open}>
      <button className="rw-h" onClick={onToggle} aria-expanded={open}>
        <span className={`bg ${st.tone}`}>{st.label}</span>
        <span className="col">
          <span className="ttl">{c.title}</span>
          <span className="met">
            <span>{KIND_LABEL[c.kind]}</span>
            <span>{ORIGIN_TAG[c.origin]}</span>
            <span>{dayLabel(c.reportedAt ?? c.postedAt ?? c.createdAt)} 접수</span>
            {dept ? <span>{dept}</span> : agency ? <span>외부 · {agency}</span> : c.kind === 'report' ? <span>배분 전</span> : null}
            {c.author && <span>{c.author}</span>}
          </span>
          {/* 1·3·7 은 민원에만 뜻이 있다. 처리 글·공지·초안에는 붙이지 않는다 */}
          {!c.aiDraft && c.kind === 'report' && <SlaChips c={c} now={rest.now} />}
        </span>
        <Chevron />
      </button>

      {open && (
        <div className="rw-b">
          <Detail c={c} {...rest} />
          {fix && <LinkedFix c={c} fix={fix} {...rest} />}
        </div>
      )}
    </div>
  );
}

/** 이어둔 처리 글. 열을 못 채운 옛 짝만 통째로 펼치고, 채워졌으면 한 줄로 줄인다 */
function LinkedFix({ c, fix, busy, act, after }: { c: Complaint; fix: Complaint } & RowShared) {
  if (c.resolutionText) {
    return (
      <div className="acts" style={{ marginTop: 10 }}>
        <span className="dim" style={{ alignSelf: 'center', fontSize: 'var(--fs-sm)' }}>
          이어둔 처리 글 · {fix.title.slice(0, 40)}
        </span>
        <button className="btn sm line" disabled={busy} onClick={async () => { await after(await act({ action: 'unlink', id: fix.id })); }}>
          잇기 해제
        </button>
      </div>
    );
  }
  return (
    <div className="res">
      <div className="rh">
        <Check />
        이어둔 처리 글 · {dayLabel(fix.postedAt ?? fix.createdAt)}
      </div>
      <div style={{ fontWeight: 600, marginTop: 6 }}>{fix.title}</div>
      <dl>
        {fix.department && (<><dt>담당부서</dt><dd>{fix.department}</dd></>)}
        {fix.agency && (<><dt>기관</dt><dd>{fix.agency}</dd></>)}
        {fix.resolvedAt && (<><dt>처리일</dt><dd>{dayLabel(fix.resolvedAt)}</dd></>)}
      </dl>
    </div>
  );
}

/**
 * 민원 한 건의 속살.
 *
 * ★ 글 상자는 **그 줄 안에서** 연다. 화면 맨 위 한 자리에서 열면 목록 아래쪽 민원에서
 *   눌렀을 때 상자가 스크롤 밖에 뜨고 화면은 아무 반응이 없어 보인다.
 */
function Detail({ c, busy, now, act, after, linking, setLinking, onMsg, onStage }: { c: Complaint } & RowShared) {
  const [editing, setEditing] = useState<'none' | 'fix' | 'body'>('none');
  const [text, setText] = useState('');
  const [at, setAt] = useState('');
  const close = () => {
    setEditing('none');
    setText('');
  };

  const lead = leadLabel(c.reportedAt, c.resolvedAt);

  return (
    <>
      <div className="acts" style={{ marginTop: 0, marginBottom: 12 }}>
        <select
          className="inp sm"
          style={{ width: 'auto' }}
          value={c.kind}
          disabled={busy}
          title={c.kindLocked ? '손으로 정한 종류입니다 (재분류가 덮지 않습니다)' : '규칙이 정한 종류입니다'}
          aria-label="종류"
          onChange={async (e) => { await after(await act({ action: 'kind', id: c.id, kind: e.target.value })); }}
        >
          {KIND.map((k) => (<option key={k.key} value={k.key}>{k.label}</option>))}
        </select>
        <select
          className="inp sm"
          style={{ width: 'auto' }}
          value={c.status}
          disabled={busy}
          aria-label="상태"
          onChange={async (e) => { await after(await act({ action: 'status', id: c.id, status: e.target.value })); }}
        >
          {CIVIC_STATUS.map((s) => (<option key={s.key} value={s.key}>{s.label}</option>))}
        </select>
        <span className="dim" style={{ alignSelf: 'center', fontSize: 'var(--fs-sm)' }}>
          {c.board ?? ORIGIN_LABEL[c.origin]}
          {` · ${dayLabel(c.postedAt ?? c.createdAt)}`}
          {c.postedAt ? '' : ' (담은 날)'}
          {c.category && ` · #${c.category}`}
        </span>
        {c.url && (
          <a className="btn sm line" href={c.url} target="_blank" rel="noreferrer noopener">
            원글 열기
          </a>
        )}
      </div>

      {(lead || c.department || c.agency || c.dueAt) && (
        <p className="note" style={{ marginBottom: 12 }}>
          {[
            lead,
            c.department && `배분 ${c.department}`,
            c.agency && `회신 ${c.agency}`,
            c.dueAt && `${new Date(c.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정`,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      {c.summary && (
        <div className="part">
          <h5>요약{c.aiDraft && <span className="dim"> · 모델이 줄인 것</span>}</h5>
          <div className="body-txt">{c.summary}</div>
        </div>
      )}
      {c.body && (
        <div className="part">
          <h5>원문{c.origin === 'chat' && <span className="dim"> · 카톡 그대로</span>}</h5>
          <div className="body-txt">{c.body}</div>
        </div>
      )}
      {c.resolutionText && (
        <div className="part">
          <h5>해결 내용{c.resolvedAt && <span className="dim"> · {dayLabel(c.resolvedAt)}</span>}</h5>
          {c.resolutionSummary && <div className="body-txt">{c.resolutionSummary}</div>}
          <div className="body-txt dim">{c.resolutionText}</div>
        </div>
      )}
      {/* 왜 이걸 민원으로 봤는지. 확정할지 지울지 판단하는 근거다 */}
      {c.aiDraft && c.aiNote && <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>{c.aiNote}</p>}
      {c.note && <p className="note" style={{ marginTop: 12, marginBottom: 0 }}>메모 · {c.note}</p>}

      <div className="acts">
        {c.aiDraft && (
          <button
            className="btn pri sm"
            disabled={busy}
            title={c.aiNote ?? '확정하면 민원 목록으로 갑니다'}
            onClick={async () => { await after(await act({ action: 'confirm', id: c.id }), '민원 목록으로 옮겼습니다'); }}
          >
            목록으로 확정
          </button>
        )}

        {/* 1·3·7 은 사람이 확인한 것만 들어간다. 모델이 채우지 않는다 */}
        {!c.aiDraft && c.kind === 'report' && (
          <button className="btn sm line" disabled={busy} onClick={() => onStage(c)}>
            단계 기록
          </button>
        )}

        {c.kind === 'resolution' &&
          (c.resolutionOf ? (
            <button className="btn sm line" disabled={busy} onClick={async () => { await after(await act({ action: 'unlink', id: c.id })); }}>
              잇기 해제
            </button>
          ) : (
            <button className="btn sm line" disabled={busy} onClick={() => setLinking(linking?.id === c.id ? null : c)}>
              {linking?.id === c.id ? '고르는 중' : '민원에 잇기'}
            </button>
          ))}

        {linking && c.kind === 'report' && c.id !== linking.id && (
          <button
            className="btn pri sm"
            disabled={busy}
            onClick={async () => {
              await after(await act({ action: 'link', resolutionId: linking.id, reportId: c.id }), '민원과 처리를 이었습니다');
              setLinking(null);
            }}
          >
            여기에 잇기
          </button>
        )}

        {/* ★ 부서가 정해지는 유일한 자리다. 처리 글 자신에게는 뜻이 없어 민원에만 붙인다 */}
        {c.kind !== 'resolution' && (
          <button
            className={c.resolutionText ? 'btn sm' : 'btn sm line'}
            disabled={busy}
            title="이 민원이 어떻게 처리됐는지 적습니다 — 부서·기관·예정일을 그 글에서 뽑습니다"
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
          className="btn sm line"
          disabled={busy}
          title="글 본문을 붙여넣어 시각·부서·예정일을 뽑습니다"
          onClick={() => {
            if (editing === 'body') return close();
            setEditing('body');
            setText(c.body ?? '');
          }}
        >
          본문{c.body ? ' ✓' : ''}
        </button>
        <button
          className="btn sm line"
          disabled={busy}
          onClick={async () => {
            const note = window.prompt('메모 (비우면 지웁니다)', c.note ?? '');
            if (note === null) return;
            await after(await act({ action: 'edit', id: c.id, note }));
          }}
        >
          메모
        </button>
        <button
          className="btn sm line"
          disabled={busy}
          onClick={async () => {
            const category = window.prompt('분류 (도로·환경·교통… 비우면 지웁니다)', c.category ?? '');
            if (category === null) return;
            await after(await act({ action: 'edit', id: c.id, category }));
          }}
        >
          분류
        </button>
        {/* 규칙이 못 읽었거나 잘못 읽었을 때 손으로 고칠 길을 반드시 둔다 */}
        {c.kind !== 'resolution' && (
          <button
            className="btn sm line"
            disabled={busy}
            onClick={async () => {
              const department = window.prompt('배분 부서 — 시청 안에서 맡은 곳 (비우면 지웁니다)', c.department ?? '');
              if (department === null) return;
              const agency = window.prompt('회신 기관 — 시청 밖에서 답한 곳. 없으면 비워두세요', c.agency ?? '');
              if (agency === null) return;
              await after(await act({ action: 'edit', id: c.id, department, agency }), '부서를 고쳤습니다');
            }}
          >
            부서
          </button>
        )}
        <button
          className="btn sm line danger"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`"${c.title.slice(0, 40)}" 을 목록에서 지울까요?`)) return;
            await after(await act({ action: 'delete', id: c.id }));
          }}
        >
          지우기
        </button>
      </div>

      {editing === 'fix' && (
        <div className="rowbox">
          <p>
            이 민원이 <b>어떻게 처리됐는지</b> 적습니다. 담당자 회신문을 그대로 붙여넣으면 담당 부서 ·
            회신 기관 · 완료 예정일 · 회신 시각을 그 자리에서 뽑습니다. 비워서 저장하면 해결 내용과
            거기서 나온 값이 함께 지워지고 진행으로 돌아갑니다.
          </p>
          <textarea
            className="inp"
            value={text}
            rows={6}
            autoFocus
            placeholder="담당자 회신문을 그대로 붙여넣기"
            onChange={(e) => setText(e.target.value)}
          />
          <label className="field">
            <span>회신일</span>
            <input className="inp sm" type="date" value={at} onChange={(e) => setAt(e.target.value)} />
            <em>본문에 시각 마커가 있으면 그게 이깁니다. 둘 다 없으면 소요일이 안 나옵니다</em>
          </label>
          <div className="acts">
            <button
              className="btn pri sm"
              disabled={busy}
              onClick={async () => {
                const json = await act({ action: 'resolution', id: c.id, text, at });
                if (!json) return;
                const p = json.parsed ?? {};
                onMsg(
                  text.trim()
                    ? [
                        p.department ? `부서 ${p.department}` : '담당 부서를 못 찾았습니다',
                        p.agency ? `회신 기관 ${p.agency}` : null,
                        p.resolvedAt ? `회신 ${new Date(p.resolvedAt).toLocaleDateString('ko-KR')}` : '회신 시각 없음',
                        p.dueAt ? `${new Date(p.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정 — 아직 안 끝났습니다` : null,
                      ].filter(Boolean).join(' · ')
                    : '해결 내용을 지웠습니다',
                );
                close();
                await after(null);
              }}
            >
              해결 내용 저장
            </button>
            <button className="btn sm line" onClick={close}>그만두기</button>
          </div>
        </div>
      )}

      {editing === 'body' && (
        <div className="rowbox">
          <p>
            글 본문을 붙여넣으면 접수·회신 시각(분 단위) · 담당 부서 · <code>…까지</code> 약속을 그
            자리에서 뽑습니다. 카페 글을 열어 Ctrl+A → Ctrl+C 하면 됩니다.
          </p>
          <textarea
            className="inp"
            value={text}
            rows={7}
            autoFocus
            placeholder="글 본문을 통째로 붙여넣기"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="acts">
            <button
              className="btn pri sm"
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
                    p.dueAt ? `${new Date(p.dueAt).toLocaleDateString('ko-KR')}까지 조치 예정` : null,
                  ].filter(Boolean).join(' · '),
                );
                close();
                await after(null);
              }}
            >
              본문 저장
            </button>
            <button className="btn sm line" onClick={close}>그만두기</button>
          </div>
        </div>
      )}
    </>
  );
}
