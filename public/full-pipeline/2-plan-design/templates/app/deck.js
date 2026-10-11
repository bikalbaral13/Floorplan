/* Brief deck builder — runs in the browser on "Generate brief deck". Input: a frozen snapshot (spacebrief-deck/1)
   made by core.js makeSnapshot(); output: a .pptx Blob. Everything it draws comes from the snapshot, so the same
   snapshot always gives the same deck. Uses PptxGenJS (UMD) loaded on demand from the CDN allowlist. */
(() => {
'use strict';
const LIB = ['https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', 'https://cdnjs.cloudflare.com/ajax/libs/pptxgenjs/3.12.0/pptxgen.bundle.js'];
const CAT = {floor: ['Flooring', '#A7712F'], ceiling: ['Ceiling', '#2C6CB0'], wall: ['Walls & finishes', '#5A8A26'], light: ['Lighting', '#C29400'],
  joinery: ['Joinery', '#8A5A44'], furniture: ['Furniture', '#C0562A'], soft: ['Soft furnishing', '#8B4A8C'], planting: ['Planting', '#23845A'],
  partition: ['Doors & partitions', '#3E4C55'], signage: ['Signage & AV', '#1D3F7A'], services: ['Services', '#A23C5A']};
const STATE = {draft: ['Not issued', '#8C9893'], pending: ['Awaiting client', '#9E6500'], stale: ['Changed since approval', '#6B4BB8'], approved: ['Approved', '#2B7A4B'], changes: ['Changes requested', '#C8361F']};
const PST = {open: ['Open', '#C8361F'], fixed: ['Fixed, to check', '#9E6500'], closed: ['Closed', '#3E7F57']};
const INK = '17201D', MUTED = '5B6863', LINE = 'CDD4D0', FONT = 'Arial', MONO = 'Consolas';
const h = c => String(c || '').replace('#', '').toUpperCase();

function loadScript(u){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = () => rej(new Error('load ' + u)); document.head.appendChild(s); }); }
async function lib(){ if (window.PptxGenJS) return window.PptxGenJS; for (const u of LIB){ try { await loadScript(u); if (window.PptxGenJS) return window.PptxGenJS; } catch(e){} } throw new Error('The deck library could not be loaded. Check the connection and try again.'); }
function img(src){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + String(src).slice(0, 60))); i.src = src; }); }
function canvas(w, hh){ const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(hh); return c; }
function rgba(hex, a){ const x = h(hex); return `rgba(${parseInt(x.slice(0, 2), 16)},${parseInt(x.slice(2, 4), 16)},${parseInt(x.slice(4, 6), 16)},${a})`; }

