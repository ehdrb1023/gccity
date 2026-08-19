/**
 * gccity 0단계 관찰 하네스 (메신저봇R · Android)
 * ------------------------------------------------------------------
 * ★ 이 스크립트는 아무것도 수집하지 않는다. 서버로 한 바이트도 보내지 않고,
 *   카톡 방에 한 글자도 쓰지 않는다. 하는 일은 폰 로그에 관찰 결과를 남기는 것뿐이다.
 *
 * 목적 — CLAUDE.md "0단계" 의 세 가지를 실측으로 확정한다.
 *   ① 열쇠가 방마다 다른가        → [요약] 의 후보가 방 수만큼 갈라지는지 본다
 *   ② 열쇠가 시간이 지나도 같은가 → 재부팅 후 [이전관찰] 과 대조한다  ★ 제일 중요
 *   ③ 한 알림에 몇 건이 묶여 오나 → [MSGS] 줄의 인덱스가 2 이상 찍히는 빈도를 본다
 *
 * 쓰는 법:
 *   1) 메신저봇R 설치 → 알림 접근 권한 허용 → 배터리 최적화 제외
 *   2) 봇 새로 만들기 → 이 파일 전체 붙여넣기 → 컴파일 ON
 *   3) 목표 오픈채팅방에서 메시지가 오게 두고, **다른 단톡방에서도** 하나 받는다
 *      (①을 확인하려면 방이 둘 이상이어야 한다)
 *   4) 메신저봇R 로그를 열어 [요약] 줄을 본다. 목표 방의 후보를 지목한다
 *   5) **폰을 재부팅**하고 다시 메시지를 받아 [이전관찰] 과 tag·id 가 같은지 본다
 *   6) 결과를 docs/spike-log.md 에 붙여넣는다 → 그게 1단계 착수 승인서다
 *
 * ⚠️ 개인정보: 이 폰에는 개인 카톡도 함께 온다. 그래서 본문은 **앞 PREVIEW_CHARS 자만**
 *   남긴다(기본 6자). 목표 방을 사람이 알아보는 데 그 정도면 충분하고, 그 이상은 개인
 *   대화가 로그에 쌓인다는 뜻이다. 아예 끄려면 0 으로. 관찰이 끝나면 로그를 지울 것.
 *
 * ⚠️ Rhino(ES5) 환경이다. 화살표 함수·let·const·템플릿 리터럴을 쓰면 컴파일이 죽는다.
 */

// ── 설정 ──────────────────────────────────────────────────────

/** 본문 앞 몇 자를 로그에 남길지. 0 이면 길이만 남긴다. 방을 알아볼 최소치만 남길 것. */
var PREVIEW_CHARS = 6;

/** 알림 N 건마다 방 후보 요약을 다시 찍는다. 로그를 스크롤하지 않고 결론을 보기 위한 것. */
var SUMMARY_EVERY = 20;

/** 관찰 결과를 저장할 파일. ②(재부팅 후 열쇠 동일성) 확인의 유일한 근거다. */
var STATE_FILE = 'gccity-observe.json';

/** 한 알림에서 android.messages 를 최대 몇 건까지 풀어 찍을지. 로그 폭주 방지. */
var MSGS_LOG_MAX = 10;

// ── 상태 ──────────────────────────────────────────────────────

var _rooms = {};          // 열쇠 -> { n, first, last, tag, id, thread, chat, ch, group, sender, prev, maxMsgs }
var _count = 0;
var _keysDumped = false;
var _filePrefix = null;
var _fileProbed = false;
var _dirty = false;
var _savedAt = 0;

/** 저장 주기. 알림마다 파일을 쓰면 활발한 방에서 폰이 느려진다. */
var SAVE_EVERY_MS = 30000;

// ── 알림 파싱 ─────────────────────────────────────────────────

function exStr(ex, key) {
  try {
    var v = ex.get(key);
    if (v === null || v === undefined) return '';
    var s = String(v);
    return (s === 'null') ? '' : s;
  } catch (e) { return ''; }
}

