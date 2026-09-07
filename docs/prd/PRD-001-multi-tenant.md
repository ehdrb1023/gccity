# PRD-001: 여러 사람이 각자 쓰는 서비스로 개방

- 상태: draft
- 복잡도: H
- 작성: 2026-09-07

## 1. 문제

지금 gccity 는 **혼자 쓰는 콘솔**이다. 근거:

| 근거 | 위치 |
|---|---|
| 비밀번호 1개로 전원이 같은 화면에 들어온다 | `src/lib/auth.ts` — `SHA-256('gccity\|v1\|' + GCCITY_PASSWORD)` 상수 쿠키 |
| 봇 토큰이 전역 1개다 | `GCCITY_INGEST_TOKEN` 환경변수 |
| 방 찾기 모드·설정 버전이 전역 1행이다 | `supabase/migrations/0001_init.sql` — `app_state.id smallint check (id = 1)` |
| 소유자 개념이 있는 테이블이 0개다 | `rooms` `messages` `files` `complaints` `complaint_authors` `complaint_sources` `complaint_pairs` `cafe_posts` `digest_runs` 전부 소유 컬럼 없음 |
| 인가 검사가 있는 라우트가 0개다 | 10개 라우트 전부 — 미들웨어의 쿠키 유무 검사가 전부다 |

그래서 두 번째 사람에게 주소와 비밀번호를 주면 **첫 번째 사람의 카톡 원문·민원·첨부파일을 전부 본다.**
카톡 원문에는 대화 참여자의 이름·연락처·주소가 그대로 들어 있다 — 개인정보보호법상 제3자 제공에 해당하고 동의 근거가 없다.

겪는 사람: 이 도구를 쓰고 싶은 다른 지역 활동가·의원실. 현재는 레포를 각자 포크해서 Vercel·Supabase 를 따로 파는 것 외에 방법이 없다.

## 2. 목표

- G1. 한 배포에서 여러 사람이 계정을 만들고 **자기 데이터만** 보게 한다
- G2. 봇 토큰을 사람별로 발급·폐기한다 — 남의 토큰으로 남의 방에 글이 들어가지 않게
- G3. 소유권 검사를 애플리케이션 레이어 한 곳에 두고, 라우트마다 흩뿌리지 않는다

## 3. 비목표

이번에 하지 않는 것:

- N1. **조직·팀 공유.** 워크스페이스 1개 = 사람 1명. 여러 명이 한 워크스페이스를 같이 보는 기능은 다음 사이클
- N2. **역할 분리(관리자/편집자/열람자).** 소유자만 존재한다
- N3. **가입 개방.** 초대 코드가 있어야 가입된다 — 아무나 가입하면 Anthropic API 요금이 무제한으로 나간다
- N4. **기존 데이터의 다중 소유자 분할.** 지금 DB 에 든 것은 전부 첫 워크스페이스 소유로 넘긴다
- N5. **RLS 정책 작성.** 서버가 service-role 로만 붙는 구조를 바꾸지 않는다. 인가는 애플리케이션 레이어가 한다 (`docs/adr/ADR-001-multi-tenant.md`)
- N6. **결제·요금제.** 사용량 상한만 두고 과금은 하지 않는다

## 4. 사용자 흐름

### 가입
1. 사람이 `/signup` 에서 이메일·비밀번호·초대 코드를 넣는다
2. 초대 코드가 `invites` 에 있고 미사용이면 계정과 워크스페이스 1개를 만든다
3. 초대 코드가 없거나 이미 쓰였으면 400 과 `code=INVALID_INVITE` 를 준다 (어느 쪽인지 구분하지 않는다 — 코드 대조 공격 방지)
4. 같은 이메일이 이미 있으면 409 와 `code=EMAIL_TAKEN`

### 로그인
1. `/login` 에서 이메일·비밀번호
2. 맞으면 세션 쿠키를 굽고 `/` 로 보낸다
3. 틀리면 401 과 `code=BAD_CREDENTIALS` — 이메일 존재 여부를 노출하지 않게 문구를 하나로 쓴다
4. 5회 연속 실패하면 그 계정을 10분 잠근다. 잠긴 상태에서는 맞는 비밀번호도 429 와 `code=LOCKED`

### 봇 연결
1. 로그인한 사람이 설정 화면에서 `봇 토큰 발급` 을 누른다
2. 서버가 32바이트 난수를 만들어 **화면에 한 번만** 보여주고, DB 에는 SHA-256 해시만 남긴다
3. 사람이 그 토큰을 폰의 MessengerBotR 스크립트에 넣는다
4. 봇이 `/api/bot/config` 를 부르면 서버가 토큰 해시로 워크스페이스를 찾고 그 워크스페이스의 방 목록만 준다
5. 토큰이 틀리면 401. `재발급` 을 누르면 옛 토큰은 즉시 죽는다

