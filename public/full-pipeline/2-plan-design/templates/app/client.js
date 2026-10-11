/* Client page: see issued revisions, pick options, approve or request changes, comment on renders. */
(() => {
'use strict';
const X = window.BRIEF; const {S, UI, ENV, $, esc, rid} = X;
const me = () => X.canActAs('client');
const needs = () => X.els().filter(e => ['pending', 'stale'].includes(X.apState(e)));
UI.pickChoice = {};
const pk = e => e.id + '@' + e.rev;
const pickOf = e => { const v = UI.pickChoice[pk(e)]; return (e.options || []).some(o => o.id === v) ? v : null; };
const cur = () => { const raw = S.elements[UI.sel]; return raw ? X.viewOf(raw) : null; };
const R = {
  tabs(){ return [['board', 'Decisions', needs().length, true], ['drawings', 'Drawings'], ['review', 'Renders'], ['changes', 'What changed'], ['deck', 'Brief deck']]; },
  render(tab, main){ if (tab === 'board') X.renderBoard(main); else if (tab === 'review') X.renderReview(main); else if (tab === 'deck') X.renderDecks(main); else renderChanges(main); },
  canChoose: e => me() && X.apState(e) !== 'draft',
  boardTop(all){
    const list = needs(); const last = Object.values(S.issues).sort((a, b) => b.n - a.n)[0];
    return (last ? `<div class="apbox" style="max-width:760px"><span class="lbl">Issue ${last.n} · ${X.fmtDate(last.at)}</span><p>${esc(last.note || 'No note from the architect.')}</p><button class="btn sm ghost" data-act="tab" data-id="changes" style="align-self:flex-start">See what changed</button></div>` : '') +
      (list.length ? `<div class="decide"><h2>${list.length} item${list.length > 1 ? 's' : ''} need your decision</h2><div class="row">${list.map(e => `<button class="btn" data-act="sel" data-id="${e.id}"><span class="code"><i style="background:${X.catColor(e.cat)}"></i>${esc(e.code)}</span>${esc(e.name)}${X.apState(e) === 'stale' ? ' <span class="pill st-stale">changed</span>' : ''}</button>`).join('')}</div></div>` : (all.length ? '<div class="apbox" style="max-width:760px"><b>You are up to date.</b><span class="muted small">Every issued item has your decision.</span></div>' : ''));
  },
  decisionActions(e){
    if (!me() || X.apState(e) === 'draft') return '';
    const d = X.decisionOf(e.id); const hasOpts = (e.options || []).length;
    const pick = pickOf(e) || (d && d.rev === e.rev ? d.choice : null);
    return `<textarea class="inp" id="ap-note" placeholder="Note for the architect (needed if you request changes)"></textarea>
      ${hasOpts && !pick ? '<p class="small muted">Pick one of the options above before approving.</p>' : ''}
      <div class="row"><button class="btn ok" data-act="approve" ${hasOpts && !pick ? 'disabled' : ''}>Approve rev ${e.rev}${hasOpts && pick ? ' with ' + esc((e.options.find(o => o.id === pick) || {}).label || '') : ''}</button><button class="btn warn" data-act="reqChange">Request changes</button></div>`;
  },
  canPinHere: () => me(), pinButtonLabel: () => '+ Comment', draftTitle: () => 'Comment for the architect',
  showClientComments: true, clientCommentHint: () => 'The architect reviews these and passes them to the modeler.',
  clientCommentActions(c){ return c.uid === ENV.uid && me() ? `<button class="btn sm ghost" data-act="withdraw" data-id="${esc(c.id)}">Withdraw</button>` : ''; },
  canReply: () => me(),
  acts: {
    choose(id){ const e = cur(); if (!e) return; UI.pickChoice[pk(e)] = id; X.renderInspector($('#insp')); },
    approve(){ const e = cur(); if (!e) return; const d = X.decisionOf(e.id);
      const choice = pickOf(e) || (d && d.rev === e.rev && (e.options || []).some(o => o.id === d.choice) ? d.choice : null);
      delete UI.pickChoice[pk(e)];
      X.saveMine({decisions: {[e.id]: {state: 'approved', choice, note: $('#ap-note')?.value.trim() || '', rev: e.rev, issue: X.issueNo(), at: Date.now()}}}); X.toast(`Approved ${e.code} rev ${e.rev}.`); },
    reqChange(){ const e = cur(); if (!e) return; const n = $('#ap-note'); const note = n?.value.trim(); if (!note){ n?.focus(); X.toast('Add a short note so the architect knows what to change.'); return; }
      X.saveMine({decisions: {[e.id]: {state: 'changes', choice: pickOf(e), note, rev: e.rev, issue: X.issueNo(), at: Date.now()}}}); X.toast('Change request sent to the architect.'); },
    draftPinSave(){ const t = $('#dr-text').value.trim(); if (!t){ $('#dr-text').focus(); return; } const d = UI.draft; const id = rid();
      X.saveMine({comments: {[id]: {render: d.render, x: d.x, y: d.y, text: t, element: $('#dr-el').value || null, at: Date.now()}}}); UI.draft = null; UI.pin = ENV.uid + ':' + id; X.refresh(); },
    withdraw(id){ X.saveMine({comments: {[id]: {withdrawn: true}}}); UI.pin = null; },
  },
};
function renderChanges(main){
  const iss = Object.values(S.issues).sort((a, b) => b.n - a.n);
  main.innerHTML = `<div class="page"><div class="pad"><div class="ph"><div><p class="lbl">Revision history</p><h1>What changed</h1></div></div>
    ${iss.map(i => `<section><div class="cat-h"><h2>Issue ${i.n}</h2><span class="n">${X.fmtDate(i.at)}</span></div>${i.note ? `<p style="margin-bottom:8px">${esc(i.note)}</p>` : ''}
      <div class="tblwrap"><table class="tbl"><tbody>${(i.changed || []).map(c => { const e = X.viewOf(S.elements[c.id]); return `<tr><td><span class="code">${esc(c.code)}</span> ${esc(c.name)}</td><td class="mono">rev ${c.rev}</td><td>${esc((c.fields || []).join(', ').replace('new', 'new item'))}</td><td>${e ? `<span class="pill st-${X.apState(e)}">${X.AP[X.apState(e)]}</span>` : ''}</td><td>${e ? `<button class="btn sm ghost" data-act="sel" data-id="${c.id}">Open</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></section>`).join('') || '<p class="muted">Nothing has been issued yet.</p>'}
  </div></div>`;
}
R.acts.sel = (id, ev) => { if (ev && ev.target.closest('#stage')) return; UI.sel = id; UI.galIdx = 0; if (UI.tab === 'changes') UI.tab = 'board'; X.refresh(); };
X.boot(R);
})();
