import { NextResponse } from 'next/server';
import {
  addDrafts,
  addManual,
  clipMessage,
  countByStatus,
  deleteComplaint,
  editComplaint,
  listComplaints,
  parsePastedList,
  setStatus,
  type ComplaintStatus,
} from '@/server/complaints';
import { addSource, countDue, deleteSource, editSource, listSources, runSources } from '@/server/complaint-crawl';

export const dynamic = 'force-dynamic';
/** 크롤은 상대 서버를 여러 번 두드린다. 기본 타임아웃 안에 못 끝나는 출처가 있다. */
export const maxDuration = 120;

/** 민원실 탭이 열릴 때·조작 뒤에만 부른다. 대시보드 3초 폴링에 얹지 않는다. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const sources = await listSources();
    return NextResponse.json({
      ok: true,
      complaints: await listComplaints({
        status: url.searchParams.get('status') ?? 'all',
        q: url.searchParams.get('q') ?? '',
      }),
      counts: await countByStatus(),
      sources,
      // 자동 크롤이 밀렸다는 것을 화면에 드러낸다. 몰래 긁지 않고 사람에게 알린다
      due: countDue(sources),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] 민원 목록 실패:', reason);
    return NextResponse.json({ ok: false, reason }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }

  try {
    switch (body.action) {
      /** 게시판 목록을 통째로 복사해 붙여넣는다. 크롤이 막힌 네이버 카페의 길이다. */
      case 'paste': {
        const drafts = parsePastedList(String(body.text ?? ''));
        if (drafts.length === 0) {
          return NextResponse.json({ ok: false, reason: '붙여넣은 글에서 제목을 찾지 못했다' }, { status: 400 });
        }
        const board = String(body.board ?? '').trim() || '붙여넣기';
        const out = await addDrafts(drafts, { origin: 'paste', board });
        return NextResponse.json({ ok: true, ...out, parsed: drafts.length });
      }

      case 'manual': {
        await addManual({
          title: String(body.title ?? ''),
          url: body.url ? String(body.url) : undefined,
          category: body.category ? String(body.category) : undefined,
          note: body.note ? String(body.note) : undefined,
        });
        return NextResponse.json({ ok: true });
      }

      /** 수집된 카톡 말풍선 하나를 민원으로 담는다. */
      case 'clip': {
        await clipMessage(Number(body.messageId));
        return NextResponse.json({ ok: true });
      }

      case 'status': {
        await setStatus(String(body.id ?? ''), String(body.status ?? '') as ComplaintStatus);
        return NextResponse.json({ ok: true });
      }

      case 'edit': {
        await editComplaint(String(body.id ?? ''), {
          title: body.title === undefined ? undefined : String(body.title),
          note: body.note === undefined ? undefined : String(body.note),
          category: body.category === undefined ? undefined : String(body.category),
          url: body.url === undefined ? undefined : String(body.url),
        });
        return NextResponse.json({ ok: true });
      }

      case 'delete': {
        await deleteComplaint(String(body.id ?? ''));
        return NextResponse.json({ ok: true });
      }

      case 'source-add': {
        const id = await addSource({
          name: String(body.name ?? ''),
          url: String(body.url ?? ''),
          kind: body.kind ? String(body.kind) : undefined,
          linkPattern: body.linkPattern ? String(body.linkPattern) : undefined,
          keywords: body.keywords ? String(body.keywords) : undefined,
          everyMinutes: body.everyMinutes ? Number(body.everyMinutes) : undefined,
        });
        return NextResponse.json({ ok: true, id });
      }

      case 'source-edit': {
        await editSource(String(body.id ?? ''), body.patch ?? {});
        return NextResponse.json({ ok: true });
      }

      case 'source-delete': {
        await deleteSource(String(body.id ?? ''));
        return NextResponse.json({ ok: true });
      }

      /**
       * 지금 긁는다. `id` 를 주면 그 출처만, 없으면 켜진 출처 전부.
       * ★ 결과를 그대로 돌려준다 — 몇 건 찾고 몇 건이 새것인지, 실패면 사유까지.
       *   "긁었다" 만 알려주고 0건인 것을 숨기면 이 화면을 믿을 수 없게 된다.
       */
      case 'crawl': {
        const results = await runSources(body.id ? String(body.id) : undefined);
        return NextResponse.json({ ok: true, results });
      }

      default:
        return NextResponse.json({ ok: false, reason: 'unknown-action' }, { status: 400 });
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
}
