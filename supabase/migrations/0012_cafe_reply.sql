-- 카페 글의 댓글 회신 (2026-08-24)
--
-- ★ 왜 본문과 따로 받는가. 정책관이 **댓글로** 회신하는 글이 있다. 본문 칸에 몰아 넣으면
--   모델이 한 건으로 뭉개서 민원이 통째로 사라지거나(회신만 남거나) 그 반대가 된다.
--   칸을 가르면 "본문=민원, 댓글=그에 대한 회신" 이라는 **구조를 사람이 알려주는** 셈이라
--   모델이 추측할 일이 없어진다.
--
--   그리고 소요일이 여기서 나온다 — 본문 작성일이 접수, 댓글 작성일이 회신이다.
alter table cafe_posts add column if not exists reply text;
alter table cafe_posts add column if not exists reply_posted_at timestamptz;
