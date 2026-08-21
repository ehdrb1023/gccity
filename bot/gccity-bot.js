/**
 * gccity 수집 봇 (메신저봇R · Android) — **읽기 전용**
 * ==================================================================
 * 빌드 표식. 폰에 붙여넣기가 실제로 먹었는지 로그 첫 줄과 대시보드 봇 상태 줄에서 확인한다.
 * 고칠 때마다 올릴 것 — 이게 없어서 "옛 코드가 도는 중" 을 "코드가 잘못됐다" 로 오진한 적이 있다.
 */
var BUILD = '2026-08-21-sender3';

/**
 * ★ 이 봇은 카톡에 한 글자도 쓰지 않는다.
 *   chat.reply · bot.send · Api.replyRoom · RemoteInput 을 부르는 코드가 이 파일에 없다.
 *   넣지 말 것 — 봇 계정이 방에 뭔가를 쓰는 순간 (1) 그 방 사람들에게 보이고
 *   (2) 카카오의 자동화 탐지 대상이 되며 (3) 계정이 정지되면 **수집까지 함께 멈춘다.**
 *   같은 이유로 방 안 명령어(`#등록` 같은 것)도 없다. 방 선택은 전부 대시보드에서 한다.
 *
 * ── 방을 무엇으로 가르는가: channelId ────────────────────────────
 *
 * API2 의 `chat.channelId` 는 카톡이 채팅방에 붙인 **고유 번호**다(예: 18409238712050393).
 * 예전 이 봇은 알림 신원(sbn.getTag()/getId())을 열쇠로 썼는데, 그건 카톡 재설치·업데이트로
 * 바뀌면 같은 방이 새 방으로 보여 수집이 **조용히** 멈췄다. channelId 는 흔들리지 않고,
 * 사람이 눈으로 읽어 대시보드에 그대로 칠 수 있다.
 *
 * 그래서 방을 정하는 길이 둘이다. 어느 쪽이든 된다.
 *   (1) 대시보드 [방 고르기] 에 channelId 를 친다   ← 권장. 개인 카톡을 한 건도 안 흘린다
 *   (2) 방 찾기 모드를 켜고 후보 목록에서 고른다     ← 숫자를 모를 때
 *
 * ⚠️ channelId 는 **API2 에서만** 온다(앱 공지: "레거시 API 에서 channelId·userHash·logId 를
 *    이용하지 못합니다 (API2 제외)"). API2 가 안 켜지면 이 봇은 방을 가를 수단이 없어
 *    아무것도 보내지 않는다. 대신 심장박동에 `api2=0` 을 실어 보내 대시보드가 그 사실을
 *    "⚠️ API2 꺼짐" 으로 드러낸다. **조용히 0건인 상태를 만들지 않는 것이 규칙이다.**
 *
 * ── 첨부: 사진은 가져오고, 파일은 이름만 (2026-08-20 결정) ───────
 *
 * 사진  알림에 실린 content:// URI 를 열어 바이트를 읽는다. 1600px·JPEG80 으로 줄여
 *       `/api/bot/photo` 로 한 장씩 올린다(배치에 섞으면 본문 상한 4.5MB 를 넘긴다).
 * 파일  PDF·한글 같은 문서는 **이름과 형식만** 올린다. 실물은 사람이 대시보드 자료실에
 *       끌어다 넣는다. 이름조차 안 남기면 "그때 그 견적서" 를 찾을 실마리가 없어진다.
 *
 * 첨부 바이트는 메시지 이벤트가 아니라 **알림**에만 실린다. 그래서 알림 훅을 남겨두되
 * 그 역할은 첨부 하나뿐이다 — 대화 수집은 전부 메시지 이벤트(channelId)가 한다.
 *
 * ★ 알림 훅은 첨부의 **주소만** 적어둔다. 바이트를 읽는 것은 그 메시지가 팔로우 방 것이라고
 *   확인된 뒤다. 팔로우하지 않은 방(=개인 카톡)의 사진은 폰 메모리에도 안 올라간다.
 *
 * ── fail-closed ─────────────────────────────────────────────────
 * 설정을 한 번도 못 받았으면 아무것도 보내지 않는다.
 * "무엇을 거를지 모르는 채로 거른다" 는 뜻이 되기 때문이다.
 *
 * ── 서버 배선 ───────────────────────────────────────────────────
 *   GET  {CONFIG_ENDPOINT}?build=&api2=&msgs=   헤더 X-Ingest-Token
 *        ← { ok, version, discovery, follow: ["<channelId>", …] }
 *   POST {INGEST_ENDPOINT}                      헤더 X-Ingest-Token
 *        → { msgs: [{channelId,nameHint,group,sender,text,tsMs,logId,att}],
 *            seen: [{channelId,nameHint,group,sender,preview,tsMs}] }
 *        ← { ok, inserted, skipped, dropped, configVersion, discovery }
 *   POST {PHOTO_ENDPOINT}                       헤더 X-Ingest-Token
 *        → { channelId, sender, text, tsMs, logId, name, mime, b64 }   사진 한 장 = 요청 한 번
 *        ← { ok, stored, reason }
 *
 * ── 설치 ────────────────────────────────────────────────────────
 *   1) 메신저봇R 에서 **API2 프로젝트**로 만든다 (그냥 만들면 레거시일 수 있다)
 *   2) 알림 접근 권한 허용 · 배터리 최적화 제외
 *   3) 이 파일 전체 붙여넣기 → 아래 TOKEN 줄 확인 → 컴파일 ON
 *   4) 대시보드 [방 고르기] 에 channelId 를 치거나, 방 찾기 모드로 고른다
 *
 * ⚠️ Rhino(ES5). 화살표 함수·let·const·템플릿 리터럴 금지.
 * ⚠️ TOKEN 을 채운 파일을 커밋하지 말 것. 저장소에는 플레이스홀더 상태로 둔다.
 */

// ── 1. 설정 (이 4줄만 보면 된다) ──────────────────────────────
var CONFIG_ENDPOINT = 'https://gccity.vercel.app/api/bot/config';
var INGEST_ENDPOINT = 'https://gccity.vercel.app/api/bot/ingest';
var PHOTO_ENDPOINT  = 'https://gccity.vercel.app/api/bot/photo';
var TOKEN = '<GCCITY_INGEST_TOKEN>';   // 서버 env GCCITY_INGEST_TOKEN 과 같은 값. ★ 채운 채로 커밋하지 말 것

// ── 2. 동작 옵션 ──────────────────────────────────────────────

/**
 * 서버를 두드리는 주기. 이 값이 **대시보드의 봇 상태와 직접 묶여 있다** —
 * 화면은 3분 넘게 신호가 없으면 "지연", 30분이면 "끊김" 으로 본다.
 * 그러니 3분 위로 올리면 멀쩡한 봇이 늘 "지연" 으로 뜬다. 올리지 말 것.
 *
 * 반대로 줄이면 호출 수가 그대로 요금이 된다(speciai-kakao-bot 은 15초 폴링으로 월 17만 번을
 * 두드려 Vercel 402 로 멈춘 적이 있다). 60초면 월 4만 번대다.
 */
var CONFIG_POLL_MS = 60000;

/** 배치를 묶는 시간·개수. 둘 중 먼저 닿는 쪽에서 보낸다. */
var BATCH_MS = 1500;
var BATCH_MAX = 30;

/**
 * 백그라운드 루프 틱. 큐·설정·첨부 대기표를 이 간격으로 점검한다.
 * 첨부 대기(ATTACH_WAIT_MS)를 이 틱이 처리하므로 초 단위여야 한다.
 */
var TICK_MS = 1000;

/** 방 찾기 모드에서 올리는 본문 길이. 서버도 같은 값으로 한 번 더 자른다. */
var PREVIEW_CHARS = 12;

