// chessEngine.js
// A self-contained chess engine: 0x88 board, legal move generation, alpha-beta
// search (iterative deepening, transposition table, null-move pruning, late move
// reductions, quiescence search) and a tapered piece-square-table evaluation.
// No dependencies. Runs in a Web Worker in the browser, or directly in Node.

const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const MATE = 30000;
const INF = 32000;
const MAXPLY = 64;

const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];
const ORDER_VALUE = [0, 1, 3, 3, 5, 9, 10]; // for MVV-LVA

const KNIGHT_D = [33, 31, 18, 14, -14, -18, -31, -33];
const KING_D = [1, -1, 16, -16, 15, 17, -15, -17];
const BISHOP_D = [15, 17, -15, -17];
const ROOK_D = [1, -1, 16, -16];

// ---------------------------------------------------------------- state
const board = new Int8Array(128);
let side = 1; // 1 = white, -1 = black
let castle = 0; // 1 WK, 2 WQ, 4 BK, 8 BQ
let ep = -1;
let half = 0;
let hLo = 0, hHi = 0;
const kingSq = [4, 116];

const STACK = 2048;
const uCap = new Int8Array(STACK);
const uCastle = new Uint8Array(STACK);
const uEp = new Int16Array(STACK);
const uHalf = new Int16Array(STACK);
const uLo = new Int32Array(STACK);
const uHi = new Int32Array(STACK);
const histLo = new Int32Array(STACK);
const histHi = new Int32Array(STACK);
let hp = 0;

const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[4] = 12; CASTLE_MASK[0] = 13; CASTLE_MASK[7] = 14;
CASTLE_MASK[116] = 3; CASTLE_MASK[112] = 7; CASTLE_MASK[119] = 11;

// ---------------------------------------------------------------- zobrist
let seed = 0x9e3779b9 | 0;
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
}
const zLo = new Int32Array(13 * 128), zHi = new Int32Array(13 * 128);
for (let i = 0; i < zLo.length; i++) { zLo[i] = rnd(); zHi[i] = rnd(); }
const zSideLo = rnd(), zSideHi = rnd();
const zCastleLo = new Int32Array(16), zCastleHi = new Int32Array(16);
for (let i = 0; i < 16; i++) { zCastleLo[i] = rnd(); zCastleHi[i] = rnd(); }
const zEpLo = new Int32Array(8), zEpHi = new Int32Array(8);
for (let i = 0; i < 8; i++) { zEpLo[i] = rnd(); zEpHi[i] = rnd(); }

function computeHash() {
  let lo = 0, hi = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq];
    if (p !== 0) { const k = (p + 6) * 128 + sq; lo ^= zLo[k]; hi ^= zHi[k]; }
  }
  if (side < 0) { lo ^= zSideLo; hi ^= zSideHi; }
  lo ^= zCastleLo[castle]; hi ^= zCastleHi[castle];
  if (ep >= 0) { lo ^= zEpLo[ep & 7]; hi ^= zEpHi[ep & 7]; }
  hLo = lo; hHi = hi;
}

// ---------------------------------------------------------------- FEN
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function loadFen(fen) {
  board.fill(0);
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  for (let r = 0; r < 8; r++) {
    const row = rows[7 - r];
    let f = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { f += +ch; continue; }
      const lower = ch.toLowerCase();
      const pt = 'pnbrqk'.indexOf(lower) + 1;
      const isBlack = ch === lower;
      board[r * 16 + f] = isBlack ? -pt : pt;
      if (pt === K) kingSq[isBlack ? 1 : 0] = r * 16 + f;
      f++;
    }
  }
  side = parts[1] === 'b' ? -1 : 1;
  castle = 0;
  const c = parts[2] || '-';
  if (c.includes('K')) castle |= 1;
  if (c.includes('Q')) castle |= 2;
  if (c.includes('k')) castle |= 4;
  if (c.includes('q')) castle |= 8;
  const e = parts[3] || '-';
  ep = e !== '-' ? (e.charCodeAt(1) - 49) * 16 + (e.charCodeAt(0) - 97) : -1;
  half = parseInt(parts[4], 10) || 0;
  computeHash();
}

