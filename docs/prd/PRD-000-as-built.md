# PRD-000: gccity 현재 서비스 (as-built)

- 상태: shipped
- 복잡도: H
- 작성: 2026-09-07
- 성격: 앞으로 만들 것이 아니라 **지금 돌고 있는 것**을 코드에서 역으로 뽑은 기준선 문서다.
  번호를 000 으로 둔 이유 — PRD-001 이후는 이 기준선 위에 얹히는 변경이다.
- 배포: https://gccity.vercel.app

## 1. 문제

과천시 시민 민원이 세 곳에 흩어져 있고 서로 이어지지 않는다.

| 흩어진 곳 | 문제 |
|---|---|
| 카카오톡 오픈채팅방 | 스크롤이 지나가면 사라진다. 검색이 안 된다. 사진은 만료된다 |
| 네이버 카페 게시판 | 민원 글과 처리 결과 글이 따로 올라오고 짝이 안 지어진다 |
| 시청 게시판 | 답변이 언제 달렸는지 세는 사람이 없다 |

그래서 "이 민원이 접수된 지 며칠 됐는지", "처리됐는지" 를 아무도 숫자로 못 댄다.
겪는 사람: 과천시 지역 활동가 1명(현재 유일 사용자).

## 2. 목표

- G1. 카톡·카페·시청 게시판의 민원을 한 곳에 모으고 사라지지 않게 보관한다
- G2. 민원 글과 처리 글을 짝지어 **처리 소요일수를 숫자로** 낸다
- G3. 모델은 초안만 내고 확정은 사람이 한다 — 통계에 추정치가 섞이지 않게

## 3. 비목표

- N1. 카톡에 글을 쓰지 않는다. 봇은 읽기 전용이다
- N2. 시청·카페에 자동 등록·자동 답변을 하지 않는다
- N3. 여러 사람이 쓰지 않는다. 워크스페이스·계정 개념이 없다 (개방은 PRD-001)
- N4. 모델이 민원 상태를 바꾸지 않는다. `new/doing/done/drop` 전이는 전부 사람 클릭이다
- N5. 실시간이 아니다. 크롤·요약은 하루 1회 크론이다
- N6. 모바일 전용 화면을 따로 만들지 않는다

## 4. 사용자 흐름

### 수집 (사람 개입 없음)
1. 폰의 MessengerBotR 이 카톡 알림을 받는다
2. 봇이 `chat.channelId` 로 **팔로우 중인 방인지 먼저 확인**한다. 아니면 본문을 만들지도 않고 버린다
3. 팔로우 방이면 `POST /api/bot/ingest` 로 보낸다 (`GCCITY_INGEST_TOKEN`)
4. 서버가 `msg_id` 로 멱등 처리한다 — 같은 메시지가 두 번 와도 1줄
5. 토큰이 없거나 틀리면 401 이고 아무것도 안 들어간다

### 민원 만들기 — 세 갈래
| 갈래 | 방법 |
|---|---|
| 카톡에서 | 대화 화면에서 메시지를 골라 `민원으로` 를 누른다 (`clip`) |
| 카페 글에서 | 목록을 통째로 붙여넣으면 파싱해서 초안으로 쌓는다 (`paste`) |
| 손으로 | 제목·본문을 직접 적는다 (`manual`) |

### AI 초안 → 확정
1. 크론(매일 23:00 UTC)이 등록된 시청·카페 소스를 크롤한다
2. 크론(매일 00:00 UTC)이 카톡 대화를 요약해 민원 후보를 뽑는다
3. 후보는 `ai_draft = true` 로 들어간다 — 목록·통계에 **안 잡힌다**
4. 사람이 `AI 초안` 보드에서 확인하고 확정을 누르면 목록에 올라온다
5. 아니면 지운다

### 처리 글 잇기
1. 모델이 "이 처리 글은 저 민원 같다" 를 제안한다 (`suggestPairs`)
2. 사람이 수락하면 처리 글이 민원 줄 안으로 접히고 상태가 `done` 이 된다
3. 거절하면 짝이 안 된다. 모델 제안만으로는 아무것도 안 바뀐다
4. 손으로도 이을 수 있다 — 민원 줄의 `[여기에 잇기]`