/** 큐 상한. 넘으면 오래된 것부터 버린다 — 무한히 쌓여 폰을 채우는 쪽이 더 나쁘다. */
var QUEUE_MAX = 500;

var HTTP_TIMEOUT_MS = 15000;

/**
 * ★ 첨부를 기다리는 시간.
 *
 * 같은 카톡 메시지가 두 경로로 들어온다 — 메시지 이벤트(channelId 를 준다)와 알림(첨부
 * 주소를 준다). 순서는 폰 사정에 따라 뒤바뀐다. 사진처럼 보이는 메시지가 왔는데 알림이
 * 아직 안 왔으면 이만큼 기다렸다가 마저 처리한다.
 *
 * 너무 길면 대화가 밀려 보이고, 너무 짧으면 사진이 그냥 "사진을 보냈습니다" 텍스트가 된다.
 */
var ATTACH_WAIT_MS = 2500;

/** 알림에서 적어둔 첨부 주소의 유효 시간. 지나면 버린다(엉뚱한 메시지에 붙지 않게). */
var ATT_TTL_MS = 20000;

/**
 * ★ 발화자를 알아내려고 메시지를 잠깐 붙들어 두는 시간.
 *
 * 오픈채팅방에서는 `chat.author.name` 이 발화자가 아니라 알림 제목("오픈채팅봇")으로 온다
 * (실측 2026-08-21: 서로 다른 사람 아홉 명의 말이 전부 같은 이름으로 저장됐다).
 * 진짜 닉네임은 알림의 `android.messages[].sender_person` 에만 있어서, 그 알림이 도착할
 * 때까지 이만큼 기다린다. 순서는 폰 사정에 따라 뒤바뀐다 — 첨부를 기다리는 것과 같은 문제다.
 *
 * 길게 잡을 이유가 없다. 못 찾으면 원래 이름 그대로 올린다(메시지를 버리지는 않는다).
 */
var SENDER_WAIT_MS = 1200;

/** 알림에서 얻은 (본문 → 닉네임) 색인의 수명. 첨부 주소보다 길 이유가 없다. */
var SENDER_TTL_MS = 20000;
var SENDER_INDEX_MAX = 300;

/**
 * 같은 문구의 두 후보를 시각으로 가를 때, 이만큼도 안 벌어져 있으면 포기한다.
 * 알림 시각과 메시지 이벤트 도착 시각의 오차가 1~2초라 그보다 넉넉히 잡는다.
 */
var SENDER_TIE_MS = 4000;

/** author.name 이 이만큼 연속 같으면 굳은 것으로 보고 로그에 남긴다. */
var STICKY_RUN = 6;

/** 한 문구에 매달아 두는 후보 수. `ㅋㅋ` 같은 문구가 색인을 통째로 먹지 않게. */
var SENDER_SLOTS = 8;

/** 첨부·이름을 기다리는 대기표 상한. 넘치면 기다리지 않고 곧바로 보낸다. */
var PEND_MAX = 200;

/**
 * 발화자 자리에 오는 껍데기 이름들. 이 값이면 알림 쪽에서 진짜 닉네임을 찾아본다.
 *
 * '오픈채팅봇' 은 실제로 입장 안내를 보내는 계정이기도 하다 — 그래서 지우지 않고,
 * 알림이 더 나은 이름을 주면 그때만 바꾼다.
 */
var SENDER_ALIASES = { '오픈채팅봇': true, '카카오톡': true, 'KakaoTalk': true, '새 메시지': true };

/** 사진 크기. base64 는 원본의 4/3 이라 3MB 를 넘기면 서버 본문 상한에 걸린다. */
var IMAGE_MAX_SIDE = 1600;
var IMAGE_MAX_BASE64 = 3 * 1024 * 1024;

/** 사진 대기열. 바이트가 무거워 깊게 쌓지 않는다. 넘치면 가장 오래된 것을 버리고 흔적을 남긴다. */
var PHOTO_QUEUE_MAX = 6;
var PHOTO_MAX_TRIES = 5;

var DEBUG = true;

// ── 3. 상태 ───────────────────────────────────────────────────

var _follow = {};                // channelId -> true
var _discovery = false;
var _configVersion = 0;
var _configEverLoaded = false;   // ★ fail-closed 의 근거
var _lastConfigAt = 0;

var _api2 = false;               // 메시지 이벤트 리스너가 붙었는가
var _msgCount = 0;               // 봇이 켜진 뒤 받은 카톡 메시지 수(진단용)

var _qMsgs = [];
var _qSeen = [];
var _qSince = 0;
var _qPhoto = [];

var _pend = [];                  // 첨부를 기다리는 메시지들

/* 이름을 어디서 얻었는지 세어 심장박동에 싣는다. 폰에 가지 않고 진단하기 위한 것이다. */
var _senderFromIndex = 0;        // 알림 색인이 준 이름 (믿을 수 있는 쪽)
var _senderFromAuthor = 0;       // API2 chat.author.name 을 그대로 쓴 것 (굳을 수 있는 쪽)
var _lastAuthor = '';
var _authorRun = 0;
var _stickyWarnAt = 0;

var _claims = {};
var _claimCount = 0;
var _claimSweptAt = 0;
var CLAIM_TTL_MS = 3600000;
var CLAIM_MAX = 4000;

/**
 * ★ 방 찾기 중 후보 방의 본문을 담아두는 곳. **폰을 벗어나지 않는다.**
 *
 * 후보 단계에서 서버로 올라가는 것은 앞 12자뿐이다. 본문은 여기 메모리에만 있다가 사람이
 * 그 방을 팔로우하는 순간에만 올라간다. 이게 없으면 "방 찾기 켜기 → 알아보기 → 팔로우"
 * 사이에 오간 대화가 통째로 날아간다. 오픈채팅은 그 몇 분에도 수십 건이 지나간다.
 *
 * 방 찾기가 꺼지면 즉시 버린다 — 개인 카톡 본문을 폰에 계속 들고 있지 않는다.
 */
var _buf = {};
var _bufRooms = 0;
var BUF_PER_ROOM = 80;
var BUF_ROOMS_MAX = 40;

/** 알림이 적어둔 첨부 주소. 발신자명이 열쇠다(알림은 channelId 를 주지 않는다). */
var _attBySender = {};
var _attLast = null;

/**
 * 알림이 적어둔 (본문 앞부분 → 닉네임) 색인. 메시지 이벤트가 못 주는 발화자를 여기서 찾는다.
 *
 * ⚠️ 짝짓기 열쇠가 본문이라 같은 문구를 두 사람이 동시에 치면 어긋날 수 있다("ㅋㅋ").
 *    알림에 channelId 가 없어 방으로 좁힐 수 없다 — 첨부 짝짓기와 같은 종류의 한계다.
 */
var _senderByText = {};
var _senderCount = 0;
var _senderSweptAt = 0;
var _senderWarnAt = 0;

var _sentTotal = 0;
var _seenTotal = 0;
var _photoTotal = 0;

function nowMs() { return java.lang.System.currentTimeMillis(); }

function trim(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^\s+|\s+$/g, '');
}

// ── 4. HTTP ───────────────────────────────────────────────────

function httpGet(url) {
  var conn = null;
  try {
    conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod('GET');
    conn.setRequestProperty('X-Ingest-Token', TOKEN);
    conn.setRequestProperty('Accept', 'application/json');
    conn.setConnectTimeout(HTTP_TIMEOUT_MS);
    conn.setReadTimeout(HTTP_TIMEOUT_MS);
    var code = conn.getResponseCode();
    var stream = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
    return { code: code, body: readAll(stream) };
  } catch (e) {
    return { code: 0, body: String(e) };
  } finally {
    if (conn !== null) { try { conn.disconnect(); } catch (e2) {} }
  }
}

