-- 카톡 대화를 주기적으로 읽어 민원을 뽑는 층 (2026-08-21)
--
-- 사람이 말풍선마다 [민원] 을 누르는 것은 정확하지만 놓친다. 오픈채팅은 하루에 수백 건이
-- 지나가고, 민원은 그 사이에 흩어져 있다. 그래서 일정 시간마다 그동안 쌓인 대화를 모아
-- 모델에게 "여기서 민원이 무엇이냐" 를 묻고, 결과를 민원실에 **초안**으로 넣는다.
--
-- ★ 초안이지 확정이 아니다. `ai_draft = true` 인 행은 화면에서 배지가 붙고, 사람이 카페와
--   대조해 [확정] 하거나 [지우기] 한다. 모델이 넣은 것을 사람이 넣은 것처럼 보이게 하면
--   이 목록을 믿을 수 없게 된다.
alter table complaints add column if not exists ai_draft boolean not null default false;
alter table complaints add column if not exists ai_note  text;    -- 모델이 남긴 근거 한 줄
alter table complaints add column if not exists ai_model text;

create index if not exists complaints_ai_draft_idx on complaints (ai_draft) where ai_draft;

-- ── 분석 실행 기록 ────────────────────────────────────────────
--
-- 다음 창의 시작점(window_from)이 여기서 나온다. 성공한 마지막 실행의 window_to 부터
-- 다시 읽으므로 봇이 멈췄다 살아나도 구멍이 나지 않는다.
--
-- ★ 실패도 남긴다. 조용히 0건으로 끝나면 "요즘 민원이 안 잡히네" 를 몇 주 뒤에나 안다.
create table if not exists digest_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  window_from timestamptz not null,
  window_to   timestamptz not null,
  messages    integer not null default 0,   -- 창 안에서 읽은 메시지 수
  drafted     integer not null default 0,   -- 모델이 뽑은 민원 수
  added       integer not null default 0,   -- 그중 새로 담긴 수(나머지는 이미 있던 것)
  model       text,
  ok          boolean not null default false,
  error       text
);

create index if not exists digest_runs_time_idx on digest_runs (started_at desc);

alter table digest_runs enable row level security;   -- 정책 없음 = 서버 전용