### 실패 경로
- 봇 설정 없음 → `/api/bot/config` 가 빈 목록을 준다. 봇은 아무 방도 안 따라간다 (fail-closed)
- `CRON_SECRET` 불일치 → 크론 라우트 401. 수집이 멈춘다
- `ANTHROPIC_API_KEY` 없음 → 요약·짝짓기가 에러를 던진다. 수집·목록은 계속 돈다
- 카톡 사진 URL 만료 → 만료 전에 서버가 받아 Supabase Storage 에 옮긴다 (`expireStalePreviews`)

## 5. 요구사항 (구현됨)

### 수집
- R1. 봇은 `chat.channelId` 하나만 방 판별 축으로 쓴다. 방 이름은 바뀌므로 쓰지 않는다
- R2. 멱등 키는 `log:<chat.logId>` 우선, 없으면 `msg:<ms>:<md5>`, 그것도 없으면 `fb:<sec>:<md5>`. `(room_id, msg_id)` 유니크
- R3. 봇은 팔로우 확인을 **본문 만들기 전에** 한다. 서버도 같은 순서로 검사한다
- R4. 보낸 사람 이름은 알림의 `sender_person` 을 먼저 보고, 없으면 `chat.author.name` 을 쓴다 (후자는 값이 굳는다)
- R5. `bot/*.js` 는 Rhino ES5 다 — 화살표 함수·`let`·`const`·템플릿 리터럴 금지

### 민원
- R6. 상태 4종: `new` `doing` `done` `drop`. 전이는 사람만
- R7. 종류 4종: `report`(민원) `resolution`(처리) `notice`(공지) `unknown`. 제목의 날짜 규칙이 작성자 등록부보다 우선
- R8. `kind_locked` 가 켜진 글은 재분류가 덮어쓰지 않는다
- R9. 목록에 서는 조건 = `ai_draft` 아님 AND 중복 아님 AND 처리글 아님 — `src/lib/complaint-view.ts:isListed` 한 곳에만 있다
- R10. 처리 글 본문에서 담당부서·기관·기한을 **정규식으로** 뽑는다 (`parseResolutionBody`). 모델을 쓰지 않는다

### 크롤
- R11. `robots.txt` 의 `Disallow` 를 지킨다 (`robotsDisallows`)
- R12. 소스별 키워드 대조 후 걸리는 글만 저장한다
- R13. RSS 와 HTML 목록 둘 다 파싱한다

### 통계
- R14. 흐름 요약에 **모수를 함께 적는다** — "평균 3일 (12건 기준)"
- R15. 소요일수는 접수일 → 처리일. 짝이 지어진 건만 센다

### 인증
- R16. 비밀번호 1개. 쿠키는 `SHA-256('gccity|v1|' + 비번)` 상수. 비번을 바꾸면 기존 쿠키가 전부 죽는다
- R17. `/api/bot/` `/api/cron/` 은 미들웨어를 통과하고 **라우트가 직접** 토큰·시크릿을 검사한다

## 6. 수용 기준 (현재 동작 = 회귀 기준선)

### 인증
- AC1. 쿠키 없이 `GET /` 를 부르면 307 로 `/login` 에 보낸다
- AC2. 쿠키 없이 `GET /api/complaints` 를 부르면 401 과 `{ok:false, reason:'unauthorized'}` 다
- AC3. `POST /api/login` 에 틀린 비번을 폼으로 보내면 303 으로 `/login?e=1` 에 보낸다
- AC4. 맞는 비번이면 303 으로 `/` 에 보내고 `gccity_auth` 쿠키를 굽는다 (`httpOnly` `secure` `sameSite=lax`, 30일)
- AC5. `GCCITY_PASSWORD` 가 비어 있으면 303 으로 `/login?e=unset` 에 보낸다 — 통과시키지 않는다