function httpPostJson(url, json) {
  var conn = null;
  try {
    conn = new java.net.URL(url).openConnection();
    conn.setRequestMethod('POST');
    conn.setDoOutput(true);
    conn.setRequestProperty('Content-Type', 'application/json; charset=utf-8');
    conn.setRequestProperty('X-Ingest-Token', TOKEN);
    conn.setConnectTimeout(HTTP_TIMEOUT_MS);
    conn.setReadTimeout(HTTP_TIMEOUT_MS);
    var os = conn.getOutputStream();
    os.write(new java.lang.String(json).getBytes('UTF-8'));
    os.flush();
    os.close();
    var code = conn.getResponseCode();
    var stream = (code >= 200 && code < 300) ? conn.getInputStream() : conn.getErrorStream();
    return { code: code, body: readAll(stream) };
  } catch (e) {
    return { code: 0, body: String(e) };
  } finally {
    if (conn !== null) { try { conn.disconnect(); } catch (e2) {} }
  }
}

function readAll(stream) {
  if (stream === null || stream === undefined) return '';
  var reader = null;
  try {
    reader = new java.io.BufferedReader(new java.io.InputStreamReader(stream, 'UTF-8'));
    var acc = '';
    var line;
    while ((line = reader.readLine()) !== null) acc += line;
    return acc;
  } catch (e) {
    return '';
  } finally {
    if (reader !== null) { try { reader.close(); } catch (e2) {} }
  }
}

// ── 5. 설정 ───────────────────────────────────────────────────

/**
 * 설정을 받아온다. 이 왕복이 곧 심장박동이다.
 *
 * 쿼리에 봇 자신의 상태(빌드·API2 여부·수신 건수)를 얹어 보낸다. API2 가 안 켜졌거나
 * 메시지 이벤트가 한 번도 안 왔다는 것은 화면 밖에서는 "그냥 조용함" 과 구분되지 않는다.
 */
function refreshConfig() {
  _lastConfigAt = nowMs();
  var url = CONFIG_ENDPOINT
    + '?build=' + encodeURIComponent(BUILD)
    + '&api2=' + (_api2 ? '1' : '0')
    + '&msgs=' + _msgCount
    // 이름을 무엇으로 붙였는지 — 알림 색인(sidx) 인지 API2 author(sauth) 인지.
    // 이 둘의 비율이 "이름이 왜 다 같은 사람이지" 를 폰에 가지 않고 가르는 유일한 단서다
    + '&sidx=' + _senderFromIndex
    + '&sauth=' + _senderFromAuthor;

  var res = httpGet(url);
  if (res.code !== 200) {
    // 사유를 그대로 남긴다. "조용히 성공하는 실패" 를 만들지 않는다.
    Log.e('gccity: 설정 수신 실패 code=' + res.code + ' ' + String(res.body).slice(0, 200));
    return false;
  }
  try {
    var obj = JSON.parse(res.body);
    if (!obj || !obj.ok) {
      Log.e('gccity: 설정 거부됨 — ' + String(res.body).slice(0, 200));
      return false;
    }
    var next = {};
    var list = obj.follow || [];
    for (var i = 0; i < list.length; i++) {
      var k = trim(list[i]);
      if (k) next[k] = true;
    }
    var changed = (_configVersion !== obj.version) || (_discovery !== !!obj.discovery);

    // ★ 새로 팔로우된 방이 있으면, 방 찾기 중 폰에 담아둔 본문을 그때 올린다.
    //   _follow 를 갈아끼우기 **전에** 비교해야 '새로' 를 알 수 있다.
    var released = 0;
    for (var fk in next) {
      if (next.hasOwnProperty(fk) && !_follow[fk]) released += releaseBuffer(fk);
    }

    _follow = next;
    _discovery = !!obj.discovery;
    if (!_discovery) clearBuffer();   // 방 찾기가 꺼지면 남은 후보 본문은 버린다
    if (released > 0) flushAsync();
    _configVersion = obj.version;
    _configEverLoaded = true;
    if (changed || DEBUG) {
      Log.i('gccity: 설정 v' + _configVersion + ' 팔로우=' + list.length + '개 방찾기=' + _discovery);
    }
    return true;
  } catch (e) {
    Log.e('gccity: 설정 파싱 실패 — ' + e);
    return false;
  }
}

// ── 6. 메시지 이벤트 (channelId 가 여기서만 온다) ─────────────

/** 객체에서 처음으로 값이 있는 칸. 앱 버전마다 이름이 조금씩 다르다. */
function pick(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    try {
      var v = obj[keys[i]];
      if (v !== null && v !== undefined) {
        var s = String(v);
        if (s && s !== 'null' && s !== 'undefined' && s !== '0') return s;
      }
    } catch (e) {}
  }
  return '';
}

function channelIdOf(chat) {
  var id = pick(chat, ['channelId', 'chatId']);
  if (id) return id;
  // 일부 버전은 room 객체 안에 넣는다.
  try {
    if (chat.room !== null && chat.room !== undefined && typeof chat.room !== 'string') {
      return pick(chat.room, ['channelId', 'chatId', 'id']);
    }
  } catch (e) {}
  return '';
}

function senderOf(chat) {
  try {
    if (chat.author && chat.author.name) return String(chat.author.name);
  } catch (e) {}
  try {
    if (chat.sender) return String(chat.sender);
  } catch (e2) {}
  return '';
}

/**
 * 이 이름을 그대로 믿어도 되는가.
 *
 * 오픈채팅방에서 메신저봇R 이 주는 `author.name` 은 발화자가 아니라 알림 제목이었다 —
 * `chat.room` 과 **글자 하나까지 같은 값**("오픈채팅봇")이 서로 다른 사람의 말에 전부 붙었다
 * (실측 2026-08-21, 두 방 17건). 단톡방에서 발화자명이 방 표시이름과 같다는 것은
 * 이름 칸이 비어 제목으로 떨어졌다는 뜻이지 그 사람이 정말 그 이름이라는 뜻이 아니다.
 */
function senderLooksBogus(sender, nameHint, group) {
  if (!sender) return true;
  if (SENDER_ALIASES.hasOwnProperty(sender)) return true;
  return !!(group && nameHint && sender === nameHint);
}

/** 본문을 색인 열쇠로 만든다. 알림과 메시지 이벤트의 본문이 끝에서 조금 다를 수 있어 앞만 쓴다. */
function textKey(text) {
  var t = trim(text).replace(/\s+/g, ' ');
  return t ? t.slice(0, 60) : '';
}

/**
 * 알림에서 얻은 닉네임을 (본문, 시각)으로 찾는다.
 *
 * ★ 본문만으로는 못 가른다. 오픈채팅에서 `ㅋㅋ`·`네`·`감사합니다` 는 하루에도 수십 번이고
 *   그때마다 이름을 포기하면 화면이 다시 `오픈채팅봇` 으로 덮인다. 그래서 같은 문구가
 *   여러 건이면 **시각으로 가른다** — 알림의 `time` 은 카톡이 찍은 메시지 시각이라
 *   봇이 메시지 이벤트를 받은 시각과 1~2초 안쪽이다.
 *
 * 두 후보가 그 정도로도 안 갈리면(같은 문구를 두 사람이 거의 동시에) 그때만 포기한다.
 * 틀린 이름을 붙이는 것이 뭉뚱그린 이름보다 나쁘다.
 */
