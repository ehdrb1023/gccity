-- 자료실 — 카톡방별 문서 보관소
--
-- 봇이 모으는 messages 와 별개다. 사람이 손으로 올리는 PDF·DOCX·이미지가 여기 쌓인다.
-- messages.attachment_* 컬럼에 얹지 않는 이유: 그것은 "어느 메시지에 딸린 첨부" 자리이고,
-- 여기 올라오는 것은 대개 대화가 지나간 뒤 사람이 따로 챙겨 넣는 자료라 붙일 메시지가 없다.

create table if not exists files (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  name       text not null,                    -- 사람이 보는 원본 파일명
  path       text not null unique,             -- Storage 안의 경로. 룸별로 갈라 둔다
  mime       text not null default '',
  size_bytes bigint not null default 0,
  note       text,                             -- 사람이 붙이는 한 줄 메모
  created_at timestamptz not null default now()
);

create index if not exists files_room_idx on files (room_id, created_at desc);

alter table files enable row level security;   -- 정책 없음 = 서버(service-role) 전용

-- 비공개 버킷. 브라우저는 서명 URL 로만 닿는다.
-- 공개로 만들면 경로를 아는 사람이 전부 받아갈 수 있다 — 거래처 문서가 올라올 자리다.
insert into storage.buckets (id, name, public, file_size_limit)
values ('room-files', 'room-files', false, 52428800)   -- 50MB
on conflict (id) do update set public = false, file_size_limit = 52428800;
