// يبني صفحات ورشة العمل من ملفات content/*.md إلى مجلد docs/ (المنشور على GitHub Pages)
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const cfg = JSON.parse(read('config.json'));
// للبروفة المحلية: AIWS_ROOM=غرفة-تجربة AIWS_OUT=.test-build node scripts/build.mjs (لا يمس docs/)
if (process.env.AIWS_ROOM) cfg.room = process.env.AIWS_ROOM;
const joinUrl = new URL(cfg.joinPath, cfg.siteUrl).href;

/* ---------- قراءة ملفات المحتوى ---------- */
function parseMd(src) {
  const out = {};
  let key = null, buf = [];
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) { if (key) out[key] = buf.join('\n').trim(); key = m[1]; buf = []; continue; }
    if (key) buf.push(line);
  }
  if (key) out[key] = buf.join('\n').trim();
  return out;
}
const C = {};
for (const f of fs.readdirSync(path.join(root, 'content')).filter(f => f.endsWith('.md')).sort()) {
  C[f.replace(/^\d+-/, '').replace(/\.md$/, '')] = parseMd(read('content/' + f));
}
function get(ref) {
  const i = ref.indexOf('.');
  const id = ref.slice(0, i), key = ref.slice(i + 1);
  if (!C[id]) throw new Error(`ملف غير موجود في content/: ${id}`);
  if (C[id][key] === undefined) throw new Error(`الحقل "## ${key}" غير موجود في ملف ${id}`);
  return C[id][key];
}

/* ---------- تحويل النص ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`([^`]+)`/g, '<span class="ltr">$1</span>')
  .replace(/==(.+?)==/g, '<span class="grad-text">$1</span>')
  .replace(/\n/g, '<br>');
const withPh = html => html.replace(/\[([^\]]+)\]/g, '<span class="ph">[$1]</span>');
const plain = s => String(s).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '⁦$1⁩').replace(/==(.+?)==/g, '$1');
const items = s => s.split('\n').filter(l => /^\s*-\s+/.test(l)).map(l => l.replace(/^\s*-\s+/, '').split('|').map(x => x.trim()));
const ico = (name, cls = '') => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`;
const COLORS = ['green', 'teal', 'blue', 'violet', 'navy', 'sand'];

/* ---------- ملاحظات المقدّم: سطر لكل ملاحظة "- النوع | النص" ---------- */
const noteTypes = Object.fromEntries(items(get('presenter-page.note_types')).map(([k, label, icon]) => [k, { label: plain(label), icon }]));
function noteSteps(id) {
  const raw = get(id + '.notes'), lines = raw.split('\n').filter(l => /^\s*-\s+/.test(l));
  if (!lines.length) return [{ k: 'say', text: raw }];
  return lines.map(l => {
    const s = l.replace(/^\s*-\s+/, ''), i = s.indexOf('|');
    const k = i < 0 ? 'say' : s.slice(0, i).trim();
    if (!noteTypes[k]) throw new Error(`نوع ملاحظة غير معروف "${k}" في ملف ${id} (المتاح: ${Object.keys(noteTypes).join('، ')})`);
    return { k, text: s.slice(i + 1).trim() };
  });
}

/* ---------- ألفاظ المعدود: مفرد | مثنى | جمع ---------- */
const units = Object.fromEntries(items(get('settings.units')).map(([k, ...f]) => [k, f.map(plain)]));

