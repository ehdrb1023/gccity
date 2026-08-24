import { NextResponse } from 'next/server';
import {
  addDrafts,
  addManual,
  attachBody,
  clipMessage,
  countByStatus,
  deleteAuthor,
  deleteComplaint,
  editComplaint,
  getFlowStats,
  linkResolution,
  listAuthors,
  listComplaints,
  parsePastedList,
  reclassifyAll,
  setAuthorKind,
  setKind,
  setResolution,
  setStatus,
  unlinkResolution,
  type ComplaintStatus,
} from '@/server/complaints';
import type { AuthorKind, PostKind } from '@/server/complaint-classify';
import { confirmDraft, digestDue, DIGEST_HOURS, lastRun, runDigest } from '@/server/digest';
import { addSource, countDue, deleteSource, editSource, listSources, runSources } from '@/server/complaint-crawl';
import { addCafePost, deleteCafePost, listCafePosts, summarizeCafePost } from '@/server/cafe';
import { acceptPair, listPairs, rejectPair, suggestPairs } from '@/server/pair';

export const dynamic = 'force-dynamic';
/**
 * 크롤은 상대 서버를 여러 번 두드리고, 카톡 분석·카페 요약은 모델을 부른다.
 * 셋 다 기본 타임아웃 안에 못 끝날 수 있다.
 */
export const maxDuration = 300;