const sqName = (sq) => String.fromCharCode(97 + (sq & 7)) + String.fromCharCode(49 + (sq >> 4));

// ---------------------------------------------------------------- attacks
function isAttacked(sq, by) {
  let s;
  if (by > 0) {
    s = sq - 15; if (!(s & 0x88) && board[s] === P) return true;
    s = sq - 17; if (!(s & 0x88) && board[s] === P) return true;
  } else {
    s = sq + 15; if (!(s & 0x88) && board[s] === -P) return true;
    s = sq + 17; if (!(s & 0x88) && board[s] === -P) return true;
  }
  const kn = by * N, ki = by * K;
  for (let i = 0; i < 8; i++) {
    s = sq + KNIGHT_D[i]; if (!(s & 0x88) && board[s] === kn) return true;
    s = sq + KING_D[i]; if (!(s & 0x88) && board[s] === ki) return true;
  }
  const bi = by * B, ro = by * R, qu = by * Q;
  for (let i = 0; i < 4; i++) {
    let d = BISHOP_D[i];
    s = sq + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p !== 0) { if (p === bi || p === qu) return true; break; }
      s += d;
    }
    d = ROOK_D[i];
    s = sq + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p !== 0) { if (p === ro || p === qu) return true; break; }
      s += d;
    }
  }
  return false;
}

const inCheckNow = () => isAttacked(kingSq[side > 0 ? 0 : 1], -side);

// ---------------------------------------------------------------- move generation
// move = from | to<<7 | promo<<14 | flag<<17   (flag: 1 en passant, 2 castle, 4 double push)
const mv = (from, to, promo, flag) => from | (to << 7) | (promo << 14) | (flag << 17);
const PROMOS = [Q, R, B, N];