function lookupSender(text, tsMs) {
  var k = textKey(text);
  if (!k) return '';
  var rec = _senderByText[k];
  if (!rec) return '';
  if ((nowMs() - rec.at) > SENDER_TTL_MS) {
    delete _senderByText[k];
    _senderCount--;
    return '';
  }

  var list = rec.list;
  if (list.length === 1) return list[0].sender;

  var best = null, bestD = 0, second = null, secondD = 0;
  for (var i = 0; i < list.length; i++) {
    var d = Math.abs(list[i].time - tsMs);
    if (best === null || d < bestD) {
      second = best; secondD = bestD;
      best = list[i]; bestD = d;
    } else if (second === null || d < secondD) {
      second = list[i]; secondD = d;
    }
  }
  if (best === null) return '';
  // 더 가까운 쪽이 다른 사람 것과 구분이 안 될 만큼 붙어 있으면 손대지 않는다.
  if (second !== null && second.sender !== best.sender && (secondD - bestD) < SENDER_TIE_MS) return '';
  return best.sender;
}

/**
 * 알림이 실어 온 (본문 → 닉네임) 을 적어둔다. **배열을 끝까지 훑는다.**
 *
 * 카톡 알림은 그 방의 최근 메시지를 여러 건 함께 싣는다. 마지막 것만 보면 그사이 지나간
 * 사람들의 이름을 놓친다 — 첨부(`notiAttachmentInfo`)와 정반대의 판단이다.
 * 첨부는 마지막 것만 봐야 하지만(옛 사진이 새 메시지에 다시 붙는다) 이름 색인은
 * 많을수록 좋다. 본문이 열쇠라 엉뚱한 메시지에 붙지 않는다.
 */
function indexSenders(ex) {
  var arr = exGet(ex, 'android.messages');
  if (arr === null) return;
  var n = 0;
  try { n = arr.length; } catch (e) { return; }
  if (n === 0) return;

  var now = nowMs();
  if ((now - _senderSweptAt) > SENDER_TTL_MS || _senderCount > SENDER_INDEX_MAX) {
    _senderSweptAt = now;
    var fresh = {};
    var kept = 0;
    for (var k in _senderByText) {
      if (_senderByText.hasOwnProperty(k) && (now - _senderByText[k].at) < SENDER_TTL_MS) {
        fresh[k] = _senderByText[k];
        kept++;
      }
    }
    _senderByText = fresh;
    _senderCount = kept;
  }

  var added = 0;
  var named = 0;      // 알림이 이름을 준 건수. 0 이면 이 폰에서는 이름 보정이 통째로 안 먹는다
  var shown = '';
  for (var i = 0; i < n; i++) {
    var b = null;
    try { b = arr[i]; } catch (eB) { continue; }
    if (!b || !b.get) continue;

    var who = '';
    try {
      var p = b.get('sender_person');     // API 28+ 는 Person 객체
      if (p !== null && p !== undefined && p.getName) {
        var nm = p.getName();
        if (nm !== null && nm !== undefined) who = String(nm);
      }
    } catch (eP) {}
    if (!who) {
      try {
        var sv = b.get('sender');         // 구형은 CharSequence
        if (sv !== null && sv !== undefined) who = String(sv);
      } catch (eS) {}
    }
    // 껍데기 이름은 색인하지 않는다 — 아래 android.text 폴백이 진짜 이름을 넣을 자리를 남긴다.
    if (!who || SENDER_ALIASES.hasOwnProperty(who)) continue;
    named++;

    var body = '';
    try {
      var t = b.get('text');
      if (t !== null && t !== undefined) body = String(t);
    } catch (eT) {}

    // 카톡이 찍은 메시지 시각. 같은 문구를 여러 사람이 쳤을 때 이걸로 가른다.
    var when = 0;
    try {
      var tm = b.get('time');
      if (tm !== null && tm !== undefined) when = parseFloat(String(tm));
    } catch (eM) {}
    if (!when || isNaN(when)) when = now;

    if (putSender(body, who, when, now) && added++ < 3) shown += ' | "' + who + '"←' + textKey(body).slice(0, 16);
  }

  // 폴백 — 이 폰의 알림이 `sender_person` 을 비워 두는 경우. 단톡방 알림의 본문 줄은
  // 흔히 "닉네임 : 내용" 꼴이다. 마지막 한 건밖에 못 얻지만 없는 것보다 낫다.
  if (added === 0) {
    var line = exGet(ex, 'android.text');
    if (line !== null) {
      var m = /^([^\n]{1,30}?)\s*:\s*([\s\S]+)$/.exec(String(line));
      if (m && !SENDER_ALIASES.hasOwnProperty(trim(m[1]))) {
        if (putSender(m[2], trim(m[1]), now, now)) {
          added++;
          shown += ' | (text)"' + trim(m[1]) + '"';
        }
      }
    }
  }

  if (DEBUG && added > 0) Log.i('gccity[알림이름] n=' + n + shown);
  if (named > 0 || added > 0) return;

  // 여기 걸리면 이 폰의 알림에 발화자가 없다는 뜻이다 — 오픈채팅 이름 보정이 통째로 안 먹는다.
  // 조용히 넘어가면 "이름이 왜 다 오픈채팅봇이지" 로 다시 돌아온다. 1분에 한 번만 짖는다.
  if ((now - _senderWarnAt) > 60000) {
    _senderWarnAt = now;
    var ttl = exGet(ex, 'android.title');
    Log.e('gccity: 알림에 발화자가 없다 (n=' + n + ' title="' + (ttl === null ? '' : String(ttl))
      + '") — bot/observe.js 의 [MSGS] 줄로 확인할 것');
  }
}

/**
 * 색인 한 칸. 같은 문구에 여러 사람을 매달아 둔다 — 고르는 것은 `lookupSender` 가 시각으로 한다.
 *
 * 같은 알림이 갱신되며 같은 메시지를 여러 번 실어 오므로, (닉네임, 시각)이 같으면 새 칸을
 * 만들지 않고 덮어쓴다. 안 그러면 `ㅋㅋ` 한 건이 후보 여덟 칸을 혼자 차지한다.
 */
function putSender(body, who, when, now) {
  var key = textKey(body);
  if (!key) return false;

  var rec = _senderByText[key];
  if (!rec) {
    _senderCount++;
    rec = _senderByText[key] = { at: now, list: [] };
  }
  rec.at = now;

  var list = rec.list;
  for (var i = 0; i < list.length; i++) {
    if (list[i].sender === who && Math.abs(list[i].time - when) < 1000) {
      list[i].time = when;
      return true;
    }
  }
  list.push({ sender: who, time: when });
  while (list.length > SENDER_SLOTS) list.shift();
  return true;
}

/**
 * 이 메시지의 발화자를 확정한다. 못 고치면 원래 이름 그대로 둔다 — 메시지를 버리지 않는다.
 * 이름을 바꿨는지 여부를 돌려준다(붙들고 더 기다릴지 정하는 데 쓴다).
 */
/**
 * 발화자 확정. **알림 색인이 먼저다. API2 의 chat.author.name 은 그 다음이다.**
 *
 * ★ 왜 뒤집었나 (실측 2026-08-21):
 *   17시 25분 이후 들어온 18건이 전부 `축하하는 죠르디` 로 저장됐다. 실제로는 좋은길·
 *   뜨악이·감동받은 어피치·갈현동·어피치가 섞인 대화였다. API2 의 author.name 이
 *   **한 사람 이름에 굳은** 것이다. 예전에는 `오픈채팅봇` 으로 뭉개졌는데(그건
 *   SENDER_ALIASES 로 걸러졌다) 이번엔 **그럴듯한 진짜 닉네임**으로 굳어서
 *   "껍데기일 때만 색인을 본다" 던 옛 규칙을 그대로 통과해 버렸다.
 *
 *   형제 프로젝트가 같은 함정을 먼저 밟았다 — speciai-kakao-bot 은 이은영이 쓴 글에
 *   author.name 이 폰 주인(조사랑)으로 오는 것을 보고 API2 수집을 아예 껐다
 *   (`speciai-bot.js` 머리말, 2026-08-20). 여기는 channelId 때문에 API2 를 못 끄니,
 *   **이름만 알림 쪽으로 넘긴다.**
 *
 * 색인은 (본문 앞 60자 + 카톡이 찍은 시각)으로 맞춘 것이라 굳지 않는다.
 * 색인에 없을 때만 author.name 을 쓰고, 그때는 몇 건 연속 같은 이름인지 세어 로그에 남긴다.
 */
