/**
 * gccity 수집 봇 (메신저봇R · Android) — **읽기 전용**
 * ------------------------------------------------------------------
 * ★ 이 봇은 카톡에 한 글자도 쓰지 않는다.
 *   Api.replyRoom · bot.send · RemoteInput · chat.reply 를 부르는 코드가 이 파일에 없다.
 *   넣지 말 것 — 봇 계정이 방에 뭔가를 쓰는 순간 (1) 그 방 사람들에게 보이고
 *   (2) 카카오의 자동화 탐지 대상이 되며 (3) 계정이 정지되면 **수집까지 함께 멈춘다.**
 *   알림을 읽기만 하므로 카톡의 '읽음' 표시도 생기지 않는다.
 *
 * ★ 방 등록은 방 안에서 하지 않는다. `#등록` 같은 명령이 없다.
 *   그런 명령은 방 사람들에게 그대로 보인다. 방 선택은 전부 대시보드에서 한다.
 *
 * 동작:
 *   1) 서버에서 설정을 받아온다 — 팔로우할 방 열쇠 목록 + 방 찾기 모드 on/off
 *   2) 카톡 알림이 오면 방 열쇠를 만들고,
 *        · 팔로우 목록에 있으면 → 본문을 배치 큐에 넣는다
 *        · 없고 방 찾기 모드면 → 열쇠·발신자·본문 앞 12자만 넣는다
 *        · 없고 방 찾기 모드도 아니면 → **아무것도 안 보낸다** (개인 카톡이 폰을 못 벗어난다)
 *   3) 큐를 묶어서 한 번에 올린다
 *
 * fail-closed: 설정을 한 번도 못 받았으면 아무것도 보내지 않는다.
 *
 * 서버 배선:
 *   GET  {CONFIG_ENDPOINT}  헤더 X-Ingest-Token
 *        ← { ok, version, discovery, follow: ["<방열쇠>", …] }
 *   POST {INGEST_ENDPOINT}  헤더 X-Ingest-Token
 *        → { msgs: [{key,nameHint,group,sender,text,tsMs}],
 *            seen: [{key,nameHint,group,sender,preview,tsMs}] }
 *        ← { ok, inserted, skipped, dropped, configVersion, discovery }
 *
 * 설치:
 *   1) 메신저봇R 설치 → 알림 접근 권한 허용 → 배터리 최적화 제외
 *   2) 봇 새로 만들기 → 이 파일 전체 붙여넣기 → 아래 3줄 채우기 → 컴파일 ON
 *   3) 대시보드에서 "방 찾기 모드" 를 켜고, 목표 방에서 메시지가 오면 팔로우
 *
 * ⚠️ Rhino(ES5). 화살표 함수·let·const·템플릿 리터럴 금지.
 * ⚠️ TOKEN 을 채운 파일을 커밋하지 말 것. 저장소에는 플레이스홀더 상태로 둔다.
 */

// ── 설정 (이 3줄만 채우면 된다) ────────────────────────────────
var CONFIG_ENDPOINT = 'https://gccity.vercel.app/api/bot/config';
var INGEST_ENDPOINT = 'https://gccity.vercel.app/api/bot/ingest';
var TOKEN = '35879874352e279349044e92f29a1a1b2efba2f7125d6db67db3e3a96d8c65a9';   // 서버 env GCCITY_INGEST_TOKEN 과 같은 값

// ── 동작 옵션 ─────────────────────────────────────────────────

/**
 * 서버를 두드리는 주기. 이 값이 **대시보드의 봇 상태와 직접 묶여 있다** —
 * 화면은 3분 넘게 신호가 없으면 "지연", 30분이면 "끊김" 으로 본다.
 * 그러니 이 값을 3분 위로 올리면 멀쩡한 봇이 늘 "지연" 으로 뜬다. 올리지 말 것.
 *
 * 반대로 줄이면 서버 호출 수가 그대로 요금이 된다. speciai-kakao-bot 이 15초 폴링으로
 * 월 17만 번을 두드려 Vercel 사용량 초과(402)로 멈춘 적이 있다. 60초면 월 4만 번대다.
 * 방이 활발하면 인입 요청이 대신 심장박동을 찍으므로 실제 호출은 이보다 적다.
 */
var CONFIG_POLL_MS = 60000;

/** 배치를 묶는 시간·개수. 둘 중 먼저 닿는 쪽에서 보낸다. */
var BATCH_MS = 1500;
var BATCH_MAX = 30;