/* ---------- المكوّنات ---------- */
const subs =id => Object.keys(C[id]).filter(k => k.endsWith('.tab')).map(k => k.slice(0, -4));
const R = {
  cards: ref => items(get(ref)).map(([icon, title, text, color], i) =>
    `<div class="card reveal"><div class="ic c-${color || COLORS[i % 4]}">${ico(icon)}</div><h3>${inline(title)}</h3><p>${inline(text)}</p></div>`).join('\n'),
  goals: ref => items(get(ref)).map(([t], i) =>
    `<div class="goal reveal"><b class="grad-text">${i + 1}</b><p>${inline(t)}</p></div>`).join('\n'),
  tlbar: ref => items(get(ref)).map(([m], i) =>
    `<span style="flex:${Number(m)};--k:${i}" class="tl-c${i}"></span>`).join(''),
  tllist: ref => items(get(ref)).map(([m, t, d], i) =>
    `<div class="tl-item reveal"><span class="min tl-c${i}">${esc(m)} د</span><div><h3>${inline(t)}</h3><p>${inline(d)}</p></div></div>`).join('\n'),
  steps: ref => items(get(ref)).map(([t]) => `<li class="reveal">${inline(t)}</li>`).join('\n'),
  pills: ref => items(get(ref)).map(([t]) => `<span>${inline(t)}</span>`).join(''),
  roles: ref => items(get(ref)).map(([icon, t]) =>
    `<div class="role reveal"><span class="ic c-teal">${ico(icon)}</span><p>${inline(t)}</p></div>`).join('\n'),
  creds: ref => items(get(ref)).map(([icon, t, logo]) => {
    if (logo && !fs.existsSync(path.join(root, 'src/assets', logo))) throw new Error(`ملف الشعار غير موجود في src/assets: ${logo}`);
    return `<div class="cred reveal">${logo ? `<span class="cred-logo"><img src="assets/${esc(logo)}" alt=""></span>` : ico(icon)}<span>${inline(t)}</span></div>`;
  }).join('\n'),
  schools: ref => items(get(ref)).map(([icon, school, label, name, , color], i) =>
    `<div class="school-card" style="--n:${i};--sc:${esc(color || '#07a869')}"><span class="ic">${ico(icon)}</span><h3>${inline(school)}</h3><small>${inline(label)}</small><b>${inline(name)}</b></div>`).join('\n'),
  compare: ref => items(get(ref)).map(([k, a, b]) =>
    `<div class="k">${inline(k)}</div><div class="p">${inline(a)}</div><div class="s">${inline(b)}</div>`).join(''),
  chips: ref => items(get(ref)).map(([k, name, hint]) =>
    `<button class="fchip k-${k}" data-k="${esc(k)}">${inline(name)}<small>${inline(hint)}</small></button>`).join('<span class="plus">+</span>'),
  segs: ref => items(get(ref)).map(([k, t]) => `<span class="seg s-${k}" data-k="${esc(k)}">${inline(t)}</span>`).join(' '),
  tabs: id => subs(id).map((s, i) =>
    `<button class="tab${i ? '' : ' on'}" data-sub="${s}">${ico(C[id][s + '.icon'] || 'spark')} ${inline(C[id][s + '.tab'])}</button>`).join('\n'),
  prompts: id => promptList(id).map(p =>
    `<div class="prompt-box reveal"><div class="prompt-head"><span>${ico(p.icon)} ${inline(p.title)}</span><button class="btn small copy-btn">${ico('copy')}<span>${esc(get('prompts.copy'))}</span></button></div>
<div class="prompt-text">${withPh(inline(p.text))}</div></div>`).join('\n'),
  notes: id => esc(noteSteps(id).map(s => plain(s.text)).join(' • ')),
  unit: k => esc(units[k][0]),
  include: file => read('src/' + file),
  joinurl: () => esc(joinUrl),
  // الرابط المكتوب على الشاشة: المختصر من config.json إن وُجد (يحوّل إلى صفحة المتدربات)، ورمز QR يبقى على الرابط المباشر
  joinurl_display: () => esc(cfg.joinShortUrl || joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')),
};
function promptList(id) {
  return Object.keys(C[id]).filter(k => /^prompt\d+\.title$/.test(k)).map(k => k.split('.')[0])
    .map(p => ({ title: C[id][p + '.title'], icon: C[id][p + '.icon'] || 'spark', text: C[id][p + '.text'] }));
}
const poll = id => ({ question: plain(get(id + '.question')), options: items(get(id + '.options')).map(([t]) => plain(t)) });
const live = {
  url: cfg.supabaseUrl, key: cfg.supabaseKey, room: cfg.room, joinUrl, bucket: 'aiws-uploads',
  polls: { p1: poll('poll-open'), p2: poll('poll-close') },
  // مدارس الشراكة (تظهر في الشريحة) ثم المدارس الإضافية (في الجوال واللوحة فقط)
  schools: [...items(get('partners.schools')), ...items(get('settings.extra_schools'))].map(([, name, , , key, color]) => ({ key, name: plain(name), color })),
};
const deckData = {
  ...live, units,
  plans: Object.fromEntries(subs('plan').map(s => [s, { prompt: plain(C.plan[s + '.prompt']), answer: plain(C.plan[s + '.answer']) }])),
  quiz: Object.fromEntries(subs('quiz').map(s => [s, items(C.quiz[s + '.questions']).map(([lv, q, o, a, n]) => ({
    lv: esc(lv), q: inline(q), o: o ? o.split(';').map(x => inline(x.trim())) : null, a: a ? Number(a) - 1 : -1, n: inline(n || ''),
  }))])),
  t: {
    show: get('quiz.show_answer'), hide: get('quiz.hide_answer'), essay: get('quiz.essay_label'),
    start: get('activity.start'), pause: get('activity.pause'), minute: get('activity.minute'), copy: get('prompts.copy'), copied: get('prompts.copied'),
    simplify: get('more.simplify_button'), original: get('more.original_button'),
    wallEmpty: get('wall.empty'), readMore: get('wall.read_more'), openLink: get('wall.open_link'),
    wordEmpty: get('word.empty'), rosterEmpty: get('settings.roster_empty'),
    handAlert: get('settings.hand_alert'), handLower: get('settings.hand_lower'), handsLowered: get('settings.hands_lowered'),
  },
};
// g: النشاط الذي يخصّه الأمر (share للنشاط التطبيقي، create لتحدّي الإبداع)؛ تُفتح أوامره تلقائيًا في الجوال
const pl = (id, g) => promptList(id).map(p => ({ title: plain(p.title), text: plain(p.text), icon: p.icon, g }));
const joinData = {
  ...live,
  prompts: [...pl('prompts', 'share'), ...pl('challenge', 'create')],
  t: {
    ...Object.fromEntries(Object.entries(C['join-page']).map(([k, v]) => [k, plain(v)])),
    word_title: plain(get('word.phone_title')), word_question: plain(get('word.question')),
    word_placeholder: plain(get('word.phone_placeholder')), word_button: plain(get('word.phone_button')), word_sent: plain(get('word.phone_sent')),
  },
  copy: get('prompts.copy'), copied: get('prompts.copied'),
};

/* ---------- القوالب ---------- */
function render(tpl, data) {
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    if (expr === 'DATA') return JSON.stringify(data).replace(/</g, '\\u003c');
    if (expr.startsWith('cfg.')) return esc(cfg[expr.slice(4)]);
    if (expr.startsWith('@')) {
      const [name, arg] = expr.slice(1).split(/\s+/);
      if (!R[name]) throw new Error('مكوّن غير معروف: ' + name);
      return R[name](arg);
    }
    const [ref, filter] = expr.split('|');
    const v = get(ref.trim());
    if (filter === 'text') return esc(plain(v));
    if (filter === 'ph') return withPh(inline(v));
    return inline(v);
  });
}