function genMoves(buf, capsOnly) {
  let n = 0;
  const us = side;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq];
    if (p === 0 || (p > 0) !== (us > 0)) continue;
    const t = p > 0 ? p : -p;
    if (t === P) {
      const dir = us > 0 ? 16 : -16;
      const startRank = us > 0 ? 1 : 6;
      const promoRank = us > 0 ? 7 : 0;
      const fwd = sq + dir;
      if (!(fwd & 0x88) && board[fwd] === 0) {
        if ((fwd >> 4) === promoRank) {
          if (capsOnly) buf[n++] = mv(sq, fwd, Q, 0);
          else for (let i = 0; i < 4; i++) buf[n++] = mv(sq, fwd, PROMOS[i], 0);
        } else if (!capsOnly) {
          buf[n++] = mv(sq, fwd, 0, 0);
          if ((sq >> 4) === startRank && board[fwd + dir] === 0) buf[n++] = mv(sq, fwd + dir, 0, 4);
        }
      }
      for (let k = -1; k <= 1; k += 2) {
        const to = sq + dir + k;
        if (to & 0x88) continue;
        const target = board[to];
        if (target !== 0 && (target > 0) !== (us > 0)) {
          if ((to >> 4) === promoRank) {
            if (capsOnly) buf[n++] = mv(sq, to, Q, 0);
            else for (let i = 0; i < 4; i++) buf[n++] = mv(sq, to, PROMOS[i], 0);
          } else buf[n++] = mv(sq, to, 0, 0);
        } else if (target === 0 && to === ep) {
          buf[n++] = mv(sq, to, 0, 1);
        }
      }
    } else if (t === N || t === K) {
      const dirs = t === N ? KNIGHT_D : KING_D;
      for (let i = 0; i < 8; i++) {
        const to = sq + dirs[i];
        if (to & 0x88) continue;
        const target = board[to];
        if (target === 0) { if (!capsOnly) buf[n++] = mv(sq, to, 0, 0); }
        else if ((target > 0) !== (us > 0)) buf[n++] = mv(sq, to, 0, 0);
      }
    } else {
      const dirs = t === B ? BISHOP_D : t === R ? ROOK_D : KING_D;
      for (let i = 0; i < dirs.length; i++) {
        const d = dirs[i];
        let to = sq + d;
        while (!(to & 0x88)) {
          const target = board[to];
          if (target === 0) { if (!capsOnly) buf[n++] = mv(sq, to, 0, 0); }
          else {
            if ((target > 0) !== (us > 0)) buf[n++] = mv(sq, to, 0, 0);
            break;
          }
          to += d;
        }
      }
    }
  }
  if (!capsOnly) {
    if (us > 0) {
      if ((castle & 3) && board[4] === K && !isAttacked(4, -1)) {
        if ((castle & 1) && board[5] === 0 && board[6] === 0 && board[7] === R &&
            !isAttacked(5, -1) && !isAttacked(6, -1)) buf[n++] = mv(4, 6, 0, 2);
        if ((castle & 2) && board[3] === 0 && board[2] === 0 && board[1] === 0 && board[0] === R &&
            !isAttacked(3, -1) && !isAttacked(2, -1)) buf[n++] = mv(4, 2, 0, 2);
      }
    } else {
      if ((castle & 12) && board[116] === -K && !isAttacked(116, 1)) {
        if ((castle & 4) && board[117] === 0 && board[118] === 0 && board[119] === -R &&
            !isAttacked(117, 1) && !isAttacked(118, 1)) buf[n++] = mv(116, 118, 0, 2);
        if ((castle & 8) && board[115] === 0 && board[114] === 0 && board[113] === 0 && board[112] === -R &&
            !isAttacked(115, 1) && !isAttacked(114, 1)) buf[n++] = mv(116, 114, 0, 2);
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------- make / unmake
function makeMove(m) {
  const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 7;
  const piece = board[from];
  const t = piece > 0 ? piece : -piece;
  let cap = board[to];

  uCap[hp] = cap; uCastle[hp] = castle; uEp[hp] = ep; uHalf[hp] = half; uLo[hp] = hLo; uHi[hp] = hHi;

  let lo = hLo, hi = hHi;
  // remove old ep + castle keys
  if (ep >= 0) { lo ^= zEpLo[ep & 7]; hi ^= zEpHi[ep & 7]; }
  lo ^= zCastleLo[castle]; hi ^= zCastleHi[castle];

  let k = (piece + 6) * 128 + from;
  lo ^= zLo[k]; hi ^= zHi[k];

  if (flag === 1) {
    const capSq = side > 0 ? to - 16 : to + 16;
    cap = board[capSq];
    uCap[hp] = cap;
    board[capSq] = 0;
    k = (cap + 6) * 128 + capSq;
    lo ^= zLo[k]; hi ^= zHi[k];
  } else if (cap !== 0) {
    k = (cap + 6) * 128 + to;
    lo ^= zLo[k]; hi ^= zHi[k];
  }

  board[from] = 0;
  const placed = promo ? promo * side : piece;
  board[to] = placed;
  k = (placed + 6) * 128 + to;
  lo ^= zLo[k]; hi ^= zHi[k];

  if (flag === 2) {
    let rf, rt;
    if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
    const rook = board[rf];
    board[rf] = 0; board[rt] = rook;
    k = (rook + 6) * 128 + rf; lo ^= zLo[k]; hi ^= zHi[k];
    k = (rook + 6) * 128 + rt; lo ^= zLo[k]; hi ^= zHi[k];
  }

  if (t === K) kingSq[side > 0 ? 0 : 1] = to;

  castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
  ep = flag === 4 ? (from + to) >> 1 : -1;
  half = (t === P || cap !== 0) ? 0 : half + 1;

  lo ^= zCastleLo[castle]; hi ^= zCastleHi[castle];
  if (ep >= 0) { lo ^= zEpLo[ep & 7]; hi ^= zEpHi[ep & 7]; }
  lo ^= zSideLo; hi ^= zSideHi;

  side = -side;
  hLo = lo; hHi = hi;
  hp++;
  histLo[hp] = lo; histHi[hp] = hi;
}

function unmakeMove(m) {
  hp--;
  side = -side;
  const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 7;
  const cap = uCap[hp];
  let piece = board[to];
  if (promo) piece = side * P;

  if (flag === 2) {
    let rf, rt;
    if (to > from) { rf = from + 3; rt = from + 1; } else { rf = from - 4; rt = from - 1; }
    board[rf] = board[rt]; board[rt] = 0;
  }
  board[from] = piece;
  if (flag === 1) {
    board[to] = 0;
    board[side > 0 ? to - 16 : to + 16] = cap;
  } else {
    board[to] = cap;
  }
  if (piece === side * K) kingSq[side > 0 ? 0 : 1] = from;

  castle = uCastle[hp]; ep = uEp[hp]; half = uHalf[hp]; hLo = uLo[hp]; hHi = uHi[hp];
}

function makeNull() {
  uEp[hp] = ep; uHalf[hp] = half; uLo[hp] = hLo; uHi[hp] = hHi;
  if (ep >= 0) { hLo ^= zEpLo[ep & 7]; hHi ^= zEpHi[ep & 7]; }
  ep = -1;
  hLo ^= zSideLo; hHi ^= zSideHi;
  side = -side;
  half++;
  hp++;
  histLo[hp] = hLo; histHi[hp] = hHi;
}
function unmakeNull() {
  hp--;
  side = -side;
  ep = uEp[hp]; half = uHalf[hp]; hLo = uLo[hp]; hHi = uHi[hp];
}

// plays m and returns false (and undoes it) if it leaves our own king in check
function makeLegal(m) {
  const mover = side;
  makeMove(m);
  if (isAttacked(kingSq[mover > 0 ? 0 : 1], -mover)) { unmakeMove(m); return false; }
  return true;
}

// ---------------------------------------------------------------- evaluation
const PST = {
  1: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
      0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  2: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30,
      -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30,
      -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  3: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10,
      -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10,
      -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  4: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
      -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  5: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
      0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
};
const KING_MG = [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20];
const KING_EG = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30,
  -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
  -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

// returns the score from the side-to-move's point of view
function evaluate() {
  let score = 0;
  let phase = 0;
  let wB = 0, bB = 0, minors = 0, heavy = 0, pawns = 0;
  let wk = 0, bk = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq];
    if (p === 0) continue;
    const r = sq >> 4, f = sq & 7;
    if (p > 0) {
      if (p === K) { wk = sq; continue; }
      score += PIECE_VALUE[p] + PST[p][(7 - r) * 8 + f];
      if (p === B) wB++;
      if (p === N || p === B) { phase += 1; minors++; }
      else if (p === R) { phase += 2; heavy++; }
      else if (p === Q) { phase += 4; heavy++; }
      else pawns++;
    } else {
      const t = -p;
      if (t === K) { bk = sq; continue; }
      score -= PIECE_VALUE[t] + PST[t][r * 8 + f];
      if (t === B) bB++;
      if (t === N || t === B) { phase += 1; minors++; }
      else if (t === R) { phase += 2; heavy++; }
      else if (t === Q) { phase += 4; heavy++; }
      else pawns++;
    }
  }
  if (pawns === 0 && heavy === 0 && minors <= 1) return 0; // insufficient material
  if (phase > 24) phase = 24;
  const wr = wk >> 4, wf = wk & 7, br = bk >> 4, bf = bk & 7;
  score += ((KING_MG[(7 - wr) * 8 + wf] * phase + KING_EG[(7 - wr) * 8 + wf] * (24 - phase)) / 24) | 0;
  score -= ((KING_MG[br * 8 + bf] * phase + KING_EG[br * 8 + bf] * (24 - phase)) / 24) | 0;
  if (wB >= 2) score += 30;
  if (bB >= 2) score -= 30;
  return (side > 0 ? score : -score) + 10;
}

// ---------------------------------------------------------------- search
const TT_BITS = 19;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttLo = new Int32Array(TT_SIZE), ttHi = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE), ttScore = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE); // flag 1 exact, 2 lower, 3 upper

