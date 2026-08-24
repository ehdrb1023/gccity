-- 민원마다 해결 내용 (2026-08-24)
--
-- ★ 왜 열로 두는가. 여태 해결 내용은 **별도 행**(kind='resolution')이었고, 민원과는
--   `resolution_of` 로 이어야만 한 줄로 읽혔다. 그러면 짝을 짓기 전까지 민원 줄의
--   부서 칸이 "배분 전" 으로 남는다 — 실제로는 회신이 이미 와 있는데도.
--
--   민원 한 건이 곧 한 행이고, 그 행에 해결 내용이 붙는다. 부서·회신 기관·완료 예정일·
--   회신 시각은 전부 **이 열에서** 규칙이 뽑는다. 짝짓기는 그 위에 얹는 보조 수단이 된다.
--
--   원문과 요약을 나눠 담는 이유는 민원 쪽과 같다 — 어디까지가 모델이 줄인 것이고
--   어디부터가 담당자가 쓴 말인지 화면에서 갈려야 한다.
alter table complaints add column if not exists resolution_text text;
alter table complaints add column if not exists resolution_summary text;
