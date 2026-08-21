-- 민원 → 처리 흐름을 재기 위한 층 (2026-08-21)
--
-- 지금까지 민원실은 "글 목록" 이었다. 목적은 그게 아니라 **흐름**이다 —
-- 민원이 언제 들어왔고, 며칠 걸려, 어떻게 처리됐는가.
-- 그러려면 같은 목록 안에 성격이 다른 세 종류의 글이 섞여 있다는 것을 인정해야 한다.
--
--   report      주민이 올린 민원 (애플망고 "지정타 근린3공원은 언제 완공될까요?")
--   resolution  처리·회신 기록   (조인길 정책관 "2026년 8월 20일(목) 양재천 냄새 민원")
--   notice      공지·홍보·보도자료 (과천문화재단, 행정복지센터, 보도자료…)
--
-- ★ 작성자만으로는 안 갈린다. `조인길 정책관` 한 계정이 처리 기록과 보도자료를 함께 쓴다.
--   그래서 작성자 명부(complaint_authors)와 제목 규칙을 **함께** 본다
--   (`src/server/complaint-classify.ts`).

-- ── 작성자 명부 ───────────────────────────────────────────────
--
-- 카페 게시판의 작성자는 사실상 고정된 명단이다. 기관 계정 한 번 찍어두면
-- 그 뒤로 올라오는 홍보글이 자동으로 걸러진다.
--   official  기관·홍보 계정 (기본 notice, 단 제목이 민원꼴이면 resolution)
--   resident  주민 (기본 report)
--   ignore    아예 목록에 안 띄운다
create table if not exists complaint_authors (
  name       text primary key,
  kind       text not null check (kind in ('official', 'resident', 'ignore')),
  note       text,
  created_at timestamptz not null default now()
);

-- ── 민원에 흐름 정보를 붙인다 ────────────────────────────────
alter table complaints add column if not exists kind text not null default 'unknown'
  check (kind in ('report', 'resolution', 'notice', 'unknown'));

-- 민원이 **접수된** 시각. 처리 글은 제목에 박혀 있고(제목 날짜), 주민 글은 글쓴 시각이다.
-- posted_at(글이 올라온 시각)과 다르다 — 이 둘의 차이가 곧 처리 소요일이다
alter table complaints add column if not exists reported_at timestamptz;
alter table complaints add column if not exists resolved_at timestamptz;

-- 처리 글이 어느 민원 글에 붙는지. 자동으로 잇지 않는다 — 사람이 화면에서 잇는다.
-- ★ 잘못 이은 짝은 통계를 조용히 망친다. 확신이 없으면 비워두는 편이 낫다
alter table complaints add column if not exists resolution_of uuid references complaints(id) on delete set null;

-- 본문에서 뽑아낸 것들. 처리 글 본문에는 접수·회신 시각이 분 단위로, 담당 부서가 이름으로,
-- 그리고 "…까지 공사 예정" 같은 약속이 들어 있다(실측 2026-08-21).
-- ★ due_at 이 남아 있으면 회신은 왔어도 **아직 안 끝난 건**이다. 회신=해결로 세지 말 것.
alter table complaints add column if not exists department text;
alter table complaints add column if not exists due_at timestamptz;

-- 사람이 화면에서 종류를 직접 고친 행. 재분류가 이걸 덮지 않는다 —
-- 명부를 손볼 때마다 사람이 고쳐둔 것이 되돌아가면 아무도 고치지 않게 된다
alter table complaints add column if not exists kind_locked boolean not null default false;

-- LLM 이 본문을 읽고 만든 한 줄 요약이 들어올 자리. 지금은 비어 있다.
-- (장황한 주민 글을 줄이는 용도. 본문 확보 경로가 정해지면 채운다)
alter table complaints add column if not exists summary text;

create index if not exists complaints_kind_idx on complaints (kind, coalesce(reported_at, posted_at, created_at) desc);
create index if not exists complaints_resolution_idx on complaints (resolution_of) where resolution_of is not null;

alter table complaint_authors enable row level security;   -- 정책 없음 = 서버 전용