/** 백그라운드 루프 틱. 이 간격으로 큐와 설정을 점검한다. */
var TICK_MS = 5000;

/** 방 찾기 모드에서 올리는 본문 길이. 서버도 같은 값으로 한 번 더 자른다. */
var PREVIEW_CHARS = 12;

/** 큐 상한. 넘으면 오래된 것부터 버린다 — 무한히 쌓여 폰을 채우는 쪽이 더 나쁘다. */
var QUEUE_MAX = 500;

var HTTP_TIMEOUT_MS = 10000;

/** 알림에 실린 메시지 시각이 이보다 오래됐으면 재게시로 본다. */
/**
 * 이 시각보다 오래된 메시지는 버린다.
 *
 * 3분이었다가 1시간으로 늘렸다(2026-08-19). 카톡 알림의 android.messages 배열에는
 * 최근 8~9건이 한꺼번에 실려 오는데, 3분이면 그중 과거 것이 전부 잘려나갔다.
 * 봇이 잠깐 죽었다 살아나면 그 배열이 **유일한 복구 경로**다 — 잘라버릴 이유가 없다.
 *
 * 같은 알림이 여러 번 올라와도 CLAIM_TTL_MS 가 같은 값이라 다시 보내지 않고,
 * 그마저 뚫려도 서버의 (room_id, msg_id) 유니크가 막는다. 방어가 두 겹이다.
 */
var STALE_MS = 3600000;

var DEBUG = true;

// ── 상태 ──────────────────────────────────────────────────────

var _follow = {};            // 방 열쇠 -> true
var _discovery = false;
var _configVersion = 0;
var _configEverLoaded = false;   // ★ fail-closed 의 근거
var _lastConfigAt = 0;

var _qMsgs = [];
var _qSeen = [];
var _qSince = 0;

var _claims = {};
var _claimCount = 0;
var _claimSweptAt = 0;

/**
 * 이미 처리한 메시지를 기억하는 기간. STALE_MS 와 같은 값이어야 한다.
 * 짧으면 알림이 다시 올라올 때마다 같은 배열을 또 보낸다(서버는 멱등이라 저장은
 * 안 되지만 폰 배터리와 호출 수를 태운다). 길면 이 표가 커지므로 개수 상한을 같이 둔다.
 */
var CLAIM_TTL_MS = 3600000;
var CLAIM_MAX = 4000;

/**
 * ★ 방 찾기 중 후보 방의 본문을 담아두는 곳. **폰을 벗어나지 않는다.**
 *
 * 후보 단계에서 서버로 올라가는 것은 여전히 앞 12자뿐이다. 본문은 여기 메모리에만 있다가
 * 사람이 그 방을 팔로우하는 순간에만 올라간다. 팔로우하지 않은 방의 본문은 전송 구간을
 * 아예 지나가지 않는다는 원칙(CLAUDE.md 2)이 그대로 지켜진다.
 *
 * 이게 없으면 "방 찾기 켜기 → 방 알아보기 → 팔로우" 사이에 오간 대화가 통째로 날아간다.
 * 오픈채팅은 그 몇 분 사이에도 수십 건이 지나간다.
 *
 * 방 찾기가 꺼지면 즉시 버린다 — 개인 카톡 본문을 폰에 계속 들고 있지 않는다.
 */
var _buf = {};
var _bufRooms = 0;
var BUF_PER_ROOM = 80;
var BUF_ROOMS_MAX = 40;

var _sentTotal = 0;
var _seenTotal = 0;

function nowMs() { return java.lang.System.currentTimeMillis(); }

// ── HTTP ──────────────────────────────────────────────────────

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
    var body = readAll(stream);
    return { code: code, body: body };
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
    var body = readAll(stream);
    return { code: code, body: body };
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

// ── 설정 ──────────────────────────────────────────────────────