const moveBuf = [], scoreBuf = [];
for (let i = 0; i < MAXPLY + 8; i++) { moveBuf.push(new Int32Array(256)); scoreBuf.push(new Int32Array(256)); }
const killers = [];
for (let i = 0; i < MAXPLY + 8; i++) killers.push(new Int32Array(2));
const history = new Int32Array(2 * 128 * 128);

let nodes = 0;
let deadline = 0;
let stopped = false;

function isRepetition() {
  const limit = Math.max(0, hp - half);
  for (let i = hp - 2; i >= limit; i -= 2) {
    if (histLo[i] === hLo && histHi[i] === hHi) return true;
  }
  return false;
}

function scoreMoves(buf, scores, n, ply, ttm) {
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, flag = (m >> 17) & 7;
    let s;
    if (m === ttm) s = 2000000;
    else {
      const victim = flag === 1 ? P : Math.abs(board[to]);
      if (victim !== 0) {
        s = 1000000 + ORDER_VALUE[victim] * 100 - ORDER_VALUE[Math.abs(board[from])];
      } else if (promo === Q) s = 900000;
      else if (m === killers[ply][0]) s = 800000;
      else if (m === killers[ply][1]) s = 700000;
      else s = history[(side > 0 ? 0 : 1) * 16384 + from * 128 + to];
    }
    scores[i] = s;
  }
}