/** 민원실 탭이 열릴 때·조작 뒤에만 부른다. 대시보드 3초 폴링에 얹지 않는다. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    /*
     * ★ 한꺼번에 띄운다. 예전에는 `await` 을 일곱 번 줄줄이 걸었는데, 그러면 서로 아무
     *   상관없는 조회가 **차례로** Supabase 를 왕복해 응답이 그 합만큼 늦어졌다.
     *   화면은 조작할 때마다 이 응답 하나를 기다리므로 그 지연이 그대로 체감된다.
     *   새 조회를 넣을 때도 이 배열에 얹을 것 — 밖에서 따로 await 하지 말 것.
     */
    const [complaints, counts, flow, digestRun, authors, cafePosts, sources, pairs] = await Promise.all([
      listComplaints({
        status: url.searchParams.get('status') ?? 'all',
        kind: url.searchParams.get('kind') ?? 'all',
        q: url.searchParams.get('q') ?? '',
      }),
      countByStatus(),
      // 흐름 요약 — 접수/처리 건수와 평균 처리일. 모수를 함께 내보낸다
      getFlowStats(),
      lastRun(),
      listAuthors(),
      // 카페 글 보관함 — 사람이 붙여넣은 원문. 요약 실패도 여기 남는다
      listCafePosts(),
      listSources(),
      // 모델이 제안한 짝. ★ 아직 이어진 것이 아니다 — 사람이 눌러야 이어진다
      listPairs(),
    ]);

    return NextResponse.json({
      ok: true,
      complaints,
      counts,
      flow,
      // 마지막 카톡 분석 결과. 실패도 그대로 화면에 뜬다
      digest: digestRun,
      // cron 이 하루 한 번뿐이라(Hobby 제한) 밀린 것을 화면이 알려준다
      digestDue: digestDue(digestRun),
      digestHours: DIGEST_HOURS,
      authors,
      cafePosts,
      pairs,
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

      /**
       * 글 본문 붙이기. 카페는 서버가 못 읽으니 사람이 열어 복사해 넣는다.
       * 붙는 즉시 접수·회신 시각·담당 부서·완료 예정일을 정규식으로 뽑는다.
       */
      case 'body': {
        const out = await attachBody(String(body.id ?? ''), String(body.body ?? ''));
        return NextResponse.json({ ok: true, ...out });
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

      /** 작성자 성격을 정한다. 정한 뒤 reclassify 를 부르면 지난 글에도 적용된다. */
      case 'author-kind': {
        await setAuthorKind(String(body.name ?? ''), String(body.kind ?? '') as AuthorKind, body.note ? String(body.note) : undefined);
        return NextResponse.json({ ok: true });
      }

      case 'author-delete': {
        await deleteAuthor(String(body.name ?? ''));
        return NextResponse.json({ ok: true });
      }

      /** 명부가 바뀐 뒤 지난 글 다시 가르기. 사람이 손으로 고친 행은 건드리지 않는다. */
      case 'reclassify': {
        const out = await reclassifyAll();
        return NextResponse.json({ ok: true, ...out });
      }

      /** 종류를 손으로 고친다(민원·처리·공지). 고치면 잠겨서 재분류가 덮지 않는다. */
      case 'kind': {
        await setKind(String(body.id ?? ''), String(body.kind ?? '') as PostKind);
        return NextResponse.json({ ok: true });
      }

      /** 처리 글 ↔ 민원 글 잇기. 자동으로 엮지 않는다 — 틀린 짝은 통계를 조용히 망친다. */
      case 'link': {
        await linkResolution(String(body.resolutionId ?? ''), String(body.reportId ?? ''));
        return NextResponse.json({ ok: true });
      }

      case 'unlink': {
        await unlinkResolution(String(body.id ?? ''));
        return NextResponse.json({ ok: true });
      }

      /**
       * 지금 분석. 창을 주면 그만큼 거슬러 올라가고, 안 주면 마지막 성공 실행 이후 전부.
       * ★ 결과를 그대로 돌려준다 — 몇 건 읽어 몇 건 뽑았고 그중 몇 건이 새것인지.
       */
      case 'digest': {
        const out = await runDigest(body.hours ? { hours: Number(body.hours) } : {});
        return NextResponse.json({ ok: true, digest: out });
      }

      /** 모델이 넣은 초안을 사람이 확정한다. */
      case 'confirm': {
        await confirmDraft(String(body.id ?? ''));
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

      /*
       * 카페 글 보관 + 요약. ★ 저장이 먼저고 요약이 나중이다 —
       * 모델 호출이 실패해도 사람이 애써 복사한 본문은 남는다.
       */
      case 'cafe-add': {
        const { post, duplicate } = await addCafePost({
          title: String(body.title ?? ''),
          url: String(body.url ?? ''),
          postedAt: String(body.postedAt ?? ''),
          reply: String(body.reply ?? ''),
          replyPostedAt: String(body.replyPostedAt ?? ''),
          body: String(body.body ?? ''),
        });
        if (duplicate) {
          return NextResponse.json({ ok: true, post, duplicate: true, summary: null });
        }
        const summary = await summarizeCafePost(post.id);
        return NextResponse.json({ ok: true, post, duplicate: false, summary });
      }

      /** 요약을 다시 돌린다. 키가 없어 실패했거나 결과가 시원찮을 때. */
      case 'cafe-summarize': {
        const summary = await summarizeCafePost(String(body.id ?? ''));
        return NextResponse.json({ ok: true, summary });
      }

      case 'cafe-delete': {
        await deleteCafePost(String(body.id ?? ''));
        return NextResponse.json({ ok: true });
      }

      /*
       * 짝 찾기. ★ 제안만 만든다 — 이 호출로 이어지는 것은 하나도 없다.
       * 자동으로 엮으면 틀린 짝이 조용히 통계에 섞이고 아무도 못 알아챈다.
       */
      /*
       * 해결 내용을 적는다. ★ 부서·회신 기관·완료 예정일을 이 글에서 규칙이 뽑아 채운다 —
       * 뽑아낸 값을 그대로 돌려주므로 화면이 "무엇이 채워졌는지" 를 사람에게 보여줄 수 있다.
       */
      case 'resolution': {
        const parsed = await setResolution(String(body.id ?? ''), {
          text: String(body.text ?? ''),
          summary: String(body.summary ?? ''),
          at: String(body.at ?? ''),
        });
        return NextResponse.json({ ok: true, parsed });
      }

      case 'pair-suggest': {
        return NextResponse.json({ ok: true, pair: await suggestPairs() });
      }

      case 'pair-accept': {
        return NextResponse.json({ ok: true, ...(await acceptPair(String(body.id ?? ''))) });
      }

      case 'pair-reject': {
        await rejectPair(String(body.id ?? ''));
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ ok: false, reason: 'unknown-action' }, { status: 400 });
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
}
