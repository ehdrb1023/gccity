-- 1·3·7 단계 시각.
--
-- 화면이 "접수부터 답변까지 기준 안에 처리됐는지" 를 세려면 세 시각이 있어야 하는데
-- 지금까지 있던 것은 `resolved_at`(답변) 하나뿐이었다. 배정·출동은 잴 데이터가 없었다.
--
-- ★ 추가만 한다. nullable 이고 기본값이 없으므로 기존 행은 그대로 있고, 이 파일을
--   적용하지 않은 상태의 옛 코드도 계속 돈다. 되돌리려면 두 컬럼을 drop 하면 된다.
--
-- ★ 적용 순서가 있다 — 이 마이그레이션을 **먼저** 넣고 그 다음에 배포한다.
--   새 코드는 select 목록에 두 컬럼을 적으므로, 컬럼이 없는 DB 에 배포하면
--   민원 조회가 통째로 실패한다.

alter table complaints add column if not exists assigned_at timestamptz;  -- 1 · 담당 부서 배정 (한도 12시간)
alter table complaints add column if not exists visited_at  timestamptz;  -- 3 · 현장 확인    (한도 36시간)

-- 준수율은 접수일 기준으로 계산한다. 접수일이 비어 있으면 어느 쪽으로도 세지 않는다.
create index if not exists complaints_sla_idx
  on complaints (reported_at)
  where reported_at is not null;