/**
 * 카톡이 채팅방 알림들 위에 얹는 묶음(요약) 알림. 본문도 방 제목도 없어 세면 안 된다.
 * 이걸 안 거르면 요약 알림이 "방 후보" 하나를 차지해 목록이 헷갈린다.
 */
function isSummaryNoti(sbn) {
  try {
    var FLAG_GROUP_SUMMARY = 0x00000200;
    return (sbn.getNotification().flags & FLAG_GROUP_SUMMARY) !== 0;
  } catch (e) { return false; }
}

/**
 * 단톡방인가. java.lang.Boolean 은 값이 false 여도 **객체**라 !! 로 읽으면 항상 true 다.
 * 문자열로 비교해야 한다.
 */
function isGroupNoti(ex) {
  try {
    var v = ex.get('android.isGroupConversation');
    if (v !== null && v !== undefined) return String(v) === 'true';
  } catch (e) {}
  return false;
}

/**
 * 방 제목이 실려 올 수 있는 자리 전부. 이 단말은 전부 빈 값일 것으로 예상하지만,
 * 카톡 업데이트나 오픈채팅에서 값이 생기면 이름 기반으로 되돌아갈 수 있으므로 매번 찍는다.
 * android.title 은 후보에 넣지 않는다 — 이 단말에서 그 값은 발신자명이다.
 */
var TITLE_KEYS = [
  'android.conversationTitle',
  'android.hiddenConversationTitle',
  'android.subText',
  'android.summaryText',
  'android.infoText'
];

function titleCandidates(ex, ntitle) {
  var out = [];
  var found = false;
  for (var i = 0; i < TITLE_KEYS.length; i++) {
    var v = exStr(ex, TITLE_KEYS[i]);
    if (v) found = true;
    out.push(TITLE_KEYS[i].replace('android.', '') + '="' + v + '"');
  }
  out.push('title="' + ntitle + '"');
  return { text: out.join(' '), any: found };
}

/**
 * 이 알림이 가리키는 방의 열쇠. **관찰 단계에서는 판정하지 않고 다 기록한다** —
 * 어느 축이 살아 있는지가 0단계의 답이기 때문이다.
 *
 * 묶음 열쇠로는 sbn.getKey() 를 쓴다. 형식이 "user|패키지|id|tag|uid" 라 tag·id 를
 * 이미 포함하는 상위집합이고, 안드로이드가 같은 키의 알림을 갱신으로 처리하므로
 * **알림창에 여러 방이 동시에 떠 있다면 그 방들의 getKey() 는 반드시 서로 다르다.**
 */
function identityOf(sbn, ex) {
  var o = { tag: '', id: '', key: '', group: '', ch: '', thread: '', chat: '' };
  try { o.tag = String(sbn.getTag()); } catch (e) {}
  try { o.id = String(sbn.getId()); } catch (e) {}
  try { o.key = String(sbn.getKey()); } catch (e) {}
  try { o.group = String(sbn.getGroupKey()); } catch (e) {}
  // 오픈채팅과 일반 채팅이 다른 알림 채널을 쓰는지 — 쓰면 보조 검증축이 하나 생긴다.
  try { o.ch = String(sbn.getNotification().getChannelId()); } catch (e) {}
  o.thread = exStr(ex, 'threadId');
  o.chat = exStr(ex, 'chatId');
  return o;
}

function normKey(s) {
  if (!s) return '';
  return String(s).replace(/\|/g, '-');
}

/**
 * MessagingStyle 메시지 배열을 **전부** 풀어 본다.
 *
 * ★ 이게 ③의 답이다. speciai-kakao-bot 은 이 배열의 마지막 것만 읽는다. 오픈채팅처럼
 *   초당 여러 건이 오는 방에서는 안드로이드가 알림 갱신을 합쳐 배열에 2~7 건이 한 번에
 *   실려 오고, 마지막 것만 읽으면 **나머지는 조용히 사라진다.**
 *   여기서 인덱스가 2 이상 찍히는 빈도를 보고 수집 봇의 순회 여부를 결정한다.
 */
