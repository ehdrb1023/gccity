import { describe, expect, it } from 'vitest';
import { absolutize, decodeBody, matchesKeywords, parseFeed, parseHtmlList, robotsDisallows, stripTags } from './complaint-crawl';

describe('robotsDisallows', () => {
  /** 실측 2026-08-21: cafe.naver.com/robots.txt 는 모든 봇에 전면 금지다. */
  it('★ 네이버 카페는 전면 금지다 — 여기서 true 가 나와야 크롤을 거부한다', () => {
    const txt = ['User-agent: *', 'Disallow: /', '', 'User-agent: Googlebot', 'Disallow: /'].join('\n');
    expect(robotsDisallows(txt, '/f-e/cafes/12345/menus/7')).toBe(true);
  });

  it('빈 Disallow 는 전부 허용이라는 뜻이다', () => {
    expect(robotsDisallows('User-agent: *\nDisallow:', '/bbs/list')).toBe(false);
  });

  it('가장 긴 패턴이 이긴다 — 하위 경로만 열어둔 사이트를 막지 않는다', () => {
    const txt = 'User-agent: *\nDisallow: /bbs/\nAllow: /bbs/notice/';
    expect(robotsDisallows(txt, '/bbs/secret/1')).toBe(true);
    expect(robotsDisallows(txt, '/bbs/notice/1')).toBe(false);
  });

  it('와일드카드와 $ 를 읽는다', () => {
    expect(robotsDisallows('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf')).toBe(true);
    expect(robotsDisallows('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf?x=1')).toBe(false);
  });

  it('주석과 대소문자를 가리지 않는다', () => {
    expect(robotsDisallows('# 안내\nUSER-AGENT: *\nDISALLOW: /admin', '/admin/x')).toBe(true);
  });

  it('규칙이 없으면 허용이다', () => {
    expect(robotsDisallows('', '/bbs/list')).toBe(false);
  });

  /**
   * 실측 2026-08-21: www.gccity.go.kr/robots.txt. `User-agent: *` 블록이 둘로 갈려 있고
   * 앞 블록은 Allow:/ 다. 두 블록을 합쳐 보지 않으면 게시판 금지를 놓친다 —
   * 그러면 "긁어도 되는 줄 알고" 시청 게시판을 두드리게 된다.
   */
  it('★ 과천시청 게시판은 robots 가 막고 있다 (블록이 둘로 갈려 있어도 합쳐 본다)', () => {
    const txt = [
      'User-agent:*',
      'Allow:/',
      '',
      'User-agent:*',
      'Disallow:/portal/bbs/',
      'Disallow:/jumin/bbs/',
      'Disallow:/dept/bbs/',
    ].join('\n');
    expect(robotsDisallows(txt, '/portal/bbs/list.do?ptIdx=111')).toBe(true);
    expect(robotsDisallows(txt, '/jumin/bbs/list.do?ptIdx=300')).toBe(true);
    expect(robotsDisallows(txt, '/main.do')).toBe(false);
  });
});

describe('parseFeed', () => {
  it('RSS 한 판에서 제목·링크·시각을 뽑는다', () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title><![CDATA[양재천 냄새 민원]]></title>
        <link>https://city.example/bbs/view?no=77</link>
        <pubDate>Thu, 20 Aug 2026 09:00:00 +0900</pubDate>
      </item>
      <item><title>도로 파임 신고</title><link>/bbs/view?no=78</link></item>
    </channel></rss>`;

    const out = parseFeed(xml, 'https://city.example/bbs/rss');
    expect(out).toHaveLength(2);
    expect(out[0].title).toBe('양재천 냄새 민원');
    expect(out[0].postedAt).toBe(new Date(Date.parse('2026-08-20T09:00:00+09:00')).toISOString());
    // 상대 주소도 절대 주소로 바꾼다 — 아니면 링크를 눌러도 열리지 않는다
    expect(out[1].url).toBe('https://city.example/bbs/view?no=78');
    expect(out[1].postedAt).toBeNull();
  });

  it('Atom 의 <link href> 꼴도 읽는다', () => {
    const xml = `<feed><entry><title>공원 정비 요청</title>
      <link href="https://city.example/a/1"/><updated>2026-08-19T00:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml, 'https://city.example/')[0].url).toBe('https://city.example/a/1');
  });
});

describe('parseHtmlList', () => {
  const html = `
    <ul class="board">
      <li><a href="/bbs/view.do?nttId=101">갈현삼거리 횡단보도 바꿔주세요</a></li>
      <li><a href="/bbs/view.do?nttId=102">   제비울천 <b>쇠파이프</b> 방치 민원 </a></li>
      <li><a href="/bbs/view.do?nttId=101">갈현삼거리 횡단보도 바꿔주세요</a></li>
      <li><a href="/help/guide.html">이용안내</a></li>
      <li><a href="/bbs/list.do?page=2">다음</a></li>
    </ul>`;

  it('글 링크만 뽑고 같은 주소는 한 번만 담는다', () => {
    const out = parseHtmlList(html, 'https://city.example/bbs/list.do');
    expect(out.map((i) => i.title)).toEqual(['갈현삼거리 횡단보도 바꿔주세요', '제비울천 쇠파이프 방치 민원']);
    expect(out[0].url).toBe('https://city.example/bbs/view.do?nttId=101');
  });

  it('링크 패턴을 주면 그것만 본다', () => {
    const out = parseHtmlList(html, 'https://city.example/bbs/list.do', 'nttId=10[12]');
    expect(out).toHaveLength(2);
  });

  it('정규식이 아닌 패턴은 조용히 넘기지 않고 던진다', () => {
    expect(() => parseHtmlList(html, 'https://city.example/', '([')).toThrow(/정규식/);
  });
});

describe('matchesKeywords', () => {
  it('비우면 전부 담는다', () => {
    expect(matchesKeywords('제3회 자원봉사 이음축제 개최', null)).toBe(true);
  });

  it('낱말이 있으면 제목에 든 것만 담는다 — 공지·보도자료를 걸러내는 수단이다', () => {
    expect(matchesKeywords('양재천 냄새 민원', '민원,청원,요청')).toBe(true);
    expect(matchesKeywords('CES 2028 진출 지원 시동', '민원,청원,요청')).toBe(false);
  });
});

describe('stripTags / absolutize / decodeBody', () => {
  it('태그와 엔티티를 걷어낸다', () => {
    expect(stripTags('<b>도로</b>&nbsp;파임 &amp; 침하 <script>x</script>')).toBe('도로 파임 & 침하');
  });

  it('http 아닌 주소는 버린다 — 목록에 javascript: 링크가 섞여 온다', () => {
    expect(absolutize('mailto:a@b.c', 'https://city.example/')).toBeNull();
    expect(absolutize('view?no=1', 'https://city.example/bbs/list')).toBe('https://city.example/bbs/view?no=1');
  });

  it('charset 을 헤더에서, 없으면 meta 에서 읽는다', () => {
    const utf8 = new TextEncoder().encode('<html>민원</html>');
    expect(decodeBody(utf8.buffer as ArrayBuffer, 'text/html; charset=utf-8')).toContain('민원');
    // 모르는 인코딩이라도 던지지 않는다 — 깨지더라도 담기는 편이 낫다
    expect(decodeBody(utf8.buffer as ArrayBuffer, 'text/html; charset=x-unknown')).toContain('민원');
  });
});
