#!/usr/bin/env node
// reflow-hard-wraps.falsify.mjs — try to break the reflow rule on many kinds of document, with the truth known.
//
// Documents are built from real material (the Zenodotus corpus beside this repo) so that every <br> carries a
// label: WRAP (made here by wrapping a paragraph at a known column, strictly or raggedly, with or without the
// padding and double spacing a text layer shows) or BREAK (a line the material set on purpose: a verse line, a
// speaker, a stage direction, a code line, a catalogue field, a clue, an article heading, a table row, an
// address line). Unlabelled real documents are run too and inspected by rate.
//
// Bars, declared before the first run (a claim that fails is reported, not quietly loosened):
//   P  wrapped prose, strict, any column 36–100, any language    recall ≥ 0.97, exact paragraph recovery ≥ 0.95
//   N  wrapped prose with ragged breaks, padding, double spaces  recall ≥ 0.90
//   D  deliberate-line documents                                 false joins ≤ 1% of breaks
//   X  mixed documents (prose + deliberate lines, two columns)   recall ≥ 0.95 strict / ≥ 0.85 ragged, false joins ≤ 1%
//   R  already-reflowed documents                                false joins ≤ 1%
//   T  tiny documents                                            no false joins (recall reported)
//   C  CJK text without spaces                                   no false joins (recall reported)
//   U  real unlabelled documents                                 inspected: join rate and samples printed; the two
//                                                                 Gutenberg table rows in reading 2 must stay rows
//   S  the screenplay (readings.json reading 7)                  cast block one line; short all-caps cues never joined
//                                                                 to what follows; action blocks ≥ 95% joined
//
//   node tools/reflow-hard-wraps.falsify.mjs [--verbose]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { reflow, WHY, plain, markClass } from './reflow-hard-wraps.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const Z = resolve(HERE, '../../Zenodotus');
const REPO = resolve(HERE, '..');
const verbose = process.argv.includes('--verbose');

// ── material ───────────────────────────────────────────────────────────────────────────────────────────────
const read = (rel) => { const p = resolve(Z, rel); return existsSync(p) ? readFileSync(p, 'utf8') : null; };
function gutenbergParas(text, { max = 250, skip = 0, minLen = 1 } = {}) {
  let t = text.replace(/\r/g, '');
  const s = t.search(/\*\*\* ?START OF/); if (s >= 0) t = t.slice(t.indexOf('\n', s) + 1);
  const e = t.search(/\*\*\* ?END OF/); if (e >= 0) t = t.slice(0, e);
  const paras = t.split(/\n[ \t]*\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length >= minLen);
  return paras.slice(skip, skip + max);
}
const linesOf = (text, from, to) => text.replace(/\r/g, '').split('\n').slice(from, to);
const groupsOf = (lines) => { const g = []; let cur = []; for (const l of lines) { if (l.trim()) cur.push(l); else if (cur.length) { g.push(cur); cur = []; } } if (cur.length) g.push(cur); return g; };

function lcg(seed) { let x = (seed >>> 0) || 1; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296; }

