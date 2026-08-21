-- 방을 가르는 축을 바꾼다: 알림 열쇠(tag·id) → **channelId** (2026-08-20)
--
-- 왜:
--   메신저봇R API2 의 `chat.channelId` 는 카톡이 채팅방에 붙인 **고유 ID** 다.
--   알림 열쇠(sbn.getTag()/getId())와 달리 카톡 재설치·업데이트로 흔들리지 않고,
--   사람이 눈으로 읽어 대시보드에 그대로 칠 수 있다.
--   (실측 2026-08-20, speciai-network 브리핑 봇 폰: chat.channelId = 18409238712050393)
--
-- 이 마이그레이션은 손으로 두 번 돌려도 되게 전부 가드를 씌웠다.
-- 옛 행(알림 열쇠로 모은 방)은 **지우지 않는다** — 그 방에 쌓인 대화까지 cascade 로 날아간다.
-- 옛 열쇠는 숫자가 아니라서 대시보드가 "옛 열쇠" 로 표시하고, 사람이 직접 지울 수 있다.

-- ── 1. rooms.room_key → rooms.channel_id ──────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rooms' and column_name = 'room_key'
  ) then
    alter table rooms rename column room_key to channel_id;
  end if;
end $$;

-- ── 2. messages.attachment_url → attachment_path ──────────────
--
-- 값이 URL 이 아니라 **Storage 경로**다. 버킷이 비공개라 URL 은 볼 때마다 서명해서 만든다.
-- URL 을 저장하면 만료된 주소가 DB 에 남아 "왜 사진이 안 뜨지" 로 돌아온다.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'attachment_url'
  ) then
    alter table messages rename column attachment_url to attachment_path;
  end if;
end $$;

-- ── 3. 봇이 어떤 모습으로 붙어 있는지 ─────────────────────────
--
-- channelId 는 API2 에서만 온다. API2 가 안 켜지면 봇은 방을 가를 수단이 아예 없고,
-- 그때의 증상은 "조용히 아무것도 안 들어옴" 이다. 그 상태를 화면에 드러내려고
-- 봇이 심장박동에 자기 상태를 같이 실어 보낸다.
alter table app_state add column if not exists bot_build     text;
alter table app_state add column if not exists bot_api2      boolean;
alter table app_state add column if not exists bot_msg_count integer;

-- ── 4. 사진 버킷 ──────────────────────────────────────────────
--
-- 자료실(room-files)과 따로 둔다. 자료실은 **사람이 손으로 챙겨 넣는 문서** 목록이고,
-- 여기 들어오는 것은 대화에 딸린 사진이라 성격이 다르다. 한 버킷에 섞으면
-- 자료실 목록이 방금 지나간 짤로 뒤덮인다.
--
-- 봇은 긴 변 1600px·JPEG80 으로 줄여 올린다(base64 3MB 상한). 8MB 면 넉넉하다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('room-photos', 'room-photos', false, 8388608)
on conflict (id) do update set public = false, file_size_limit = 8388608;