function dumpMessages(ex) {
  var out = { n: 0, lines: [], lastSender: '', lastText: '', lastTime: 0 };
  var arr = null;
  try { arr = ex.get('android.messages'); } catch (e) { return out; }
  if (arr === null || arr === undefined) return out;
  try { out.n = arr.length; } catch (e2) { return out; }

  var limit = (out.n < MSGS_LOG_MAX) ? out.n : MSGS_LOG_MAX;
  for (var i = 0; i < limit; i++) {
    var b = null;
    try { b = arr[i]; } catch (eB) {}
    if (!b || !b.get) continue;

    var sender = '';
    try {
      var p = b.get('sender_person');   // API 28+ 는 Person 객체
      if (p !== null && p !== undefined) {
        var nm = p.getName();
        if (nm !== null && nm !== undefined) sender = String(nm);
      }
    } catch (eP) {}
    if (!sender) {
      try {
        var s = b.get('sender');        // 구형은 CharSequence
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
      if (tm !== null && tm !== undefined) ms = parseFloat(String(tm));  // java.lang.Long
    } catch (eM) {}

    // 첨부가 실려 오는지도 본다(사진은 uri 가 있고, 카톡 파일은 없을 것으로 예상).
    var att = '';
    try {
      var u = b.get('uri');
      if (u !== null && u !== undefined && String(u) !== 'null') att = 'uri';
    } catch (eU) {}
    try {
      var ty = b.get('type');
      if (ty !== null && ty !== undefined && String(ty) !== 'null') att += (att ? '/' : '') + String(ty);
    } catch (eY) {}

    out.lines.push(i + ':sender="' + sender + '" time=' + (ms > 0 ? String(Math.round(ms)) : '없음')
      + ' len=' + text.length + (att ? ' att=' + att : ''));

    out.lastSender = sender || out.lastSender;
    out.lastText = text || out.lastText;
    if (ms > 0) out.lastTime = ms;
  }
  if (out.n > limit) out.lines.push('…+' + (out.n - limit) + '건');
  return out;
}

/** 본문 미리보기. 개인 대화가 로그에 쌓이지 않게 앞 N 자만. */
function preview(text) {
  if (!text) return '없음';
  var s = String(text).replace(/\s+/g, ' ');
  if (PREVIEW_CHARS <= 0) return s.length + '자';
  return '"' + s.slice(0, PREVIEW_CHARS) + '"(' + s.length + '자)';
}

// ── 관찰 기록 ─────────────────────────────────────────────────

function hhmm(ms) {
  try {
    var d = new java.util.Date(ms);
    var f = new java.text.SimpleDateFormat('MM-dd HH:mm');
    return String(f.format(d));
  } catch (e) { return String(ms); }
}

function now() { return java.lang.System.currentTimeMillis(); }

function record(k, ident, isGroup, msgs, hasTitle) {
  var r = _rooms[k];
  if (!r) {
    r = { n: 0, first: now(), last: 0, tag: ident.tag, id: ident.id,
          thread: ident.thread, chat: ident.chat, ch: ident.ch, group: isGroup,
          sender: '', prev: '', maxMsgs: 0, title: hasTitle ? 'Y' : 'N', neu: true };
    _rooms[k] = r;
    Log.i('gccity[새방] 후보 발견 → ' + k);
  }
  r.n++;
  r.last = now();
  r.group = isGroup;
  if (msgs.lastSender) r.sender = msgs.lastSender;
  if (msgs.lastText) r.prev = String(msgs.lastText).replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS > 0 ? PREVIEW_CHARS : 0);
  if (msgs.n > r.maxMsgs) r.maxMsgs = msgs.n;
  if (hasTitle) r.title = 'Y';
  // tag·id 가 도중에 바뀌면 그것 자체가 ②의 답이다. 덮어쓰지 말고 남긴다.
  if (r.tag !== ident.tag) { Log.e('gccity[⚠️변경] tag 가 바뀌었다 ' + r.tag + ' → ' + ident.tag + ' (열쇠=' + k + ')'); r.tag = ident.tag; }
  if (r.id !== ident.id) { Log.e('gccity[⚠️변경] id 가 바뀌었다 ' + r.id + ' → ' + ident.id + ' (열쇠=' + k + ')'); r.id = ident.id; }
  _dirty = true;
}

