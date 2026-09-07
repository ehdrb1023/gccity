-- 0014 되돌리기. 두 컬럼을 지우면 기록해둔 배정·출동 시각도 함께 사라진다.
alter table complaints drop column if exists assigned_at;
alter table complaints drop column if exists visited_at;
drop index if exists complaints_sla_idx;