### 수집
- AC6. 토큰 없이 `POST /api/bot/ingest` 를 부르면 401 이고 `messages` 행이 안 는다
- AC7. 같은 `(room_id, msg_id)` 로 두 번 보내면 `messages` 행이 1개다
- AC8. 팔로우하지 않는 `channelId` 로 보내면 저장되지 않는다
- AC9. 봇 설정이 없으면 `GET /api/bot/config` 가 빈 방 목록을 준다 (fail-closed)
- AC10. `CRON_SECRET` 없이 `GET /api/cron/digest` 를 부르면 401 이다

### 민원 목록
- AC11. `ai_draft = true` 인 글은 `GET /api/complaints` 응답의 `complaints` 에 없다
- AC12. 상태별 칩 숫자를 전부 더하면 목록 줄 수와 같다 (`src/lib/complaint-view.test.ts`)
- AC13. `duplicate_of` 또는 `resolution_of` 가 채워진 글은 목록에 없다
- AC14. 출처(`origin`) 거르개를 카톡으로 바꿔도 좌측 `AI 초안` 건수는 안 바뀐다 — 초안 집계는 거르개를 안 받는다

### 분류
- AC15. 제목이 `[2026-08-12] ...` 형태면 작성자 등록부가 뭐라 하든 그 날짜를 접수일로 쓴다
- AC16. `kind_locked` 인 글에 `reclassify` 를 돌려도 `kind` 가 안 바뀐다
- AC17. 처리 글 본문에 `담당부서: 도시과` 가 있으면 `parseResolutionBody` 가 `도시과` 를 뽑는다

### 짝짓기
- AC18. 모델이 짝을 제안해도 사람이 수락하기 전에는 `complaints.resolution_of` 가 null 이다
- AC19. 수락하면 처리 글의 `resolution_of` 가 민원 ID 가 되고 민원 상태가 `done` 이 된다

### 크롤
- AC20. `robots.txt` 가 그 경로를 `Disallow` 하면 요청하지 않는다
- AC21. 소스의 키워드에 안 걸리는 글은 저장되지 않는다

## 7. 데이터·계약

### 테이블 (9종, `supabase/migrations/0001`~`0013`)
| 테이블 | 무엇 |
|---|---|
| `rooms` | 카톡 방. `channel_id` 가 판별 축, `followed` 가 수집 여부 |
| `messages` | 카톡 원문. `(room_id, msg_id)` 유니크 |
| `files` | 자료실 첨부. Supabase Storage 경로 |
| `complaints` | 민원·처리·공지 글 전부. `kind` `status` `ai_draft` `duplicate_of` `resolution_of` |
| `complaint_authors` | 작성자 등록부 — 이 사람이 쓰면 대체로 처리 글이다 |
| `complaint_sources` | 크롤 대상(시청·카페 게시판) + 키워드 |
| `complaint_pairs` | 민원↔처리 짝 제안·수락 기록 |
| `cafe_posts` | 붙여넣은 카페 글 보관 |
| `digest_runs` | 요약 크론 실행 기록 |
| `app_state` | 전역 1행 (`check (id = 1)`) — 방 찾기 모드, 설정 버전, 봇 심박 |

RLS 는 전 테이블 켜져 있고 정책은 0개다. 서버가 service-role 로만 붙는다.

### API (10개 라우트)
| 경로 | 메서드 | 인증 | 무엇 |
|---|---|---|---|
| `/api/login` | POST | 없음 | 폼 비번 검사 → 쿠키 |
| `/api/complaints` | GET/POST | 쿠키 | 조회 + 14개 동작 (`paste` `manual` `clip` `body` `status` `edit` `delete` `author-kind` `author-delete` `reclassify` `kind` `link` `unlink`) |
| `/api/rooms` | POST | 쿠키 | `add` `follow` `unfollow` `rename` `delete` `discovery` |
| `/api/files` | GET/POST | 쿠키 | `sign` `confirm` `download` `note` |
| `/api/state` | GET | 쿠키 | 방 찾기 모드·봇 심박 |
| `/api/bot/config` | GET | 봇 토큰 | 팔로우 방 목록 + 설정 버전 |
| `/api/bot/ingest` | POST | 봇 토큰 | 메시지 저장 |
| `/api/bot/photo` | POST | 봇 토큰 | 사진 저장 |
| `/api/cron/complaints` | GET | `CRON_SECRET` | 소스 크롤 |
| `/api/cron/digest` | GET | `CRON_SECRET` | 대화 요약 → 초안 |