/* sheet + element overlays → JPEG data URL (same look as the app) */
async function sheetImage(snap, sheetId, highlight, dim){
  const sh = snap.meta.sheets.find(s => s.id === sheetId); const svg = snap.sheets_svg[sheetId]; if (!sh || !svg) return null;
  const k = Math.min(1.4, 2000 / sh.w); const c = canvas(sh.w * k, sh.h * k), x = c.getContext('2d');
  const u = URL.createObjectURL(new Blob([svg], {type: 'image/svg+xml'}));
  try { const im = await img(u); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); } finally { URL.revokeObjectURL(u); }
  const tags = []; const W = c.width, H = c.height;
  const list = snap.elements.flatMap(e => (e.shapes || []).filter(s => s.sheet === sheetId).map(s => [e, s])).sort((a, b) => (a[0].id === highlight) - (b[0].id === highlight));
  for (const [e, s] of list){
    const on = e.id === highlight; let col = on ? '#2349C4' : (CAT[e.cat] || ['', '#666666'])[1]; if (highlight && !on && dim) col = '#B9C0BC';
    const P = s.pts.map(p => [p[0] * W, p[1] * H]);
    if (s.type === 'poly'){ x.beginPath(); P.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); x.fillStyle = rgba(col, on ? .38 : .18); x.fill(); x.lineWidth = (on ? 4 : 2) * k; x.strokeStyle = col; x.stroke(); }
    else if (s.type === 'line'){ x.beginPath(); P.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.lineWidth = (on ? 10 : 7) * k; x.lineCap = 'round'; x.strokeStyle = rgba(col, .92); x.stroke(); }
    else { x.beginPath(); x.arc(P[0][0], P[0][1], 11 * k, 0, Math.PI * 2); x.fillStyle = col; x.fill(); x.lineWidth = 2 * k; x.strokeStyle = '#fff'; x.stroke(); }
    if (!highlight || on || !dim){
      let cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length;
      if (s.type === 'line' && P.length > 1){ const i = Math.max(0, Math.floor(P.length / 2) - 1); cx = (P[i][0] + P[i + 1][0]) / 2; cy = (P[i][1] + P[i + 1][1]) / 2; }
      if (s.type === 'pin') cy -= 22 * k;
      tags.push([cx, cy, e.code, col]);
    }
  }
  const seen = new Set(); x.font = `bold ${Math.round(15 * k)}px Arial, sans-serif`; x.textBaseline = 'middle';
  for (const [cx, cy, code, col] of tags){ const key = code + Math.round(cx / 40) + ':' + Math.round(cy / 40); if (seen.has(key)) continue; seen.add(key);
    const tw = x.measureText(code).width, pad = 4 * k; x.fillStyle = col; x.fillRect(cx - tw / 2 - pad, cy - 10 * k, tw + 2 * pad, 20 * k); x.fillStyle = '#fff'; x.fillText(code, cx - tw / 2, cy + 1); }
  return {data: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height};
}
async function photo(src, max = 1200){
  try { const im = await img(src); const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)); const c = canvas(im.naturalWidth * k, im.naturalHeight * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); return {data: c.toDataURL('image/jpeg', 0.86), w: c.width, h: c.height}; }
  catch(e){ return null; }
}
async function renderWithPins(src, pins){
  const p = await photo(src, 1600); if (!p) return null; const im = await img(p.data); const c = canvas(p.w, p.h), x = c.getContext('2d'); x.drawImage(im, 0, 0); const k = p.w / 1600;
  x.font = `bold ${Math.round(20 * k)}px Arial, sans-serif`; x.textBaseline = 'middle'; x.textAlign = 'center';
  pins.forEach((pn, i) => { const px = pn.x * p.w, py = pn.y * p.h, r = 19 * k; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fillStyle = PST[pn.state][1]; x.fill(); x.lineWidth = 3 * k; x.strokeStyle = '#fff'; x.stroke(); x.fillStyle = '#fff'; x.fillText(String(i + 1), px, py + 1); });
  return {data: c.toDataURL('image/jpeg', 0.86), w: p.w, h: p.h};
}