### 조회
1. 로그인한 사람이 대시보드를 연다
2. 모든 조회가 자기 워크스페이스로 좁혀진다
3. 남의 리소스 ID 를 직접 넣으면 **404** 를 준다 (403 이 아니다 — 존재 여부를 노출하지 않는다)

## 5. 요구사항

### 필수
- R1. `users` 테이블 — 이메일, 비밀번호 해시(argon2id 또는 bcrypt cost≥12), 생성시각, 실패횟수, 잠금해제시각
- R2. `workspaces` 테이블 — 소유자 1명, 이름, 생성시각. 사람 1명당 1개
- R3. 데이터 테이블 9종 전부에 `workspace_id` 추가 + 외래키 + 인덱스
- R4. `app_state` 를 워크스페이스별 1행으로 바꾼다 — `id = 1` 제약 제거, 주키를 `workspace_id` 로
- R5. 봇 토큰을 `bot_tokens` 로 옮긴다 — 워크스페이스별, 해시 저장, 폐기 가능
- R6. 인가 헬퍼 1개(`src/server/authz.ts`)를 만들고 **모든** 데이터 접근 함수가 `workspaceId` 를 인자로 받게 한다
- R7. 세션은 서명된 쿠키로 사용자 ID 를 담는다. 현재의 상수 쿠키를 버린다
- R8. 초대 코드 테이블 — 코드 해시, 발급자, 사용자, 사용시각
- R9. 기존 데이터 이관 — 마이그레이션이 워크스페이스 1개를 만들고 기존 행 전부를 거기 붙인다
- R10. 워크스페이스별 사용량 상한 — 하루 Anthropic 호출 횟수, 메시지 수집 건수

### 선택
- R20. 비밀번호 재설정 메일
- R21. 워크스페이스 데이터 내려받기(JSON)
- R22. 탈퇴 시 데이터 삭제 잡

## 6. 수용 기준

### 격리
- AC1. 워크스페이스 A 로 로그인해 `GET /api/complaints` 를 부르면 응답의 모든 행이 `workspace_id = A` 다. B 의 행은 0건이다
- AC2. A 로 로그인해 B 소유 민원 ID 로 `PATCH /api/complaints` 를 부르면 404 와 `code=NOT_FOUND` 를 반환하고, B 의 행은 바뀌지 않는다
- AC3. A 로 로그인해 B 소유 파일 ID 로 `GET /api/files?id=...` 를 부르면 404 를 반환하고 응답 본문에 파일 바이트가 없다
- AC4. A 의 봇 토큰으로 `POST /api/bot/ingest` 를 부르면 메시지가 A 의 방에만 들어간다. 본문의 `channelId` 가 B 의 방이면 405 와 `code=UNKNOWN_ROOM` 을 반환하고 어느 테이블에도 행이 늘지 않는다
- AC5. A 로 로그인해 `GET /api/state` 를 부르면 A 의 `app_state` 행만 나온다. A 가 방 찾기 모드를 켜도 B 의 `discovery_until` 은 null 로 남는다
- AC6. `select` 를 부르는 서버 함수 전체 목록에 대해, `workspace_id` 조건이 없는 함수가 0개다 (테스트가 `src/server/*.ts` 를 훑어 판정한다)

### 인증
- AC7. 없는 이메일과 있는 이메일에 각각 틀린 비밀번호로 로그인하면 **같은 상태코드(401)와 같은 `code`(`BAD_CREDENTIALS`)** 를 반환한다
- AC8. 같은 계정에 틀린 비밀번호로 5회 연속 요청하면 6회째는 맞는 비밀번호여도 429 와 `code=LOCKED` 를 반환한다
- AC9. 10분이 지나면 같은 계정이 맞는 비밀번호로 200 을 받는다
- AC10. `users.password_hash` 는 `$argon2id$` 또는 `$2b$` 로 시작한다. `createHash('sha256')` 결과 형태(64자 hex)면 실패다
- AC11. 초대 코드 없이 `POST /api/signup` 을 부르면 400 과 `code=INVALID_INVITE`. 이미 쓰인 코드도 **같은** 400 과 같은 `code` 다
- AC12. 로그인 쿠키를 다른 사용자의 쿠키로 바꿔 넣어도 서명 검증이 깨져 401 이 난다

