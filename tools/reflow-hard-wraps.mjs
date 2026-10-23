#!/usr/bin/env node
// reflow-hard-wraps.mjs — join the hard wraps a PDF text layer left as <br> inside one reading's <p> blocks,
// by what the material itself measures; nothing here knows what a screenplay, a book or a report looks like.
//
// A text layer breaks lines where the page did. Inside one <p>, a <br> is either a WRAP (the next word did
// not fit in the column) or a BREAK the page made on purpose (a heading, a speaker, a stage direction, a
// verse line, a table row). The two are told apart by the page's geometry and by the marks the material
// uses, each measured from the reading and printed. Every threshold below is a structural one (a majority,
// two standard errors, at least two of something), never a number tuned to a document.
//
//   width    a line's width in characters once the layer's spacing is collapsed to one space (the layer pads
//            words apart where the page had wider gaps). A run of two or more after a sentence-end mark
//            counts as two when the material spaces sentence ends wider than words by more than the padding
//            alone does (both shares are measured; the excess has to beat its own standard error).
//   columns  each multi-line block's widest line is a floor under the column it was set in; those floors
//            pile up just under every column the page used. Their histogram is cut at empty runs at least
//            one typical token wide (the median token width); a cluster's column is the largest width in it
//            that is at least as populated as the cluster's average (what lies beyond is a straggler). A
//            wall needs at least two blocks stopping within a token of it, and a cluster narrower than the
//            widest token is not a column of running text; either gives no column.
//   case     per column: new units (first lines of blocks) start lowercase at some rate; breaks inside the
//            column's ragged zone (lines within one widest line-opening token of the wall) are followed by a
//            lowercase start at another. Case is INFORMATIVE where the second rate beats the first by more
//            than two standard errors, or, where no first line is cased at all, where most units open with a
//            bare mark (a bulleted list); CASELESS where most lines start with uncased characters; otherwise
//            it says nothing (field lists, source code) and no case evidence is used.
//   marks    per column, for each class of line-final mark (a single dot, an ellipsis, ? ! : ; , a hyphen,
//            a dash, a closing bracket, a quote, a letter, a digit), two measured facts:
//              follow   what starts the next line at a break in the ragged zone — a lowercase start more
//                       often than a capital means the class CONTINUES a unit, else it ENDS one (only
//                       where case is informative);
//              closes   how often a line of the class is the last of its block, against the share of lines
//                       that are last of their block anyway: beyond two standard errors above, the class
//                       CLOSES units (a sentence end); below, it never closes one (letters, commas, a
//                       stage direction's bracket); in between its block ends are ARBITRARY (a table row).
//   wrap     a <br> after line A (width w) before line B (first token f wide), in a block whose column is M,
//            with W the widest token in the reading:
//              w < M − W (any word would have fit on A)                              → break
//              w + 1 + f > M (the next word did not fit) and the column wraps text
//                (its plain letter-ended lines continue) and A's mark is not a row
//                ender (one that ends units without closing them, or that never
//                closes them yet is followed by a capital)                            → wrap
//              else, where case is informative: B starts lowercase, or A's mark
//                continues units more reliably than a plain letter does              → wrap
//              otherwise                                                              → break (a gap, not a guess)
//   join     one space; a hyphen- or dash-ended line joins closed when the material writes that mark closed.
//   items    a line that opens with a mark that is not a word (a bullet, a bare dash, a rule) opens an item
//            of its own and is never joined to the line above.
//
// As a command, only the named reading's html literal is rewritten in the JSON file; every other byte of
// the file stays. As a module, reflow(html) returns the new html with every decision and measurement, so
// the rule can be falsified on other material (tools/reflow-hard-wraps.falsify.mjs).
//
//   node tools/reflow-hard-wraps.mjs <readings.json> <reading index> [--dry-run] [--show-gaps]

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ── text of a line: tags off, entities decoded, whitespace as spaces ──────────────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});
export const plain = (seg) => decode(seg.replace(/<[^>]+>/g, '')).replace(/\s/g, ' ').trim();