function resolveSender(item) {
  var real = lookupSender(item.text, item.tsMs);
  if (real) {
    if (real !== item.sender) {
      if (DEBUG) Log.i('gccity[이름] "' + item.sender + '" → "' + real + '" (알림)');
      item.sender = real;
    }
    item.senderSrc = 'idx';
    return true;
  }

  if (senderLooksBogus(item.sender, item.nameHint, item.group)) return false;

  // 색인이 비었다 — author.name 으로 때운다. 굳었는지는 finalize 에서 센다
  // (sweepPending 이 같은 메시지로 여러 번 들어오므로 여기서 세면 숫자가 부푼다)
  item.senderSrc = 'author';
  return true;
}

/**
 * 같은 author.name 이 계속 나오면 굳은 것이다. 조용히 넘어가면 화면에서는
 * "한 사람이 혼자 떠드는 방" 으로 보인다 — 실제로는 여러 명인데 이름만 뭉갠 것이다.
 */
function noteStickyAuthor(name) {
  if (name === _lastAuthor) {
    _authorRun++;
  } else {
    _lastAuthor = name;
    _authorRun = 1;
  }
  if (_authorRun >= STICKY_RUN && (nowMs() - _stickyWarnAt) > 60000) {
    _stickyWarnAt = nowMs();
    Log.e('gccity: 같은 이름이 ' + _authorRun + '건 연속이다 (author="' + name
      + '") — 알림 색인이 비어 API2 이름을 쓰는 중. 알림 접근 권한·미리보기 설정을 볼 것');
  }
}

function textOf(chat) {
  try {
    if (chat.content !== null && chat.content !== undefined) return String(chat.content);
  } catch (e) {}
  try {
    if (chat.message !== null && chat.message !== undefined) return String(chat.message);
  } catch (e2) {}
  return '';
}

/**
 * 이 방의 표시 이름. **매칭에는 절대 쓰지 않는다.**
 *
 * 이 폰의 `chat.room` 은 방 제목이 아니라 알림 제목이라 단톡방에서 사람 이름이 오기도 한다
 * (실측 2026-08-20: room=[신동규]). 화면에서 후보를 알아볼 힌트로만 올린다.
 */
function nameHintOf(chat) {
  try {
    var rm = chat.room;
    if (rm === null || rm === undefined) return '';
    return (typeof rm === 'string') ? String(rm) : (rm.name ? String(rm.name) : '');
  } catch (e) { return ''; }
}

/**
 * 첨부가 딸렸을 법한 메시지인가. 첨부를 기다릴지 정하는 데만 쓴다.
 *
 * 카톡은 사진·파일 메시지의 본문 자리에 "사진을 보냈습니다" 류의 문구를 넣는다. 그 문구는
 * 카톡 버전·언어마다 달라서 맞히려 들면 진다 — 그래서 **넓게 잡고**, 실제 판단은 알림이
 * 첨부 주소를 줬는지로 한다. 헛기다림의 비용은 2.5초뿐이다.
 */
function looksLikeAttachment(text) {
  var t = trim(text);
  if (!t) return true;                       // 본문이 빈 메시지는 대개 첨부다
  if (t.length > 40) return false;
  return /사진|이미지|동영상|비디오|파일|음성|보냈습니다|Photo|Image|File/.test(t);
}

/**
 * 카톡 메시지 한 건. **여기가 수집의 유일한 입구다.**
 */
function onChat(chat) {
  try {
    _msgCount++;

    // ★ fail-closed. 설정을 한 번도 못 받았으면 아무것도 안 보낸다.
    if (!_configEverLoaded) return;

    var chId = channelIdOf(chat);
    if (!chId) {
      // 여기서 조용히 넘어가면 "봇은 도는데 아무것도 안 들어옴" 이 된다.
      Log.e('gccity: channelId 없는 메시지 — API2 프로젝트가 맞는지 확인할 것');
      return;
    }

    var followed = !!_follow[chId];
    // ★ 팔로우도 아니고 방 찾기 모드도 아니면 여기서 끝난다.
    //   본문을 만들지도, 첨부를 열지도 않는다. 개인 카톡은 이 폰을 못 벗어난다.
    if (!followed && !_discovery) return;

    var sender = senderOf(chat);
    var text = textOf(chat);
    var logId = pick(chat, ['logId']);
    var group = false;
    try { group = String(chat.isGroupChat) === 'true'; } catch (eG) {}

    var item = {
      channelId: chId,
      nameHint: nameHintOf(chat),
      group: group,
      sender: sender,
      text: text,
      tsMs: nowMs(),
      logId: logId
    };

    if (!claim(item)) return;

    if (!followed) {
      // 방 찾기 모드 — 사람이 방을 알아볼 최소한만. 본문 전체를 절대 넣지 말 것.
      // 여기서는 이름을 기다리지 않는다. 후보 목록은 힌트일 뿐이고, 기다린 만큼 개인 카톡
      // 본문을 폰에 더 오래 들고 있게 된다.
      resolveSender(item);
      enqueue(_qSeen, {
        channelId: chId, nameHint: item.nameHint, group: group,
        sender: item.sender, preview: trim(text).slice(0, PREVIEW_CHARS), tsMs: item.tsMs
      });
      // 본문은 폰 안에만 둔다. 이 방을 팔로우하면 그때 함께 올라간다.
      bufferForFollow(item);
      if (queueDue()) flushAsync();
      return;
    }

    // 팔로우 방 — 발화자(알림에만 있다)와 첨부 주소를 알림이 줄 때까지 잠깐 기다린다.
    // 색인에 없으면 알림이 올 때까지 잠깐 기다린다. resolveSender 가 false 를 주는 것은
    // "아직 진짜 이름을 못 얻었다" 는 뜻이고, author.name 으로 때운 경우도 굳었을 수 있으니
    // 색인 적중이 아니면 한 번은 기다려 본다.
    var named = resolveSender(item);
    var fromIndex = (item.senderSrc === 'idx');
    var wantsAtt = looksLikeAttachment(text);
    var att = takeAtt(item.sender);
    // 대기표가 넘치면 기다리지 않고 그냥 보낸다 — 이름이 덜 예쁜 것보다 대화를 잃는 쪽이 나쁘다.
    if (att === null && (wantsAtt || !named || !fromIndex) && _pend.length < PEND_MAX) {
      _pend.push({ item: item, until: nowMs() + (wantsAtt ? ATTACH_WAIT_MS : SENDER_WAIT_MS) });
      return;
    }
    finalize(item, att);
  } catch (e) {
    Log.e('gccity: 메시지 처리 예외 — ' + e);
  }
}

/**
 * 첨부까지 정해진 메시지를 큐에 넣는다.
 *
 * 사진이면 여기서 비로소 바이트를 읽는다 — 팔로우 방이라고 확인된 뒤다.
 * 파일이면 이름·형식만 실어 보낸다(바이트는 안 가져온다. 사람이 자료실에 넣는다).
 */
