#!/usr/bin/env node
/**
 * 민원 ↔ 해결 내용 잇기.
 *
 * 해결 내용은 세 곳에서 온다. 셋 다 같은 문장 틀이라 `parseResolutionBody` 하나로 읽힌다.
 *   ① 카페 처리 글      제목이 `날짜 + …민원`
 *   ② 카페 댓글 회신    주민 글에 정책관이 댓글로 답한 것 — **원 민원과 이미 붙어 있다**
 *   ③ 현장 방문 기록    본문이 `민 원 : / 처리내역 : / 홍 보 :` 로 갈려 있다
 *
 * ★ ①의 원 민원은 카톡에 있다. **본문 접수 마커 시각이 카톡 메시지 시각과 같다**
 *   (실측 2026-09-08 — 마커 `오전 9시 48분` ↔ 카톡 09:48). 그래서 제목 유사도로
 *   추측하지 않고 시각으로 못 박는다. 창을 좁게(±MATCH_MIN 분) 잡아 오탐을 막는다.
 *
 * ★ 못 이은 것을 조용히 버리지 않는다. 미해결 쪽에 그대로 담아 건수가 보이게 한다.
 *
 * 사용: node --experimental-strip-types scripts/link-complaints.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseResolutionBody } from '../src/server/complaint-classify.ts';

const H = os.homedir();
/* 8월·9월 카페 수집분을 합친다. 카톡 수집 구간(8/19~)과 겹치는 9월 처리 글이 있어야 매칭 기회가 생긴다 */
const CAFE = {};
for (const f of ['gccity-aug-pick-bodies.json', 'gccity-sep-pick-bodies.json']) {
  const p = path.join(H, f);
  if (fs.existsSync(p)) Object.assign(CAFE, JSON.parse(fs.readFileSync(p, 'utf-8')));
}
const KAKAO = JSON.parse(fs.readFileSync(path.join(H, 'gccity-kakao-aug.json'), 'utf-8'));

/**
 * 접수 마커와 카톡 메시지가 같은 건으로 인정되는 시간 창(분).
 *
 * ★ 4분에서 20분으로 넓혔다. 마커는 정책관이 **접수를 기록한 시각**이라 원 메시지보다
 *   조금 뒤인 경우가 있다. 대신 **팔로우 중인 두 방으로만** 후보를 좁혀 오탐을 막는다 —
 *   단지별 소통방은 수집 대상이 아니라서 거기서 온 민원은 애초에 못 잇는다(결정 2026-09-08).
 */
const MATCH_MIN = 12;
/** 민원 원문이 실제로 오는 방. 나머지 방은 매칭 후보에서 뺀다 */
const ROOMS = new Set(['과천시 지정타 조인길', '과천시 조인길 정책관 소통방']);
/** 정책관·봇 발화는 민원 원문이 아니다 */
const NOT_RESIDENT = /(정책관|비서관|오픈채팅봇|과천시청)/;
/** 회신성 댓글 판별 — 정책관이 쓰는 정형 문구 */
const REPLY_RE = /(담당 부서|담당 기관|문의한 결과|회신을 받)/;

const cafe = Object.values(CAFE);
const msgs = KAKAO.rows
  .filter((m) => ROOMS.has(m.room))
  .filter((m) => !NOT_RESIDENT.test(m.sender || ''))
  .filter((m) => (m.body || '').trim().length >= 10)
  .map((m) => ({ ...m, t: Date.parse(m.sent_at) }));
console.log(`카톡 매칭 후보: ${msgs.length}건 (팔로우 2개 방 · 주민 발화 · 10자↑)`);
const kakaoStart = Math.min(...msgs.map((m) => m.t));
console.log(`카톡 수집 개시: ${new Date(kakaoStart).toISOString().slice(0, 10)} — 그 이전 민원은 원문을 되살릴 수 없다\n`);

const solved = [];
const unsolved = [];