function pickMove(buf, scores, n, start) {
  let best = start;
  for (let i = start + 1; i < n; i++) if (scores[i] > scores[best]) best = i;
  if (best !== start) {
    const tm = buf[start]; buf[start] = buf[best]; buf[best] = tm;
    const ts = scores[start]; scores[start] = scores[best]; scores[best] = ts;
  }
  return buf[start];
}

function qsearch(alpha, beta, ply) {
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
  if (stopped) return 0;
  const stand = evaluate();
  if (ply >= MAXPLY - 1) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;

  const buf = moveBuf[ply], scores = scoreBuf[ply];
  const n = genMoves(buf, true);
  scoreMoves(buf, scores, n, ply, 0);
  for (let i = 0; i < n; i++) {
    const m = pickMove(buf, scores, n, i);
    const to = (m >> 7) & 127;
    const gain = ((m >> 17) & 7) === 1 ? 100 : PIECE_VALUE[Math.abs(board[to])];
    if (stand + gain + 200 < alpha && !((m >> 14) & 7)) continue; // delta pruning
    if (!makeLegal(m)) continue;
    const score = -qsearch(-beta, -alpha, ply + 1);
    unmakeMove(m);
    if (stopped) return 0;
    if (score > alpha) {
      alpha = score;
      if (alpha >= beta) return alpha;
    }
  }
  return alpha;
}

function hasPieces(s) {
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq] * s;
    if (p >= N && p <= Q) return true;
  }
  return false;
}

