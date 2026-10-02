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

  /* ---- Display formatting (display only; underlying values are untouched) ---- */
  function prettyState(s) {
    if (!s) { return ''; }
    return String(s).replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
  }
  function prettyDate(s) {
    // "09/29/2026 03:52:21 PM" -> "09/29/2026 3:52 PM"
    var m = /^(\d{2}\/\d{2}\/\d{4})\s+0?(\d{1,2}):(\d{2}):\d{2}\s*([AP]M)$/i.exec(s || '');
    return m ? m[1] + ' ' + m[2] + ':' + m[3] + ' ' + m[4].toUpperCase() : (s || '');
  }
  var formatters = { state: prettyState, modified: prettyDate, created: prettyDate };

  /* ---- Table (one combined table; click a row to load its detail) ---- */
  var MAX_PARTS = 10;
  var cols = [['Title', 'title'], ['Revision', 'revision'], ['Maturity', 'state'], ['Modified', 'modified'],
              ['Created', 'created'], ['Owner', 'owner'], ['3DX Name', 'name']];

  function render(items, highlightIds) {
    var box = $('results');
    box.innerHTML = '';
    if (!items.length) { return; }
    var table = document.createElement('table');
    var head = table.insertRow();
    cols.forEach(function (c) {
      var th = document.createElement('th'); th.textContent = c[0]; head.appendChild(th);
    });
    items.forEach(function (it) {
      var tr = table.insertRow();
      tr.className = 'clickable' + (highlightIds[it.id] ? ' dropped' : '');
      cols.forEach(function (c) {
        var td = tr.insertCell();
        var v = it[c[1]] == null ? '' : it[c[1]];
        td.textContent = formatters[c[1]] ? formatters[c[1]](v) : v;
      });
      tr.addEventListener('click', function () { toggleDetail(tr, it); });
    });
    box.appendChild(table);
  }

  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach(function (k) {
      var v = obj[k], name = prefix ? prefix + '.' + k : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) { flatten(v, name, out); }
      else { out.push([name, Array.isArray(v) ? JSON.stringify(v) : String(v)]); }
    });
    return out;
  }

  function toggleDetail(tr, it) {
    var next = tr.nextSibling;
    if (next && next.className === 'detail') { next.parentNode.removeChild(next); return; }
    var dr = tr.parentNode.insertRow(tr.rowIndex + 1);
    dr.className = 'detail';
    var cell = dr.insertCell();
    cell.colSpan = cols.length;
    cell.textContent = 'Loading detail...';
    get('/resources/v1/modeler/dseng/dseng:EngItem/' + encodeURIComponent(it.id) +
        '?$mask=dsmveng:EngItemMask.Details', true).then(function (d) {
      var obj = (d.member && d.member[0]) || d;
      var rows = flatten(obj, '', []);
      cell.textContent = '';
      var t = document.createElement('table');
      rows.forEach(function (r) {
        var row = t.insertRow();
        var a = row.insertCell(); a.textContent = r[0]; a.style.fontWeight = 'bold';
        row.insertCell().textContent = r[1];
      });
      cell.appendChild(t);
    }).catch(function (e) { cell.textContent = e.message; });
  }

  /* ---- Lookup by exact Title(s), one search per Title, only for what the user entered ---- */
  function searchTitle(title) {
    var path = '/resources/v1/modeler/dseng/dseng:EngItem/search?$searchStr=' +
               encodeURIComponent(title) + '&$top=50';
    return get(path, true).then(function (data) {
      return (data.member || []).filter(function (m) { return m.title === title; });
    });
  }

  function lookupTitles(titles, highlightIds) {
    var seen = {};
    titles = titles.map(function (t) { return (t || '').trim(); })
                   .filter(function (t) { if (!t || seen[t]) { return false; } seen[t] = true; return true; });
    if (!titles.length) { setStatus('Enter a part Title first.', true); return Promise.resolve(); }
    if (titles.length > MAX_PARTS) { titles = titles.slice(0, MAX_PARTS); }
    if (!$('ctx').value) { setStatus('No security context selected.', true); return Promise.resolve(); }
    setStatus('Looking up ' + titles.join(', ') + '...');
    $('results').innerHTML = '';
    var all = [], missing = [];
    return titles.reduce(function (chain, t) {
      return chain.then(function () {
        return searchTitle(t).then(function (hits) {
          if (!hits.length) { missing.push(t); }
          all = all.concat(hits);
        });
      });
    }, Promise.resolve()).then(function () {
      all.sort(function (a, b) {
        return a.title === b.title ? revCompare(a, b) : (a.title < b.title ? -1 : 1);
      });
      var msg = all.length + ' revision(s) across ' + (titles.length - missing.length) + ' part(s).';
      if (missing.length) { msg += ' No exact Title match for: ' + missing.join(', ') + '.'; }
      setStatus(msg, !all.length);
      render(all, highlightIds || {});
    }).catch(function (e) { setStatus(e.message, true); });
  }

  function lookupFromBox() {
    lookupTitles($('title').value.split(/[,;\n]/));
  }

  /* ---- Drag and drop: read every dropped part by id, then list its Title's revisions ---- */
  function onDrop(data) {
    var payload;
    try { payload = typeof data === 'string' ? JSON.parse(data) : data; }
    catch (e) { setStatus('Dropped content was not JSON.', true); return; }
    var items = (payload && payload.data && payload.data.items || []).filter(function (i) { return i && i.objectId; });
    if (!items.length) { showRaw('DROP payload', payload); setStatus('Could not find an objectId in the dropped item (see Raw response).', true); return; }
    var skipped = items.length > MAX_PARTS;
    items = items.slice(0, MAX_PARTS);
    setStatus('Reading ' + items.length + ' dropped part(s)' + (skipped ? ' (limit ' + MAX_PARTS + ')' : '') + '...');
    var titles = [], highlight = {};
    items.reduce(function (chain, item) {
      return chain.then(function () {
        return get('/resources/v1/modeler/dseng/dseng:EngItem/' + encodeURIComponent(item.objectId) +
                   '?$mask=dsmveng:EngItemMask.Details', true).then(function (d) {
          var obj = (d.member && d.member[0]) || d;
          if (obj.title) { titles.push(obj.title); highlight[obj.id || item.objectId] = true; }
        });
      });
    }, Promise.resolve()).then(function () {
      if (!titles.length) { setStatus('Dropped item(s) have no Title (are they Physical Products?).', true); return; }
      $('title').value = titles.join(', ');
      return lookupTitles(titles, highlight);
    }).catch(function (e) { setStatus(e.message, true); });
  }

  /* ---- Start ---- */
  function init() {
    $('lookup').addEventListener('click', lookupFromBox);
    $('title').addEventListener('keydown', function (e) { if (e.keyCode === 13) { lookupFromBox(); } });
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