### 봇 토큰
- AC13. 토큰 발급 응답에는 평문 토큰이 1회 들어간다. 같은 토큰을 다시 조회하는 API 는 없다 — `GET` 으로 평문이 나오는 경로가 0개다
- AC14. `bot_tokens.token_hash` 에 평문 토큰 문자열이 들어 있지 않다
- AC15. 재발급 후 옛 토큰으로 `/api/bot/config` 를 부르면 401 이고, 새 토큰은 200 이다
- AC16. 토큰이 없는 `/api/bot/ingest` 요청은 401 이고 DB 행이 늘지 않는다 (fail-closed)

### 이관
- AC17. 마이그레이션 `0014` 를 적용하면 기존 `complaints` 행 수가 그대로고, 전부 같은 `workspace_id` 를 갖는다
- AC18. 마이그레이션 후 `workspace_id` 가 null 인 행이 9개 테이블 전체에서 0건이다
- AC19. 마이그레이션 적용 후 기존 봇 스크립트가 옛 전역 토큰으로 `/api/bot/config` 를 부르면 200 을 받는다 (한 사이클 동안 호환 유지 — R5 참조)

### 상한
- AC20. 한 워크스페이스가 하루 Anthropic 호출 상한에 닿으면 그 다음 호출은 429 와 `code=QUOTA_EXCEEDED` 를 반환하고, 다른 워크스페이스의 호출은 200 이다

## 7. 데이터·계약

### 새 테이블
| 테이블 | 열 |
|---|---|
| `users` | `id uuid pk`, `email citext unique`, `password_hash text`, `failed_count int default 0`, `locked_until timestamptz`, `created_at` |
| `workspaces` | `id uuid pk`, `owner_id uuid → users`, `name text`, `created_at` |
| `bot_tokens` | `id uuid pk`, `workspace_id uuid → workspaces`, `token_hash text unique`, `created_at`, `revoked_at` |
| `invites` | `id uuid pk`, `code_hash text unique`, `created_by uuid`, `used_by uuid`, `used_at` |
| `usage_counters` | `workspace_id`, `day date`, `ai_calls int`, `messages int`, pk `(workspace_id, day)` |

### 바뀌는 테이블 — 전부 파괴적
| 테이블 | 변경 | 파괴적인 이유 |
|---|---|---|
| `rooms` `messages` `files` `complaints` `complaint_authors` `complaint_sources` `complaint_pairs` `cafe_posts` `digest_runs` | `workspace_id uuid not null` 추가 | `not null` 이라 백필 없이는 기존 행이 거부된다 |
| `app_state` | `check (id = 1)` 제거, 주키를 `workspace_id` 로 교체 | 주키 교체 — 되돌리려면 행을 1개로 줄여야 한다 |
| `messages` | `(room_id, msg_id)` unique → `(workspace_id, room_id, msg_id)` | 유니크 축 변경. 멱등 키가 바뀐다 |

**단일 배포 금지.** `backend.md` 3절대로 확장→이중쓰기→백필→축소 4단계로 나눈다:
1. `0014` — 새 테이블 + `workspace_id` **nullable** 추가 + 기본 워크스페이스 1행 생성
2. `0015` — 코드가 새 열을 쓰기 시작 (읽기는 아직 null 허용)
3. `0016` — 기존 행 백필 (`update ... set workspace_id = <기본> where workspace_id is null`)
4. `0017` — `not null` 걸고 유니크 축 교체

### API 계약 변경
| 경로 | 변경 | 파괴적 |
|---|---|---|
| `POST /api/login` | 본문에 `email` 추가 (기존은 `password` 만) | 예 — 기존 쿠키 전부 무효 |
| `POST /api/signup` | 신규 | 아니오 |
| `POST /api/bot/token` | 신규 | 아니오 |
| `/api/bot/*` | 전역 토큰 → 워크스페이스 토큰. 한 사이클 동안 옛 토큰도 받는다 (AC19) | 유예 후 예 |
| 나머지 7개 라우트 | 응답 형태 그대로, 범위만 좁아진다 | 아니오 |

## 8. 비기능

### 권한 규칙
| 주체 | 가능 | 불가 |
|---|---|---|
| 미로그인 | `/login` `/signup` `/api/login` `/api/signup` | 그 외 전부 — API 는 401, 화면은 `/login` 리다이렉트 |
| 로그인 사용자 | 자기 워크스페이스의 모든 읽기·쓰기, 자기 봇 토큰 발급·폐기 | 남의 워크스페이스 리소스 — 404. 초대 코드 발급 |
| 봇(토큰) | 자기 워크스페이스 방 목록 읽기, 메시지·사진 쓰기 | 민원·파일 읽기, 설정 변경, 다른 워크스페이스 |
| 크론(`CRON_SECRET`) | 전 워크스페이스 순회 — 요약·수집 잡 | HTTP 응답으로 데이터 반환 |
| 초대 코드 발급 | 첫 워크스페이스 소유자만 (부트스트랩) | 그 외 |