function printSummary(head) {
  var keys = [];
  for (var k in _rooms) { if (_rooms.hasOwnProperty(k)) keys.push(k); }
  Log.i('gccity[요약] ' + head + ' — 방 후보 ' + keys.length + '개 / 알림 ' + _count + '건');
  for (var i = 0; i < keys.length; i++) {
    var r = _rooms[keys[i]];
    Log.i('  [' + (i + 1) + '] n=' + r.n
      + ' tag=' + r.tag + ' id=' + r.id
      + ' thread=' + (r.thread || '없음') + ' chatId=' + (r.chat || '없음')
      + ' ch=' + r.ch
      + ' 단톡=' + r.group + ' 방제목=' + r.title
      + ' 최대묶음=' + r.maxMsgs
      + ' 발신자="' + r.sender + '" 미리보기="' + r.prev + '"'
      + ' ' + hhmm(r.first) + '~' + hhmm(r.last));
    Log.i('       열쇠=' + keys[i]);
  }
  if (keys.length === 1) {
    Log.e('gccity[요약] ⚠️ 후보가 1개다. 다른 단톡방에서도 메시지를 받아야 ①(방 구분)을 확인할 수 있다.');
  }
}

// ── 파일 (재부팅 후 대조용) ────────────────────────────────────
//
// 실측(speciai-kakao-bot): 이 단말은 FileStream 이 상대경로·/sdcard 어디에도 못 쓴다(NPE).
// Android 11+ 범위 지정 저장 때문이다. 그래서 앱 전용 디렉터리를 첫 후보로 두고,
// FileStream 이 실패하면 순수 Java IO 로 한 번 더 시도한다.

var EXTRA_PREFIXES = ['', '/sdcard/msgbot/', '/storage/emulated/0/msgbot/'];

function appContext() {
  try { if (typeof App !== 'undefined' && App.getContext) return App.getContext(); } catch (e) {}
  try { if (typeof Api !== 'undefined' && Api.getContext) return Api.getContext(); } catch (e2) {}
  return null;
}

function filesDirPrefix() {
  try {
    var ctx = appContext();
    if (ctx === null) return null;
    var dir = ctx.getFilesDir();
    if (dir === null) return null;
    return String(dir.getAbsolutePath()) + '/';
  } catch (e) { return null; }
}

function javaWrite(path, text) {
  var out = null;
  try {
    var f = new java.io.File(path);
    var parent = f.getParentFile();
    if (parent !== null && !parent.exists()) parent.mkdirs();
    out = new java.io.FileOutputStream(f);
    out.write(new java.lang.String(text).getBytes('UTF-8'));
    return true;
  } catch (e) { return false; }
  finally { if (out !== null) { try { out.close(); } catch (e2) {} } }
}

function javaRead(path) {
  var reader = null;
  try {
    var f = new java.io.File(path);
    if (!f.exists()) return null;
    reader = new java.io.BufferedReader(
      new java.io.InputStreamReader(new java.io.FileInputStream(f), 'UTF-8'));
    var acc = '';
    var line;
    while ((line = reader.readLine()) !== null) acc += line;
    return acc;
  } catch (e) { return null; }
  finally { if (reader !== null) { try { reader.close(); } catch (e2) {} } }
}

function fileWrite(path, text) {
  if (path === null) return false;
  try {
    if (typeof FileStream !== 'undefined') { FileStream.write(path, text); return true; }
  } catch (e) {}
  return javaWrite(path, text);
}