/* ── ① 카페 처리 글 → 카톡 원문 ─────────────────────────── */
for (const r of cafe.filter((x) => x.kind === 'resolution')) {
  const p = parseResolutionBody(r.body || '');
  let origin = null;
  let why = null;
  if (p.receivedAt && Date.parse(p.receivedAt) < kakaoStart) why = '카톡 수집 개시 이전';
  if (p.receivedAt && !why) {
    const t0 = Date.parse(p.receivedAt);
    const near = msgs
      .filter((m) => Math.abs(m.t - t0) <= MATCH_MIN * 60000)
      .sort((a, b) => Math.abs(a.t - t0) - Math.abs(b.t - t0));
    /*
     * 시각만으로 잇지 않는다. 12분 창 안에도 봇 환영 공지나 응원 댓글이 들어와
     * 실측에서 4건 중 2건이 오탐이었다(2026-09-08).
     *
     * ★ 해결 내용의 **장소·대상 낱말**이 카톡 원문에 실제로 나와야 인정한다.
     *   틀린 짝은 통계를 조용히 망친다 — 불확실하면 기각이 기본이다.
     * ★ 예외는 사진 민원 하나다. 본문이 "사진을 보냈습니다" 뿐이라 낱말이 겹칠 수 없다.
     *   첨부가 이미지이고 시각이 아주 가까울 때만 인정하고, 원문 없음을 표시한다.
     */
    const keys = complaintKeywords(r.body || '');
    for (const m of near) {
      const body = String(m.body || '');
      const isPhoto = m.attachment_type === 'image' || /^사진을 보냈습니다\.?$/.test(body.trim());
      if (isPhoto) {
        if (Math.abs(m.t - t0) <= 6 * 60000) { origin = m; origin.__photo = true; break; }
        continue;
      }
      if (keys.some((k) => body.includes(k))) { origin = m; break; }
    }
    if (!origin) why = near.length
      ? `시각은 가까우나 내용이 안 겹쳐 기각 (후보 ${near.length}건)`
      : '두 방에서 같은 시각 메시지 없음(단지별 소통방으로 추정)';
  }
  solved.push({
    type: '카페 처리 글',
    articleId: r.id, url: r.url, title: cleanTitle(r), postedAt: r.date,
    민원원문: origin ? (origin.__photo ? '(사진으로 접수 — 본문 없음)' : origin.body) : null,
    민원출처: origin ? `카톡 · ${origin.room} · ${origin.sender}` : `원문 미확인 — ${why || '사유 미상'}`,
    민원시각: p.receivedAt, 회신시각: p.repliedAt,
    부서: p.department, 기관: p.agency, 완료예정: p.dueAt,
    해결내용: r.body,
    소요시간h: p.receivedAt && p.repliedAt ? +((Date.parse(p.repliedAt) - Date.parse(p.receivedAt)) / 3600000).toFixed(1) : null,
    matchedMessageId: origin ? origin.id : null,
  });
}

/* ── ② 카페 댓글 회신 → 그 글이 곧 원 민원 ─────────────── */
for (const r of cafe) {
  const replies = (r.comments || []).filter((c) => REPLY_RE.test(c.text || ''));
  if (!replies.length) continue;
  for (const c of replies) {
    const p = parseResolutionBody(c.text || '');
    solved.push({
      type: '카페 댓글 회신',
      articleId: r.id, url: r.url, title: cleanTitle(r), postedAt: r.date,
      민원원문: r.body || null,
      민원출처: `카페 · ${r.board || ''} · ${r.author || ''}`,
      민원시각: r.date, 회신시각: c.at || null,
      부서: p.department, 기관: p.agency, 완료예정: p.dueAt,
      해결내용: c.text,
      소요시간h: null,
      matchedMessageId: null,
    });
  }
}

/* ── ③ 현장 방문 기록 — 본문 안에 민원과 처리내역이 함께 있다 ── */
for (const r of cafe.filter((x) => x.kind === 'visit')) {
  const b = (r.body || '').replace(/​/g, '');
  const mm = /민\s*원\s*:(.*?)(?:처리\s*내역|홍\s*보|$)/s.exec(b);
  const pm = /처리\s*내역\s*:(.*?)(?:홍\s*보|$)/s.exec(b);
  if (!mm) continue;
  const p = parseResolutionBody(pm ? pm[1] : b);
  solved.push({
    type: '현장 방문 기록',
    articleId: r.id, url: r.url, title: cleanTitle(r), postedAt: r.date,
    민원원문: mm[1].trim().slice(0, 800),
    민원출처: '현장 접수(주무관 순회)',
    민원시각: r.reportedAt || r.date, 회신시각: r.date,
    부서: p.department, 기관: p.agency, 완료예정: p.dueAt,
    해결내용: (pm ? pm[1] : '').trim(),
    소요시간h: null,
    matchedMessageId: null,
  });
}