function refreshConfig() {
  _lastConfigAt = nowMs();
  var res = httpGet(CONFIG_ENDPOINT);
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
      var k = String(list[i]);
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

// ── 알림 파싱 ─────────────────────────────────────────────────

function exStr(ex, key) {
  try {
    var v = ex.get(key);
    if (v === null || v === undefined) return '';
    var s = String(v);
    return (s === 'null') ? '' : s;
  } catch (e) { return ''; }
}

/** 카톡이 채팅방 알림들 위에 얹는 묶음 알림. 본문도 방도 없어 처리하면 안 된다. */
function isSummaryNoti(sbn) {
  try {
    return (sbn.getNotification().flags & 0x00000200) !== 0;
  } catch (e) { return false; }
}

/** java.lang.Boolean 은 false 여도 객체다. !! 로 읽으면 항상 true 가 된다. */
function isGroupNoti(ex) {
  try {
    var v = ex.get('android.isGroupConversation');
    if (v !== null && v !== undefined) return String(v) === 'true';
  } catch (e) {}
  return false;
}

/**
 * 방 열쇠. speciai-kakao-bot 의 notiRoomKeyOf 와 같은 우선순위다.
 *
 * 값이 없거나 0 이면 건너뛴다 — 0 을 그대로 쓰면 **모든 방이 한 방으로 합쳐진다.**
 * 마지막 폴백 sbn.getKey() 는 절대 실패하지 않는다: 안드로이드는 같은 키의 알림을
 * 갱신으로 처리하므로, 알림창에 방 여러 개가 동시에 떠 있다는 것은 키가 서로 다르다는 뜻이다.
 */
function roomKeyOf(sbn, ex) {
  var cand = [];
  cand.push(exStr(ex, 'threadId'));
  cand.push(exStr(ex, 'chatId'));
  try { cand.push(String(sbn.getTag() || '')); } catch (e) {}
  try { cand.push(String(sbn.getId())); } catch (e2) {}
  for (var i = 0; i < cand.length; i++) {
    var v = cand[i];
    if (!v || v === '0' || v === 'null' || v === 'undefined') continue;
    return v;
  }
  try {
    var k = String(sbn.getKey() || '');
    if (k) return k.replace(/\|/g, '-');
  } catch (e3) {}
  return '';
}

/** 방 제목이 실려 오는 드문 경우를 위한 힌트. **매칭에는 절대 쓰지 않는다.** */
var TITLE_KEYS = [
  'android.conversationTitle',
  'android.hiddenConversationTitle',
  'android.subText'
];

function nameHintOf(ex) {
  for (var i = 0; i < TITLE_KEYS.length; i++) {
    var v = exStr(ex, TITLE_KEYS[i]);
    if (v) return v;
  }
  return '';
}

/**
 * ★ MessagingStyle 메시지 배열을 **전부** 푼다.
 *
 * 마지막 것만 읽으면 안 되는 이유: 오픈채팅처럼 초당 여러 건이 오는 방에서는 안드로이드가
 * 알림 갱신을 합쳐 배열에 2~7 건이 한 번에 실려 온다. 마지막 것만 읽으면 나머지는
 * **조용히 사라진다.** 화면에는 100건이 있는데 원래 130건이었다는 사실이 아무데도 안 남는다.
 * speciai-kakao-bot 의 notiTextOf/notiSenderOf 를 그대로 복사해 오지 말 것.
 */
function extractMessages(ex) {
  var out = [];
  var arr = null;
  try { arr = ex.get('android.messages'); } catch (e) { return out; }
  if (arr === null || arr === undefined) return out;

  var n = 0;
  try { n = arr.length; } catch (e2) { return out; }

  for (var i = 0; i < n; i++) {
    var b = null;
    try { b = arr[i]; } catch (eB) { continue; }
    if (!b || !b.get) continue;

    var sender = '';
    try {
      var p = b.get('sender_person');
      if (p !== null && p !== undefined) {
        var nm = p.getName();
        if (nm !== null && nm !== undefined) sender = String(nm);
      }
    } catch (eP) {}
    if (!sender) {
      try {
        var s = b.get('sender');
        if (s !== null && s !== undefined) sender = String(s);
      } catch (eS) {}
    }

    var text = '';
    try {
      var t = b.get('text');
      if (t !== null && t !== undefined) text = String(t);
    } catch (eT) {}

    var ms = 0;
    try {
      var tm = b.get('time');
      if (tm !== null && tm !== undefined) ms = parseFloat(String(tm));
    } catch (eM) {}

    if (!trim(text)) continue;   // 입장·퇴장 같은 시스템 메시지
    out.push({ sender: sender, text: text, tsMs: (ms > 0 ? ms : 0) });
  }
  return out;
}

function trim(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/^\s+|\s+$/g, '');
}

/**
 * 같은 메시지를 두 번 큐에 넣지 않는다.
 *
 * 열쇠에 **메시지 시각(ms)** 을 넣는 것이 핵심이다. speciai-kakao-bot 은 (발신자, 본문) 만
 * 봐서 20초 안에 같은 사람이 "ㅋㅋ" 를 두 번 치면 두 번째를 먹었다. 오픈채팅에서는
 * 늘 일어나는 일이다. 시각이 다르면 다른 메시지로 통과시킨다.
 */
