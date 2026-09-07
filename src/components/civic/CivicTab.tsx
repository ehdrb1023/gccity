'use client';

import { useCallback, useEffect, useState } from 'react';
import { relTime } from '@/lib/time';
import { isListed } from '@/lib/complaint-view';
import { isLate, type SlaInput } from '@/lib/sla';
import Empty, { Skeleton } from '@/components/ui/Empty';
import Drawer from '@/components/ui/Drawer';
import { Arrow, Search, Spark } from '@/components/ui/icons';
import Wing from '@/components/ui/Wing';
import StdBand from './StdBand';
import ComplaintRow from './ComplaintRow';
import CafeBox from './CafeBox';
import { AuthorsPanel, ManualPanel, PastePanel, SourcesPanel, StagePanel } from './panels';
import {
  CIVIC_STATUS,
  KIND,
  type CafePost,
  type CivicAuthor,
  type CivicStatus,
  type Complaint,
  type CrawlSource,
  type DigestRun,
  type Flow,
  type PairSuggestion,
  type PostKind,
} from '@/components/types';

/** 왼쪽 보드의 세 칸. 화면이 하는 일이 셋으로 갈린다 — 확정된 것 / 검토할 것 / 넣는 곳 */
type Board = 'list' | 'drafts' | 'cafe';
type Panel = 'none' | 'paste' | 'manual' | 'sources' | 'authors' | 'stage';

const PANEL_TITLE: Record<Exclude<Panel, 'none'>, string> = {
  paste: '카페 목록 붙여넣기',
  manual: '민원 직접 적기',
  sources: '크롤 소스',
  authors: '작성자 등록부',
  stage: '1·3·7 단계 기록',
};

const slaOf = (c: Complaint): SlaInput => ({
  reportedAt: c.reportedAt,
  assignedAt: c.assignedAt,
  visitedAt: c.visitedAt,
  resolvedAt: c.resolvedAt,
});

/**
 * 민원실.
 *
 * ★ 왼쪽 보드가 **일의 방향**이다. 카페 글을 넣으면 모델이 초안을 만들고, 사람이 확정한
 *   것만 목록에 남는다. 되돌아가는 화살표는 없다 — 초안과 확정본을 한 목록에 섞으면
 *   무엇을 아직 안 봤는지 알 수 없게 된다.
 *
 * ★ 대시보드 3초 폴링에 얹지 않는다. 목록이 저절로 흔들리면 읽던 자리를 놓치고,
 *   민원은 초 단위로 바뀌는 것이 아니다. 탭을 열 때와 조작한 뒤에만 다시 읽는다.
 */
