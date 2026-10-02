/* Part History widget, version 1. READ-ONLY: every 3DSpace call below is a GET. */
/* index.html calls executeInitWidget once the dashboard's `widget` object exists;
   `require` is not available before that. */
function executeInitWidget(w) {
require([
  'DS/WAFData/WAFData',
  'DS/i3DXCompassServices/i3DXCompassServices',
  'DS/DataDragAndDrop/DataDragAndDrop'
], function (WAFData, i3DXCompassServices, DataDragAndDrop) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var spaceUrl = null;
  var droppedId = null;

  function setStatus(msg, isErr) {
    var s = $('status');
    s.textContent = msg || '';
    s.className = isErr ? 'err' : '';
  }

  function showRaw(label, obj) {
    var text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    $('raw').textContent = label + '\n' + text;
  }

  /* ---- 3DSpace GET helper (the only way this widget talks to 3DX) ---- */
  function get(path, withContext) {
    return new Promise(function (resolve, reject) {
      var headers = { Accept: 'application/json' };
      var ctx = $('ctx').value;
      if (withContext && ctx) { headers.SecurityContext = ctx; }
      var url = spaceUrl + path;
      WAFData.authenticatedRequest(url, {
        method: 'GET',
        headers: headers,
        type: 'json',
        onComplete: function (data) { showRaw('GET ' + path, data); resolve(data); },
        onFailure: function (err, resp) {
          showRaw('GET ' + path + ' FAILED', { error: String(err && err.message || err), response: resp });
          reject(new Error('Request failed: ' + (err && err.message || err)));
        },
        onTimeout: function () { showRaw('GET ' + path, 'TIMEOUT'); reject(new Error('Request timed out')); }
      });
    });
  }

  /* ---- Security context list ---- */
  function loadContexts() {
    return get('/resources/modeler/pno/person?current=true&select=collabspaces', false).then(function (data) {
      var list = [];
      (data.collabspaces || []).forEach(function (cs) {
        (cs.couples || []).forEach(function (c) {
          var role = c.role && c.role.name, org = c.organization && c.organization.name;
          if (role && org && cs.name) { list.push('ctx::' + role + '.' + org + '.' + cs.name); }
        });
      });
      var sel = $('ctx');
      sel.innerHTML = '';
      list.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v; o.textContent = v; sel.appendChild(o);
      });
      var saved = widget.getValue('secCtx');
      if (saved && list.indexOf(saved) >= 0) { sel.value = saved; }
      else {
        var pref = list.filter(function (v) { return v.indexOf('Venturi North America Designs') >= 0; })[0];
        if (pref) { sel.value = pref; }
      }
      if (!list.length) { sel.innerHTML = '<option value="">(none found, see Raw response)</option>'; }
      widget.setValue('secCtx', sel.value);
    });
  }

  /* ---- Revision helpers ---- */
  function revKey(rev) {
    var m = /^([A-Za-z]*)(?:\.(\d+))?/.exec(rev || '') || [];
    var letters = (m[1] || '').toUpperCase();
    return { len: letters.length, letters: letters, iter: parseInt(m[2] || '0', 10) };
  }
  function revCompare(a, b) {
    var x = revKey(a.revision), y = revKey(b.revision);
    if (x.len !== y.len) { return x.len - y.len; }
    if (x.letters !== y.letters) { return x.letters < y.letters ? -1 : 1; }
    return x.iter - y.iter;
  }

  /* ---- Table ---- */
  function render(items, highlightId) {
    var box = $('results');
    box.innerHTML = '';
    if (!items.length) { return; }
    var cols = [['Revision', 'revision'], ['Maturity', 'state'], ['Modified', 'modified'],
                ['Created', 'created'], ['Owner', 'owner'], ['3DX Name', 'name']];
    var table = document.createElement('table');
    var head = table.insertRow();
    cols.forEach(function (c) {
      var th = document.createElement('th'); th.textContent = c[0]; head.appendChild(th);
    });
    items.forEach(function (it) {
      var tr = table.insertRow();
      if (highlightId && (it.id === highlightId)) { tr.className = 'dropped'; }
      cols.forEach(function (c) {
        var td = tr.insertCell();
        td.textContent = it[c[1]] == null ? '' : it[c[1]];
      });
    });
    box.appendChild(table);
  }

  /* ---- Lookup by exact Title ---- */
  function lookupTitle(title, highlightId) {
    title = (title || '').trim();
    if (!title) { setStatus('Enter a part Title first.', true); return Promise.resolve(); }
    if (!$('ctx').value) { setStatus('No security context selected.', true); return Promise.resolve(); }
    setStatus('Looking up "' + title + '"...');
    $('results').innerHTML = '';
    var path = '/resources/v1/modeler/dseng/dseng:EngItem/search?$searchStr=' +
               encodeURIComponent(title) + '&$top=50';
    return get(path, true).then(function (data) {
      var all = data.member || [];
      var hits = all.filter(function (m) { return m.title === title; });
      hits.sort(revCompare);
      if (!hits.length) {
        setStatus('No part with exact Title "' + title + '" (' + all.length + ' loose matches; see Raw response).', true);
        return;
      }
      setStatus(hits.length + ' revision(s) of ' + title + '.');
      render(hits, highlightId);
    }).catch(function (e) { setStatus(e.message, true); });
  }

  /* ---- Drag and drop: read dropped part by id, then list its Title's revisions ---- */
  function onDrop(data) {
    var payload;
    try { payload = typeof data === 'string' ? JSON.parse(data) : data; }
    catch (e) { setStatus('Dropped content was not JSON.', true); return; }
    var item = payload && payload.data && payload.data.items && payload.data.items[0];
    if (!item || !item.objectId) { showRaw('DROP payload', payload); setStatus('Could not find an objectId in the dropped item (see Raw response).', true); return; }
    droppedId = item.objectId;
    setStatus('Reading dropped part...');
    get('/resources/v1/modeler/dseng/dseng:EngItem/' + encodeURIComponent(droppedId) +
        '?$mask=dsmveng:EngItemMask.Details', true).then(function (d) {
      var obj = (d.member && d.member[0]) || d;
      if (!obj.title) { setStatus('Dropped item has no Title (is it a Physical Product?).', true); return; }
      $('title').value = obj.title;
      return lookupTitle(obj.title, obj.id || droppedId);
    }).catch(function (e) { setStatus(e.message, true); });
  }

  /* ---- Start ---- */
  function init() {
    $('lookup').addEventListener('click', function () { droppedId = null; lookupTitle($('title').value); });
    $('title').addEventListener('keydown', function (e) { if (e.keyCode === 13) { droppedId = null; lookupTitle($('title').value); } });
    $('ctx').addEventListener('change', function () { widget.setValue('secCtx', $('ctx').value); });

    var drop = $('drop');
    DataDragAndDrop.droppable(drop, {
      enter: function () { drop.className = 'over'; },
      leave: function () { drop.className = ''; },
      drop: function (data) { drop.className = ''; onDrop(data); }
    });

    setStatus('Connecting to 3DSpace...');
    i3DXCompassServices.getServiceUrl({
      serviceName: '3DSpace',
      platformId: widget.getValue('x3dPlatformId'),
      onComplete: function (url) {
        spaceUrl = (typeof url === 'string' ? url : (url && url[0] && url[0].url)) || '';
        spaceUrl = spaceUrl.replace(/\/+$/, '');
        if (!spaceUrl) { setStatus('Could not resolve the 3DSpace URL.', true); return; }
        loadContexts().then(function () { setStatus('Ready. Type or drop a part.'); })
          .catch(function (e) { setStatus('Could not load security contexts: ' + e.message, true); });
      },
      onFailure: function () { setStatus('Could not resolve the 3DSpace URL.', true); }
    });
  }

  var started = false;
  function start() {
    if (started) { return; }
    started = true;
    try { init(); } catch (e) { setStatus('Startup error: ' + e.message, true); showRaw('Startup error', String(e.stack || e)); }
  }
  // The require callback is async, so onLoad may already have fired; start now and on onLoad.
  start();
  widget.addEvent('onLoad', start);
}, function (err) {
  var s = document.getElementById('status');
  s.className = 'err';
  s.textContent = 'Module load failed: ' + (err && err.message || err);
  document.getElementById('raw').textContent = String(err && err.requireModules || err);
});
}