// ── line-final mark classes ───────────────────────────────────────────────────────────────────────────────
export function markClass(t) {
  if (!t) return 'empty';
  if (/(\.\.\.|…)$/.test(t)) return 'ellipsis';
  if (/(--|—|–)$/.test(t)) return 'dash';
  const c = t[t.length - 1];
  if (c === '.') return 'dot';
  if (c === '?') return 'question';
  if (c === '!') return 'bang';
  if (c === ':') return 'colon';
  if (c === ';') return 'semicolon';
  if (c === ',') return 'comma';
  if (c === '-') return 'hyphen';
  if (/[)\]}]/.test(c)) return 'close';
  if (/["'”’»]/.test(c)) return 'quote';
  if (/\p{L}/u.test(c)) return 'letter';
  if (/\p{N}/u.test(c)) return 'digit';
  return 'other';
}
const startCase = (t) => (/^\p{Ll}/u.test(t) ? 'lower' : /^\p{Lu}/u.test(t) ? 'upper' : 'other');

export const WHY = {
  FORCED: 'wrap: next word did not fit',
  UNFINISHED: 'wrap: unfinished sentence (lowercase next or continuing mark)',
  ROW: 'break: mark ends a row or unit',
  NOWRAP: 'break: this column does not wrap text',
  ITEM: 'break: next line opens with a mark, not a word',
  SHORT: 'break: line stops more than a word short',
  GAP: 'break: word would have fit, nothing says the sentence goes on (gap)',
  NOCOL: 'break: no column for this block',
  EMPTY: 'break: empty line',
};

// z of a share p seen n times against a baseline share p0
const zAbove = (p, n, p0) => (n ? (p - p0) / Math.sqrt(Math.max(p0 * (1 - p0), 1e-9) / n) : 0);

// reflow(html) → { html, decisions: [{ block, i, join, why, w, f, M, A, B }], measures, report() }
export function reflow(html) {
  const P = /(<p\b[^>]*>)([\s\S]*?)(<\/p>)/g;
  const blocks = [];
  for (const m of html.matchAll(P)) {
    const segs = m[2].split('<br>');
    blocks.push({ start: m.index, end: m.index + m[0].length, open: m[1], close: m[3], segs, texts: segs.map(plain) });
  }
  const allTexts = blocks.flatMap((b) => b.texts);

  // spacing: does the material space sentence ends wider than words, beyond the layer's padding?
  const share = (re) => { let n = 0, wide = 0; for (const t of allTexts) for (const r of t.matchAll(re)) { n++; if (r[1].length >= 2) wide++; } return { n, wide, p: n ? wide / n : 0 }; };
  const words = share(/\p{L}( +)(?=\p{L})/gu);
  const sentEnds = share(/[.?!]["'”’)\]]*( +)(?=\S)/g);
  const sentenceEndWide = zAbove(sentEnds.p, sentEnds.n, words.p) > 2;
  const collapse = (t) => t.replace(/ {2,}/g, (run, off, s) => (sentenceEndWide && /[.?!]["'”’)\]]*$/.test(s.slice(0, off)) ? '  ' : ' '));
  const width = (t) => collapse(t).length;
  const tokens = (t) => collapse(t).split(' ').filter(Boolean);

  // tokens: the widest that opens a line sets how far short of a column a wrapped line can stop (a wrap pushes
  // the word that did not fit to the next line's start; a wide token that never opens a line never forced
  // one); the median token is a typical word
  const tokWidths = allTexts.flatMap(tokens).map((w) => w.length).sort((a, b) => a - b);
  const W = allTexts.reduce((m, t) => Math.max(m, (tokens(t)[0] || '').length), 0);
  const typ = tokWidths.length ? tokWidths[Math.floor(tokWidths.length / 2)] : 1;

  // hyphens and dashes: closed or open, as the material writes them mid-line
  const convention = (reClosed, reOpen) => { let closed = 0, open = 0; for (const t of allTexts) { closed += (t.match(reClosed) || []).length; open += (t.match(reOpen) || []).length; } return { closed, open, join: closed > open ? '' : ' ' }; };
  const hyph = convention(/(?<![-\s])-(?=\p{L})/gu, /(?<![-\s])-(?= )/g);
  const dash = convention(/(?<!\s)(--|—|–)(?=\p{L})/gu, /(?<!\s)(--|—|–)(?= )/g);
  const joinAfter = (k) => (k === 'hyphen' ? hyph.join : k === 'dash' ? dash.join : ' ');
  // a line that opens with a mark that is not a word (a bullet, a dash, a rule) opens an item of its own
  const opensWithMark = (t) => { const first = tokens(t)[0] || ''; return first.length > 0 && !/[\p{L}\p{N}]/u.test(first); };

  // columns, from where the multi-line blocks' widest lines pile up
  for (const b of blocks) { b.widths = b.texts.map(width); b.max = b.widths.length ? Math.max(...b.widths) : 0; }
  const multi = blocks.filter((b) => b.segs.length > 1);
  const hist = new Map();
  for (const b of multi) hist.set(b.max, (hist.get(b.max) || 0) + 1);
  const distinct = [...hist.keys()].sort((a, b) => a - b);
  const clusters = [];
  for (const x of distinct) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.hi - 1 < typ) last.hi = x; else clusters.push({ lo: x, hi: x });
  }
  for (const c of clusters) {
    c.blocks = multi.filter((b) => c.lo <= b.max && b.max <= c.hi);
    c.n = c.blocks.length;
    const mean = c.n / (c.hi - c.lo + 1);
    c.column = null; c.why = '';
    for (let x = c.hi; x >= c.lo; x--) if ((hist.get(x) || 0) >= mean) { c.column = x; break; }
    if (c.column !== null) {
      let near = 0; for (let x = c.column - typ + 1; x <= c.column; x++) near += hist.get(x) || 0;
      if (c.column < W) { c.why = `wall ${c.column} is narrower than the widest token`; c.column = null; }
      else if (near < 2) { c.why = `only one block stops at wall ${c.column}`; c.column = null; }
    }
  }

  // per column: the case regime, and what each line-final mark class does
  for (const c of clusters) {
    if (c.column === null) continue;
    const M = c.column;
    const first = { lower: 0, upper: 0, other: 0 }, inner = { lower: 0, upper: 0, other: 0 }, all = { lower: 0, upper: 0, other: 0 };
    const follow = new Map(), occ = new Map();
    let lines = 0, marked = 0;
    for (const b of c.blocks) {
      b.texts.forEach((t, i) => {
        all[startCase(t)]++; lines++;
        const k = markClass(t); const o = occ.get(k) || { n: 0, final: 0 }; o.n++; if (i === b.texts.length - 1) o.final++; occ.set(k, o);
      });
      first[startCase(b.texts[0])]++;
      if (opensWithMark(b.texts[0])) marked++;
      for (let i = 0; i + 1 < b.texts.length; i++) {
        if (b.widths[i] < M - W) continue; // outside the ragged zone a break says nothing about wrapping
        const s = startCase(b.texts[i + 1]); inner[s]++;
        const k = markClass(b.texts[i]); const e = follow.get(k) || { lower: 0, upper: 0, other: 0 }; e[s]++; follow.set(k, e);
      }
    }
    // new units are the first lines of blocks; where most of them open with a bare mark (a bullet, a dash),
    // the material marks its units and a letter-led line inside the zone is not one
    const nf = first.lower + first.upper, ni = inner.lower + inner.upper;
    const pf = nf ? first.lower / nf : 0, pi = ni ? inner.lower / ni : 0, pp = nf + ni ? (first.lower + inner.lower) / (nf + ni) : 0;
    const z = nf && ni ? (pi - pf) / Math.sqrt(Math.max(pp * (1 - pp), 1e-9) * (1 / nf + 1 / ni)) : 0;
    const cased = lines ? (all.lower + all.upper) / lines : 0;
    c.marked = !nf && c.n ? marked / c.n > 0.5 : false; // only where no cased first line can say what new units look like
    c.regime = cased < 0.5 ? 'caseless' : (nf ? z > 2 : c.marked) ? 'cased' : 'uninformative';
    c.caseRates = { first: pf, inner: pi, nf, ni, z };
    c.baseline = lines ? c.n / lines : 0;
    c.follow = (k) => { if (c.regime !== 'cased') return 'unknown'; const e = follow.get(k); if (!e || e.lower + e.upper === 0) return 'unknown'; return e.lower > e.upper ? 'continues' : 'ends'; };
    c.closes = (k) => { const o = occ.get(k); if (!o) return 'unknown'; const zz = zAbove(o.final / o.n, o.n, c.baseline); return zz > 2 ? 'closes' : zz < -2 ? 'never' : 'arbitrary'; };
    c.followCounts = follow; c.occ = occ;
    const L = follow.get('letter');
    c.letterRate = L && L.lower + L.upper ? L.lower / (L.lower + L.upper) : 0;
    c.wraps = c.regime !== 'uninformative' && c.follow('letter') !== 'ends';
    // a row ender: a mark followed by a new unit (by case) that does not close units, or, where case says
    // nothing, a mark whose block ends are arbitrary (a row is as likely as any line to be the last)
    c.rowEnder = (k) => { const f = c.follow(k), cl = c.closes(k); if (cl === 'closes') return false; if (f === 'ends') return true; if (f === 'continues') return false; return cl !== 'never'; };
    c.reliable = (k) => { if (c.follow(k) !== 'continues') return false; const e = follow.get(k); return e.lower / (e.lower + e.upper) > c.letterRate; };
  }
  const clusterOf = (b) => clusters.find((c) => c.lo <= b.max && b.max <= c.hi) || null;

  // the decisions
  const decisions = [];
  let out = '', cursor = 0;
  blocks.forEach((b, bi) => {
    const c = clusterOf(b);
    const M = c?.column ?? null;
    let inner = b.segs[0];
    for (let i = 0; i + 1 < b.segs.length; i++) {
      const A = b.texts[i], B = b.texts[i + 1];
      const w = b.widths[i], f = (tokens(B)[0] || '').length, o = w + 1 + f;
      const k = markClass(A);
      let join = null, why;
      if (!A || !B) why = WHY.EMPTY;
      else if (M === null) why = WHY.NOCOL;
      else if (opensWithMark(B)) why = WHY.ITEM;
      else if (w < M - W) why = WHY.SHORT;
      else if (o > M && c.wraps && !c.rowEnder(k)) { why = WHY.FORCED; join = joinAfter(k); }
      else if (c.regime === 'cased' && (startCase(B) === 'lower' || c.reliable(k))) { why = WHY.UNFINISHED; join = joinAfter(k); }
      else why = o > M ? (c.wraps ? WHY.ROW : WHY.NOWRAP) : WHY.GAP;
      decisions.push({ block: bi, i, join: join !== null, why, w, f, M, A, B, cluster: c ? clusters.indexOf(c) : -1 });
      if (join === null) inner += '<br>' + b.segs[i + 1];
      else inner = inner.replace(/\s+$/, '') + join + b.segs[i + 1].replace(/^\s+/, '');
    }
    out += html.slice(cursor, b.start) + b.open + inner + b.close;
    cursor = b.end;
  });
  out += html.slice(cursor);

  const measures = { blocks: blocks.length, multi: multi.length, brIn: (html.match(/<br>/g) || []).length, brOut: (out.match(/<br>/g) || []).length, W, typ, words, sentEnds, sentenceEndWide, hyph, dash, clusters };
  const report = (showGaps = false) => {
    const pct = (x) => (100 * x).toFixed(1) + '%';
    const L = [];
    L.push(`blocks ${blocks.length} (${multi.length} multi-line), <br> ${measures.brIn} → ${measures.brOut}`);
    L.push(`tokens: widest W=${W}, typical (median) ${typ}`);
    L.push(`spacing: wide gap after a sentence end ${sentEnds.wide}/${sentEnds.n} (${pct(sentEnds.p)}) vs between words ${words.wide}/${words.n} (${pct(words.p)}) → a run after a sentence end counts as ${sentenceEndWide ? 'two' : 'one'}`);
    L.push(`hyphens mid-line: closed ${hyph.closed}, open ${hyph.open} → a hyphen-ended line joins ${hyph.join === '' ? 'closed' : 'with a space'}; dashes: closed ${dash.closed}, open ${dash.open} → ${dash.join === '' ? 'closed' : 'with a space'}`);
    L.push('columns (clusters of block maxima, cut at empty runs ≥ typical token):');
    for (const c of clusters) {
      if (c.column === null) { L.push(`  widths ${c.lo}–${c.hi}: ${c.n} blocks → no column (${c.why || 'nothing stops here'})`); continue; }
      L.push(`  widths ${c.lo}–${c.hi}: ${c.n} blocks → column ${c.column}; case ${c.regime}${c.marked ? ' (units open with a mark)' : ''} (new units start lowercase ${pct(c.caseRates.first)} of ${c.caseRates.nf} cased, breaks in the ragged zone ${pct(c.caseRates.inner)} of ${c.caseRates.ni}, z=${c.caseRates.z.toFixed(1)}); ${c.wraps ? 'wraps text' : 'does not wrap text'}; a line is last of its block ${pct(c.baseline)} of the time`);
      const ks = [...new Set([...c.followCounts.keys(), ...c.occ.keys()])].sort((a, b) => (c.occ.get(b)?.n || 0) - (c.occ.get(a)?.n || 0));
      for (const k of ks) { const e = c.followCounts.get(k) || { lower: 0, upper: 0, other: 0 }; const o = c.occ.get(k) || { n: 0, final: 0 }; L.push(`    ${k.padEnd(9)} follows: lower ${String(e.lower).padStart(4)} upper ${String(e.upper).padStart(4)} other ${String(e.other).padStart(4)} → ${c.follow(k).padEnd(9)}  last of block ${String(o.final).padStart(4)}/${String(o.n).padEnd(5)} → ${c.closes(k).padEnd(9)}${c.rowEnder(k) ? ' row ender' : ''}${c.reliable(k) ? ' continues reliably' : ''}`); }
    }
    const tally = new Map(); for (const d of decisions) tally.set(d.why, (tally.get(d.why) || 0) + 1);
    L.push('decisions:');
    for (const why of Object.values(WHY)) if (tally.get(why)) L.push(`  ${String(tally.get(why)).padStart(5)}  ${why}`);
    if (showGaps) { const gaps = decisions.filter((d) => d.why === WHY.GAP); L.push(`gaps left (${gaps.length}):`); for (const g of gaps) L.push(`  M=${g.M} w=${g.w} f=${g.f} | ${JSON.stringify(g.A)} ‖ ${JSON.stringify(g.B.slice(0, 40))}`); }
    return L.join('\n');
  };
  return { html: out, decisions, measures, report };
}

// ── command: rewrite one reading's html literal in a readings.json, nothing else ───────────────────────────
function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const [file, idxArg] = args.filter((a) => !a.startsWith('--'));
  if (!file || idxArg === undefined) {
    console.error('usage: node tools/reflow-hard-wraps.mjs <readings.json> <reading index> [--dry-run] [--show-gaps]');
    process.exit(2);
  }
  const raw = readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  const idx = Number(idxArg);
  const reading = data.readings?.[idx];
  if (!reading || typeof reading.html !== 'string') { console.error(`no reading ${idx} with html in ${file}`); process.exit(2); }
  const { html: out, report } = reflow(reading.html);
  console.log(`reading ${idx}: ${JSON.stringify(reading.title)}`);
  console.log(report(flags.has('--show-gaps')));
  const lit = JSON.stringify(reading.html);
  const pos = raw.indexOf(lit);
  if (pos < 0 || raw.indexOf(lit, pos + 1) >= 0) { console.error('could not locate the html literal exactly once in the file; nothing written'); process.exit(1); }
  const next = raw.slice(0, pos) + JSON.stringify(out) + raw.slice(pos + lit.length);
  const check = JSON.parse(next);
  if (check.readings[idx].html !== out) { console.error('round-trip check failed; nothing written'); process.exit(1); }
  for (let i = 0; i < data.readings.length; i++) if (i !== idx && JSON.stringify(check.readings[i]) !== JSON.stringify(data.readings[i])) { console.error(`reading ${i} would change; nothing written`); process.exit(1); }
  if (flags.has('--dry-run')) console.log('dry run: nothing written');
  else { writeFileSync(file, next); console.log(`wrote ${file}`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