function fileRead(path) {
  if (path === null) return null;
  try {
    if (typeof FileStream !== 'undefined') {
      var raw = FileStream.read(path);
      if (raw !== null && raw !== undefined) return String(raw);
    }
  } catch (e) {}
  return javaRead(path);
}

function statePath() {
  if (_fileProbed) return _filePrefix === null ? null : _filePrefix + STATE_FILE;
  _fileProbed = true;
  var list = [];
  var priv = filesDirPrefix();
  if (priv !== null) list.push(priv);
  for (var i = 0; i < EXTRA_PREFIXES.length; i++) list.push(EXTRA_PREFIXES[i]);
  for (var j = 0; j < list.length; j++) {
    if (fileWrite(list[j] + 'gccity-probe.txt', 'ok')) {
      _filePrefix = list[j];
      Log.i('gccity: 상태 파일 경로 = ' + (_filePrefix || '(상대경로)'));
      return _filePrefix + STATE_FILE;
    }
  }
  // 파일을 못 쓰면 관찰은 계속되지만 **재부팅 후 대조(②)를 못 한다.** 조용히 넘기지 않는다.
  Log.e('gccity: ⚠️ 상태 파일을 쓸 수 없다 — 재부팅 후 대조(②)가 불가능하다. 로그를 직접 비교할 것.');
  return null;
}

function saveState(force) {
  if (!_dirty) return;
  if (!force && (now() - _savedAt) < SAVE_EVERY_MS) return;
  var p = statePath();
  if (p === null) return;
  try {
    fileWrite(p, JSON.stringify({ savedAt: now(), rooms: _rooms }));
    _savedAt = now();
    _dirty = false;
  } catch (e) { Log.e('gccity: 상태 저장 실패 — ' + e); }
}

/**
 * 지난 실행에서 본 방 후보를 찍는다. ★ 이 줄이 ②의 답이다.
 * 재부팅 뒤 같은 방에서 메시지를 받았을 때 tag·id 가 여기와 같으면 열쇠는 안정적이다.
 */
function printPrevious() {
  var p = statePath();
  if (p === null) return;
  var raw = fileRead(p);
  if (!raw) { Log.i('gccity[이전관찰] 없음 — 이번이 첫 실행이다'); return; }
  try {
    var obj = JSON.parse(raw);
    var keys = [];
    for (var k in obj.rooms) { if (obj.rooms.hasOwnProperty(k)) keys.push(k); }
    Log.i('gccity[이전관찰] ' + hhmm(obj.savedAt) + ' 저장 · 방 후보 ' + keys.length + '개');
    Log.i('gccity[이전관찰] ★ 아래 tag·id 가 지금도 같게 나오면 열쇠는 안정적이다(②ok)');
    for (var i = 0; i < keys.length; i++) {
      var r = obj.rooms[keys[i]];
      Log.i('  (이전) n=' + r.n + ' tag=' + r.tag + ' id=' + r.id
        + ' 발신자="' + r.sender + '" 미리보기="' + r.prev + '" ' + hhmm(r.last));
    }
    // 이어서 세면 재부팅 전후가 섞인다. 이전 것은 보여주기만 하고 새로 시작한다.
  } catch (e) { Log.e('gccity[이전관찰] 파싱 실패 — ' + e); }
}

// ── 알림 훅 ───────────────────────────────────────────────────

