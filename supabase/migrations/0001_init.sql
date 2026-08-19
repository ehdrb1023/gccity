-- gccity 초기 스키마
--
-- 테이블 셋이 전부다. 늘리기 전에 정말 필요한지 물을 것.
--
-- ★ RLS 를 켜고 정책을 하나도 만들지 않는다.
--   Supabase 는 RLS 가 꺼져 있으면 anon 키로 PostgREST 를 통해 테이블을 그대로 읽을 수 있다.
--   이 앱은 브라우저가 Supabase 에 직접 말하지 않고 서버 라우트만 service-role 로 접근하므로,
--   "정책 없는 RLS" = 서버 외 전면 차단이다. 단일 사용자에 가장 단순하고 안전한 조합이다.
--   나중에 브라우저 직결이 필요해지면 그때 정책을 만들 것 — RLS 를 끄는 쪽으로 풀지 말 것.

create extension if not exists pgcrypto;

-- ── 방 ────────────────────────────────────────────────────────
--
-- room_key 는 봇이 알림 신원(tag·id·getKey)으로 만든 문자열이다. 방 이름이 아니다.
-- 이 단말의 카톡 알림에는 방 제목이 실려 오지 않기 때문이다(CLAUDE.md 참조).
-- 사람이 보는 이름은 display_name 이고, 대시보드에서 직접 적는다.
create table if not exists rooms (
  id                 uuid primary key default gen_random_uuid(),
  room_key           text not null unique,
  display_name       text,                  -- 사람이 붙인 이름. 없으면 화면은 name_hint→열쇠 순으로 보여준다
  name_hint          text,                  -- 알림에 방 제목이 실려 온 드문 경우. 표시용일 뿐 매칭에 쓰지 않는다
  followed           boolean not null default false,
  is_group           boolean not null default false,
  seen_count         integer not null default 0,   -- 이 방에서 온 알림 수(본문 저장 여부와 무관)
  message_count      integer not null default 0,   -- 실제 저장된 메시지 수
  last_seen_at       timestamptz,           -- 이 방에서 마지막으로 알림이 온 시각
  last_message_at    timestamptz,           -- 마지막으로 **저장된** 메시지 시각
  last_sender        text,                  -- 방 찾기용 단서. 방 찾기 모드가 꺼지면 서버가 비운다
  last_preview       text,                  -- 〃 본문 앞 몇 자. 저장이 아니라 식별용이다
  preview_expires_at timestamptz,           -- 이 시각이 지나면 last_sender·last_preview 를 비운다
  followed_at        timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists rooms_followed_idx on rooms (followed desc, last_seen_at desc nulls last);

-- ── 메시지 ────────────────────────────────────────────────────
--
-- 멱등은 (room_id, msg_id) 유니크 하나로 끝난다.
-- msg_id = 'noti:<알림이 준 메시지 시각 ms>:<md5(발신자|본문)>'
-- 부분 인덱스가 아니라 완전 유니크라 supabase-js 의
-- upsert(onConflict:'room_id,msg_id', ignoreDuplicates:true) 가 정상 동작한다.
create table if not exists messages (
  id              bigserial primary key,
  room_id         uuid not null references rooms(id) on delete cascade,
  msg_id          text not null,
  sender          text not null default '',
  body            text not null default '',
  sent_at         timestamptz not null,
  attachment_url  text,
  attachment_type text,          -- 'image' | 'file'
  attachment_name text,
  created_at      timestamptz not null default now(),
  unique (room_id, msg_id)
);

create index if not exists messages_room_time_idx on messages (room_id, sent_at desc, id desc);

-- ── 단일 상태 행 ──────────────────────────────────────────────
--
-- 워크스페이스가 없는 앱이라 전역 상태는 행 하나로 충분하다.
--
-- bot_last_gap_ms(직전 신호 간격)를 같이 남기는 이유: "재워짐(Doze)" 과 "죽음" 을 가르는
-- 유일한 단서다. Doze 는 간격만 벌리고 신호는 계속 오지만, 앱이 죽으면 끊긴다.
-- 쓰기를 아끼자고 간격을 뭉개면 이 구분이 사라진다. 아끼지 말 것.
create table if not exists app_state (
  id               smallint primary key default 1 check (id = 1),
  discovery_until  timestamptz,             -- 이 시각까지 방 찾기 모드. null·과거면 꺼진 것
  config_version   bigint not null default 1,  -- 봇이 설정을 다시 받아갈 신호
  bot_last_seen_at timestamptz,
  bot_last_gap_ms  integer,
  updated_at       timestamptz not null default now()
);

insert into app_state (id) values (1) on conflict (id) do nothing;

alter table rooms     enable row level security;
alter table messages  enable row level security;
alter table app_state enable row level security;
