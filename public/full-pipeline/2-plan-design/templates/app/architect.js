/* Architect page: author the brief, issue revisions, manage the team, run render reviews. */
(() => {
'use strict';
const X = window.BRIEF; const {S, UI, CV, ENV, $, esc, rid, clone, CATS, CAT, AP, PS, ROLE} = X;
const SNAP = X.SNAP_KEYS;
const FIELD_NAMES = {code: 'code', name: 'name', cat: 'type', shapes: 'drawn shapes', spec: 'specification', dims: 'dimensions', notes: 'notes', refs: 'references', options: 'options', lib: 'library item', refInfo: 'reference sources'};
const can = () => X.canEditSpec();
const live = () => Object.values(S.elements).sort((a, b) => (a.order || 0) - (b.order || 0));
function changedFields(e){ if (!e.issued) return ['new']; return SNAP.filter(k => JSON.stringify(e[k] ?? null) !== JSON.stringify(e.issued[k] ?? null)); }
const pending = () => live().filter(e => !e.issued || changedFields(e).length);
function patchEl(id, patch){ return X.patchDoc('elements/' + id, Object.assign(patch, {dirty: true, updatedAt: Date.now()})); }
function nextCode(cat){ const p = (CAT[cat] || {p: 'EL'}).p; let n = 0; for (const e of live()){ const m = String(e.code || '').match(new RegExp('^' + p + '-(\\d+)$')); if (m) n = Math.max(n, +m[1]); } return p + '-' + String(n + 1).padStart(2, '0'); }

const R = {
  tabs(){
    const iss = pending().length, ch = X.els().filter(e => ['changes'].includes(X.apState(e))).length;
    const cc = X.clientComments().length, chk = Object.values(S.pins).filter(p => X.pinState(p) === 'fixed').length;
    const ag = Object.values(S.agent).filter(m => m.role === 'agent' && !m.seen).length;
    return [['drawings', 'Drawings'], ['board', 'Schedule', ch], ['agent', 'Agent', ag, true], ['review', 'Review', cc + chk, !cc], ['punch', 'Punch list'], ['issue', 'Issue & team', iss, true], ['deck', 'Brief deck']];
  },
  topExtra(){ return X.BUILD.standalone ? '' : `<a class="btn sm ghost" href="client.html" title="See what the client sees">Client view</a><a class="btn sm ghost" href="modeler.html">Modeler view</a>`; },
  render(tab, main){
    if (tab === 'board') X.renderBoard(main);
    else if (tab === 'review') X.renderReview(main);
    else if (tab === 'punch') X.renderPunch(main);
    else if (tab === 'deck') X.renderDecks(main);
    else if (tab === 'agent') renderAgent(main);
    else renderIssue(main);
  },
  deckPanel(list){
    const iss = X.issueNo(), drafts = pending(), all = X.els().filter(e => S.elements[e.id]?.issued);
    const c = {}; ['approved', 'pending', 'stale', 'changes'].forEach(k => c[k] = all.filter(e => X.apState(e) === k).length);
    const open = Object.values(S.pins).filter(p => X.pinState(p) !== 'closed').length; const next = (list[0]?.k || 0) + 1;
    if (!iss) return `<div class="decide"><h2>Nothing issued yet</h2><p>The deck is built from an issue. Fill in the elements, then issue them to the client in Issue & team.</p><button class="btn" data-act="tab" data-id="issue">Go to Issue & team</button></div>`;
    return `<section class="apbox" style="max-width:760px">
      <div class="row" style="justify-content:space-between"><b style="font-size:16px">Brief v${next} from issue I${iss}</b><span class="small muted">frozen at the moment you generate</span></div>
      <div class="kv"><span>Issued elements</span><b>${all.length}</b><span>Approved by the client</span><b>${c.approved}</b><span>Awaiting the client</span><b>${c.pending}</b><span>Changed since approval</span><b>${c.stale}</b><span>Changes requested</span><b>${c.changes}</b><span>Open review comments</span><b>${open}</b></div>
      ${drafts.length ? `<p class="diff">${drafts.length} element${drafts.length > 1 ? 's have' : ' has'} changes that are not issued (${drafts.map(e => esc(e.code)).join(', ')}). The deck shows issue I${iss} as the client saw it. <button class="btn sm" data-act="tab" data-id="issue">Issue them first</button></p>` : ''}
      <p class="small muted">Anything not approved and every open comment is listed as an open item in the deck. Each version is stored with the exact data it was built from, and everyone on the brief can download it.</p>
      ${X.canEditSpec() ? `<label class="fld"><span class="lbl">Note on this version</span><input class="inp" id="deck-note" placeholder="e.g. For the modeler's R5 renders"></label><div class="row"><button class="btn pri" data-act="genDeck">Generate brief deck v${next}</button></div>` : ''}</section>`;
  },
  onLoaded(){
    // the owner is always the architect; record it so other pages can trust architect replies and pins
    if (!ENV.local && ENV.owner && ENV.uid && X.roleOf(ENV.uid) !== 'architect' && S.meta) X.putDoc('roster/' + ENV.uid, {role: 'architect', at: Date.now()});
  },
  sideSheetExtra(){ return ''; },
  sideFooter(){ return ENV.local ? `<div class="side-sec more"><button class="btn sm" data-act="resetLocal">Reset local copy</button></div>` : ''; },
  /* ----- drawing new shapes ----- */
  drawCard(d){
    const kind = {poly: 'zone', line: 'line', pin: 'pin'}[d.type];
    return `<div class="drawcard"><b>New ${kind}</b>
      <label class="fld"><span class="lbl">Attach to</span><select class="inp" id="dc-target"><option value="">New element</option>${live().map(e => `<option value="${e.id}">${esc(e.code + ' · ' + e.name)}${UI.sel === e.id ? ' (selected)' : ''}</option>`).join('')}</select></label>
      <div id="dc-new" style="display:flex;flex-direction:column;gap:8px"><label class="fld"><span class="lbl">Name</span><input class="inp" id="dc-name" placeholder="e.g. Moss wall"></label>
      <label class="fld"><span class="lbl">Type</span><select class="inp" id="dc-cat">${CATS.map(c => `<option value="${c.id}" ${c.id === (d.type === 'pin' ? 'light' : d.type === 'line' ? 'wall' : 'floor') ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label></div>
      <div class="row end"><button class="btn sm ghost" data-act="draftCancel">Discard</button><button class="btn sm acc" data-act="draftSave">Add</button></div></div>`;
  },
  shapesMoved(el){ patchEl(el.id, {shapes: clone(el.shapes)}); },
  /* ----- inspector ----- */
  summary(){ return X.summary(); },
  inspector(e){
    if (!can()) return X.detail(e);
    const s = e.spec || {}; const chg = changedFields(e);
    return X.head(e, `<input class="inp" data-f="name" value="${esc(e.name)}" style="font-size:18px;font-weight:650">`) +
      `<div class="sec">${agentNote(e, chg)}${e.issued ? (chg.length ? `<p class="diff">Changed since issue: ${chg.map(k => FIELD_NAMES[k]).join(', ')}. The client and modeler still see rev ${e.issued.rev} until you issue.</p>` : `<p class="small muted">Matches issued rev ${e.issued.rev}.</p>`) : `<p class="diff">Not issued yet. The client and modeler will see it after the next issue.</p>`}
        <div class="grid2"><label class="fld"><span class="lbl">Code</span><input class="inp mono" data-f="code" value="${esc(e.code)}"></label><label class="fld"><span class="lbl">Type</span><select class="inp" data-f="cat">${CATS.map(c => `<option value="${c.id}" ${c.id === e.cat ? 'selected' : ''}>${c.name}</option>`).join('')}</select></label></div></div>` +
      X.gallery(e, true) + (UI.refPicker ? refPicker(e) : '') +
      `<div class="sec"><div class="lbl">Specification</div>
        <label class="fld"><span class="lbl">Material</span><input class="inp" data-f="spec.material" value="${esc(s.material)}"></label>
        <label class="fld"><span class="lbl">Finish</span><input class="inp" data-f="spec.finish" value="${esc(s.finish)}"></label>
        <div class="optedit"><input type="color" data-f="spec.hex" value="${/^#[0-9a-f]{6}$/i.test(s.hex || '') ? s.hex : '#cccccc'}" aria-label="Colour"><input class="inp" data-f="spec.colourName" value="${esc(s.colourName)}" placeholder="Colour name"><button class="btn sm ghost" data-act="hexClear">Clear</button></div>
        <label class="fld"><span class="lbl">Source link</span><input class="inp" data-f="spec.link" value="${esc(s.link)}" placeholder="https://"></label></div>
      <div class="sec"><div class="lbl">Dimensions & levels <button class="btn sm" data-act="dimAdd">+ Add</button></div>
        ${(e.dims || []).map((d, i) => `<div class="editrow"><input class="inp" data-dim="${i}|k" value="${esc(d.k)}"><input class="inp mono" data-dim="${i}|v" value="${esc(d.v)}"><button class="x" data-act="dimRm" data-id="${i}" aria-label="Remove">✕</button></div>`).join('')}
        <p class="small muted">Rows marked "from plan" were measured by the pipeline; edit them only if the plan is wrong (then fix the plan and rerun).</p></div>
      <div class="sec"><label class="fld"><span class="lbl">Notes for the modeler</span><textarea class="inp" data-f="notes" rows="3">${esc(e.notes)}</textarea></label></div>
      <div class="sec"><div class="lbl">Options for the client <button class="btn sm" data-act="optAdd">+ Option</button></div>
        ${(e.options || []).map((o, i) => `<div class="optedit"><input type="color" data-opt="${i}|hex" value="${/^#[0-9a-f]{6}$/i.test(o.hex || '') ? o.hex : '#cccccc'}" aria-label="Option colour"><input class="inp" data-opt="${i}|label" value="${esc(o.label)}"><button class="x" data-act="optRm" data-id="${i}" aria-label="Remove option">✕</button></div>`).join('') || '<p class="small muted">Add colour or product options; the client picks one when approving.</p>'}</div>` +
      X.decisionSec(e) + X.historySec(e) +
      `<div class="sec"><div class="lbl">Drawn on</div>${(e.shapes || []).map((x, i) => `<div class="row" style="justify-content:space-between;font-size:13px"><span>${esc(X.sheetById(x.sheet)?.name || 'Missing drawing')} · ${{poly: 'zone', line: 'line', pin: 'pin'}[x.type]}</span><span><button class="btn sm ghost" data-act="gosheet" data-id="${x.sheet}">View</button><button class="x" data-act="shapeRm" data-id="${i}" aria-label="Remove shape">✕</button></span></div>`).join('') || '<p class="small muted">Not drawn yet.</p>'}
        <p class="small muted">Draw with Zone, Line or Pin and attach to this element to add a shape. Drag the square handles to adjust.</p></div>
      <div class="sec"><div class="row">${UI.confirmDel ? `<span>Delete ${esc(e.code)}?${e.issued ? ' It has been issued; the client and modeler will no longer see it.' : ''}</span><button class="btn sm warn" data-act="delEl">Delete</button><button class="btn sm ghost" data-act="delCancel">Keep</button>` : `<button class="btn sm warn" data-act="delAsk">Delete element</button>`}</div></div>`;
  },
  onChange(ev){
    const t = ev.target;
    if (t.dataset.act === 'libAlso'){ R.acts.libAlso(); return; }
    if (t.id === 'dc-target'){ $('#dc-new').hidden = !!t.value; return; }
    if (t.dataset.roleUid){ R.acts.teamRole(t.dataset.roleUid + '|' + t.value); return; }
    const e = UI.sel && S.elements[UI.sel]; if (!e || !can()) return;
    if (t.dataset.f){ const path = t.dataset.f.split('.'); const p = {}; let o = p; path.slice(0, -1).forEach(k => o = o[k] = {}); o[path[path.length - 1]] = t.value; patchEl(e.id, p); }
    else if (t.dataset.dim){ const [i, k] = t.dataset.dim.split('|'); const d = clone(e.dims); d[+i][k] = t.value; if (k === 'v') d[+i].src = 'architect'; patchEl(e.id, {dims: d}); }
    else if (t.dataset.opt){ const [i, k] = t.dataset.opt.split('|'); const o = clone(e.options); o[+i][k] = t.value; patchEl(e.id, {options: o}); }
  },
  /* ----- review ----- */
  canPinHere: () => can(), pinButtonLabel: () => '+ Comment for modeler', draftTitle: () => 'New comment for the modeler',
  showClientComments: true, clientCommentHint: () => 'Only you see these. Send a comment to the modeler to make it part of the punch list.',
  canReply: () => !ENV.readOnly,
  noRoundsText: () => can() ? 'Add round 1, then upload the modeler’s renders and pin comments on them.<br><br><button class="btn pri" data-act="roundAdd">+ Add round 1</button>' : 'No rounds yet.',
  noRenderText: () => 'Upload the renders for this round. Name each view the same way every round so rounds can be compared.',
  reviewBarExtra(r){ return can() ? `${ENV.assets || ENV.local ? '<button class="btn sm" data-act="renderUp">Upload renders</button>' : ''}<button class="btn sm ghost" data-act="roundAdd">+ Round</button>` : ''; },
  renderHeadExtra(r){ return can() ? (UI.confirmRender ? `<span class="row"><button class="btn sm warn" data-act="renderRmYes">Remove view</button><button class="btn sm ghost" data-act="renderRmNo">Keep</button></span>` : `<button class="btn sm ghost" data-act="renderRm">Remove</button>`) : ''; },
  pinActions(p, st, compact){
    if (!can()) return '';
    const a = [];
    if (st === 'fixed') a.push(`<button class="btn sm ok" data-act="pst" data-id="${p.id}|closed">Verify & close</button>`);
    if (st === 'open') a.push(`<button class="btn sm" data-act="pst" data-id="${p.id}|closed">Close</button>`);
    if (st !== 'open') a.push(`<button class="btn sm ghost" data-act="pst" data-id="${p.id}|open">Reopen</button>`);
    if (!compact) a.push(UI.confirmPin ? `<button class="btn sm warn" data-act="pinDelYes">Delete comment</button>` : `<button class="btn sm ghost" data-act="pinDel">Delete</button>`);
    return a.join('');
  },
  clientCommentActions(c){ return can() ? `<button class="btn sm acc" data-act="promote" data-id="${c.key}">Send to modeler</button><button class="btn sm ghost" data-act="dismiss" data-id="${c.key}">Dismiss</button>` : ''; },
  acts: {
    /* cloud library */
    async libOpen(){ await X.library(); UI.modal = 'lib'; UI.lib = UI.lib || {kind: 'material', q: '', group: '', pick: null, alsoFinish: true};
      if (!UI.lib.kindSet){ const e = S.elements[UI.sel]; UI.lib.kind = e && ['furniture', 'joinery', 'light', 'planting', 'soft', 'signage', 'services'].includes(e.cat) ? 'object' : 'material'; } X.refresh(); },
    libKind(k){ UI.lib.kind = k; UI.lib.kindSet = true; UI.lib.group = ''; UI.lib.pick = null; X.refresh(); },
    libGroup(g){ UI.lib.group = UI.lib.group === g ? '' : g; X.refresh(); },
    libPick(path){ UI.lib.pick = UI.lib.pick === path ? null : path; X.refresh(); setTimeout(() => $('#libdet')?.scrollIntoView({block: 'nearest'}), 0); },
    async libUse(use){
      const it = X.libItem(UI.lib.pick); const e = S.elements[UI.sel]; if (!it || !e) return;
      X.busy(true, 'Adding from the library…');
      try { const ref = it.kind === 'image' ? it.file : await X.swatchRef(it); let p = X.libApply(e, it, use, ref);
        if (it.kind === 'object' && use !== 'ref' && UI.lib.alsoFinish && it.finishes?.length){ const m = X.libItem(it.finishes[it.finishes.length - 1]); if (m){ const merged = Object.assign({}, e, p); const pm = X.libApply(merged, m, 'spec', null); p = Object.assign(p, pm, {lib: Object.assign({}, p.lib, pm.lib)}); } }
        patchEl(e.id, p); UI.galIdx = (p.refs || e.refs || []).length - 1; UI.modal = null; X.toast(`${it.title} added to ${e.code}.`); }
      catch(er){ X.uploadErr(er); } X.busy(false); X.refresh(); },
    libAlso(){ UI.lib.alsoFinish = !UI.lib.alsoFinish; X.refresh(); },
    /* AI images: queued for the briefing agent, which generates them and attaches them with their prompt */
    genOpen(){ const e = S.elements[UI.sel]; if (!e) return; UI.modal = 'gen'; UI.gen = {prompt: defaultPrompt(e), style: 'render', n: 2}; X.refresh(); setTimeout(() => $('#gen-prompt')?.focus(), 0); },
    genStyle(id){ UI.gen.prompt = $('#gen-prompt')?.value ?? UI.gen.prompt; UI.gen.style = id; X.refresh(); },
    genQueue(){ const e = S.elements[UI.sel]; if (!e) return; const prompt = $('#gen-prompt').value.trim(); if (!prompt){ $('#gen-prompt').focus(); return; }
      const n = +($('#gen-n')?.value || 1); const id = rid(); UI.modal = null;
      X.putDoc('requests/' + id, {id, kind: 'image', element: e.id, code: e.code, prompt, style: UI.gen.style, n, status: 'queued', by: ENV.uid, at: Date.now()});
      X.toast(ENV.local ? 'Queued. In this trial copy the agent picks it up from your export (Agent tab).' : 'Queued for the agent. The images will appear on this element, labelled AI.'); },
    reqCancel(id){ X.delDoc('requests/' + id); },
    modalClose(){ UI.modal = null; X.refresh(); },
    /* agent conversation */
    async agAttach(){ const fs = await X.pickFile('image/*,application/pdf,.txt,.md,.csv,.docx,.xlsx,audio/*', true); if (!fs.length) return; X.busy(true, 'Attaching…');
      UI.agFiles = UI.agFiles || [];
      try { for (const f of fs){ if (/^image\//.test(f.type)){ const {ref} = await X.ingest(f); UI.agFiles.push({ref, name: f.name, type: f.type}); }
          else { if (f.size > 8e6) { X.toast(f.name + ' is over 8 MB; share a link instead.'); continue; } const ref = ENV.local ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }) : await X.backend.uploadRaw(f, f.type || 'application/octet-stream'); UI.agFiles.push({ref, name: f.name, type: f.type || 'file'}); } } }
      catch(er){ X.uploadErr(er); } X.busy(false); X.refresh(); },
    agRmFile(i){ UI.agFiles.splice(+i, 1); X.refresh(); },
    agMode(m){ UI.agMode = m; ls_set('sb-agmode', m); X.refresh(); },
    agSend(){ const t = $('#ag-text').value.trim(); if (!t && !(UI.agFiles || []).length) { $('#ag-text').focus(); return; }
      const id = rid(); X.putDoc('agent/' + id, {id, role: 'architect', text: t, files: UI.agFiles || [], mode: UI.agMode || 'apply', focus: UI.agFocus ? UI.sel : null, status: 'new', by: ENV.uid, at: Date.now()});
      UI.agFiles = []; $('#ag-text').value = ''; X.refresh(); setTimeout(() => { const th = $('#thread'); if (th) th.scrollTop = th.scrollHeight; }, 30); },
    agQuick(v){ const [mid, i, k] = v.split('|'); const m = S.agent[mid]; const q = m?.questions?.[+i]; if (!q) return; const ans = q.options[+k];
      const id = rid(); X.putDoc('agent/' + id, {id, role: 'architect', text: ans, replyTo: mid, question: q.q, mode: UI.agMode || 'apply', status: 'new', by: ENV.uid, at: Date.now()}); },
    async agLoad(){ const fs = await X.pickFile('.json,application/json', false); if (!fs.length) return; let run; try { run = JSON.parse(await fs[0].text()); } catch(e){ X.toast('That file is not JSON.'); return; } await loadRun(run); },
    async agSample(){ try { const r = await fetch(X.src('fixture/agent-run.json')); await loadRun(await r.json()); } catch(e){ X.toast('The sample run is missing from this copy.'); } },
    runUndo(id){ X.undoRun(id); },
    runShow(id){ UI.runOpen = UI.runOpen === id ? null : id; X.refresh(); },
    async agExport(){ await R.acts.exportJson(); },
    resetLocal(){ if (confirm('Discard everything you changed in this browser and start again from the original brief?')) X.backend.reset(); },
    genDeck(){ X.generateDeck($('#deck-note')?.value.trim() || ''); },
    draftCancel(){ CV.draft = null; X.drawSheet(); X.renderTools(); },
    draftSave(){
      const d = CV.draft; const sh = X.curSheet(); const shape = {sheet: sh.id, type: d.type, pts: d.pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)])};
      const target = $('#dc-target').value;
      if (target){ const e = S.elements[target]; patchEl(target, {shapes: [...(e.shapes || []), shape]}); UI.sel = target; }
      else { const cat = $('#dc-cat').value, id = rid(); const order = live().reduce((m, e) => Math.max(m, e.order || 0), 0) + 1;
        X.putDoc('elements/' + id, {id, order, code: nextCode(cat), name: $('#dc-name').value.trim() || 'Untitled element', cat, origin: {type: 'manual'}, shapes: [shape],
          spec: {material: '', finish: '', colourName: '', hex: '', link: ''}, dims: [], notes: '', refs: [], options: [], rev: 0, dirty: true, updatedAt: Date.now()});
        UI.sel = id; UI.galIdx = 0; }
      CV.draft = null; UI.tool = 'select'; X.refresh();
    },
    refPick(){ UI.refPicker = !UI.refPicker; X.renderInspector($('#insp')); },
    refAdd(id){ const e = S.elements[UI.sel]; if (!e) return; if ((e.refs || []).includes(id)) return; patchEl(e.id, {refs: [...(e.refs || []), id]}); UI.galIdx = (e.refs || []).length; },
    async refUpload(){ const fs = await X.pickFile('image/*', true); if (!fs.length) return; X.busy(true, 'Uploading…'); const e = S.elements[UI.sel]; if (!e){ X.busy(false); return; } const refs = [...(e.refs || [])];
      const info = Object.assign({}, e.refInfo || {});
      try { for (const f of fs){ const {ref} = await X.ingest(f); refs.push(ref); info[X.refKey(ref)] = {source: 'upload', title: f.name, at: Date.now(), by: ENV.uid}; } patchEl(e.id, {refs, refInfo: info}); UI.galIdx = refs.length - 1; } catch(er){ X.uploadErr(er); } X.busy(false); },
    refRm(id, ev){ ev.stopPropagation(); const e = S.elements[UI.sel]; if (!e) return; const refs = [...e.refs]; const [gone] = refs.splice(+id, 1); UI.galIdx = 0; const p = {refs}; if (e.refInfo && !refs.includes(gone) && e.refInfo[X.refKey(gone)]){ const inf = clone(e.refInfo); delete inf[X.refKey(gone)]; X.patchDoc('elements/' + e.id, {refInfo: null}); p.refInfo = inf; } patchEl(e.id, p); },
    hexClear(){ patchEl(UI.sel, {spec: {hex: ''}}); },
    dimAdd(){ const e = S.elements[UI.sel]; if (!e) return; patchEl(e.id, {dims: [...(e.dims || []), {k: '', v: '', src: 'architect'}]}); },
    dimRm(id){ const e = S.elements[UI.sel]; if (!e) return; const d = [...e.dims]; d.splice(+id, 1); patchEl(e.id, {dims: d}); },
    optAdd(){ const e = S.elements[UI.sel]; if (!e) return; patchEl(e.id, {options: [...(e.options || []), {id: rid(), label: 'Option ' + ((e.options || []).length + 1), hex: '#cccccc'}]}); },
    optRm(id){ const e = S.elements[UI.sel]; if (!e) return; const o = [...e.options]; o.splice(+id, 1); patchEl(e.id, {options: o}); },
    shapeRm(id){ const e = S.elements[UI.sel]; if (!e) return; const s = [...e.shapes]; s.splice(+id, 1); patchEl(e.id, {shapes: s}); },
    delAsk(){ UI.confirmDel = true; X.renderInspector($('#insp')); }, delCancel(){ UI.confirmDel = false; X.renderInspector($('#insp')); },
    delEl(){ const id = UI.sel; UI.sel = null; UI.confirmDel = false; X.delDoc('elements/' + id); Object.values(S.pins).filter(p => p.element === id).forEach(p => X.patchDoc('pins/' + p.id, {element: null})); },
    roundAdd(){ const rs = clone(X.rounds()); const id = 'r' + rid(); rs.push({id, name: 'R' + (rs.length + 1), note: '', issue: X.issueNo()}); X.patchDoc('brief/meta', {rounds: rs}); UI.round = id; UI.render = null; X.refresh(); },
    async renderUp(){ const fs = await X.pickFile('image/*', true); if (!fs.length) return; X.busy(true, `Uploading ${fs.length} render${fs.length > 1 ? 's' : ''}…`);
      try { let o = X.rendersIn(UI.round).length; const views = [...new Set(Object.values(S.renders).map(r => r.view))];
        for (const f of fs){ const {ref, w, h} = await X.ingest(f); const id = rid(); let view = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); const m = views.find(v => view.toLowerCase().includes(v.toLowerCase())); if (m) view = m;
          await X.putDoc('renders/' + id, {id, round: UI.round, view, img: ref, w, h, order: ++o, at: Date.now()}); UI.render = id; } }
      catch(e){ X.uploadErr(e); } X.busy(false); X.refresh(); },
    renderRm(){ UI.confirmRender = true; X.refresh(); }, renderRmNo(){ UI.confirmRender = false; X.refresh(); },
    renderRmYes(){ const id = UI.render; UI.confirmRender = false; X.pinsOn(id).forEach(p => X.delDoc('pins/' + p.id)); X.delDoc('renders/' + id); UI.render = null; X.refresh(); },
    draftPinSave(){ const t = $('#dr-text').value.trim(); if (!t){ $('#dr-text').focus(); return; } const id = rid(), d = UI.draft;
      X.putDoc('pins/' + id, {id, render: d.render, x: d.x, y: d.y, element: $('#dr-el').value || null, text: t, status: 'open', uid: ENV.uid, at: Date.now(), refs: []}); UI.draft = null; UI.pin = id; X.refresh(); },
    pst(v){ const [id, st] = v.split('|'); const p = {status: st, statusAt: Date.now(), statusBy: ENV.uid}; if (st === 'open') p.reopenedAt = Date.now(); X.patchDoc('pins/' + id, p); },
    pinDel(){ UI.confirmPin = true; X.refresh(); }, pinDelYes(){ const id = UI.pin; UI.pin = null; UI.confirmPin = false; X.delDoc('pins/' + id); },
    promote(key){ const c = X.clientComments().find(x => x.key === key); if (!c) return; const id = rid();
      X.putDoc('pins/' + id, {id, render: c.render, x: c.x, y: c.y, element: c.element || null, text: c.text, status: 'open', uid: ENV.uid, at: Date.now(), refs: [], fromComment: key, fromRole: 'client'}); UI.pin = id; X.toast('Sent to the modeler’s punch list.'); },
    dismiss(key){ X.patchDoc('brief/meta', {dismissed: [...(S.meta.dismissed || []), key]}); UI.pin = null; },
    /* issue & team */
    issueNow(){
      const list = pending(); if (!list.length) return; const n = X.issueNo() + 1; const at = Date.now(); const note = $('#iss-note')?.value.trim() || '';
      const changed = [];
      for (const e of list){ const rev = (e.issued?.rev || 0) + 1; const snap = {}; SNAP.forEach(k => snap[k] = clone(e[k] ?? null)); snap.rev = rev; snap.at = at; snap.issue = n;
        changed.push({id: e.id, code: e.code, name: e.name, rev, fields: changedFields(e)});
        X.patchDoc('elements/' + e.id, {issued: snap, rev, dirty: false}); }
      X.putDoc('issues/' + n, {n, at, note, by: ENV.uid, changed});
      X.patchDoc('brief/meta', {issue: {n, at}}); X.toast(`Issue ${n} sent: ${changed.length} element${changed.length > 1 ? 's' : ''}.`);
    },
    async teamSearch(){ const q = $('#tm-q').value.trim(); if (!ENV.user){ X.toast('People search is only available in the published brief.'); return; }
      UI.teamHits = await ENV.user.search(q); X.refresh(); },
    teamAdd(v){ const [uid, role] = v.split('|'); X.putDoc('roster/' + uid, {role, at: Date.now(), by: ENV.uid}); UI.teamHits = null; },
    teamRole(v){ const [uid, role] = v.split('|'); X.patchDoc('roster/' + uid, {role}); },
    teamRm(uid){ if (uid === ENV.uid) return; X.delDoc('roster/' + uid); },
    async exportJson(){ const data = JSON.stringify({schema: 'spacebrief-export/1', exported: new Date().toISOString(), build: X.BUILD, meta: S.meta, elements: S.elements, renders: S.renders, pins: S.pins, roster: S.roster, issues: S.issues, inputs: S.inputs, requests: S.requests, agent: S.agent, runs: S.runs, decks: S.decks}, null, 1);
      await X.saveFile((S.meta.project.code + '-brief-export.json').toLowerCase(), new Blob([data], {type: 'application/json'})); },
  },
};
function refPicker(e){
  const all = S.meta.references || []; const tray = new Set(S.meta.tray || []);
  const sorted = [...all].sort((a, b) => tray.has(b.id) - tray.has(a.id));
  return `<div class="sec" style="background:var(--raise)"><div class="lbl">Add a reference <button class="x" data-act="refPick" aria-label="Close">✕</button></div>
    <div class="gal-row">${sorted.map(r => `<button class="gal-th" data-act="refAdd" data-id="${r.id}" title="${esc(r.title)}${tray.has(r.id) ? ' (unassigned)' : ''}" style="${tray.has(r.id) ? 'outline:2px dashed var(--amber)' : ''}"><img src="refs/${esc(r.asset)}" alt="${esc(r.title)}"></button>`).join('')}</div>
    <p class="small muted">Dashed = not yet used on any element.</p>${ENV.assets || ENV.local ? '<button class="btn sm" data-act="refUpload">Upload new image</button>' : ''}</div>`;
}
const ls_set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} };
const ls_get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } };
UI.agMode = ls_get('sb-agmode', 'apply');
function agentNote(e, chg){
  if (!e.agent || !e.agent.run) return '';
  const r = S.runs[e.agent.run]; const pending = !e.issued || chg.length;
  return pending ? `<p class="diff agent">Filled by the agent${r ? ` (run ${esc(r.label || r.id)})` : ''} from your instructions: ${esc((e.agent.fields || []).join(', ') || 'see changes')}. Check it, then issue.</p>` : '';
}
function defaultPrompt(e){
  const s = e.spec || {}; const sp = (S.meta?.space?.label || '').split(' · ')[0];
  const mat = [s.material, s.finish, s.colourName].filter(Boolean).join(', ');
  return `${e.name}${mat ? ' in ' + mat : ''}, ${sp ? sp.toLowerCase() + ' of a contemporary office' : 'contemporary interior'}, natural daylight, eye-level view`;
}
async function loadRun(run){
  const bad = X.checkRun(run); if (bad.length){ X.toast('This agent run was refused: ' + bad[0]); return; }
  let r = await X.applyRun(run);
  if (r && r.conflicts){ if (!confirm(`You changed ${r.conflicts.join(', ')} after the agent read the brief. Apply anyway? Its version replaces yours for those elements (you can undo).`)) return; r = await X.applyRun(run, true); }
  UI.tab = 'agent'; X.refresh();
}
const GEN_STYLES = [['render', 'In the room'], ['closeup', 'Material close-up'], ['product', 'Product shot'], ['sketch', 'Sketch']];
R.modal = function(){
  const e = UI.sel && S.elements[UI.sel];
  if (UI.modal === 'lib' && e){
    const items = libItems();
    const all = libAll(); const kinds = [['material', 'Materials'], ['object', 'Objects'], ['image', 'Images']].map(([k, l]) => [k, l, all.filter(i => i.kind === k).length]);
    const groups = [...new Set(all.filter(i => i.kind === UI.lib.kind).map(i => i.group))];
    const it = UI.lib.pick && X.libItem(UI.lib.pick);
    return `<div class="modal-bg" data-act="modalClose"></div><section class="modal" role="dialog" aria-label="Cloud library">
      <div class="modal-h"><div><div class="lbl">Cloud library · for ${esc(e.code)}</div><b>${esc(e.name)}</b></div><button class="x" data-act="modalClose" aria-label="Close">✕</button></div>
      <div class="modal-t"><div class="seg">${kinds.map(([k, l, n]) => `<button data-act="libKind" data-id="${k}" aria-pressed="${UI.lib.kind === k}">${l} <span class="mono">${n}</span></button>`).join('')}</div>
        <input class="inp" id="lib-q" placeholder="Search the library" value="${esc(UI.lib.q)}" autocomplete="off"></div>
      ${groups.length > 1 ? `<div class="row chips">${groups.map(g => `<button class="chipf" data-act="libGroup" data-id="${esc(g)}" aria-pressed="${UI.lib.group === g}">${esc(g)}</button>`).join('')}</div>` : ''}
      <div class="modal-b">${items.length ? `<div class="libgrid">${items.map(i => `<button class="libcard" data-act="libPick" data-id="${esc(i.path)}" aria-pressed="${UI.lib.pick === i.path}"><img src="${thumb(i)}" alt=""><b>${esc(i.title.replace(/^[^—]+—\s*/, ''))}</b><small>${esc(i.kind === 'material' ? [X.finishWord(i.finish), i.hex].filter(Boolean).join(' · ') : i.kind === 'object' ? (i.dims || []).slice(0, 3).map(d => Math.round(d.v * 1000)).join(' × ') + ((i.dims || []).length ? ' mm' : i.group) : i.group)}</small></button>`).join('')}</div>`
        : `<p class="empty">${all.length ? 'Nothing matches.' : 'The library catalog is empty in this copy. The pipeline fills it from a mirror of the cloud library (inputs/library); see agents/BRIEFING_AGENT.md.'}</p>`}</div>
      ${it ? `<div class="modal-d" id="libdet"><img src="${thumb(it)}" alt=""><div class="dd"><b>${esc(it.title)}</b><small class="muted">${esc(it.path)}</small><p class="small">${esc(it.desc || '')}</p>
        ${it.kind === 'object' && (it.dims || []).length ? `<p class="small mono">${it.dims.map(d => esc(d.k) + ' ' + Math.round(d.v * 1000) + ' mm').join(' · ')}</p>` : ''}
        ${it.kind === 'object' && it.finishes?.length ? `<label class="layer"><input type="checkbox" data-act="libAlso" ${UI.lib.alsoFinish ? 'checked' : ''}> Also use its finish: ${esc((X.libItem(it.finishes[it.finishes.length - 1]) || {}).title || '')}</label>` : ''}
        <div class="row">${it.kind === 'material' ? `<button class="btn pri" data-act="libUse" data-id="spec">Use as specification</button><button class="btn" data-act="libUse" data-id="option">Add as client option</button>`
          : it.kind === 'object' ? `<button class="btn pri" data-act="libUse" data-id="object">Use for ${esc(e.code)}</button><button class="btn" data-act="libUse" data-id="ref">Reference only</button>` : `<button class="btn pri" data-act="libUse" data-id="ref">Add as reference</button>`}</div></div></div>` : ''}
    </section>`;
  }
  if (UI.modal === 'gen' && e){
    const reqs = Object.values(S.requests).filter(q => q.element === e.id).sort((a, b) => b.at - a.at);
    return `<div class="modal-bg" data-act="modalClose"></div><section class="modal narrow" role="dialog" aria-label="Generate images">
      <div class="modal-h"><div><div class="lbl">Generate with AI · for ${esc(e.code)}</div><b>${esc(e.name)}</b></div><button class="x" data-act="modalClose" aria-label="Close">✕</button></div>
      <div class="modal-b pad1"><label class="fld"><span class="lbl">Describe the image</span><textarea class="inp" id="gen-prompt" rows="4">${esc(UI.gen.prompt)}</textarea></label>
        <div class="fld"><span class="lbl">Kind</span><div class="row">${GEN_STYLES.map(([k, l]) => `<button class="chipf" data-act="genStyle" data-id="${k}" aria-pressed="${UI.gen.style === k}">${l}</button>`).join('')}</div></div>
        <label class="fld" style="max-width:160px"><span class="lbl">How many</span><select class="inp" id="gen-n">${[1, 2, 3, 4].map(n => `<option ${n === UI.gen.n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <p class="small muted">The briefing agent generates these with the image model it is set up with, and attaches them here labelled <b>AI</b> with this prompt. They go to the client only when you issue.</p>
        <div class="row"><button class="btn pri" data-act="genQueue">Queue for the agent</button></div>
        ${reqs.length ? `<div class="lbl" style="margin-top:6px">Requests for ${esc(e.code)}</div>${reqs.map(q => `<div class="reqrow"><span class="pill st-${q.status === 'done' ? 'approved' : q.status === 'failed' ? 'changes' : 'pending'}">${esc(q.status)}</span><span class="small">${esc(q.prompt)}</span>${q.status === 'queued' ? `<button class="btn sm ghost" data-act="reqCancel" data-id="${q.id}">Cancel</button>` : '<span></span>'}</div>`).join('')}` : ''}
      </div></section>`;
  }
  return '';
};
const _thumbs = new Map();
function thumb(i){ if (i.kind === 'image') return X.src(i.file); if (!_thumbs.has(i.path)) _thumbs.set(i.path, X.drawSwatch(i, 240, 180).toDataURL('image/jpeg', .8)); return _thumbs.get(i.path); }
const libAll = () => UI._libcache || [];
function libItems(){ const q = (UI.lib.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  return libAll().filter(i => i.kind === UI.lib.kind && (!UI.lib.group || i.group === UI.lib.group) && q.every(w => (i.title + ' ' + i.path + ' ' + (i.desc || '') + ' ' + (i.material || '')).toLowerCase().includes(w))); }
X.library().then(c => { UI._libcache = c.items || []; });
(X.MOUNT?.root || document).addEventListener('input', ev => { if (ev.target.id !== 'lib-q') return; UI.lib.q = ev.target.value; const pos = ev.target.selectionStart; X.renderModal(); const n = $('#lib-q'); if (n){ n.focus(); try { n.setSelectionRange(pos, pos); } catch(e){} } });
/* ----- Agent tab ----- */
function renderAgent(main){
  const msgs = Object.values(S.agent).sort((a, b) => a.at - b.at); const runs = Object.values(S.runs).sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
  const reqs = Object.values(S.requests).sort((a, b) => b.at - a.at); const st = S.meta?.agent || null;
  msgs.filter(m => m.role === 'agent' && !m.seen).forEach(m => X.patchDoc('agent/' + m.id, {seen: Date.now()}));
  const runCard = r => { const ch = r.changes || []; return `<div class="runcard ${esc(r.status)}"><div class="row" style="justify-content:space-between"><b>Run ${esc(r.label || r.id)}</b><span class="pill st-${r.status === 'applied' ? 'approved' : 'draft'}">${r.status === 'applied' ? 'Applied as drafts' : esc(r.status)}</span></div>
      <p class="small">${esc(r.summary || '')}</p><p class="small muted">${ch.length} element${ch.length !== 1 ? 's' : ''} changed${r.requests ? ` · ${r.requests} image request${r.requests > 1 ? 's' : ''}` : ''} · ${X.fmtDate(r.appliedAt || Date.parse(r.at))}</p>
      <div class="row"><button class="btn sm" data-act="runShow" data-id="${esc(r.id)}">${UI.runOpen === r.id ? 'Hide changes' : 'Show changes'}</button>${r.status === 'applied' ? `<button class="btn sm ghost" data-act="runUndo" data-id="${esc(r.id)}">Undo run</button>` : ''}</div>
      ${UI.runOpen === r.id ? `<ul class="chg">${ch.map(c => `<li><a href="#" class="lnk" data-act="goel" data-id="${esc(c.id)}">${esc(c.code)}</a> ${esc(c.name || '')}: ${esc((c.fields || []).join(', '))}${c.cites?.length ? ` <span class="muted">· from ${esc(c.cites.join(', '))}</span>` : ''}</li>`).join('')}</ul>` : ''}</div>`; };
  const bubble = m => `<div class="msg ${m.role}"><div class="who">${m.role === 'agent' ? 'Agent' : 'You'} · ${X.fmtDate(m.at)}${m.mode === 'ask' && m.role === 'architect' ? ' · ask first' : ''}</div>
      ${m.question ? `<div class="small muted">Re: ${esc(m.question)}</div>` : ''}<div class="txt">${esc(m.text).replace(/\n/g, '<br>')}</div>
      ${(m.files || []).length ? `<div class="gal-row">${m.files.map(f => /^image\//.test(f.type) ? `<a class="gal-th" href="${esc(X.src(f.ref))}" target="_blank" rel="noopener"><img src="${esc(X.src(f.ref))}" alt="${esc(f.name)}"></a>` : `<span class="filechip">${esc(f.name)}</span>`).join('')}</div>` : ''}
      ${(m.questions || []).map((q, i) => `<div class="q"><b>${esc(q.q)}</b><div class="row">${(q.options || []).map((o, k) => `<button class="chipf" data-act="agQuick" data-id="${esc(m.id)}|${i}|${k}">${esc(o)}</button>`).join('')}</div></div>`).join('')}
      ${m.run && S.runs[m.run] ? runCard(S.runs[m.run]) : ''}${m.role === 'architect' ? `<div class="state">${m.status === 'new' ? 'Waiting for the agent' : m.status === 'working' ? 'The agent is working on it' : 'Done'}</div>` : ''}</div>`;
  const orphanRuns = runs.filter(r => !msgs.some(m => m.run === r.id));
  main.innerHTML = `<div class="page"><div class="pad agentpage">
    <div class="ph"><div><p class="lbl">Briefing agent</p><h1>Brief it yourself, or hand it over</h1></div>
      <span class="small muted">${st ? `Agent ${esc(st.status || '')} · last seen ${X.fmtDate(st.seenAt)}` : ENV.local ? 'No agent connected to this copy' : 'The agent reads this thread when you ask it to'}</span></div>
    <div class="agentgrid"><section class="thread-wrap">
      <div class="howto"><b>Give everything at once</b> — notes, sketches, photos, a PDF, links, voice-note transcripts — and the agent fills the elements as drafts. <b>Or talk it through</b> — it asks what it needs, one question at a time. Nothing reaches the client until you issue.</div>
      <div class="thread" id="thread">${msgs.map(bubble).join('') || '<p class="empty">No messages yet. Try: “Reception floor white Statuario marble, lobby herringbone oak; moss wall darker than the photo; baffles navy and sky blue alternating; pendant 2400 above FFL.” and attach your sketches.</p>'}${orphanRuns.map(runCard).join('')}</div>
      <div class="composer">${(UI.agFiles || []).length ? `<div class="row">${UI.agFiles.map((f, i) => `<span class="filechip">${esc(f.name)} <button class="x" data-act="agRmFile" data-id="${i}" aria-label="Remove">✕</button></span>`).join('')}</div>` : ''}
        <textarea class="inp" id="ag-text" rows="3" placeholder="Instructions for the agent: what to specify, which references to use, what to generate…"></textarea>
        <div class="row" style="justify-content:space-between"><div class="row"><button class="btn sm" data-act="agAttach">${'Attach'}</button>
          <div class="seg sm"><button data-act="agMode" data-id="apply" aria-pressed="${UI.agMode !== 'ask'}" title="The agent fills the elements as drafts">Fill as drafts</button><button data-act="agMode" data-id="ask" aria-pressed="${UI.agMode === 'ask'}" title="The agent proposes and asks before changing anything">Ask me first</button></div></div>
          <button class="btn pri" data-act="agSend">Send to agent</button></div></div>
    </section><aside class="agentside">
      <section class="apbox"><div class="lbl">AI image requests</div>${reqs.length ? reqs.map(q => `<div class="reqrow"><span class="pill st-${q.status === 'done' ? 'approved' : q.status === 'failed' ? 'changes' : 'pending'}">${esc(q.status)}</span><span class="small"><a href="#" class="lnk" data-act="goel" data-id="${esc(q.element)}">${esc(q.code || '')}</a> ${esc(q.prompt)}</span>${q.status === 'queued' ? `<button class="btn sm ghost" data-act="reqCancel" data-id="${q.id}">Cancel</button>` : '<span></span>'}</div>`).join('') : '<p class="small muted">None. Use Generate on an element, or ask the agent here.</p>'}</section>
      <section class="apbox"><div class="lbl">Agent runs</div>${runs.length ? runs.map(r => `<div class="reqrow"><span class="pill st-${r.status === 'applied' ? 'approved' : 'draft'}">${esc(r.status)}</span><span class="small">${esc(r.label || r.id)} · ${esc(r.summary || '')}</span>${r.status === 'applied' ? `<button class="btn sm ghost" data-act="runUndo" data-id="${esc(r.id)}">Undo</button>` : '<span></span>'}</div>`).join('') : '<p class="small muted">Every change the agent makes arrives as one run you can inspect and undo.</p>'}</section>
      <section class="apbox"><div class="lbl">${ENV.local ? 'Working with an agent from this copy' : 'Offline hand-over'}</div>
        <p class="small muted">${ENV.local ? 'This trial copy is not connected to an agent. Download the brief (it carries your messages and requests), give it to the agent with your files, then load the run file it returns.' : 'If the agent worked from an export, load the run file it returned.'}</p>
        <div class="row"><button class="btn sm" data-act="agExport">Download for the agent</button><button class="btn sm" data-act="agLoad">Load agent run…</button>${X.BUILD.fixture && ENV.local ? '<button class="btn sm acc" data-act="agSample">Try the sample run</button>' : ''}</div></section>
    </aside></div></div></div>`;
  const th = $('#thread'); if (th) th.scrollTop = th.scrollHeight;
}
function renderIssue(main){
  const list = pending(); const iss = Object.values(S.issues).sort((a, b) => b.n - a.n);
  const roster = Object.entries(S.roster);
  main.innerHTML = `<div class="page"><div class="pad">
   <div class="ph"><div><p class="lbl">Versions</p><h1>Issue ${X.issueNo() + 1}${list.length ? '' : ' (nothing to issue)'}</h1></div></div>
   <section><p class="muted" style="max-width:62ch">The client and the modeler only ever see issued revisions. Each issue snapshots the elements you changed and bumps their revision; a client approval given on an older revision stops counting until they review the new one.</p></section>
   ${list.length ? `<section class="tblwrap"><table class="tbl"><thead><tr><th>Element</th><th>Rev</th><th>What changed</th></tr></thead><tbody>${list.map(e => `<tr><td><span class="code"><i style="background:${X.catColor(e.cat)}"></i>${esc(e.code)}</span> ${esc(e.name)}</td><td class="mono">${e.issued ? e.issued.rev + ' → ' + (e.issued.rev + 1) : 'new → 1'}</td><td>${changedFields(e).map(k => FIELD_NAMES[k] || k).join(', ')}</td></tr>`).join('')}</tbody></table></section>
   ${X.canEditSpec() ? `<section class="apbox" style="max-width:640px"><label class="fld"><span class="lbl">Note to the client and modeler</span><textarea class="inp" id="iss-note" placeholder="e.g. Moss wall darker, pendant raised to +2400"></textarea></label><div class="row"><button class="btn pri" data-act="issueNow">Issue ${list.length} element${list.length > 1 ? 's' : ''} as I${X.issueNo() + 1}</button></div></section>` : ''}` : ''}
   <section><div class="cat-h"><h2>Issue log</h2><span class="n">${iss.length}</span></div>${iss.map(i => `<div class="pitem" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="rchip">I${i.n}</span><span class="t">${esc(i.note || 'No note')}<small>${(i.changed || []).map(c => `${esc(c.code)} rev ${esc(c.rev)}`).join(' · ')}</small></span><small class="muted">${X.fmtDate(i.at)}</small></div>`).join('') || '<p class="muted">Nothing issued yet.</p>'}</section>
   <section><div class="cat-h"><h2>Team</h2><span class="n">${roster.length}</span></div>
     <p class="muted small" style="margin-bottom:10px">Roles decide whose input counts. Share the brief with the client and modeler as <b>Contributor</b> (they can only write their own decisions and fixes); keep architects as <b>Editor</b>.</p>
     <div class="tblwrap"><table class="tbl"><tbody>${roster.map(([uid, r]) => `<tr><td>${esc(X.nameOf(uid))}${uid === ENV.uid ? ' (you)' : ''}</td><td>${X.canEditSpec() && uid !== ENV.uid ? `<select class="inp" style="width:auto" data-role-uid="${esc(uid)}">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${k === r.role ? 'selected' : ''}>${l}</option>`).join('')}</select>` : esc(ROLE[r.role] || r.role)}</td><td>${X.canEditSpec() && uid !== ENV.uid ? `<button class="btn sm ghost" data-act="teamRm" data-id="${esc(uid)}">Remove</button>` : ''}</td></tr>`).join('') || '<tr><td class="muted">Nobody yet.</td></tr>'}</tbody></table></div>
     ${X.canEditSpec() ? `<div class="row" style="margin-top:10px;max-width:520px;flex-wrap:nowrap"><input class="inp" id="tm-q" placeholder="Search people in your organisation"><button class="btn sm" data-act="teamSearch">Search</button></div>
       ${UI.teamHits ? `<div style="margin-top:8px;max-width:620px">${UI.teamHits.map(h => `<div class="row" style="justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(h.name)}</span><span class="row">${['client', 'modeler', 'architect'].map(r => `<button class="btn sm" data-act="teamAdd" data-id="${esc(h.id)}|${r}">Add as ${ROLE[r]}</button>`).join('')}</span></div>`).join('') || '<p class="muted small">No matches.</p>'}</div>` : ''}` : ''}
   </section>
   <section><button class="btn sm" data-act="exportJson">Download everything as JSON</button> <span class="small muted">The pipeline and the briefing agent read the same data.</span></section>
  </div></div>`;
}
X.boot(R);
})();