const out = path.join(root, process.env.AIWS_OUT || 'docs');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
fs.mkdirSync(path.join(out, 'join'), { recursive: true });
for (const f of fs.readdirSync(path.join(root, 'src/assets'))) fs.copyFileSync(path.join(root, 'src/assets', f), path.join(out, 'assets', f));
fs.writeFileSync(path.join(out, 'assets/join-qr.svg'),
  await QRCode.toString(joinUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#15445a', light: '#ffffff' } }));
const deckHtml = render(read('src/deck.html'), deckData);
fs.writeFileSync(path.join(out, 'index.html'), deckHtml);

/* ---------- صفحة ملاحظات المقدّم: الشرائح بترتيبها من العرض نفسه ---------- */
const strip = h => h.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const sched = Object.fromEntries(items(get('presenter-page.schedule')).map(([id, t]) => { const [m, sec] = t.split(':').map(Number); return [id, m * 60 + (sec || 0)]; }));
const noteRef = Object.fromEntries([...read('src/deck.html').matchAll(/<section class="slide" id="([^"]+)"[^>]*\{\{@notes ([\w-]+)\}\}/g)].map(m => [m[1], m[2]]));
let at = 0;
const slideList = [...deckHtml.matchAll(/<section class="slide" id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)].map(m => {
  const t = m[2].match(/class="[^"]*\bsplit\b[^"]*">([\s\S]*?)<\/(?:h1|h2|p)>/) || m[2].match(/class="kicker[^"]*">([\s\S]*?)<\/span>/);
  if (sched[m[1]] === undefined) console.warn('⚠ لا مدة للشريحة في presenter-page.schedule:', m[1]);
  if (!noteRef[m[1]]) throw new Error('الشريحة بلا ملاحظات ({{@notes ...}}) في src/deck.html: ' + m[1]);
  const dur = sched[m[1]] ?? 60, o = { id: m[1], title: t ? strip(t[1]) : m[1], steps: noteSteps(noteRef[m[1]]).map(s => ({ k: s.k, h: inline(s.text) })), at, dur };
  at += dur; return o;
});
const notesData = { url: cfg.supabaseUrl, key: cfg.supabaseKey, room: cfg.room, slides: slideList, types: noteTypes, schools: live.schools,
  t: Object.fromEntries(Object.entries(C['presenter-page']).filter(([k]) => !['schedule', 'note_types'].includes(k)).map(([k, v]) => [k, plain(v)])) };
fs.mkdirSync(path.join(out, 'notes'), { recursive: true });
fs.writeFileSync(path.join(out, 'notes/index.html'), render(read('src/notes.html'), notesData));
fs.writeFileSync(path.join(out, 'join/index.html'), render(read('src/join.html'), joinData));

/* ---------- صفحة اختبار الصوت المباشر (تجربة جدوى LiveKit؛ التوكن من الدالة aiws_live_token) ---------- */
const liveTestData = { url: cfg.supabaseUrl, key: cfg.supabaseKey, room: cfg.room, fn: cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/aiws_live_token',
  t: Object.fromEntries(Object.entries(C['live-test']).map(([k, v]) => [k, plain(v)])) };
fs.mkdirSync(path.join(out, 'live-test'), { recursive: true });
fs.writeFileSync(path.join(out, 'live-test/index.html'), render(read('src/live-test.html'), liveTestData));
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log('✓ تم البناء في docs/');
console.log('  العرض:', cfg.siteUrl);
console.log('  رابط المتدربات:', joinUrl);
console.log('  ملاحظات المقدّم:', new URL('notes/', cfg.siteUrl).href, `(${slideList.length} شريحة، ${Math.round(at / 60)} دقيقة)`);
console.log('  اختبار الصوت:', new URL('live-test/', cfg.siteUrl).href, '(المقدّم: ?p=1)');