function onKakaoNoti(sbn) {
  try {
    var pkg = '';
    try { pkg = String(sbn.getPackageName()); } catch (eP) {}
    if (pkg.indexOf('kakao') < 0) return;
    if (isSummaryNoti(sbn)) return;

    var ex = sbn.getNotification().extras;
    var ntitle = exStr(ex, 'android.title');
    var ident = identityOf(sbn, ex);
    var isGroup = isGroupNoti(ex);
    var msgs = dumpMessages(ex);
    var cand = titleCandidates(ex, ntitle);

    // messages 가 없는 축약·갱신 알림도 있다. 그때는 bigText/text 로 미리보기를 만든다.
    var body = msgs.lastText || exStr(ex, 'android.bigText') || exStr(ex, 'android.text');

    var k = normKey(ident.key) || ('tag:' + ident.tag + '|id:' + ident.id);
    _count++;
    record(k, ident, isGroup, msgs, cand.any);

    Log.i('gccity[NOTI] #' + _count
      + ' tag=' + ident.tag + ' id=' + ident.id
      + ' thread=' + (ident.thread || '없음') + ' chatId=' + (ident.chat || '없음')
      + ' ch=' + ident.ch + ' groupKey=' + ident.group
      + ' 단톡=' + isGroup
      + ' 발신자="' + (msgs.lastSender || ntitle) + '"'
      + ' 본문=' + preview(body));

    // ★ ③ — 이 줄에 인덱스 1 이상이 자주 찍히면 배열 전량 순회가 필수다.
    Log.i('gccity[MSGS] n=' + msgs.n + (msgs.lines.length ? ' | ' + msgs.lines.join(' | ') : ' (배열 없음)'));

    // 방 제목이 어디에 실려 오는지. 전부 빈 값이면 이름 기반은 확정적으로 불가능하다.
    Log.i('gccity[TITLE] ' + cand.text);

    // extras 키 목록은 한 번만. 값이 아니라 키 이름만 남긴다.
    if (!_keysDumped) {
      _keysDumped = true;
      try {
        var ks = ex.keySet().toArray();
        var names = [];
        for (var i = 0; i < ks.length; i++) names.push(String(ks[i]));
        Log.i('gccity[KEYS] ' + names.join(' '));
      } catch (eK) { Log.e('gccity[KEYS] 덤프 실패 — ' + eK); }
    }

    if (_count % SUMMARY_EVERY === 0) printSummary('중간');
    saveState(false);
  } catch (e) {
    Log.e('gccity[NOTI] 파싱 예외 — ' + e);
  }
}

// 구 API 전역 훅. 지원하지 않는 버전이면 호출되지 않는다(무해).
function onNotificationPosted(sbn) {
  onKakaoNoti(sbn);
}

/**
 * 메신저봇R 의 메시지 콜백. **관찰만 한다.**
 * 알림 훅과 서로 독립된 이벤트라 순서가 보장되지 않는다는 것을 여기서 눈으로 확인한다
 * (수집 봇에서 두 경로를 어떻게 합칠지가 이 관찰에 달려 있다).
 */
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  try {
    Log.i('gccity[구API] room="' + room + '" sender="' + sender + '" 단톡=' + isGroupChat
      + ' 본문=' + preview(msg)
      + (String(room) === String(sender) ? ' ← room 이 발신자명이다(방 이름 못 읽음)' : ''));
  } catch (e) {}
}

// ── 진입점 ────────────────────────────────────────────────────

Log.i('gccity: 관찰 시작 v2026-08-18a PREVIEW_CHARS=' + PREVIEW_CHARS
  + ' — 수집·발신 없음. 로그만 남긴다.');
printPrevious();

var _api2 = false;
try {
  if (typeof BotManager !== 'undefined' && BotManager.getCurrentBot) {
    var bot = BotManager.getCurrentBot();
    if (bot && bot.on) {
      bot.on(Event.NOTIFICATION_POSTED, onKakaoNoti);
      _api2 = true;
      Log.i('gccity: 알림 훅 등록 성공 (API2)');
    }
  }
} catch (e) {
  Log.e('gccity: API2 알림 훅 등록 실패 — ' + e);
}
if (!_api2) {
  Log.i('gccity: API2 미활성 — 구 API onNotificationPosted 로 동작한다');
}

// 알림이 아예 안 들어오는 것과 "안 왔다" 를 구분하려면 시작 로그만으로는 부족하다.
// 첫 알림이 올 때까지 이 줄이 마지막이면, 알림 접근 권한이나 카톡 알림 설정을 볼 것.
Log.i('gccity: 대기 중 — 목표 오픈채팅방과 **다른 단톡방** 양쪽에서 메시지를 받아야 ①을 확인할 수 있다');
