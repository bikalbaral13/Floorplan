/* Pipeline UI template (Skills/Pipeline Creator). Runs in the editor's RIGHT-HAND PANEL (beside Properties), in a
   sandboxed iframe about 540 px wide. The editor's canvas is the drawing and its chat is the agent — so no drawing
   view and no chat/agent tab here: only this pipeline's own panels.
   window.pipeline = { db, assets, downloads, emit(type, data), setTabs(tabs, active), project, id }
   window.PIPELINE_UI = { tab(id) }   the editor calls it when the user picks one of your tabs (or a run step opens one)
   Data lives in Projects/<project>/<pipeline id>/state.json; Claude changes it live with pipeline.patch. */
(function () {
  'use strict';
  var TABS = [['items', 'Items'], ['summary', 'Summary']];   // panel ids — use them as `panel` in the steps
  var S = { meta: null, items: {} }, tab = 'items';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var db = window.pipeline.db;

  function render() {
    $('#title').textContent = (S.meta && S.meta.title) || 'Pipeline';
    $('#project').textContent = window.pipeline.project || '';
    var items = Object.keys(S.items).map(function (id) { return Object.assign({ id: id }, S.items[id]); }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    // The tabs are shown by the EDITOR, in its right-hand panel header (count = a badge; amber = needs attention).
    window.pipeline.setTabs(TABS.map(function (t) { return { id: t[0], label: t[1], count: t[0] === 'items' ? items.filter(function (i) { return !i.done; }).length : 0, amber: true }; }), tab);
    if (tab === 'items') {
      $('#main').innerHTML = items.map(function (it) {
        return '<div class="card"><input type="checkbox" data-done="' + it.id + '"' + (it.done ? ' checked' : '') + '>' +
          '<input type="text" data-name="' + it.id + '" value="' + esc(it.name) + '"><button class="btn" data-del="' + it.id + '">Remove</button></div>';
      }).join('') + '<button class="btn primary" id="add">Add item</button>';
    } else {
      var done = items.filter(function (i) { return i.done; }).length;
      $('#main').innerHTML = '<div class="card"><b>' + done + ' / ' + items.length + '</b>&nbsp;done</div>' +
        '<button class="btn" id="ready">Tell Claude this is ready</button>';
    }
  }
  window.PIPELINE_UI = { tab: function (id) { tab = id; render(); } };

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.id === 'add') { var id = 'i' + Date.now().toString(36); db.doc('items/' + id).set({ name: 'New item', done: false, order: Date.now() }); }
    else if (t.dataset.del) db.doc('items/' + t.dataset.del).delete();
    else if (t.id === 'ready') window.pipeline.emit('ready', { tab: tab });
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.done) db.doc('items/' + t.dataset.done).update({ done: t.checked });
    if (t.dataset.name) db.doc('items/' + t.dataset.name).update({ name: t.value });
  });
  db.doc('brief/meta').onSnapshot(function (s) { S.meta = s.data(); render(); });
  db.collection('items').onSnapshot(function (q) { var m = {}; q.docs.forEach(function (d) { m[d.id] = d.data(); }); S.items = m; render(); });
})();
