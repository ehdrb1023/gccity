import { NextResponse } from 'next/server';
import { checkIngestToken } from '@/server/token';
import { touchHeartbeat } from '@/server/state';
import { ingestBatch, type IncomingMsg, type IncomingSeen } from '@/server/ingest';

export const dynamic = 'force-dynamic';

/** 한 번에 받는 상한. 넘으면 앞에서부터 자른다 — 통째로 거부하면 그 배치가 전부 사라진다. */
const MAX_MSGS = 100;
const MAX_SEEN = 200;

export async function POST(req: Request) {
  const auth = checkIngestToken(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, reason: auth.reason }, { status: 401 });
  }

  let body: { msgs?: unknown; seen?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }

  const msgs = (Array.isArray(body.msgs) ? body.msgs : []).slice(0, MAX_MSGS) as IncomingMsg[];
  const seen = (Array.isArray(body.seen) ? body.seen : []).slice(0, MAX_SEEN) as IncomingSeen[];

  try {
    await touchHeartbeat();
    const result = await ingestBatch(msgs, seen);

    // 시각을 못 얻은 메시지 비율. 높으면 봇의 시각 추출부터 고쳐야 한다
    // (초 단위 폴백은 같은 초의 동일 메시지를 합쳐버린다).
    const noTs = msgs.filter((m) => !m.tsMs).length;
    console.log(
      `[gccity] ingest msgs=${msgs.length} seen=${seen.length} ` +
        `inserted=${result.inserted} skipped=${result.skipped} dropped=${result.dropped}` +
        (noTs ? ` ⚠️시각없음=${noTs}` : ''),
    );

    return NextResponse.json(result);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error('[gccity] ingest 실패:', reason);
    return NextResponse.json({ ok: false, reason }, { status: 503 });
  }
}