function claim(key, m) {
  var now = nowMs();
  // TTL 이 길어졌으므로(1시간) 시간뿐 아니라 개수로도 쓸어낸다. 활발한 방은 금세 쌓인다.
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
  var id = key + '|' + m.tsMs + '|' + m.sender + '|' + trim(m.text).slice(0, 60);
  if (_claims[id] && (now - _claims[id]) < CLAIM_TTL_MS) return false;
  _claims[id] = now;
  _claimCount++;
  return true;
}

// ── 팔로우 직전 대화 버퍼 ─────────────────────────────────────

/** 방 찾기 중 후보 방의 본문을 폰 안에만 담아둔다. 전송하지 않는다. */
function bufferForFollow(item) {
  if (!_buf.hasOwnProperty(item.key)) {
    if (_bufRooms >= BUF_ROOMS_MAX) return;   // 개인 카톡이 많은 폰에서 무한정 늘지 않게
    _buf[item.key] = [];
    _bufRooms++;
  }
  var arr = _buf[item.key];
  arr.push(item);
  while (arr.length > BUF_PER_ROOM) arr.shift();
}

/** 사람이 그 방을 팔로우한 순간 — 담아둔 본문을 이제 올린다. */
function releaseBuffer(key) {
  var arr = _buf[key];
  if (!arr || arr.length === 0) return 0;
  for (var i = 0; i < arr.length; i++) enqueue(_qMsgs, arr[i]);
  var n = arr.length;
  delete _buf[key];
  _bufRooms--;
  Log.i('gccity: 팔로우 직전 대화 ' + n + '건을 올린다 (key=' + key + ')');
  return n;
}

/** 방 찾기가 끝나면 남은 것은 버린다. 개인 카톡 본문을 폰에 들고 있지 않는다. */
function clearBuffer() {
  if (_bufRooms === 0) return;
  Log.i('gccity: 방 찾기 종료 — 담아둔 후보 본문 ' + _bufRooms + '개 방분을 버린다');
  _buf = {};
  _bufRooms = 0;
}

// ── 큐 ────────────────────────────────────────────────────────

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

  var payload = JSON.stringify({ msgs: msgs, seen: seen });
  var res = httpPostJson(INGEST_ENDPOINT, payload);

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

// ── 알림 훅 ───────────────────────────────────────────────────

function onKakaoNoti(sbn) {
  try {
    var pkg = '';
    try { pkg = String(sbn.getPackageName()); } catch (eP) {}
    if (pkg.indexOf('kakao') < 0) return;
    if (isSummaryNoti(sbn)) return;

    // ★ fail-closed. 설정을 한 번도 못 받았으면 아무것도 안 보낸다.
    //   "무엇을 거를지 모르는 채로 거른다" 는 뜻이 되기 때문이다.
    if (!_configEverLoaded) {
      Log.e('gccity: 설정 미수신 — 아무것도 보내지 않는다');
      return;
    }

    var ex = sbn.getNotification().extras;
    var key = roomKeyOf(sbn, ex);
    if (!key) {
      Log.e('gccity: 방을 특정할 수 없는 알림 — 건너뛴다');
      return;
    }

    var followed = !!_follow[key];
    // ★ 팔로우도 아니고 방 찾기 모드도 아니면 여기서 끝난다.
    //   알림을 열지도, 본문을 만들지도 않는다. 개인 카톡은 이 폰을 못 벗어난다.
    if (!followed && !_discovery) return;

    var isGroup = isGroupNoti(ex);
    var hint = nameHintOf(ex);
    var items = extractMessages(ex);

    if (items.length === 0) {
      // messages 배열이 없는 축약·갱신 알림. 본문 자리만 있으면 1건으로 본다.
      var body = exStr(ex, 'android.bigText') || exStr(ex, 'android.text');
      var who = exStr(ex, 'android.title');   // 이 단말에서 title 은 발신자명이다
      if (trim(body)) items = [{ sender: who, text: body, tsMs: 0 }];
    }

    var queued = 0;
    for (var i = 0; i < items.length; i++) {
      var m = items[i];

      // 카톡은 같은 알림을 다시 올린다. 메시지 자신의 시각이 한참 지났으면 재게시로 본다.
      if (m.tsMs > 0 && (nowMs() - m.tsMs) > STALE_MS) continue;
      if (!claim(key, m)) continue;

      if (followed) {
        enqueue(_qMsgs, {
          key: key, nameHint: hint, group: isGroup,
          sender: m.sender, text: m.text, tsMs: m.tsMs
        });
      } else {
        // 방 찾기 모드 — 사람이 방을 알아볼 최소한만. 본문 전체를 절대 넣지 말 것.
        enqueue(_qSeen, {
          key: key, nameHint: hint, group: isGroup,
          sender: m.sender, preview: trim(m.text).slice(0, PREVIEW_CHARS), tsMs: m.tsMs
        });
        // 본문은 폰 안에만 둔다. 이 방을 팔로우하면 그때 함께 올라간다(bufferForFollow 주석).
        bufferForFollow({
          key: key, nameHint: hint, group: isGroup,
          sender: m.sender, text: m.text, tsMs: m.tsMs
        });
      }
      queued++;
    }

    if (DEBUG && queued > 0) {
      Log.i('gccity[' + (followed ? '수집' : '후보') + '] key=' + key
        + ' 배열=' + items.length + '건 큐=' + queued + '건');
    }

    if (queueDue()) flushAsync();
  } catch (e) {
    Log.e('gccity: 알림 처리 예외 — ' + e);
  }
}