### 크론 (`vercel.json`)
| 시각(UTC) | 경로 |
|---|---|
| `0 23 * * *` | `/api/cron/complaints` |
| `0 0 * * *` | `/api/cron/digest` |

### 모델
`claude-opus-5` (`GCCITY_DIGEST_MODEL` 로 덮어쓸 수 있다). 세 곳에서 부른다 — `digest.ts`(대화 요약), `cafe.ts`(카페 글 요약), `pair.ts`(짝 제안). 전부 `zodOutputFormat` 으로 구조화 출력을 강제한다.

## 8. 비기능

### 권한 규칙
| 주체 | 가능 | 불가 |
|---|---|---|
| 미로그인 | `/login` `/api/login` | 그 외 전부 (API 401, 화면 `/login`) |
| 로그인 사용자 | 전 데이터 읽기·쓰기 | 없음 — 권한 구분이 없다 |
| 봇 (`GCCITY_INGEST_TOKEN`) | 방 목록 읽기, 메시지·사진 쓰기 | 민원·파일 읽기, 설정 변경 |
| 크론 (`CRON_SECRET`) | 크롤·요약 실행 | — |

사용자가 1명이라 사용자 간 권한 구분이 존재하지 않는다. 이것이 PRD-001 의 출발점이다.

### 성능
- Vercel `icn1`(서울). 무거운 라우트에 `maxDuration = 300`
- 목록 조회 상한 300건, 집계 상한 5000건 — **300건을 넘기면 칩 숫자와 목록이 다시 어긋난다** (`src/server/complaints.ts` 주석에 적혀 있다)

### 개인정보
- 카톡 원문에 대화 참여자의 이름·연락처·주소가 그대로 들어온다
- 요약을 위해 원문이 Anthropic API 로 나간다 — 처리 위탁·국외 이전에 해당한다. 현재 마스킹도 고지도 없다 (미해결)
- 처리방침 문서 자체가 없다

## 9. 위험 (현재 남아 있는 것)

| 위험 | 영향 | 현재 상태 |
|---|---|---|
| 비번 1개 공유 | 주소를 아는 사람이 전부 본다 | 미해결 — PRD-001 |
| 로그인 레이트리밋·잠금 없음 | 무차별 대입 | 미해결 — PRD-001 R1 |
| 카톡 원문이 마스킹 없이 모델로 나감 | 개인정보 위탁 고지 의무 위반 소지 | 미해결 |
| 처리방침 부재 | 개인정보 처리 시 공개 의무 위반 소지 | 미해결 |
| 목록 300 / 집계 5000 불일치 | 민원 300건 넘으면 칩과 목록이 어긋난다 | 코드 주석에 명시, 미수정 |
| `Dashboard.tsx` 2571줄 | 변경마다 회귀 위험 | 분해 예정 |
| 봇이 401 을 조용히 삼킴 | 수집이 멈춰도 화면은 멀쩡하다 | `app_state.bot_last_seen_at` 심박으로 관측 |

## 10. 롤백

이 문서는 코드 변경이 아니라 기준선 기록이다. 되돌릴 것이 없다.
운영 롤백은 Vercel 이전 배포로 되돌리는 것이고, DB 는 Supabase 자동 백업 시점으로 복구한다.

## 11. 추적성

| 요구 | 수용 기준 |
|---|---|
| R1, R3 | AC8 |
| R2 | AC7 |
| R6 | AC18, AC19 |
| R7 | AC15 |
| R8 | AC16 |
| R9 | AC11, AC12, AC13, AC14 |
| R10 | AC17 |
| R11 | AC20 |
| R12 | AC21 |
| R16 | AC3, AC4, AC5 |
| R17 | AC1, AC2, AC6, AC9, AC10 |