async function build(snap, srcOf, progress = () => {}){
  const PptxGenJS = await lib(); const pptx = new PptxGenJS();
  pptx.defineLayout({name: 'BRIEF', width: 13.333, height: 7.5}); pptx.layout = 'BRIEF';
  const M = snap.meta, V = snap.version, I = snap.issue?.n || 0; let n = 0;
  pptx.title = `${M.project.title} · ${M.space.label} · brief v${V}`; pptx.company = M.project.client || ''; pptx.subject = `Issue I${I}`;
  const text = (s, t, x, y, w, hh, o = {}) => s.addText(String(t ?? ''), Object.assign({x, y, w, h: hh, fontFace: FONT, fontSize: 12, color: INK, margin: 0, valign: 'top'}, o));
  const fit = (s, im, x, y, w, hh) => { if (!im) return; const ar = im.w / im.h; let W = w, Hh = w / ar; if (Hh > hh){ Hh = hh; W = hh * ar; } s.addImage({data: im.data, x: x + (w - W) / 2, y: y + (hh - Hh) / 2, w: W, h: Hh}); };
  const pill = (s, label, col, x, y, w = 1.9) => { s.addShape(pptx.ShapeType.roundRect, {x, y, w, h: 0.3, fill: {color: h(col)}, line: {color: h(col)}, rectRadius: 0.08}); text(s, label, x, y, w, 0.3, {fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle'}); };
  const slide = (title, kicker = '') => {
    const s = pptx.addSlide(); n++; s.background = {color: 'FFFFFF'};
    if (kicker) text(s, kicker.toUpperCase(), 0.5, 0.3, 9, 0.3, {fontSize: 10, bold: true, color: MUTED, charSpacing: 1});
    text(s, title, 0.5, 0.55, 10.4, 0.6, {fontSize: 24, bold: true});
    const cells = [['PROJECT', M.project.title, 3.4], ['SPACE', M.space.label, 3.9], ['ISSUE', 'I' + I, 0.9], ['BRIEF', 'v' + V, 0.9], ['SHEET', String(n).padStart(2, '0'), 0.9]];
    let x = 0.5; const y = 7.08;
    for (const [k, v, w] of cells){ s.addShape(pptx.ShapeType.rect, {x, y, w, h: 0.3, fill: {color: 'FFFFFF'}, line: {color: INK, width: 0.75}});
      s.addText([{text: k + '  ', options: {fontSize: 7, bold: true, color: MUTED}}, {text: v, options: {fontSize: 9, bold: true, color: INK, fontFace: ['ISSUE', 'BRIEF', 'SHEET'].includes(k) ? MONO : FONT}}], {x: x + 0.06, y, w: w - 0.1, h: 0.3, fontFace: FONT, margin: 0, valign: 'middle'}); x += w; }
    text(s, snap.fixture ? 'FIXTURE - test data' : `generated ${snap.generated.at.slice(0, 10)}`, 10.6, 7.13, 2.3, 0.22, {fontSize: 8, color: snap.fixture ? 'C8361F' : MUTED, bold: !!snap.fixture, align: 'right'});
    return s;
  };
  const els = snap.elements; const tot = Math.max(1, els.length);
  progress('Cover and schedule');
  // cover
  let s = slide(M.space.label, 'Interior brief');
  text(s, M.project.title + (M.project.client ? `  ·  client: ${M.project.client}` : ''), 0.5, 1.3, 8, 0.4, {fontSize: 16, color: MUTED});
  text(s, `Brief v${V} · Issue I${I} · ${snap.generated.at.slice(0, 10)}`, 0.5, 2.1, 6.5, 0.4, {fontSize: 14, bold: true});
  let y = 2.7;
  for (const k of ['approved', 'pending', 'stale', 'changes']){ const c = snap.counts[k]; if (!c) continue; const w = Math.max(0.08, 6 * c / tot);
    s.addShape(pptx.ShapeType.rect, {x: 0.5, y, w, h: 0.3, fill: {color: h(STATE[k][1])}, line: {color: h(STATE[k][1])}}); text(s, `${c} ${STATE[k][0].toLowerCase()}`, 0.62 + w, y + 0.02, 4, 0.3); y += 0.42; }
  const pc = snap.pin_counts;
  text(s, `Render review: ${pc.open} open · ${pc.fixed} fixed, to check · ${pc.closed} closed`, 0.5, y + 0.2, 6.2, 0.3, {color: MUTED});
  text(s, `Generated by ${snap.generated.by_name || 'the architect'}${snap.generated.note ? `: “${snap.generated.note}”` : ''}`, 0.5, y + 0.6, 6.2, 0.9, {fontSize: 11, color: MUTED});
  if (snap.drafts_excluded.length) text(s, `Not in this deck (unissued changes): ${snap.drafts_excluded.join(', ')}`, 0.5, y + 1.4, 6.2, 0.8, {fontSize: 10, color: '9E6500'});
  fit(s, await sheetImage(snap, 'plan', null, false), 7.2, 1.2, 5.6, 5.6);
  // changes since the previous deck
  if (snap.changes_since_prev && snap.changes_since_prev.length){
    s = slide(`What changed since v${V - 1}`, 'Revisions');
    const rows = [[{text: 'Issue', options: {bold: true, color: MUTED}}, {text: 'Element', options: {bold: true, color: MUTED}}, {text: 'Rev', options: {bold: true, color: MUTED}}, {text: 'What changed', options: {bold: true, color: MUTED}}, {text: 'Note', options: {bold: true, color: MUTED}}]];
    for (const iss of snap.changes_since_prev) for (const c of iss.changed || []) rows.push(['I' + iss.n, `${c.code} ${c.name}`, String(c.rev), (c.fields || []).join(', '), iss.note || '']);
    s.addTable(rows.slice(0, 22), {x: 0.5, y: 1.3, w: 12.3, colW: [0.7, 4.2, 0.6, 3.0, 3.8], fontFace: FONT, fontSize: 10, border: {type: 'solid', pt: 0.5, color: LINE}, valign: 'middle'});
  }
  // schedule
  const head = ['Code', 'Element', 'Material / finish', 'Rev', 'Client', 'Choice', 'Open'].map(t => ({text: t, options: {bold: true, color: MUTED, fill: {color: 'E6EAE8'}}}));
  for (let i = 0; i < els.length; i += 15){
    s = slide('Element schedule' + (i ? ' (cont.)' : ''), `${els.length} issued elements`);
    const rows = [head].concat(els.slice(i, i + 15).map(e => { const sp = e.spec || {}; const st = STATE[e.state];
      return [e.code, e.name, [sp.material, sp.finish].filter(Boolean).join(' · ') || '—', String(e.rev), {text: st[0], options: {bold: true, color: h(st[1])}}, e.choice?.label || '', String(snap.pins.filter(p => p.element === e.id && p.state !== 'closed').length || '')]; }));
    s.addTable(rows, {x: 0.5, y: 1.3, w: 12.3, colW: [0.8, 3.4, 3.5, 0.5, 1.8, 1.4, 0.9], fontFace: FONT, fontSize: 10, border: {type: 'solid', pt: 0.5, color: LINE}, valign: 'middle'});
  }
  // sheets
  const KIND = {plan: 'Key plan', rcp: 'Ceiling', elevation: 'Interior elevation'};
  for (const sh of M.sheets){ progress('Drawing ' + sh.name); s = slide(sh.name, KIND[sh.kind] || 'Drawing'); fit(s, await sheetImage(snap, sh.id, null, false), 0.5, 1.3, 12.3, 5.6); }
  // elements
  const refMeta = id => (M.references || []).find(r => r.id === id);
  for (const e of els){
    progress(`${e.code} ${e.name}`);
    const cat = CAT[e.cat] || [e.cat, '#666666'], st = STATE[e.state];
    s = slide(`${e.code}  ${e.name}`, `${cat[0]} · rev ${e.rev}`); pill(s, st[0], st[1], 10.9, 0.6);
    const prim = (e.shapes || []).map(x => x.sheet).find(id => M.sheets.find(q => q.id === id)?.kind === 'elevation') || (e.shapes || [])[0]?.sheet;
    if (prim){ fit(s, await sheetImage(snap, prim, e.id, true), 0.5, 1.3, 6.2, 3.6); text(s, M.sheets.find(q => q.id === prim)?.name || '', 0.5, 4.95, 6.2, 0.3, {fontSize: 10, color: MUTED}); }
    const refs = (e.refs || []).slice(0, 3);
    if (!refs.length) text(s, 'No reference image.', 0.5, 5.4, 6, 0.3, {fontSize: 11, color: MUTED});
    for (let i = 0; i < refs.length; i++){ fit(s, await photo(srcOf.ref(refs[i]), 900), 0.5 + i * 2.1, 5.3, 2.0, 1.6); }
    const sp = e.spec || {}; let yy = 1.3; const x0 = 7.0;
    const spec = [['Material', sp.material], ['Finish', sp.finish], ['Colour', [sp.colourName, sp.hex].filter(Boolean).join(' ')], ['Source', sp.link]].filter(r => r[1]);
    if (spec.length){ s.addTable([[{text: 'Specification', options: {bold: true, color: MUTED, fill: {color: 'E6EAE8'}}}, {text: '', options: {fill: {color: 'E6EAE8'}}}]].concat(spec), {x: x0, y: yy, w: 5.8, colW: [1.3, 4.5], fontFace: FONT, fontSize: 10, border: {type: 'solid', pt: 0.5, color: LINE}}); yy += 0.3 * (spec.length + 1) + 0.15; }
    else { text(s, 'Specification not filled in.', x0, yy, 5.8, 0.3, {fontSize: 11, color: 'C8361F'}); yy += 0.4; }
    if (sp.hex && /^#?[0-9a-f]{6}$/i.test(sp.hex)) s.addShape(pptx.ShapeType.ellipse, {x: 12.45, y: 1.33, w: 0.24, h: 0.24, fill: {color: h(sp.hex)}, line: {color: LINE}});
    const dims = e.dims || [];
    if (dims.length){ s.addTable([[{text: 'Dimensions & levels', options: {bold: true, color: MUTED, fill: {color: 'E6EAE8'}}}, {text: '', options: {fill: {color: 'E6EAE8'}}}]].concat(dims.map(d => [d.k + ({plan: '  (plan)', convention: '  (default)'}[d.src] || ''), d.v])), {x: x0, y: yy, w: 5.8, colW: [3.3, 2.5], fontFace: FONT, fontSize: 10, border: {type: 'solid', pt: 0.5, color: LINE}}); yy += 0.3 * (dims.length + 1) + 0.15; }
    if (e.notes){ text(s, 'Notes: ' + e.notes, x0, yy, 5.8, 0.65, {fontSize: 11}); yy += 0.65; }
    const d = e.decision;
    text(s, `Client: ${st[0]}${d ? ` · rev ${d.rev}` : ''}${e.choice ? ` · choice: ${e.choice.label}` : ''}${d && d.note ? `\n“${d.note}”` : ''}`, x0, yy, 5.8, 0.6, {fontSize: 11, bold: true, color: h(st[1])}); yy += 0.6;
    const ps = snap.pins.filter(p => p.element === e.id);
    if (ps.length){ text(s, 'Review history', x0, yy, 5.8, 0.25, {fontSize: 10, bold: true, color: MUTED}); yy += 0.25;
      text(s, ps.slice(-6).map(p => `[${p.round_name}] ${PST[p.state][0]} — ${p.text}`).join('\n'), x0, yy, 5.8, Math.max(0.4, 6.9 - yy), {fontSize: 9.5}); }
  }
  // review rounds
  for (const r of snap.renders){
    const ps = snap.pins.filter(p => p.render === r.id); progress('Render ' + r.view);
    s = slide(`${(M.rounds || []).find(x => x.id === r.round)?.name || ''} · ${r.view}`, 'Render review');
    const im = await renderWithPins(srcOf.render(r.img), ps);
    if (im) fit(s, im, 0.5, 1.3, 8.0, 5.6); else text(s, 'Render image not available.', 0.5, 1.4, 8, 0.4, {color: 'C8361F'});
    text(s, ps.map((p, i) => `${i + 1}. [${PST[p.state][0]}] ${p.text}`).join('\n') || 'No comments.', 8.8, 1.3, 4.0, 5.6, {fontSize: 10});
  }
  // open items
  s = slide('Open items', `${snap.outstanding.length} item${snap.outstanding.length === 1 ? '' : 's'}`);
  text(s, snap.outstanding.join('\n') || 'Nothing outstanding.', 0.5, 1.3, 12.3, 5.6, {fontSize: 11});
  progress('Writing the file');
  const blob = await pptx.write({outputType: 'blob'});
  return {blob, slides: n};
}
window.BRIEF_DECK = {build};
})();