미들웨어의 `PUBLIC_PATHS` 는 `/api/bot/` `/api/cron/` 을 그대로 통과시킨다. 두 경로는 **라우트가 직접** 토큰·시크릿을 검사한다 — 여기를 건드리면 봇이 로그인 HTML 을 받고 조용히 멈춘다.

### 성능
- 워크스페이스 조회는 `workspace_id` 인덱스를 탄다. 목록 응답 p95 500ms 이내(현재와 동일 수준 유지)
- `workspace_id` 를 모든 `where` 의 **첫 조건**으로 둔다

### 개인정보
- 카톡 원문에 제3자 개인정보가 들어 있다. 워크스페이스 간 교차 조회는 제3자 제공에 해당하고 동의 근거가 없다 — 그래서 격리가 이 PRD 의 존재 이유다
- 계정 이메일이 새 개인정보 항목이다. 처리방침에 수집 항목·목적·보유기간을 추가해야 한다 (`/privacy-sync` 로 대조)
- 비밀번호는 argon2id 로 저장한다. 로그에 이메일 전체를 남기지 않는다

## 9. 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| `workspace_id` 조건을 빠뜨린 함수가 남는다 | 교차 노출. 이 PRD 가 막으려던 것이 그대로 발생 | AC6 — 테스트가 `src/server/*.ts` 를 훑어 `workspace_id` 없는 select 를 0건으로 강제 |
| 백필 도중 새 행이 들어와 `workspace_id` 가 null 로 남는다 | `0017` 의 `not null` 이 실패하고 마이그레이션이 멈춘다 | `0015` 에서 코드가 먼저 쓰게 한다. `0017` 직전에 null 건수를 세고 0 이 아니면 중단 |
| 봇 토큰 교체 중 폰 스크립트를 못 고친다 | 수집이 멈춘다 — 봇은 401 을 조용히 삼킨다 | AC19 — 한 사이클 동안 옛 전역 토큰도 받는다. 폐기 시점을 따로 커밋 |
| 가입 개방으로 Anthropic 요금이 튄다 | 청구서 | N3 초대 코드 + R10 워크스페이스별 일일 상한 |
| `messages` 유니크 축 교체 중 중복이 들어온다 | 같은 카톡 메시지가 2줄 | `0017` 에서 옛 유니크를 지우기 **전에** 새 유니크를 먼저 만든다 |
| 세션 쿠키 서명 키가 유출된다 | 임의 사용자로 로그인 가능 | 키를 Vercel Secret 으로 두고 회전 절차를 ADR 에 적는다. 회전하면 전원 로그아웃 |

## 10. 롤백

단계별로 되돌리는 법이 다르다.

| 시점 | 되돌리는 법 |
|---|---|
| `0014` 적용 후 (열 nullable) | 코드만 이전 커밋으로 되돌린다. 새 열은 null 인 채 남겨둬도 기존 코드가 무시한다. 마이그레이션 되돌림 불필요 |
| `0015`~`0016` 적용 후 (이중쓰기·백필) | 위와 동일. 데이터 손실 없음 — 추가만 했다 |
| `0017` 적용 후 (`not null` + 유니크 교체) | `alter table ... alter column workspace_id drop not null` + 옛 유니크 재생성. `supabase/migrations/0017_down.sql` 로 미리 써 둔다 |
| 배포 후 로그인이 깨진 경우 | 이전 배포로 Vercel 롤백. 옛 상수 쿠키 방식이 되살아나고 `GCCITY_PASSWORD` 가 다시 먹는다 — 그래서 그 환경변수를 이 사이클에 지우지 않는다 |

전 단계 공통: Supabase 자동 백업 시점으로 복구 가능. 복구 전에 `select count(*) from complaints` 를 찍어 남긴다.

## 11. 추적성

| 요구 | 수용 기준 |
|---|---|
| R1 | AC10, AC7, AC8, AC9 |
| R2 | AC1, AC17 |
| R3 | AC1, AC2, AC3, AC18 |
| R4 | AC5 |
| R5 | AC13, AC14, AC15, AC16, AC19 |
| R6 | AC6 |
| R7 | AC12 |
| R8 | AC11 |
| R9 | AC17, AC18 |
| R10 | AC20 |
| 봇 격리 | AC4 |
