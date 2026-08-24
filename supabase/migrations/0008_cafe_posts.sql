-- 카페 글 보관함 (2026-08-24)
--
-- ★ 왜 별도 테이블인가. 네이버 카페는 robots.txt 가 모든 봇을 막아 서버가 못 긁는다.
--   그래서 사람이 글을 열어 본문을 복사해 넣는 것이 유일한 경로다. 그 **원문**을
--   민원 행에 바로 밀어넣지 않고 여기 먼저 쌓는 이유는 둘이다:
--     1) 요약은 모델이 하는 일이라 실패한다. 실패해도 사람이 애써 복사한 원문은 남아야 한다
--     2) 한 글에서 민원이 여러 건 나올 수 있다. 원문 1 : 민원 N 이 되려면 자리가 따로 있어야 한다
create table if not exists cafe_posts (
  id            uuid primary key default gen_random_uuid(),
  title         text,                       -- 없어도 된다. 모델이 본문에서 뽑는다
  url           text,
  body          text not null,
  -- 같은 글을 두 번 붙여넣어도 한 건이다. 본문 해시가 멱등의 전부
  body_hash     text not null unique,
  created_at    timestamptz not null default now(),
  -- 요약 결과. ★ 실패를 지우지 않는다 — 사유가 남아야 사람이 다시 시도할지 판단한다
  summarized_at timestamptz,
  ok            boolean,
  error         text,
  drafted       integer not null default 0,
  model         text
);

create index if not exists cafe_posts_created_idx on cafe_posts (created_at desc);

-- 이 글에서 나온 민원 초안. 글이 지워져도 민원은 남는다(출처만 끊긴다)
alter table complaints add column if not exists cafe_post_id uuid references cafe_posts(id) on delete set null;
create index if not exists complaints_cafe_post_idx on complaints (cafe_post_id);

-- 브라우저는 Supabase 에 직접 말하지 않는다. 정책을 만들지 않는 것이 이 앱의 규칙이다
alter table cafe_posts enable row level security;