function finalize(item, att) {
  // 이름을 무엇으로 붙였는지는 여기서 한 번만 센다 — sweepPending 이 같은 메시지를
  // 여러 번 훑기 때문에 resolveSender 안에서 세면 숫자가 부풀고 헛경보가 뜬다
  if (item.senderSrc === 'idx') {
    _senderFromIndex++;
    _lastAuthor = item.sender;
    _authorRun = 1;
  } else if (item.senderSrc === 'author') {
    _senderFromAuthor++;
    noteStickyAuthor(item.sender);
  }

  if (att !== null && att.isImage) {
    var b64 = readImage(att);
    if (b64) {
      enqueuePhoto({
        channelId: item.channelId, sender: item.sender, text: item.text,
        tsMs: item.tsMs, logId: item.logId, name: att.name, mime: 'image/jpeg', b64: b64
      });
      if (DEBUG) Log.i('gccity[사진] ch=' + item.channelId + ' ' + b64.length + 'B "' + att.name + '"');
      return;
    }
    // 사진을 못 읽었어도 그 자리에 무엇이 왔는지는 남긴다.
    Log.e('gccity: 사진 바이트를 읽지 못했다 — 이름만 남긴다 "' + att.name + '"');
    item.att = { kind: 'image', name: att.name, mime: att.mime };
  } else if (att !== null) {
    item.att = { kind: 'file', name: att.name, mime: att.mime };
    if (DEBUG) Log.i('gccity[파일] ch=' + item.channelId + ' "' + att.name + '" (' + att.mime + ')');
  }

  enqueue(_qMsgs, item);
  if (queueDue()) flushAsync();
}

/**
 * 첨부를 기다리던 메시지들을 처리한다. **루프 스레드만** 부른다.
 *
 * 알림 훅에서도 부르고 싶어지지만(그러면 사진이 곧바로 붙는다) 그러지 말 것 —
 * 두 스레드가 같은 목록을 훑으면 같은 메시지를 두 번 보낸다. 1초(TICK_MS)면 충분히 빠르고,
 * 기다리는 상한(ATTACH_WAIT_MS)에 견줘도 무시할 만하다.
 *
 * 목록을 먼저 비우고(swap) 남은 것만 되돌려 넣는다. 그사이 메시지 스레드가 새로 밀어 넣은
 * 것을 통째로 덮어써 잃지 않기 위해서다.
 */
function sweepPending() {
  if (_pend.length === 0) return;
  var list = _pend;
  _pend = [];
  var now = nowMs();
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    resolveSender(p.item);   // 알림이 그사이 왔을 수 있다
    var att = takeAtt(p.item.sender);
    if (att !== null) {
      finalize(p.item, att);
    } else if (now >= p.until) {
      finalize(p.item, null);   // 첨부 없는 평범한 메시지였다
    } else {
      _pend.push(p);
    }
  }
}

// ── 7. 알림 훅 — 첨부 주소만 적어둔다 ─────────────────────────
//
// 첨부 바이트는 메시지 이벤트에 실려 오지 않는다(메신저봇R 은 알림 파싱 기반이라
// 알림에 없는 것은 줄 수 없다). 알림에는 MessagingStyle 메시지마다 두 칸이 있다.
//
//   uri   첨부의 content:// 주소     type  MIME (image/jpeg · application/pdf …)
//
// NotificationListenerService 는 알림에 실린 URI 에 **일시적 읽기 권한**을 받는다.
// 그래서 다른 앱(카톡)의 파일을 열 수 있다. 종류를 가리지 않는 권한이라 사진이 되면 파일도 된다.
//
// ⚠️ 그 권한은 알림이 살아 있는 동안만 유효하다. 몇 초 안에 읽어야 한다 —
//    그래서 ATT_TTL_MS 가 짧고, 대기(ATTACH_WAIT_MS)도 짧다.

function exGet(ex, key) {
  try {
    var v = ex.get(key);
    return (v === null || v === undefined) ? null : v;
  } catch (e) { return null; }
}

/** 카톡이 채팅방 알림들 위에 얹는 묶음 알림. 첨부도 방도 없다. */
function isSummaryNoti(sbn) {
  try {
    return (sbn.getNotification().flags & 0x00000200) !== 0;
  } catch (e) { return false; }
}

function appContext() {
  try { if (typeof App !== 'undefined' && App.getContext) return App.getContext(); } catch (e) {}
  try { if (typeof Api !== 'undefined' && Api.getContext) return Api.getContext(); } catch (e2) {}
  return null;
}

/**
 * 이 알림의 **마지막 메시지**에 실린 첨부. 앞엣것은 보지 않는다.
 *
 * ⚠️ 예전 speciai-kakao-bot 이 배열을 뒤에서부터 훑어 uri 가 있는 첫 번째를 썼다가 크게 물렸다 —
 *    카톡 알림은 그 방의 최근 메시지 여러 건을 함께 싣기 때문에, 사진 **다음에 온 텍스트**
 *    메시지의 알림에도 그 사진이 들어 있고, 훑어 내려가다 그걸 집어 새 메시지에 다시 붙였다
 *    (실측 2026-08-14). 마지막 한 건만 본다.
 */
function notiAttachmentInfo(ex) {
  var arr = exGet(ex, 'android.messages');
  if (arr === null) return null;
  var n = 0;
  try { n = arr.length; } catch (e) { return null; }
  if (n === 0) return null;

  var last = null;
  try { last = arr[n - 1]; } catch (e2) { return null; }
  if (!last || !last.get) return null;

  try {
    var uri = last.get('uri');
    if (uri === null || uri === undefined) return null;
    var mime = last.get('type');
    var sender = '';
    try {
      var p = last.get('sender_person');
      if (p !== null && p !== undefined && p.getName) sender = String(p.getName());
    } catch (eP) {}
    if (!sender) {
      try {
        var s = last.get('sender');
        if (s !== null && s !== undefined) sender = String(s);
      } catch (eS) {}
    }
    return {
      uri: (typeof uri === 'string') ? android.net.Uri.parse(uri) : uri,
      mime: (mime === null || mime === undefined) ? '' : String(mime),
      sender: sender
    };
  } catch (e3) {
    return null;
  }
}

/** content:// 의 원본 파일명. 알림 문구에 이름이 없어도 여기서 나온다. */
function uriDisplayName(uri) {
  var ctx = appContext();
  if (ctx === null) return '';
  var cur = null;
  try {
    cur = ctx.getContentResolver().query(uri, null, null, null, null);
    if (cur === null || !cur.moveToFirst()) return '';
    var idx = cur.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
    if (idx < 0) return '';
    var v = cur.getString(idx);
    return (v === null || v === undefined) ? '' : String(v);
  } catch (e) {
    return '';
  } finally {
    if (cur !== null) { try { cur.close(); } catch (e2) {} }
  }
}

/**
 * 알림이 왔다. 여기서 하는 일은 둘뿐이다 — **발화자 이름 색인**과 **첨부 주소 적어두기**.
 * 대화 수집은 하지 않는다(알림은 channelId 를 주지 않아 어느 방 것인지 모른다).
 *
 * ★ 바이트는 여기서 읽지 않는다. 팔로우 방이라고 확인된 뒤에 읽는다.
 *
 * ★ 이름 색인(`_senderByText`)은 **폰 메모리에만** 있다. 20초면 사라지고, 서버로 가는 것은
 *   이미 팔로우 방으로 확정된 메시지에 붙은 닉네임뿐이다. 이 색인을 전송 큐에 섞지 말 것 —
 *   개인 카톡 본문 앞 60자가 그대로 서버로 간다.
 */