/* ── 미해결: 회신 댓글이 없는 주민 글 ───────────────────── */
const solvedArticles = new Set(solved.map((s) => s.articleId));
for (const r of cafe) {
  if (r.kind === 'resolution' || r.kind === 'visit') continue;
  if (solvedArticles.has(r.id)) continue;
  unsolved.push({
    type: '카페 주민 글',
    articleId: r.id, url: r.url, title: cleanTitle(r), postedAt: r.date,
    작성자: r.author, 게시판: r.board,
    본문: r.body || null,
    댓글수: (r.comments || []).length,
  });
}

/* ── 미해결: 해결 내용에 안 붙은 카톡 메시지 ─────────────── */
const usedMsg = new Set(solved.map((s) => s.matchedMessageId).filter(Boolean));
const kakaoLeft = msgs.filter((m) => !usedMsg.has(m.id));

/**
 * 해결 내용 첫 문장에서 장소·대상 낱말을 뽑는다.
 * `"갈현천 산책로 주변의 수목이 울창하여…라는 민원이 접수 되었습니다"` → [갈현천, 산책로, 수목]
 * 이 낱말이 카톡 원문에 없으면 같은 건으로 보지 않는다.
 */
function complaintKeywords(body) {
  const head = String(body || '').split(/라는 민원이|민원이 접수/)[0].slice(0, 200);
  const words = head.match(/[가-힣]{2,}/g) || [];
  const STOP = new Set(['담당', '부서인', '기관인', '문의한', '결과', '현장', '출동', '예정이다', '회신', '관내', '민원', '접수', '되었습니다', '위험이', '있다', '주변의', '인해', '대한', '관련']);
  return [...new Set(words.filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 12);
}

function cleanTitle(r) {
  const t = (r.title || '').split('\n').map((x) => x.trim()).filter(Boolean);
  return t.find((x) => x.length > 8 && !/앱 열기|카페홈|본문 기타/.test(x)) || t[0] || '';
}

const outSolved = path.join(H, 'gccity-solved.json');
const outUnsolved = path.join(H, 'gccity-unsolved.json');
const outKakao = path.join(H, 'gccity-kakao-unlinked.json');
fs.writeFileSync(outSolved, JSON.stringify({ count: solved.length, rows: solved }, null, 2));
fs.writeFileSync(outUnsolved, JSON.stringify({ count: unsolved.length, rows: unsolved }, null, 2));
fs.writeFileSync(outKakao, JSON.stringify({ count: kakaoLeft.length, note: '해결 내용에 안 붙은 카톡 메시지 전량. 민원 여부는 아직 안 갈랐다', rows: kakaoLeft }, null, 2));

const byType = {};
for (const s of solved) byType[s.type] = (byType[s.type] || 0) + 1;
console.log('=== 해결된 민원 ===');
for (const [k, v] of Object.entries(byType)) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log(`  ${String(solved.length).padStart(3)}  합계`);
const matched = solved.filter((s) => s.matchedMessageId).length;
console.log(`\n카톡 원문 매칭: ${matched}/${byType['카페 처리 글'] || 0}건 (처리 글 기준)`);
console.log(`부서 확보     : ${solved.filter((s) => s.부서).length}/${solved.length}건`);
console.log(`\n=== 미해결 ===`);
console.log(`  카페 주민 글 ${unsolved.length}건`);
console.log(`  안 붙은 카톡 ${kakaoLeft.length}건 (민원 여부 미판정)`);
console.log(`\n→ ${outSolved}\n→ ${outUnsolved}\n→ ${outKakao}`);
