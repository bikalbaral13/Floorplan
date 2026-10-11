/* Modeler page: the punch list against the latest issue, the issued spec, renders; mark fixes and reply. */
(() => {
'use strict';
const X = window.BRIEF; const {S, UI, ENV, $, esc} = X;
const me = () => X.canActAs('modeler');
const R = {
  tabs(){ const open = Object.values(S.pins).filter(p => X.pinState(p) === 'open').length; return [['punch', 'Punch list', open], ['review', 'Renders'], ['drawings', 'Drawings'], ['board', 'Spec'], ['deck', 'Brief deck']]; },
  render(tab, main){ if (tab === 'punch') X.renderPunch(main); else if (tab === 'review') X.renderReview(main); else if (tab === 'deck') X.renderDecks(main); else X.renderBoard(main); },
  canChoose: () => false,
  pinActions(p, st){
    if (!me()) return '';
    const f = X.fixOf(p);
    if (st === 'open') return `<button class="btn sm" style="border-color:var(--amber);color:var(--amber)" data-act="fixed" data-id="${p.id}">Mark fixed</button>`;
    if (st === 'fixed' && f && f.uid === ENV.uid) return `<button class="btn sm ghost" data-act="unfix" data-id="${p.id}">Undo fixed</button>`;
    return '';
  },
  canReply: () => me(),
  acts: {
    fixed(id){ X.saveMine({fixes: {[id]: {at: Date.now(), issue: X.issueNo()}}}); X.toast('Marked fixed. The architect will verify it.'); },
    unfix(id){ X.saveMine({fixes: {[id]: {at: 0}}}); },
  },
};
X.boot(R);
})();