function onKakaoNoti(sbn) {
  try {
    var pkg = '';
    try { pkg = String(sbn.getPackageName()); } catch (eP) { return; }
    if (pkg.indexOf('kakao') < 0) return;
    if (isSummaryNoti(sbn)) return;
    if (!_configEverLoaded) return;

    var ex = sbn.getNotification().extras;

    // ★ 첨부보다 먼저 한다. 첨부가 없는 알림에도 발화자는 실려 있다 —
    //   여기서 return 하면 텍스트 메시지의 이름을 통째로 잃는다.
    indexSenders(ex);

    var info = notiAttachmentInfo(ex);
    if (info === null) return;

    var rec = {
      uri: info.uri,
      mime: info.mime,
      name: uriDisplayName(info.uri),
      isImage: (info.mime.indexOf('image/') === 0),
      at: nowMs()
    };

    var who = info.sender;
    if (!who) {
      var t = exGet(ex, 'android.title');
      if (t !== null) who = String(t);   // 이 단말에서 title 은 발신자명이다
    }
    if (who) _attBySender[who] = rec;
    _attLast = rec;

    if (DEBUG) {
      Log.i('gccity[첨부알림] ' + (rec.isImage ? '사진' : '파일')
        + ' type="' + rec.mime + '" name="' + rec.name + '" from="' + who + '"');
    }

    // 이 첨부를 기다리던 메시지는 다음 틱(1초 안)에 루프가 붙여준다.
    // 여기서 직접 부르지 말 것 — sweepPending 주석 참조.
  } catch (e) {
    Log.e('gccity: 알림 처리 예외 — ' + e);
  }
}

function onNotificationPosted(sbn) {   // 구 API 전역 훅(있으면 같이 받는다)
  onKakaoNoti(sbn);
}

/**
 * 이 발신자의 첨부를 꺼낸다. **한 번만 쓴다** — 꺼내면 지운다.
 * 안 지우면 뒤따르는 텍스트 메시지에 같은 첨부가 또 붙는다.
 */
function takeAtt(sender) {
  var now = nowMs();
  var rec = sender ? _attBySender[String(sender)] : null;
  if (rec && (now - rec.at) < ATT_TTL_MS) {
    delete _attBySender[String(sender)];
    if (_attLast === rec) _attLast = null;
    return rec;
  }
  // 발신자명이 안 맞는 단말을 위한 폴백. 아주 최근 것만 — 넓히면 남의 사진이 붙는다.
  if (_attLast && (now - _attLast.at) < 1500) {
    var last = _attLast;
    _attLast = null;
    return last;
  }
  return null;
}

/**
 * 첨부 URI 를 열어 사진 바이트를 읽는다. 긴 변 1600px·JPEG80 으로 줄인다.
 *
 * 원본 그대로 보내면 base64 가 4MB 를 넘어 Vercel 함수 본문 상한에 걸린다.
 * 대화에 딸린 사진을 화면에서 알아보는 용도라 이 정도면 충분하다.
 */
function readImage(att) {
  var ctx = appContext();
  if (ctx === null) { Log.e('gccity: App.getContext() 없음 — 사진을 읽을 수 없다'); return null; }

  var stream = null;
  try {
    stream = ctx.getContentResolver().openInputStream(att.uri);
    if (stream === null) return null;
    var bmp = android.graphics.BitmapFactory.decodeStream(stream);
    if (bmp === null) return null;

    var w = bmp.getWidth();
    var h = bmp.getHeight();
    var scaled = bmp;
    if (w > IMAGE_MAX_SIDE || h > IMAGE_MAX_SIDE) {
      var ratio = (w > h) ? (IMAGE_MAX_SIDE / w) : (IMAGE_MAX_SIDE / h);
      scaled = android.graphics.Bitmap.createScaledBitmap(
        bmp, Math.round(w * ratio), Math.round(h * ratio), true);
    }
    var bos = new java.io.ByteArrayOutputStream();
    scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 80, bos);
    var bytes = bos.toByteArray();
    bos.close();

    var b64 = String(android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
    if (b64.length > IMAGE_MAX_BASE64) {
      Log.e('gccity: 사진이 상한 초과 — ' + b64.length + 'B, 이름만 남긴다');
      return null;
    }
    return b64;
  } catch (e) {
    // 알림이 이미 사라져 권한이 끊긴 경우가 대부분이다.
    Log.e('gccity: 사진 읽기 실패 — ' + e);
    return null;
  } finally {
    if (stream !== null) { try { stream.close(); } catch (e2) {} }
  }
}

// ── 8. 중복 선점 ──────────────────────────────────────────────

/**
 * 같은 메시지를 두 번 큐에 넣지 않는다.
 *
 * logId 가 있으면 그것만으로 충분하다. 없으면 (발신자, 본문, 시각)으로 떨어지는데,
 * 시각을 넣는 것이 핵심이다 — 오픈채팅에서 같은 사람이 "ㅋㅋ" 를 연달아 치는 일은 늘 있다.
 */
function claim(item) {
  var now = nowMs();
  if ((now - _claimSweptAt > CLAIM_TTL_MS) || _claimCount > CLAIM_MAX) {
    _claimSweptAt = now;
    var fresh = {};
    var n = 0;
    for (var k in _claims) {
      if (_claims.hasOwnProperty(k) && (now - _claims[k]) < CLAIM_TTL_MS) { fresh[k] = _claims[k]; n++; }
    }
    _claims = fresh;
    _claimCount = n;
  }
  var id = item.logId
    ? (item.channelId + '|log|' + item.logId)
    : (item.channelId + '|' + item.tsMs + '|' + item.sender + '|' + trim(item.text).slice(0, 60));
  if (_claims[id] && (now - _claims[id]) < CLAIM_TTL_MS) return false;
  _claims[id] = now;
  _claimCount++;
  return true;
}

// ── 9. 팔로우 직전 대화 버퍼 ──────────────────────────────────

function bufferForFollow(item) {
  if (!_buf.hasOwnProperty(item.channelId)) {
    if (_bufRooms >= BUF_ROOMS_MAX) return;   // 개인 카톡이 많은 폰에서 무한정 늘지 않게
    _buf[item.channelId] = [];
    _bufRooms++;
  }
  var arr = _buf[item.channelId];
  arr.push(item);
  while (arr.length > BUF_PER_ROOM) arr.shift();
}

/** 사람이 그 방을 팔로우한 순간 — 담아둔 본문을 이제 올린다. */
function releaseBuffer(channelId) {
  var arr = _buf[channelId];
  if (!arr || arr.length === 0) return 0;
  for (var i = 0; i < arr.length; i++) enqueue(_qMsgs, arr[i]);
  var n = arr.length;
  delete _buf[channelId];
  _bufRooms--;
  Log.i('gccity: 팔로우 직전 대화 ' + n + '건을 올린다 (ch=' + channelId + ')');
  return n;
}

/** 방 찾기가 끝나면 남은 것은 버린다. 개인 카톡 본문을 폰에 들고 있지 않는다. */
function clearBuffer() {
  if (_bufRooms === 0) return;
  Log.i('gccity: 방 찾기 종료 — 담아둔 후보 본문 ' + _bufRooms + '개 방분을 버린다');
  _buf = {};
  _bufRooms = 0;
}

// ── 10. 큐와 전송 ─────────────────────────────────────────────

function enqueue(list, item) {
  list.push(item);
  while (list.length > QUEUE_MAX) list.shift();
  if (_qSince === 0) _qSince = nowMs();
}

function queueDue() {
  if (_qMsgs.length === 0 && _qSeen.length === 0) return false;
  if (_qMsgs.length + _qSeen.length >= BATCH_MAX) return true;
  return _qSince > 0 && (nowMs() - _qSince) >= BATCH_MS;
}

