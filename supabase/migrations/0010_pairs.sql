-- 짝 제안 (2026-08-24)
--
-- ★ 자동으로 잇지 않는다. **모델은 제안만 하고 사람이 누른다.**
--   제목이 비슷하다고 민원과 회신을 자동으로 엮으면 틀린 짝이 조용히 통계에 섞이고,
--   그렇게 한 번 어긋난 "평균 처리 3일" 은 아무도 못 알아챈다.
--   그래서 제안을 이 표에 쌓아두고, 사람이 [잇기]/[아니다] 를 누른 것만 반영한다.
--
-- ★ 거절도 남긴다. 남기지 않으면 다음 실행 때 같은 짝을 또 제안해서
--   사람이 매번 같은 것을 물리쳐야 한다 — 그러면 이 화면을 안 보게 된다.
create table if not exists complaint_pairs (
  id          uuid primary key default gen_random_uuid(),
  -- resolves: left=처리 글, right=민원 글 / duplicate: left=나중 글, right=먼저 글
  left_id     uuid not null references complaints(id) on delete cascade,
  right_id    uuid not null references complaints(id) on delete cascade,
  relation    text not null check (relation in ('resolves', 'duplicate')),
  confidence  text,
  reason      text,
  model       text,
  decided     text not null default 'pending' check (decided in ('pending', 'accepted', 'rejected')),
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  -- 같은 짝을 두 번 쌓지 않는다. 멱등의 전부다
  unique (left_id, right_id)
);

create index if not exists complaint_pairs_pending_idx on complaint_pairs (decided, created_at desc);

-- 중복으로 판정된 글. 지우지 않고 가리키기만 한다 — 출처가 둘이라는 사실 자체가 정보다
-- (카톡에 올라온 회신을 정책관이 카페에도 그대로 올린다)
alter table complaints add column if not exists duplicate_of uuid references complaints(id) on delete set null;
create index if not exists complaints_duplicate_idx on complaints (duplicate_of);

alter table complaint_pairs enable row level security;
