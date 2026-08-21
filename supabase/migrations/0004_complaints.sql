-- 민원실 — 과천 민원 게시글을 모아 상태를 따라가는 곳 (2026-08-21)
--
-- 자료실(files)과 나란히 서지만 성격이 다르다.
--   자료실  방마다 갈리는 문서 보관소. room_id 가 필수다
--   민원실  **방과 무관한 전역 목록.** 과천시 민원은 특정 카톡방의 소유물이 아니라
--           도시의 일이라, 팔로우 방을 바꿔도 같은 목록이 보여야 한다
--
-- room_id·message_id 는 "카톡 대화에서 담은 것" 의 출처 표시일 뿐이라 nullable 이고,
-- 그 방을 지워도 민원은 남는다(on delete set null). 방을 정리하다 민원 목록이
-- 통째로 사라지는 것이 더 나쁜 실패다.

-- ── 크롤 출처 ─────────────────────────────────────────────────
--
-- ★ robots.txt 를 무시하지 말 것. 서버가 긁기 전에 대상 호스트의 robots.txt 를 보고
--   막혀 있으면 거부한다(`src/server/complaint-crawl.ts`). 네이버 카페(cafe.naver.com)는
--   모든 봇에 Disallow: / 라 이 경로로는 못 가져온다 — 그쪽은 사람이 목록을 복사해
--   붙여넣는 경로(origin='paste')로 처리한다.
create table if not exists complaint_sources (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  url           text not null unique,
  kind          text not null default 'auto' check (kind in ('auto', 'rss', 'html')),
  -- html 목록에서 어떤 링크가 글인지 가르는 정규식. 비우면 흔한 게시판 주소꼴을 쓴다.
  -- CSS 선택자를 두지 않는 이유: 파서 의존성(cheerio 등)을 들이지 않으려고 앵커만 훑는다
  link_pattern  text,
  -- 제목에 이 낱말 중 하나가 있어야 담는다(쉼표 구분). 비우면 전부 담는다.
  -- 시청 게시판은 공지·행사·보도자료가 섞여 들어와서 이게 없으면 민원 목록이 아니게 된다
  keywords      text,
  enabled       boolean not null default true,
  every_minutes integer not null default 360,
  last_run_at   timestamptz,
  last_ok       boolean,
  last_error    text,        -- ★ 실패 사유를 그대로 남긴다. 조용히 0건으로 넘어가지 않는다
  last_count    integer,     -- 목록에서 읽어낸 글 수
  last_new      integer,     -- 그중 새로 담긴 수
  created_at    timestamptz not null default now()
);

-- ── 민원 ──────────────────────────────────────────────────────
--
-- 멱등은 dedup_key 유니크 하나로 끝난다(자료실이 path, 메시지가 (room_id,msg_id) 인 것과 같다).
--   url:<정규화한 주소>     크롤·붙여넣기로 주소를 아는 것
--   chat:<messages.id>      카톡 말풍선에서 담은 것
--   title:<md5(출처|제목)>  주소가 없는 것(카페 목록을 제목만 복사한 경우)
-- 같은 글을 몇 번 다시 긁어도 한 건이고, 사람이 붙인 상태·메모는 덮이지 않는다.
create table if not exists complaints (
  id         uuid primary key default gen_random_uuid(),
  dedup_key  text not null unique,
  origin     text not null check (origin in ('crawl', 'chat', 'paste', 'manual')),
  source_id  uuid references complaint_sources(id) on delete set null,
  title      text not null,
  url        text,
  author     text,
  board      text,                       -- 출처 이름. 목록에서 어디서 온 글인지 가른다
  posted_at  timestamptz,                -- 원글 시각. 모르면 null 이고 화면은 담은 시각을 쓴다
  body       text,                       -- 카톡에서 담았으면 원문 전체
  category   text,                       -- 사람이 붙이는 분류(도로·환경·교통…). 자유 문자열
  status     text not null default 'new' check (status in ('new', 'doing', 'done', 'drop')),
  note       text,
  room_id    uuid references rooms(id) on delete set null,
  message_id bigint,                     -- 카톡에서 담은 원본 messages.id (FK 를 걸지 않는다*)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- * messages 에 FK 를 걸면 방을 지울 때 cascade 로 민원까지 날아간다. 민원은 남아야 한다

create index if not exists complaints_status_idx on complaints (status, coalesce(posted_at, created_at) desc);
create index if not exists complaints_created_idx on complaints (created_at desc);

alter table complaints        enable row level security;   -- 정책 없음 = 서버(service-role) 전용
alter table complaint_sources enable row level security;