// ── wrapping a paragraph at a column, the way a page would ────────────────────────────────────────────────
function wrapAt(text, M, rnd, { ragged = 0, raggedP = 0, hyphen = false, double = false } = {}) {
  let words = text.split(' ').filter(Boolean);
  if (double) { // the typesetter's two spaces after a sentence end: the word carries one extra trailing space
    words = words.map((w, i) => (i + 1 < words.length && /[.?!]["'”’)]*$/.test(w) && /^[A-Z"'“(]/.test(words[i + 1]) ? w + ' ' : w));
  }
  const lines = []; let cur = '';
  const nextLimit = () => (ragged && rnd() < raggedP ? M - 1 - Math.floor(rnd() * ragged) : M);
  let limit = nextLimit();
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if (cur.length + 1 + w.length <= limit) { cur += ' ' + w; continue; }
    if (hyphen && w.includes('-') && !w.startsWith('-')) {
      const parts = w.split('-'); let head = '';
      for (let k = 0; k < parts.length - 1; k++) { const t = (head ? head + '-' : '') + parts[k]; if (cur.length + 1 + t.length + 1 <= limit) head = t; else break; }
      if (head) { lines.push(cur + ' ' + head + '-'); cur = w.slice(head.length + 1); limit = nextLimit(); continue; }
    }
    lines.push(cur); cur = w; limit = nextLimit();
  }
  if (cur) lines.push(cur);
  return lines.map((l) => l.replace(/ +$/, ''));
}
const pad = (line, rnd, p) => (p ? line.replace(/ /g, (sp) => (rnd() < p ? ' '.repeat(3 + Math.floor(rnd() * 4)) : sp)) : line);

// ── documents: blocks of segments, each segment after the first labelled wrap or break ────────────────────
const seg = (t, truth) => ({ t, truth });
const wrapped = (para, M, rnd, opts, padP = 0) => wrapAt(para, M, rnd, opts).map((l, i) => seg(pad(l, rnd, padP), i ? 'wrap' : null));
const deliberate = (lines) => lines.map((l, i) => seg(l, i ? 'break' : null));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const toHtml = (blocks) => blocks.map((b) => '<p style="margin:0 0 14px">' + b.map((s) => esc(s.t)).join('<br>') + '</p>').join('\n');
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

// ── scoring ────────────────────────────────────────────────────────────────────────────────────────────────
const results = [];
// `limit`: a structural limit stated before the run; the bar is still printed against, but a miss is reported
// as LIMIT (with the reason) and does not fail the battery
function score(name, kind, blocks, { exact = null, bars, limit = null } = {}) {
  const html = toHtml(blocks);
  const r = reflow(html);
  const truth = []; blocks.forEach((b, bi) => b.forEach((s, i) => { if (i > 0) truth.push({ block: bi, i: i - 1, truth: s.truth }); }));
  if (truth.length !== r.decisions.length) throw new Error(`${name}: ${truth.length} labels, ${r.decisions.length} decisions`);
  let tw = 0, tb = 0, found = 0; const missed = [], fj = [];
  r.decisions.forEach((d, k) => { const t = truth[k]; if (t.truth === 'wrap') { tw++; if (d.join) found++; else missed.push(d); } else { tb++; if (d.join) fj.push(d); } });
  let exactN = 0, exactOf = 0;
  if (exact) {
    const outBlocks = [...r.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    exact.forEach((para, i) => { if (para === null) return; exactOf++; const inner = outBlocks[i]; if (!inner.includes('<br>') && collapse(plain(inner)) === collapse(para)) exactN++; });
  }
  const recall = tw ? found / tw : null, fjRate = tb ? fj.length / tb : null, exactRate = exactOf ? exactN / exactOf : null;
  const cols = r.measures.clusters.map((c) => (c.column !== null ? c.column : `(${c.lo}–${c.hi}: none)`)).join(' ');
  const checks = [];
  if (bars.recall !== undefined && recall !== null) checks.push([`recall ≥ ${bars.recall}`, recall >= bars.recall]);
  if (bars.exact !== undefined && exactRate !== null) checks.push([`exact ≥ ${bars.exact}`, exactRate >= bars.exact]);
  if (bars.fj !== undefined && tb) checks.push([`false joins ≤ ${bars.fj}`, fjRate <= bars.fj]);
  const met = checks.every((c) => c[1]);
  const pass = met || !!limit;
  results.push({ name, kind, pass, limit: !met && limit ? limit : null });
  const f = (x) => (x === null ? '  —  ' : (100 * x).toFixed(1).padStart(5) + '%');
  console.log(`${met ? 'PASS' : limit ? 'LIMIT' : 'FAIL'} ${kind} ${name.padEnd(46)} wraps ${String(found).padStart(5)}/${String(tw).padEnd(5)} ${f(recall)}  false joins ${String(fj.length).padStart(3)}/${String(tb).padEnd(5)} ${f(fjRate)}  exact ${f(exactRate)}  gaps ${String(r.decisions.filter((d) => d.why === WHY.GAP).length).padStart(4)}  columns ${cols}${checks.filter((c) => !c[1]).length ? '   ← ' + checks.filter((c) => !c[1]).map((c) => c[0]).join(', ') : ''}`);
  if (!met && limit) console.log(`     limit: ${limit}`);
  const show = (list, label) => { if (!list.length) return; console.log(`     ${label} (${list.length}), first ${Math.min(list.length, verbose ? 12 : 4)}:`); for (const d of list.slice(0, verbose ? 12 : 4)) console.log(`       M=${d.M} w=${d.w} f=${d.f} ${d.why} | ${JSON.stringify(d.A.slice(-50))} ‖ ${JSON.stringify(d.B.slice(0, 30))}`); };
  if (fj.length) show(fj, 'FALSE JOINS');
  if (verbose || (recall !== null && bars.recall !== undefined && recall < bars.recall)) show(missed, 'missed wraps');
  return r;
}

// ── sources ────────────────────────────────────────────────────────────────────────────────────────────────
const SRC = {
  pip: read('01-literature-books/gitenberg/pg1400_Great-Expectations.txt'),
  dracula: read('01-literature-books/gitenberg/pg345_Dracula.txt'),
  pride: read('01-literature-books/gutenberg/pg1342_Pride_and_Prejudice.txt'),
  alice: read('01-literature-books/gutenberg/pg11_Alice_s_Adventures_in_Wonderland.txt'),
  miserables: read('11-multi-language/gutenberg-non-en/fr/pg17489_Les_Miserables__Victor_Hugo.txt'),
  warpeace_ru: (() => { const d = resolve(Z, '11-multi-language/war-and-peace/ru'); if (!existsSync(d)) return null; const f = readFileSync; const files = execSync(`ls "${d}"`).toString().trim().split('\n').filter((x) => x.endsWith('.txt')); return files.length ? f(resolve(d, files[0]), 'utf8') : null; })(),
  warpeace_fr: read('11-multi-language/war-and-peace/fr/guerre-et-paix_Tolstoy_Bienstock_wikisource.txt'),
  edda: read('11-multi-language/translations-en/bellows-1923-the-poetic-edda.txt'),
  hamsun_he: read('24-global-literature/he/he-18291-Hamsun.txt'),
  octoroon: read('21-anti-colonial/colonial-studies/46091-Boucicault-The-Octoroon-or-Life-in-Louisiana-A-Play.txt'),
  shakespeare: read('01-literature-books/gutenberg/pg100_Complete_Works_of_Shakespeare.txt'),
  faust: read('01-literature-books/gutenberg/pg2636_Faust__German_.txt'),
  longfellow: read('21-anti-colonial/colonial-studies/44398-Longfellow-Poems-on-Slavery.txt'),
  whitman: read('01-literature-books/gutenberg/pg2397_Leaves_of_Grass_by_Whitman.txt'),
  folger: read('15-western-canon/folger-shakespeare/Hamlet.txt'),
  clues: read('16-wordplay/guardian-cryptics/guardian-cryptic-clues-1999-2020.txt'),
  udhr: read('06-government-legal/un-udhr/udhr-eng.txt'),
  code: read('09-source-code/openssh_openssh-portable/ssh.c'),
  met: read('07-images-media/met-museum-catalog.txt'),
  sblgnt: read('14-holy-texts/sblgnt/Matt.txt'),
  kinder: read('18-childrens-books/african-storybook/de/0001_ein-sehr-großer-mann.md'),
  naoroji: read('21-anti-colonial/india-naoroji.txt'),
  akutagawa: read('24-global-literature/ja/ja-1982-Akutagawa.txt'),
  sunzi: read('24-global-literature/zh/zh-12407-Sunzi.txt'),
};
for (const [k, v] of Object.entries(SRC)) if (!v) console.log(`(no source ${k}; its documents are skipped)`);

// ── P: wrapped prose, strict ──────────────────────────────────────────────────────────────────────────────
const P = { recall: 0.97, exact: 0.95 };
const proseDoc = (name, kind, paras, M, seed, opts = {}, padP = 0, bars = P) => score(`${name} @${M}`, kind, paras.map((p) => wrapped(p, M, lcg(seed), opts, padP)), { exact: paras, bars });
if (SRC.pip) { const paras = gutenbergParas(SRC.pip, { max: 300, skip: 10, minLen: 30 }); for (const M of [36, 48, 60, 72, 100]) proseDoc('Great Expectations', 'P', paras, M, M, { hyphen: true }); }
if (SRC.dracula) proseDoc('Dracula (letters, diary)', 'P', gutenbergParas(SRC.dracula, { max: 300, skip: 10 }), 65, 7, { hyphen: true });
if (SRC.pride) proseDoc('Pride and Prejudice', 'P', gutenbergParas(SRC.pride, { max: 300, skip: 10 }), 72, 8);
if (SRC.miserables) proseDoc('Les Misérables (fr)', 'P', gutenbergParas(SRC.miserables, { max: 300, skip: 30 }), 72, 9);
if (SRC.warpeace_ru) proseDoc('War and Peace (ru)', 'P', gutenbergParas(SRC.warpeace_ru, { max: 250, skip: 30, minLen: 30 }), 70, 10);
if (SRC.warpeace_fr) proseDoc('Guerre et Paix (fr, wikisource)', 'P', gutenbergParas(SRC.warpeace_fr, { max: 250, skip: 30, minLen: 30 }), 80, 11);
if (SRC.edda) proseDoc('Poetic Edda introduction (prose)', 'P', gutenbergParas(SRC.edda, { max: 120, skip: 20, minLen: 200 }).filter((p) => !/ \| |\. \. \./.test(p)), 72, 12); // quoted verse (caesura bars, dotted lacunae) is not prose
if (SRC.hamsun_he) proseDoc('Hamsun in Hebrew', 'P', gutenbergParas(SRC.hamsun_he, { max: 200, skip: 5, minLen: 60 }), 60, 13);
if (SRC.octoroon) proseDoc('The Octoroon as prose paragraphs', 'P', gutenbergParas(SRC.octoroon, { max: 300, skip: 40, minLen: 40 }), 72, 14);

// ── N: wrapped prose with the noise a text layer adds ─────────────────────────────────────────────────────
const N = { recall: 0.90 };
if (SRC.pip) {
  const paras = gutenbergParas(SRC.pip, { max: 300, skip: 10, minLen: 30 });
  proseDoc('Great Expectations ragged ≤8 (p .3)', 'N', paras, 60, 21, { ragged: 8, raggedP: 0.3, hyphen: true }, 0, N);
  proseDoc('Great Expectations padded (p .15)', 'N', paras, 60, 22, { hyphen: true }, 0.15, N);
  proseDoc('Great Expectations double-spaced sentences', 'N', paras, 60, 23, { hyphen: true, double: true }, 0, N);
  proseDoc('Great Expectations ragged+padded+double', 'N', paras, 60, 24, { ragged: 8, raggedP: 0.3, hyphen: true, double: true }, 0.15, N);
  proseDoc('Great Expectations ragged+padded+double @40', 'N', paras, 40, 25, { ragged: 6, raggedP: 0.3, hyphen: true, double: true }, 0.15, N);
}

// ── D: deliberate lines ───────────────────────────────────────────────────────────────────────────────────
const D = { fj: 0.01 };
const linesDoc = (name, groups, bars = D, kind = 'D') => score(name, kind, groups.filter((g) => g.length).map(deliberate), { bars });
if (SRC.shakespeare) linesDoc('Shakespeare sonnets (verse, capitals)', groupsOf(linesOf(SRC.shakespeare, 1900, 2830)).filter((g) => g.length > 2)); // the sonnets end at THE END, line 2831; a play's prose follows
if (SRC.faust) linesDoc('Faust (German verse)', groupsOf(linesOf(SRC.faust, 400, 1400)).filter((g) => g.length > 1));
if (SRC.longfellow) linesDoc('Longfellow (indented stanzas)', groupsOf(linesOf(SRC.longfellow, 150, 700)).filter((g) => g.length > 1));
// the Folger file is Romeo and Juliet; its prose scenes are wrapped at ~70 by the edition (real wraps), so only
// speeches whose lines all fit a verse width are deliberate-line truth here
if (SRC.folger) linesDoc('Folger play text (speakers, verse, directions)', groupsOf(linesOf(SRC.folger, 300, 2200)).filter((g) => g.length > 1 && g.every((l) => l.length <= 60)));
if (SRC.clues) { const ls = linesOf(SRC.clues, 30, 1230); const g = []; for (let i = 0; i < ls.length; i += 12) g.push(ls.slice(i, i + 12)); linesDoc('Cryptic clues (one per line)', g); }
if (SRC.code) linesDoc('C source (ssh.c)', groupsOf(linesOf(SRC.code, 0, 600)).filter((g) => g.length > 1));
if (SRC.met) linesDoc('Museum catalogue (field: value)', SRC.met.split(/\n--- /).slice(1, 120).map((e) => e.split('\n').filter((l) => l.trim())));
if (SRC.sblgnt) linesDoc('Greek NT apparatus', groupsOf(linesOf(SRC.sblgnt, 0, 800)).filter((g) => g.length > 1));
if (SRC.kinder) linesDoc("Children's book, one sentence a line (de)", [SRC.kinder.split('\n').filter((l) => l.trim() && !l.startsWith('#'))]);
if (SRC.udhr) {
  const ls = SRC.udhr.split('\n').map((l) => l.trim()).filter(Boolean).slice(5);
  const arts = []; for (const l of ls) { if (/^Article \d+$/.test(l)) arts.push([l]); else if (arts.length) arts[arts.length - 1].push(l); }
  linesDoc('UDHR, one paragraph a line (long lines)', arts);
}
if (SRC.sunzi) linesDoc('Sunzi (zh, short deliberate lines)', [SRC.sunzi.split('\n').filter((l) => l.trim())], D, 'C');
{ // a numeric table, rows aligned with spaces, and address cards
  const rnd = lcg(31); const names = SRC.pip ? [...new Set((SRC.pip.match(/\b[A-Z][a-z]{4,}\b/g) || []))].slice(0, 400) : ['Mauretania', 'Titanic', 'Olympic', 'Lusitania'];
  const rows = []; for (let i = 0; i < 160; i++) rows.push(names[Math.floor(rnd() * names.length)].padEnd(18) + String(Math.floor(rnd() * 90000)).padStart(7) + String(Math.floor(rnd() * 999) / 10).padStart(9) + String(Math.floor(rnd() * 40)).padStart(6));
  const groups = []; for (let i = 0; i < rows.length; i += 12) groups.push(['Name' + ' '.repeat(14) + 'Tonnage   Speed  Boats', ...rows.slice(i, i + 12)]);
  linesDoc('Numeric table (aligned rows)', groups);
  const cards = []; for (let i = 0; i < 40; i++) cards.push([names[Math.floor(rnd() * names.length)] + ' ' + names[Math.floor(rnd() * names.length)], `${Math.floor(rnd() * 200)} ${names[Math.floor(rnd() * names.length)]} Street`, names[Math.floor(rnd() * names.length)], 'England']);
  linesDoc('Address cards', cards);
}

// ── X: mixed documents ────────────────────────────────────────────────────────────────────────────────────
const X = { recall: 0.95, fj: 0.01 }, XR = { recall: 0.85, fj: 0.01 };
if (SRC.pip && SRC.longfellow) {
  const paras = gutenbergParas(SRC.pip, { max: 150, skip: 10, minLen: 30 }); const stanzas = groupsOf(linesOf(SRC.longfellow, 150, 700)).filter((g) => g.length > 1);
  const blocks = []; const rnd = lcg(41); paras.forEach((p, i) => { blocks.push(wrapped(p, 72, rnd, { hyphen: true })); if (i % 5 === 4) blocks.push(deliberate(stanzas[(i / 5) % stanzas.length | 0])); });
  score('Novel @72 with verse stanzas between', 'X', blocks, { bars: X });
}
if (SRC.dracula) { // letters: address, date, salutation, body, closing
  const paras = gutenbergParas(SRC.dracula, { max: 200, skip: 10, minLen: 80 }); const rnd = lcg(42); const blocks = [];
  for (let i = 0; i + 2 < paras.length; i += 3) {
    blocks.push(deliberate(['Castle Dracula', 'Bistritz', 'Transylvania', `${3 + (i % 27)} May`])); blocks.push([seg('My dear Mina,', null)]);
    blocks.push(wrapped(paras[i], 65, rnd, { hyphen: true })); blocks.push(wrapped(paras[i + 1], 65, rnd, { hyphen: true }));
    blocks.push(deliberate(['Your loving friend,', 'Lucy']));
  }
  score('Letters @65 (addresses, salutations, signatures)', 'X', blocks, { bars: X });
}
if (SRC.alice) { // lists and a contents page
  const paras = gutenbergParas(SRC.alice, { max: 120, skip: 8, minLen: 60 }); const rnd = lcg(43);
  const items = paras.map((p) => '- ' + p.split(/(?<=[.?!])\s/).slice(0, 2).join(' '));
  const blocks = []; for (let i = 0; i < items.length; i += 8) { const b = []; for (const it of items.slice(i, i + 8)) { const ls = wrapAt(it, 70, rnd); ls.forEach((l, k) => b.push(seg(k ? '  ' + l : l, b.length ? (k ? 'wrap' : 'break') : null))); } blocks.push(b); }
  score('Bulleted list @72 (items wrap, items break)', 'X', blocks, { bars: X });
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const toc = []; paras.slice(0, 60).forEach((p, i) => { const title = p.split(' ').slice(0, 5 + (i % 6)).join(' ').toUpperCase().replace(/[^A-Z' ]/g, ''); toc.push(`CHAPTER ${roman[i % 12]}. ${title} ${'.'.repeat(8)} ${3 + i * 7}`); });
  const tb = []; for (let i = 0; i < toc.length; i += 10) { const b = []; for (const e of toc.slice(i, i + 10)) { const ls = wrapAt(e, 60, rnd); ls.forEach((l, k) => b.push(seg(k ? '    ' + l : l, b.length ? (k ? 'wrap' : 'break') : null))); } tb.push(b); }
  score('Contents page @60 (long entries wrap)', 'X', tb, { bars: { fj: 0.01 } }); // all-caps entries: joins are gaps by design, so only false joins are held
}
if (SRC.udhr) {
  const ls = SRC.udhr.split('\n').map((l) => l.trim()).filter(Boolean).slice(5); const rnd = lcg(44);
  // the page keeps a blank line between paragraphs, so each paragraph is its own block; the heading opens the first
  const blocks = []; let heading = null;
  for (const l of ls) { if (/^Article \d+$/.test(l)) heading = l; else { const b = heading ? [seg(heading, null)] : []; heading = null; wrapAt(l, 60, rnd).forEach((x, k) => b.push(seg(x, b.length ? (k ? 'wrap' : 'break') : null))); blocks.push(b); } }
  score('UDHR articles @60 (heading, wrapped paragraphs)', 'X', blocks, { bars: X });
}
if (SRC.pip) { // paragraphs run together with no blank line between: a paragraph whose last line is full cannot be told from a wrap
  const paras = gutenbergParas(SRC.pip, { max: 240, skip: 10, minLen: 30 }); const rnd = lcg(47); const blocks = [];
  for (let i = 0; i + 3 < paras.length; i += 4) { const b = []; for (const p of paras.slice(i, i + 4)) wrapAt(p, 72, rnd, { hyphen: true }).forEach((l, k) => b.push(seg(l, b.length ? (k ? 'wrap' : 'break') : null))); blocks.push(b); }
  score('Paragraphs with no blank line between @72', 'X', blocks, { bars: X, limit: 'a paragraph boundary after a full line is indistinguishable from a wrap; the rate above is that of full last lines' });
}
if (SRC.octoroon) { // a play: speaker on a line, speech wrapped, stage directions as their own blocks
  const paras = gutenbergParas(SRC.octoroon, { max: 400, skip: 40, minLen: 20 }); const rnd = lcg(45); const blocks = [];
  for (const p of paras) {
    const m = p.match(/^_([^_]+)\._ (.*)$/);
    if (m) { const b = [seg(m[1].toUpperCase(), null)]; wrapAt(m[2].replace(/_/g, ''), 55, rnd).forEach((l, k) => b.push(seg(l, k ? 'wrap' : 'break'))); blocks.push(b); }
    else if (/^_Enter|^_Exit|^\[/.test(p)) blocks.push([seg(p.replace(/_/g, ''), null)]);
  }
  score('Play @55 (speaker line, wrapped speech)', 'X', blocks, { bars: X });
}
if (SRC.pip) { // two columns, the screenplay's geometry: narrative at 60, dialogue at 40 under a short name
  const paras = gutenbergParas(SRC.pip, { max: 400, skip: 10, minLen: 30 });
  const quotes = paras.flatMap((p) => [...p.matchAll(/"([^"]{40,400})"/g)].map((m) => m[1])).slice(0, 220);
  const narrative = paras.filter((p) => !p.includes('"')).slice(0, 110);
  const names = ['PIP', 'JOE', 'ESTELLA', 'MISS HAVISHAM', 'HERBERT', 'WEMMICK', 'JAGGERS', 'MAGWITCH', 'BIDDY', 'MRS. JOE'];
  const asides = ['(quietly)', '(to Joe)', '(after a pause)', '(looking at the fire, almost to herself)', '(tense but feigning unconcern)'];
  for (const [label, opts, padP, bars] of [['strict', {}, 0, X], ['ragged ≤8 (p .4) + padded + double', { ragged: 8, raggedP: 0.4, double: true }, 0.15, XR]]) {
    const rnd = lcg(46); const blocks = []; let q = 0;
    narrative.forEach((p, i) => {
      blocks.push(wrapped(p, 60, rnd, { hyphen: true, ...opts }, padP));
      for (let k = 0; k < 2 && q < quotes.length; k++, q++) {
        const b = [seg('          ' + names[(q * 7) % names.length], null)];
        if (rnd() < 0.3) b.push(seg('    ' + asides[(q * 3) % asides.length], 'break'));
        const said = quotes[q].trim(); const speech = said[0].toUpperCase() + said.slice(1); // a speech opens with a capital, as any play writes it
        wrapAt(speech, 40, rnd, opts).forEach((l, j) => b.push(seg(pad(l, rnd, padP), j ? 'wrap' : 'break')));
        blocks.push(b);
      }
      if (i % 9 === 8) blocks.push([seg('CUT TO:', null)]);
    });
    score(`Two columns 60/40, names and asides, ${label}`, 'X', blocks, { bars });
  }
}

// ── R: already reflowed ───────────────────────────────────────────────────────────────────────────────────
if (SRC.pip && SRC.shakespeare) {
  const paras = gutenbergParas(SRC.pip, { max: 120, skip: 10, minLen: 30 }); const sonnets = groupsOf(linesOf(SRC.shakespeare, 1900, 2600)).filter((g) => g.length > 2);
  const blocks = []; paras.forEach((p, i) => { blocks.push([seg(p, null)]); if (i % 6 === 5) blocks.push(deliberate(sonnets[(i / 6 | 0) % sonnets.length])); });
  score('Reflowed novel (one line a paragraph) with sonnets', 'R', blocks, { bars: { fj: 0.01 } });
}

// ── T: tiny ───────────────────────────────────────────────────────────────────────────────────────────────
if (SRC.pip) { const paras = gutenbergParas(SRC.pip, { max: 3, skip: 40, minLen: 200 }); proseDoc('Three paragraphs', 'T', paras, 72, 51, {}, 0, { fj: 0 }); proseDoc('One paragraph', 'T', paras.slice(0, 1), 72, 52, {}, 0, { fj: 0 }); }

// ── C: CJK, no spaces between words ───────────────────────────────────────────────────────────────────────
if (SRC.akutagawa) {
  // the file is itself hard-wrapped at about 35 characters; a paragraph opens with an ideographic space, so
  // every break inside one is a wrap of the page's own making
  const blocks = []; let cur = null;
  for (const raw of SRC.akutagawa.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) continue;
    if (raw.startsWith('　')) { if (cur && cur.length > 1) blocks.push(cur); cur = [seg(raw.trim(), null)]; }
    else if (cur) cur.push(seg(raw.trim(), 'wrap'));
  }
  if (cur && cur.length > 1) blocks.push(cur);
  score('Akutagawa (ja), the file\'s own wraps at ~35', 'C', blocks, { bars: { recall: 0.9, fj: 0 }, limit: 'a script without spaces: every line is one token, so no wall is as wide as the widest token and no column is measured; nothing joins, nothing is guessed' });
}

// ── U: real, unlabelled or weakly labelled ───────────────────────────────────────────────────────────────
if (SRC.naoroji) { // OCR with double spaces between words; paragraphs are hard-wrapped; all inner breaks are wraps
  const groups = groupsOf(linesOf(SRC.naoroji, 900, 2400)).filter((g) => g.length > 1);
  score('Naoroji OCR (double-spaced words, hard-wrapped)', 'U', groups.map((g) => g.map((l, i) => seg(l, i ? 'wrap' : null))), { bars: { recall: 0.9 }, limit: 'proportional type: the column is ragged by ten characters, so a continuation that opens with a capital or a digit has no evidence and stays a gap; the text also holds tables, labelled here as wraps' });
}
if (SRC.whitman) { // Gutenberg's hanging indent: a line indented six spaces continues the verse line above it
  const groups = groupsOf(linesOf(SRC.whitman, 280, 1500)).filter((g) => g.length > 1);
  score('Whitman (verse lines break, hanging indents wrap)', 'U', groups.map((g) => g.map((l, i) => seg(l, i ? (/^ {5,}/.test(l) ? 'wrap' : 'break') : null))), { bars: { recall: 0.9, fj: 0.01 } });
}
{ // the Gutenberg originals before the generator reflowed them (commit 3a41527^), and the screenplay now
  let before = null;
  try { before = JSON.parse(execSync('git show 3a41527^:titanic-1912/readings.json', { cwd: REPO }).toString()); } catch (e) { console.log('(no git history for the Gutenberg originals; skipped)'); }
  const now = JSON.parse(readFileSync(resolve(REPO, 'titanic-1912/readings.json'), 'utf8'));
  let head = null;
  try { head = JSON.parse(execSync('git show HEAD:titanic-1912/readings.json', { cwd: REPO }).toString()); } catch (e) {}
  if (before) for (const i of [2, 3, 4]) {
    // truth from the generator: a block it kept whole as prose has only wraps inside; blocks it dropped or
    // restructured (title pages, contents, tables) are not scored, except the two table rows that must stay
    const r = reflow(before.readings[i].html);
    const after = new Set([...now.readings[i].html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => collapse(plain(m[1])).replace(/_/g, '')));
    const blocksIn = [...before.readings[i].html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].split('<br>').map(plain));
    const kept = new Set(); blocksIn.forEach((ls, bi) => { if (ls.length > 1 && after.has(collapse(ls.join(' ')).replace(/_/g, ''))) kept.add(bi); });
    const scored = r.decisions.filter((d) => kept.has(d.block));
    const joined = scored.filter((d) => d.join).length;
    const rows = r.decisions.filter((d) => /^(Mauretania|Titanic) [\d,]+ [\d,]+ \d+$/.test(collapse(d.A)) || /^Displacement Horse power/.test(collapse(d.A)));
    const rowsKept = rows.every((d) => !d.join);
    const recall = scored.length ? joined / scored.length : 0;
    const met = recall >= 0.97 && (i !== 2 || (rows.length >= 2 && rowsKept));
    const limit = i === 4 ? 'the list of illustrations sets its captions in a column reached by one block each, so no wall is measured there and those wraps stay gaps' : null;
    const pass = met || !!limit;
    results.push({ name: `Gutenberg original reading ${i}`, kind: 'U', pass, limit: !met && limit ? limit : null });
    console.log(`${met ? 'PASS' : limit ? 'LIMIT' : 'FAIL'} U ${('Gutenberg original reading ' + i + ' (' + before.readings[i].title.slice(0, 24) + ')').padEnd(46)} wraps ${joined}/${scored.length} (${(100 * recall).toFixed(1)}%) in the ${kept.size} blocks the generator kept whole; ${r.decisions.length - scored.length} other breaks not scored  columns ${r.measures.clusters.map((c) => c.column ?? '—').join(' ')}${i === 2 ? `  table rows kept ${rowsKept} (${rows.length} rows)` : ''}`);
    const missed = scored.filter((d) => !d.join);
    for (const d of missed.slice(0, verbose ? 30 : 4)) console.log(`       missed: ${d.why} | ${JSON.stringify(d.A.slice(-50))} ‖ ${JSON.stringify(d.B.slice(0, 30))}`);
  }
  // the target is judged on the committed (hard-wrapped) reading 7; the working copy, once rewritten, must be a
  // fixed point: a second pass joins nothing
  const r = reflow((head || now).readings[7].html);
  const again = reflow(now.readings[7].html);
  const fixedPoint = again.html === now.readings[7].html && again.measures.brOut === again.measures.brIn;
  const outBlocks = [...r.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => plain(m[1]));
  const cast = outBlocks.find((t) => t.startsWith('KATE WINSLET'));
  const castOne = !!cast && !cast.includes('<br>') && /BILLY ZANE\.\.\. Caledon Hockley BILL PAXTON\.\.\. Brock Lovett$/.test(collapse(cast)) && /Jack Dawson KATHY/.test(collapse(cast));
  const cues = r.decisions.filter((d) => /^[A-Z][A-Z .'()]{0,24}$/.test(collapse(d.A)) && collapse(d.A).length <= 24 && /^\p{L}/u.test(d.B));
  const cuesJoined = cues.filter((d) => d.join);
  const wide = Math.max(...r.measures.clusters.map((c) => c.column ?? 0));
  const action = r.decisions.filter((d) => d.M === wide && markClass(d.A) === 'letter');
  const actionJoined = action.filter((d) => d.join).length / Math.max(1, action.length);
  // the file on disk against the last commit: only reading 7's html may differ
  let untouched = 'no git HEAD to compare';
  if (head) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const others = head.readings.every((hr, i) => i === 7 ? same({ ...hr, html: null }, { ...now.readings[i], html: null }) : same(hr, now.readings[i]));
    const top = same({ ...head, readings: null }, { ...now, readings: null }) && head.readings.length === now.readings.length;
    untouched = others && top ? (head.readings[7].html === now.readings[7].html ? 'identical to HEAD (reading 7 not rewritten yet)' : 'only reading 7 html differs from HEAD') : 'SOMETHING OUTSIDE READING 7 DIFFERS FROM HEAD';
  }
  const pass = castOne && cuesJoined.length === 0 && actionJoined >= 0.95 && fixedPoint && !/SOMETHING/.test(untouched);
  results.push({ name: 'Screenplay reading 7', kind: 'S', pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} S ${'Screenplay reading 7 (the target)'.padEnd(46)} on HEAD: cast block one line ${castOne}; short all-caps cues joined ${cuesJoined.length}/${cues.length}; wide-column breaks not ending a unit joined ${(100 * actionJoined).toFixed(1)}%; columns ${r.measures.clusters.map((c) => c.column ?? '—').join(' ')}; <br> ${r.measures.brIn} → ${r.measures.brOut}`);
  console.log(`       working copy: ${untouched}; a second pass ${fixedPoint ? 'joins nothing (fixed point)' : 'STILL CHANGES IT (' + again.measures.brIn + ' → ' + again.measures.brOut + ')'}`);
  if (cast) console.log(`       cast: ${collapse(cast)}`);
  for (const d of cuesJoined.slice(0, 6)) console.log(`       cue joined: ${JSON.stringify(d.A)} ‖ ${JSON.stringify(d.B.slice(0, 30))}`);
}

// ── summary ────────────────────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass), limits = results.filter((r) => r.limit);
console.log(`\n${results.length - failed.length - limits.length}/${results.length} documents within their bars${limits.length ? '; at a stated limit: ' + limits.map((r) => r.name).join(' | ') : ''}${failed.length ? '; FAILED: ' + failed.map((r) => r.name).join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