export default function CivicTab({ now }: { now: number }) {
  const [items, setItems] = useState<Complaint[] | null>(null);
  /*
   * ★ 초안 수는 목록 거르개와 따로 온다. 왼쪽 보드가 "아직 안 본 것" 을 답해야 하는데,
   *   거르개가 걸린 `items` 에서 세면 목록에서 출처를 고를 때마다 숫자가 흔들린다.
   */
  const [draftCounts, setDraftCounts] = useState({ total: 0, chat: 0, cafe: 0 });
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | CivicStatus>('all');
  const [kind, setKind] = useState<'all' | PostKind>('all');
  const [origin, setOrigin] = useState<'all' | Complaint['origin']>('all');
  /** 기준 넘긴 것만 보기. 이것만 화면에서 자른다 — 아래 주석 참조 */
  const [lateOnly, setLateOnly] = useState(false);
  const [q, setQ] = useState('');
  const [linking, setLinking] = useState<Complaint | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [stageFor, setStageFor] = useState<Complaint | null>(null);

  /*
   * ★ 상태·종류·출처·검색어 넷은 **전부 서버로 보낸다.** 하나라도 화면에서만 거르면
   *   칩 숫자가 목록 줄 수와 갈린다 — `origin` 을 클라에서만 걸러 그 증상이 재발한 적이 있다.
   */
  const reload = useCallback(async (st: string, query: string, kd: string, og: string) => {
    try {
      const qs = new URLSearchParams({ status: st, q: query, kind: kd, origin: og });
      const res = await fetch(`/api/complaints?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.reason ?? '민원 목록을 읽지 못했습니다');
        return;
      }
      setErr(null);
      setItems(json.complaints);
      setDraftCounts(json.draftCounts ?? { total: 0, chat: 0, cafe: 0 });
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
   * ★ 검색어는 잠깐 기다렸다 보낸다. 글자마다 바로 쏘면 요청이 네 번 날아가고,
   *   늦게 도착한 앞 글자의 응답이 뒤 글자의 결과를 덮어쓴다.
   */
  useEffect(() => {
    const t = setTimeout(() => void reload(status, q, kind, origin), q ? 260 : 0);
    return () => clearTimeout(t);
  }, [reload, status, q, kind, origin]);

  const act = useCallback(async (body: Record<string, unknown>): Promise<Record<string, any> | null> => {
    setBusy(true);
    try {
      const res = await fetch('/api/complaints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setErr(json.reason ?? '실패했습니다');
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
  }, []);

  const after = useCallback(
    async (json: Record<string, any> | null, note?: string) => {
      if (json && note) setMsg(note);
      await reload(status, q, kind, origin);
    },
    [reload, status, q, kind, origin],
  );

  /** ★ 결과를 그대로 적는다 — 몇 곳을 긁어 몇 건이 새것인지, 실패면 사유까지 */
  const crawl = async (id?: string) => {
    setMsg('긁는 중…');
    const json = await act(id ? { action: 'crawl', id } : { action: 'crawl' });
    if (!json) return setMsg(null);
    const results = (json.results ?? []) as { name: string; ok: boolean; found: number; added: number; error: string | null }[];
    setMsg(
      results.length === 0
        ? '켜져 있는 출처가 없습니다 — [크롤 소스] 에서 게시판 주소를 등록하세요'
        : results.map((r) => (r.ok ? `${r.name}: ${r.found}건 중 ${r.added}건 새로` : `${r.name}: 실패 — ${r.error}`)).join(' · '),
    );
    await reload(status, q, kind, origin);
  };

  /* 보드를 옮길 때 걸러둔 것을 풀어준다 — "민원이 하나도 없다" 로 보이는 착시를 막는다 */
  const goto = (b: Board) => {
    setBoard(b);
    setOpenId(null);
    setPanel('none');
    if (b !== 'list') {
      setStatus('all'); setKind('all'); setOrigin('all'); setLateOnly(false); setQ('');
    }
  };

  const rows = items ?? [];
  /*
   * ★ 이어진 회신은 목록에 따로 세우지 않는다. 민원과 회신이 두 줄로 나란히 있으면 같은
   *   사안이 두 건으로 읽힌다. 이어둔 것은 민원 줄 하나로 합쳐 보여준다.
   */
  const resolutionFor = new Map<string, Complaint>();
  for (const c of rows) if (c.resolutionOf) resolutionFor.set(c.resolutionOf, c);

  /*
   * ★ 조건을 여기에 적지 않는다. `isListed` 가 서버의 칩 집계(`applyListed`)와 짝을 이루는
   *   하나뿐인 정의다 — 여기에 조건을 하나 더 얹으면 그 순간 칩 숫자가 줄 수와 갈린다.
   */
  const listed = rows.filter(isListed);
  /*
   * ★ `lateOnly` 만 화면에서 자른다. 1·3·7 판정은 **지금 시각**에 달려 있어 서버 집계로
   *   옮길 수 없다(같은 행이 한 시간 뒤에 늦은 것이 된다). 그래서 이 거르개가 켜지면
   *   기준 띠를 `listed` 로 계산하고 목록만 좁힌 뒤, 둘이 다른 것을 세고 있다고 화면에 적는다.
   *   숫자와 줄 수가 다른 것을 말없이 두지 않는다.
   */
  const shown = lateOnly ? listed.filter((c) => c.kind === 'report' && isLate(slaOf(c), now)) : listed;

  const drafts = rows.filter((c) => c.aiDraft && !c.duplicateOf);
  const chatDrafts = drafts.filter((c) => c.origin === 'chat');
  const cafeDrafts = drafts.filter((c) => c.origin !== 'chat');

  const shared = { busy, now, act, after, linking, setLinking, onMsg: setMsg, onStage: (c: Complaint) => { setStageFor(c); setPanel('stage'); } };
  const closePanel = () => { setPanel('none'); setStageFor(null); };
  const panelDone = async (m: string) => { setMsg(m); closePanel(); await reload(status, q, kind, origin); };

  return (
    <section className="screen">
      <aside className="pane">
        <div className="pane-h"><h2>보드</h2></div>
        <div className="pane-b">
          <button className="board" data-on={board === 'list'} onClick={() => goto('list')}>
            <div className="bt">민원 목록<span className="bn">{listed.length}</span></div>
            <div className="bd">사람이 확정한 것</div>
          </button>
          <button className="board" data-on={board === 'drafts'} onClick={() => goto('drafts')}>
            <div className="bt">초안<span className="bn">{draftCounts.total}</span></div>
            <div className="bd">카톡 {draftCounts.chat} · 카페 {draftCounts.cafe}</div>
          </button>
          <button className="board" data-on={board === 'cafe'} onClick={() => goto('cafe')}>
            <div className="bt">카페 글<span className="bn">{cafePosts.length}</span></div>
            <div className="bd">붙여넣으면 요약합니다</div>
          </button>

          <div style={{ height: 12 }} />
          <button className="btn line sm" style={{ width: '100%', marginBottom: 6 }} onClick={() => setPanel('paste')}>카페 목록 붙여넣기</button>
          <button className="btn line sm" style={{ width: '100%', marginBottom: 6 }} onClick={() => setPanel('manual')}>민원 직접 적기</button>
          <button className="btn line sm" style={{ width: '100%', marginBottom: 6 }} onClick={() => setPanel('sources')}>
            크롤 소스{sources.length > 0 ? ` ${sources.length}` : ''}
          </button>
          <button className="btn line sm" style={{ width: '100%', marginBottom: 6 }} onClick={() => setPanel('authors')}>작성자 등록부</button>

          <div style={{ height: 12 }} />
          <button className="btn sm" style={{ width: '100%', marginBottom: 6 }} disabled={busy} onClick={() => void crawl()}>지금 긁기</button>
          <button
            className="btn sm"
            style={{ width: '100%', marginBottom: 6 }}
            disabled={busy}
            title="쌓인 카톡을 읽어 민원 초안을 만듭니다"
            onClick={async () => {
              setMsg('카톡을 분석하는 중… (수십 초 걸릴 수 있습니다)');
              const json = await act({ action: 'digest' });
              if (!json) return setMsg(null);
              const d = json.digest as DigestRun;
              setMsg(d.error ? `분석 실패 — ${d.error}` : `${d.messages}건 읽어 ${d.drafted}건 뽑았고 ${d.added}건 새로 담았습니다`);
              if (!d.error && d.added > 0) goto('drafts');
              await reload(status, q, kind, origin);
            }}
          >
            지금 분석
          </button>
          <button
            className="btn sm"
            style={{ width: '100%' }}
            disabled={busy}
            title="같은 사안이 두 번 들어온 것을 찾아 제안합니다 (이어지지는 않습니다)"
            onClick={async () => {
              setMsg('짝을 찾는 중…');
              const json = await act({ action: 'pair-suggest' });
              if (!json) return setMsg(null);
              const r = json.pair as { scanned: number; found: number; added: number; error: string | null };
              setMsg(
                r.error
                  ? `짝 찾기 실패 — ${r.error}`
                  : r.added > 0
                    ? `${r.scanned}건을 보고 ${r.added}건을 제안했습니다 — 목록에서 확인하세요`
                    : `${r.scanned}건을 봤지만 새로 제안할 짝이 없습니다`,
              );
              if ((r.added ?? 0) > 0) goto('list');
              await reload(status, q, kind, origin);
            }}
          >
            짝 찾기
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="wrap">
          {err && <p className="note bad">{err}</p>}
          {msg && (
            <p className="note">
              {msg}{' '}
              <button className="btn sm line" style={{ marginLeft: 6 }} onClick={() => setMsg(null)}>닫기</button>
            </p>
          )}
          {/* 자동 분석은 하루 한 번뿐이다. 그 사이 공백을 몰래 메우지 않고 사람에게 알린다 */}
          {digestDue && (
            <p className="note warn">
              카톡 분석이 밀렸습니다 — 마지막 분석 이후 {digestHours}시간이 지났습니다. 왼쪽 <b>지금 분석</b> 을 누르면 그동안 쌓인 대화에서 민원을 뽑습니다.
            </p>
          )}
          {/* ★ 실패를 숨기지 않는다 — 0건이 조용한 하루인지 아예 안 돌았는지 갈라야 한다 */}
          {digest && !digest.ok && (
            <p className="note bad">마지막 카톡 분석 실패 ({relTime(digest.startedAt)}) — {digest.error}</p>
          )}
          {due > 0 && <p className="note warn">출처 {due}곳이 갱신할 때가 됐습니다. 왼쪽 <b>지금 긁기</b> 를 누르면 바로 가져옵니다.</p>}
          {linking && (
            <p className="note">
              잇는 중: {linking.title.slice(0, 40)} — 민원 줄을 펼쳐 <b>[여기에 잇기]</b> 를 누르면 짝이 됩니다.{' '}
              <button className="btn sm line" style={{ marginLeft: 6 }} onClick={() => setLinking(null)}>그만두기</button>
            </p>
          )}

          {board === 'list' && (
            <>
              <StdBand rows={listed} flow={flow} now={now} />

              {/*
                ★ 모델이 찾아낸 짝은 제안일 뿐이다. 사람이 누르기 전에는 아무것도 이어지지 않는다.
                  자동으로 엮으면 틀린 짝이 조용히 통계에 섞이고, 그렇게 어긋난 평균은 아무도 못 알아챈다.
              */}
              {pairs.map((p) => (
                <div className="sug" key={p.id}>
                  <div className="sh">
                    <Spark />
                    {p.relation === 'resolves' ? '짝이 맞아 보이는 처리 글이 있습니다' : '같은 글이 두 번 들어온 것 같습니다'}
                  </div>
                  <div className="pair">
                    <div className="p">
                      <div className="pt">{p.right.title}</div>
                      <div className="pm">{p.relation === 'resolves' ? '민원' : '먼저'} · {p.right.origin}</div>
                    </div>
                    <Arrow />
                    <div className="p">
                      <div className="pt">{p.left.title}</div>
                      <div className="pm">{p.relation === 'resolves' ? '처리' : '나중'} · {p.left.origin}</div>
                    </div>
                  </div>
                  {/* 왜 같은 사안으로 봤는지. 누를지 말지 판단하는 근거다 */}
                  <div className="why">{p.confidence} · {p.reason}</div>
                  <div className="acts">
                    <button
                      className="btn pri sm"
                      disabled={busy}
                      onClick={async () => {
                        await after(await act({ action: 'pair-accept', id: p.id }), p.relation === 'resolves' ? '민원과 처리를 이었습니다' : '중복으로 내렸습니다');
                      }}
                    >
                      이어붙이기
                    </button>
                    <button className="btn sm line" disabled={busy} onClick={async () => { await after(await act({ action: 'pair-reject', id: p.id })); }}>
                      아니에요
                    </button>
                    <span className="dim" style={{ alignSelf: 'center', fontSize: 'var(--fs-sm)' }}>수락해야 완료로 바뀝니다</span>
                  </div>
                </div>
              ))}

              <div className="bar">
                <div className="seg">
                  <button data-on={status === 'all'} onClick={() => setStatus('all')}>전체</button>
                  {CIVIC_STATUS.map((s) => (
                    <button key={s.key} data-on={status === s.key} onClick={() => setStatus(s.key)}>{s.label}</button>
                  ))}
                </div>
                <div className="seg">
                  <button data-on={!lateOnly} onClick={() => setLateOnly(false)}>기준 전체</button>
                  <button data-on={lateOnly} onClick={() => setLateOnly(true)}>넘긴 것만</button>
                </div>
                <select className="inp sm" style={{ width: 'auto' }} aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value as any)}>
                  <option value="all">종류 전체</option>
                  {KIND.map((k) => (<option key={k.key} value={k.key}>{k.label}</option>))}
                </select>
                <select className="inp sm" style={{ width: 'auto' }} aria-label="출처" value={origin} onChange={(e) => setOrigin(e.target.value as any)}>
                  <option value="all">출처 전체</option>
                  <option value="chat">카톡</option>
                  <option value="paste">카페</option>
                  <option value="crawl">크롤</option>
                  <option value="manual">직접</option>
                </select>
                <div className="search">
                  <Search />
                  <input className="inp sm" value={q} placeholder="제목, 본문, 메모에서 찾기" onChange={(e) => setQ(e.target.value)} />
                </div>
              </div>

              {/* 띠와 목록이 다른 것을 세고 있으면 말없이 두지 않는다 */}
              {lateOnly && (
                <p className="note warn">
                  기준 넘긴 {shown.length}건만 보이는 중입니다. 위 준수율 띠는 거른 {listed.length}건 전체를 기준으로 셉니다.
                </p>
              )}

              {items === null ? (
                <Skeleton />
              ) : shown.length === 0 ? (
                <Empty
                  icon={<Search size={20} />}
                  title={
                    lateOnly ? '기준을 넘긴 민원이 없습니다'
                      : q || status !== 'all' || kind !== 'all' || origin !== 'all' ? '조건에 맞는 민원이 없습니다'
                      : '확정된 민원이 아직 없습니다'
                  }
                  desc={
                    q || status !== 'all' || kind !== 'all' || origin !== 'all' || lateOnly
                      ? '거르개를 넓히거나 검색어를 지워보세요.'
                      : '초안 보드에서 확정하면 여기로 옵니다.'
                  }
                  action={
                    (q || status !== 'all' || kind !== 'all' || origin !== 'all' || lateOnly) && (
                      <button
                        className="btn line sm"
                        onClick={() => { setQ(''); setStatus('all'); setKind('all'); setOrigin('all'); setLateOnly(false); }}
                      >
                        거르개 초기화
                      </button>
                    )
                  }
                />
              ) : (
                <div className="rows">
                  {shown.map((c) => (
                    <ComplaintRow
                      key={c.id}
                      c={c}
                      fix={resolutionFor.get(c.id)}
                      open={openId === c.id}
                      onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                      {...shared}
                    />
                  ))}
                </div>
              )}

              <div className="foot-ci">
                <Wing size={16} />
                민원의 특성에 따라 절차가 변동될 수 있습니다. 시청 공식 접수와 별개로 시민이 직접 세는 기록입니다.
              </div>
            </>
          )}

          {board === 'drafts' && (
            <>
              <h2 className="pg">초안</h2>
              <p className="pg">확정하기 전까지는 목록과 준수율에 들어가지 않습니다. 매일 아침 크론이 새로 쌓습니다.</p>

              <h5 style={{ margin: '18px 0 8px', fontSize: 'var(--fs-sm)' }}>카톡에서 {chatDrafts.length}건</h5>
              {chatDrafts.length === 0 ? (
                <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>없습니다. 왼쪽 [지금 분석] 을 누르면 쌓인 대화에서 뽑습니다.</p>
              ) : (
                <div className="rows">
                  {chatDrafts.map((c) => (
                    <ComplaintRow key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} {...shared} />
                  ))}
                </div>
              )}

              <h5 style={{ margin: '22px 0 8px', fontSize: 'var(--fs-sm)' }}>카페에서 {cafeDrafts.length}건</h5>
              {cafeDrafts.length === 0 ? (
                <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>없습니다. 왼쪽 [카페 글] 에 본문을 붙여넣으면 여기 쌓입니다.</p>
              ) : (
                <div className="rows">
                  {cafeDrafts.map((c) => (
                    <ComplaintRow key={c.id} c={c} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} {...shared} />
                  ))}
                </div>
              )}
            </>
          )}

          {board === 'cafe' && (
            <CafeBox
              posts={cafePosts}
              busy={busy}
              act={act}
              reload={() => reload(status, q, kind, origin)}
              onMsg={setMsg}
              onDone={() => goto('drafts')}
            />
          )}
        </div>
      </div>

      <Drawer open={panel !== 'none'} title={panel === 'none' ? '' : PANEL_TITLE[panel]} onClose={closePanel}>
        {panel === 'paste' && <PastePanel busy={busy} act={act} onDone={panelDone} />}
        {panel === 'manual' && <ManualPanel busy={busy} act={act} onDone={panelDone} />}
        {panel === 'stage' && stageFor && <StagePanel c={stageFor} busy={busy} act={act} onDone={panelDone} />}
        {panel === 'sources' && (
          <SourcesPanel sources={sources} busy={busy} act={act} reload={() => reload(status, q, kind, origin)} onCrawl={crawl} />
        )}
        {panel === 'authors' && (
          <AuthorsPanel authors={authors} busy={busy} act={act} reload={() => reload(status, q, kind, origin)} onMsg={setMsg} />
        )}
      </Drawer>
    </section>
  );
}