function search(depth, alpha, beta, ply, nullOk) {
  nodes++;
  if ((nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
  if (stopped) return 0;

  if (ply > 0) {
    if (half >= 100 || isRepetition()) return 0;
  }
  const inCheck = inCheckNow();
  if (inCheck && ply < MAXPLY - 2) depth++;
  if (depth <= 0) return qsearch(alpha, beta, ply);
  if (ply >= MAXPLY - 1) return evaluate();

  // mate-distance pruning
  const matedScore = -MATE + ply;
  if (alpha < matedScore) alpha = matedScore;
  if (beta > MATE - ply - 1) beta = MATE - ply - 1;
  if (alpha >= beta) return alpha;

  const pvNode = beta - alpha > 1;
  const idx = hLo & TT_MASK;
  let ttm = 0;
  if (ttLo[idx] === hLo && ttHi[idx] === hHi) {
    ttm = ttMove[idx];
    if (ttDepth[idx] >= depth && !pvNode) {
      let s = ttScore[idx];
      if (s > MATE - 100) s -= ply; else if (s < -MATE + 100) s += ply;
      const fl = ttFlag[idx];
      if (fl === 1) return s;
      if (fl === 2 && s >= beta) return s;
      if (fl === 3 && s <= alpha) return s;
    }
  }

  // null move pruning
  if (nullOk && !inCheck && !pvNode && depth >= 3 && hasPieces(side)) {
    if (evaluate() >= beta) {
      makeNull();
      const score = -search(depth - 3, -beta, -beta + 1, ply + 1, false);
      unmakeNull();
      if (stopped) return 0;
      if (score >= beta) return score >= MATE - 100 ? beta : score;
    }
  }

  const buf = moveBuf[ply], scores = scoreBuf[ply];
  const n = genMoves(buf, false);
  scoreMoves(buf, scores, n, ply, ttm);

  const origAlpha = alpha;
  let best = -INF, bestMove = 0, legal = 0;
  const sideIdx = side > 0 ? 0 : 1;

  for (let i = 0; i < n; i++) {
    const m = pickMove(buf, scores, n, i);
    const from = m & 127, to = (m >> 7) & 127;
    const isCapture = board[to] !== 0 || ((m >> 17) & 7) === 1;
    const isPromo = ((m >> 14) & 7) !== 0;
    if (!makeLegal(m)) continue;
    legal++;
    const givesCheck = inCheckNow();

    let score;
    if (legal === 1) {
      score = -search(depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      let reduction = 0;
      if (depth >= 3 && legal > 3 && !isCapture && !isPromo && !inCheck && !givesCheck) {
        reduction = legal > 8 ? 2 : 1;
      }
      score = -search(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && reduction > 0) score = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
      if (score > alpha && score < beta) score = -search(depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmakeMove(m);
    if (stopped) return 0;

    if (score > best) {
      best = score; bestMove = m;
      if (score > alpha) {
        alpha = score;
        if (alpha >= beta) {
          if (!isCapture) {
            if (killers[ply][0] !== m) { killers[ply][1] = killers[ply][0]; killers[ply][0] = m; }
            history[sideIdx * 16384 + from * 128 + to] += depth * depth;
          }
          break;
        }
      }
    }
  }

  if (legal === 0) return inCheck ? -MATE + ply : 0;

  let flag = 1;
  if (best <= origAlpha) flag = 3; else if (best >= beta) flag = 2;
  let s = best;
  if (s > MATE - 100) s += ply; else if (s < -MATE + 100) s -= ply;
  if (ttLo[idx] !== hLo || ttHi[idx] !== hHi || ttDepth[idx] <= depth) {
    ttLo[idx] = hLo; ttHi[idx] = hHi; ttMove[idx] = bestMove;
    ttScore[idx] = s; ttDepth[idx] = depth; ttFlag[idx] = flag;
  }
  return best;
}

function legalRootMoves() {
  const buf = new Int32Array(256);
  const n = genMoves(buf, false);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (makeLegal(buf[i])) { unmakeMove(buf[i]); out.push(buf[i]); }
  }
  return out;
}

function moveToObj(m, score, depth) {
  const promo = (m >> 14) & 7;
  return {
    from: sqName(m & 127),
    to: sqName((m >> 7) & 127),
    promotion: promo ? 'pnbrqk'[promo - 1] : undefined,
    score,
    depth,
  };
}

// ---------------------------------------------------------------- public API
export const LEVELS = {
  1: { name: 'Beginner', depth: 1, noise: 300, randomChance: 0.15 },
  2: { name: 'Casual', depth: 2, noise: 120, randomChance: 0 },
  3: { name: 'Club', maxDepth: 5, timeMs: 1000 },
  4: { name: 'Strong', maxDepth: 14, timeMs: 3000 },
};

function setupPosition(fen, historyFens) {
  hp = 0;
  for (const h of historyFens || []) {
    loadFen(h);
    histLo[hp] = hLo; histHi[hp] = hHi;
    hp++;
  }
  loadFen(fen);
  histLo[hp] = hLo; histHi[hp] = hHi;
}

export function getBestMove(fen, level = 3, historyFens = [], overrides = {}) {
  const cfg = { ...(LEVELS[level] || LEVELS[3]), ...overrides };
  setupPosition(fen, historyFens);
  const rootMoves = legalRootMoves();
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return moveToObj(rootMoves[0], 0, 0);

  killers.forEach((k) => k.fill(0));
  history.fill(0);
  nodes = 0;
  stopped = false;

  // --- weak levels: score each root move with a shallow search, add noise
  if (cfg.noise !== undefined) {
    if (Math.random() < (cfg.randomChance || 0)) {
      return moveToObj(rootMoves[Math.floor(Math.random() * rootMoves.length)], 0, 0);
    }
    deadline = Date.now() + 5000;
    let bestM = rootMoves[0], bestS = -Infinity, bestRaw = 0;
    for (const m of rootMoves) {
      makeMove(m);
      let raw = -search(cfg.depth - 1, -INF, INF, 1, true);
      unmakeMove(m);
      const noisy = raw + (Math.random() * 2 - 1) * cfg.noise;
      if (raw > MATE - 100) { bestM = m; bestRaw = raw; bestS = Infinity; break; } // always take a mate
      if (noisy > bestS) { bestS = noisy; bestM = m; bestRaw = raw; }
    }
    return moveToObj(bestM, bestRaw, cfg.depth);
  }

  // --- strong levels: iterative deepening
  deadline = Date.now() + cfg.timeMs;
  let bestMove = rootMoves[0];
  let bestScore = 0;
  let reached = 0;
  // order root moves by TT/previous results as we iterate
  let ordered = rootMoves.slice();

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    let alpha = -INF;
    const beta = INF;
    let iterBest = 0, iterScore = -INF;
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i];
      makeMove(m);
      let score;
      if (i === 0) score = -search(depth - 1, -beta, -alpha, 1, true);
      else {
        score = -search(depth - 1, -alpha - 1, -alpha, 1, true);
        if (score > alpha && !stopped) score = -search(depth - 1, -beta, -alpha, 1, true);
      }
      unmakeMove(m);
      if (stopped) break;
      if (score > iterScore) { iterScore = score; iterBest = m; if (score > alpha) alpha = score; }
    }
    if (stopped) {
      // an unfinished iteration is only trusted if it already beat the previous best move
      if (iterBest && iterScore > bestScore && reached > 0) { bestMove = iterBest; bestScore = iterScore; }
      break;
    }
    bestMove = iterBest; bestScore = iterScore; reached = depth;
    ordered = [iterBest, ...ordered.filter((x) => x !== iterBest)];
    if (bestScore > MATE - 100) break; // found a forced mate
    if (Date.now() > deadline) break;
  }

  // avoid walking into a threefold repetition when we are not worse
  if (bestScore > 50) {
    makeMove(bestMove);
    const rep = isRepetition();
    unmakeMove(bestMove);
    if (rep) {
      for (const m of ordered) {
        if (m === bestMove) continue;
        makeMove(m);
        const r2 = isRepetition();
        unmakeMove(m);
        if (!r2) { bestMove = m; break; }
      }
    }
  }
  return moveToObj(bestMove, bestScore, reached);
}

// ---------------------------------------------------------------- testing helpers
export function perft(fen, depth) {
  setupPosition(fen, []);
  const bufs = [];
  for (let i = 0; i <= depth; i++) bufs.push(new Int32Array(256));
  const go = (d) => {
    if (d === 0) return 1;
    const buf = bufs[d];
    const n = genMoves(buf, false);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const m = buf[i];
      if (!makeLegal(m)) continue;
      total += go(d - 1);
      unmakeMove(m);
    }
    return total;
  };
  return go(depth);
}

export function lastSearchNodes() { return nodes; }