/**
 * 알림 콜백은 메인 스레드로 오는 단말이 있다(NetworkOnMainThreadException).
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

function onNotificationPosted(sbn) {   // 구 API 전역 훅
  onKakaoNoti(sbn);
}

// ── 백그라운드 루프 ───────────────────────────────────────────
//
// 하는 일 둘: 밀린 큐 비우기, 설정 다시 받기.
// 설정 요청이 곧 심장박동이라 방이 조용해도 대시보드가 "봇 살아 있음" 을 안다.

/**
 * ★ 재컴파일이 남긴 좀비 루프를 죽인다.
 *
 * 메신저봇R 은 스크립트를 다시 컴파일해도 **이전에 띄운 데몬 스레드를 죽이지 않는다.**
 * 옛 스레드는 옛 스크립트의 변수를 그대로 붙들고 있어서, 주소를 채우기 전 버전이라면
 * 플레이스홀더 URL 로 60초마다 계속 실패하고(실측: `https://xn--<>-…` = `<배포도메인>`
 * 이 IDN punycode 로 변환된 것), 주소가 멀쩡하다면 **컴파일 횟수만큼 서버를 두드린다.**
 * 후자가 더 위험하다 — 조용히 요금만 곱해진다. speciai-kakao-bot 이 폴링 과다로
 * Vercel 402 를 맞아 멈춘 적이 있다.
 *
 * 그래서 세대 번호를 **JVM 시스템 속성**에 둔다. 스크립트 변수로는 안 된다 —
 * 옛 스레드는 옛 변수를 보기 때문에 새 스크립트가 무슨 값을 넣든 보이지 않는다.
 * 시스템 속성은 프로세스 전역이라 옛 스레드에도 그대로 읽힌다.
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
          if (queueDue()) flush();
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

// ── 진입점 ────────────────────────────────────────────────────

// 폰에 실제로 올라간 코드가 어느 것인지 첫 줄로 못 박는다.
// 붙여넣기가 안 먹었는데 먹은 줄 알고 원인을 엉뚱한 데서 찾은 적이 있다.
Log.i('gccity: 시작 v2026-08-19a — 읽기 전용. 카톡에 아무것도 쓰지 않는다.');

refreshConfig();
startLoop();

var _hooked = false;
try {
  if (typeof BotManager !== 'undefined' && BotManager.getCurrentBot) {
    var _bot = BotManager.getCurrentBot();
    if (_bot && _bot.on) {
      _bot.on(Event.NOTIFICATION_POSTED, onKakaoNoti);
      _hooked = true;
      Log.i('gccity: 알림 훅 등록 성공 (API2)');
    }
  }
} catch (e) {
  Log.e('gccity: API2 알림 훅 등록 실패 — ' + e);
}
if (!_hooked) Log.i('gccity: API2 미활성 — 구 API onNotificationPosted 로 동작한다');

// ★ 메시지 콜백(response / Event.MESSAGE)은 일부러 쓰지 않는다.
//   이 단말에서 그 경로는 room 자리에 발신자명을 넣어 넘긴다. 열쇠를 만들 수 없고,
//   억지로 만들면 같은 말이 서로 다른 두 방에 쌓인다. 알림 훅에 필요한 것이 전부 있다.
