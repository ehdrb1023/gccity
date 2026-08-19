import { NextResponse } from 'next/server';
import { deleteRoom, renameRoom, setFollowed } from '@/server/rooms';
import { setDiscovery } from '@/server/state';

export const dynamic = 'force-dynamic';

/** 대시보드의 조작 전부. 미들웨어가 이미 로그인 여부를 봤다. */
export async function POST(req: Request) {
  let body: { action?: string; id?: string; name?: string; on?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }

  try {
    switch (body.action) {
      case 'follow':
        if (!body.id) throw new Error('id 없음');
        await setFollowed(body.id, true);
        break;
      case 'unfollow':
        if (!body.id) throw new Error('id 없음');
        await setFollowed(body.id, false);
        break;
      case 'rename':
        if (!body.id) throw new Error('id 없음');
        await renameRoom(body.id, body.name ?? '');
        break;
      case 'delete':
        if (!body.id) throw new Error('id 없음');
        await deleteRoom(body.id);
        break;
      case 'discovery': {
        const until = await setDiscovery(!!body.on);
        return NextResponse.json({ ok: true, until });
      }
      default:
        return NextResponse.json({ ok: false, reason: 'unknown-action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, reason }, { status: 400 });
  }
}
