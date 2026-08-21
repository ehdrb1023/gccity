-- 이름을 무엇으로 붙였는지 심장박동에 싣는다 (2026-08-21)
--
-- 실측: 17시 25분 이후 들어온 18건이 전부 `축하하는 죠르디` 로 저장됐다. 실제로는 여섯 명이
-- 섞인 대화였고, API2 의 chat.author.name 이 한 이름에 **굳은** 것이었다.
-- 그 상태는 화면에서 "한 사람이 혼자 떠드는 방" 과 똑같이 보인다 — 조용한 실패다.
--
-- 봇이 이름을 알림 색인에서 얻었는지(sender_idx) API2 author 로 때웠는지(sender_auth)를
-- 세어 보내면, 폰에 가지 않고 대시보드에서 그 둘을 가를 수 있다.
-- author 쪽만 늘고 있으면 알림 접근 권한·미리보기 설정을 봐야 한다는 뜻이다.
alter table app_state add column if not exists bot_sender_idx  integer;
alter table app_state add column if not exists bot_sender_auth integer;