function flush() {
  if (_qMsgs.length === 0 && _qSeen.length === 0) return;

  var msgs = _qMsgs;
  var seen = _qSeen;
  _qMsgs = [];
  _qSeen = [];
  _qSince = 0;

  var res = httpPostJson(INGEST_ENDPOINT, JSON.stringify({ msgs: msgs, seen: seen }));

  if (res.code !== 200) {
    // 되돌려 놓고 다음 틱에 다시 시도한다. 상한을 넘으면 오래된 것부터 버려진다.
    Log.e('gccity: 전송 실패 code=' + res.code + ' msgs=' + msgs.length
      + ' — 되돌려 재시도. ' + String(res.body).slice(0, 160));
    for (var i = 0; i < msgs.length; i++) enqueue(_qMsgs, msgs[i]);
    for (var j = 0; j < seen.length; j++) enqueue(_qSeen, seen[j]);
    return;
  }

  _sentTotal += msgs.length;
  _seenTotal += seen.length;

  try {
    var obj = JSON.parse(res.body);
    if (DEBUG) {
      Log.i('gccity: 전송 ok msgs=' + msgs.length + ' seen=' + seen.length
        + ' 저장=' + obj.inserted + ' 중복=' + obj.skipped
        + (obj.dropped ? ' 버림=' + obj.dropped : ''));
    }
    // 서버에서 팔로우·방 찾기 모드가 바뀌었으면 즉시 다시 받아온다.
    if (obj.configVersion && obj.configVersion !== _configVersion) {
      Log.i('gccity: 설정이 바뀌었다 (v' + _configVersion + ' → v' + obj.configVersion + ')');
      refreshConfig();
    }
  } catch (e) {}
}

/**
 * 사진 대기열. 바이트가 무거워 깊게 쌓지 않는다.
 *
 * 넘쳐서 버릴 때는 **버렸다는 사실을 대화에 남긴다** — 사진이 조용히 사라지면
 * 나중에 그 자리에 무엇이 있었는지 알 길이 없다.
 */
function enqueuePhoto(p) {
  _qPhoto.push(p);
  while (_qPhoto.length > PHOTO_QUEUE_MAX) {
    var lost = _qPhoto.shift();
    Log.e('gccity: 사진 대기열이 넘쳐 한 장을 버린다 — 흔적만 남긴다');
    noteLostPhoto(lost);
  }
}

function noteLostPhoto(p) {
  enqueue(_qMsgs, {
    channelId: p.channelId, sender: p.sender, text: p.text,
    tsMs: p.tsMs, logId: p.logId,
    att: { kind: 'image', name: p.name || '' }
  });
}

function flushPhotos() {
  if (_qPhoto.length === 0) return;
  var p = _qPhoto[0];

  var res = httpPostJson(PHOTO_ENDPOINT, JSON.stringify(p));
  if (res.code === 200) {
    _qPhoto.shift();
    _photoTotal++;
    if (DEBUG) Log.i('gccity: 사진 전송 ok ' + String(res.body).slice(0, 120));
    return;
  }

  p.tries = (p.tries || 0) + 1;
  Log.e('gccity: 사진 전송 실패 code=' + res.code + ' (' + p.tries + '/' + PHOTO_MAX_TRIES + ') '
    + String(res.body).slice(0, 160));
  if (p.tries >= PHOTO_MAX_TRIES) {
    _qPhoto.shift();
    noteLostPhoto(p);   // 포기하더라도 무엇이 왔는지는 남는다
  }
}

/**
 * 콜백은 메인 스레드로 오는 단말이 있다(NetworkOnMainThreadException).
 * 네트워크는 반드시 별도 스레드에서 돈다.
 */
function flushAsync() {
  try {
    var t = new java.lang.Thread(new java.lang.Runnable({
      run: function () {
        try { flush(); } catch (e) { Log.e('gccity: 전송 예외 — ' + e); }
      }
    }));
    t.setDaemon(true);
    t.start();
  } catch (eT) {
    // 스레드를 못 만들면 다음 백그라운드 틱이 대신 비운다.
    Log.e('gccity: 전송 스레드 생성 실패 — ' + eT);
  }
}

// ── 11. 백그라운드 루프 ───────────────────────────────────────
//
// 하는 일 넷: 첨부 대기표 정리, 밀린 큐 비우기, 사진 올리기, 설정 다시 받기.
// 설정 요청이 곧 심장박동이라 방이 조용해도 대시보드가 "봇 살아 있음" 을 안다.

/**
 * ★ 재컴파일이 남긴 좀비 루프를 죽인다.
 *
 * 메신저봇R 은 스크립트를 다시 컴파일해도 **이전에 띄운 데몬 스레드를 죽이지 않는다.**
 * 옛 스레드는 옛 스크립트의 변수를 붙들고 있어서, 컴파일 열 번이면 루프 열 개가 60초마다
 * 서버를 두드린다 — 실패보다 위험하다. 조용히 요금만 곱해진다.
 *
 * 그래서 세대 번호를 **JVM 시스템 속성**에 둔다. 스크립트 변수로는 안 된다 —
 * 옛 스레드는 옛 변수를 보기 때문에 새 스크립트가 무엇을 넣든 보이지 않는다.
 */
var GEN_KEY = 'gccity.loop.generation';
var MY_GEN = String(nowMs());

function loopSuperseded() {
  try {
    return String(java.lang.System.getProperty(GEN_KEY)) !== MY_GEN;
  } catch (e) {
    return false;   // 속성을 못 읽으면 살아 있는 쪽으로 둔다 — 멀쩡한 루프를 죽이지 않는다
  }
}

function startLoop() {
  try { java.lang.System.setProperty(GEN_KEY, MY_GEN); } catch (eP) {}

  var t = new java.lang.Thread(new java.lang.Runnable({
    run: function () {
      while (true) {
        if (loopSuperseded()) {
          Log.i('gccity: 새 컴파일 감지 — 옛 루프 종료 (gen ' + MY_GEN + ')');
          return;
        }
        try {
          sweepPending();
          if (queueDue()) flush();
          flushPhotos();
          if ((nowMs() - _lastConfigAt) >= CONFIG_POLL_MS) refreshConfig();
        } catch (e) {
          Log.e('gccity: 루프 예외 — ' + e);
        }
        try { java.lang.Thread.sleep(TICK_MS); } catch (eS) { return; }
      }
    }
  }));
  t.setDaemon(true);
  t.start();
}

// ── 12. 진입점 ────────────────────────────────────────────────

Log.i('━━━ gccity ' + BUILD + ' 시작 — 읽기 전용. 카톡에 아무것도 쓰지 않는다 ━━━');

var _bot = null;
try {
  if (typeof BotManager !== 'undefined' && BotManager.getCurrentBot) _bot = BotManager.getCurrentBot();
} catch (eB) {
  Log.e('gccity: BotManager 접근 실패 — ' + eB);
}

if (_bot && _bot.on) {
  // ★ 대화 수집은 전부 이 하나로 한다. channelId 가 여기서만 오기 때문이다.
  _bot.on(Event.MESSAGE, onChat);
  _api2 = true;
  Log.i('gccity: 메시지 훅 등록 (API2) — 방은 channelId 로만 가른다');

  // 알림 훅은 첨부 주소를 얻는 용도뿐이다. 대화는 여기서 수집하지 않는다.
  try {
    _bot.on(Event.NOTIFICATION_POSTED, onKakaoNoti);
    Log.i('gccity: 알림 훅 등록 — 첨부(사진·파일 이름) 전용');
  } catch (eN) {
    Log.e('gccity: 알림 훅 등록 실패 — 사진은 못 가져온다. ' + eN);
  }
} else {
  // 여기서 멈추지 않고 루프는 띄운다. 심장박동에 api2=0 이 실려 나가야
  // 대시보드가 "⚠️ API2 꺼짐" 으로 이 상태를 드러낸다. 조용히 죽지 않는 것이 규칙이다.
  Log.e('gccity: ★ API2 가 아니다 (BotManager/Event 없음). channelId 를 얻을 수 없어 '
    + '아무것도 수집하지 않는다. 메신저봇R 에서 **API2 프로젝트**로 다시 만들 것.');
}

refreshConfig();
startLoop();
