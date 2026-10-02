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
  function parseDate(s) {
    // "09/29/2026 03:52:21 PM" or "9/29/2026 3:52:21 PM"; unparseable sorts oldest
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)$/i.exec(s || '');
    if (!m) { return 0; }
    var h = parseInt(m[4], 10) % 12 + (/PM/i.test(m[7]) ? 12 : 0);
    return new Date(+m[3], +m[1] - 1, +m[2], h, +m[5], +m[6]).getTime();
  }
  var formatters ={ state: prettyState, modified: prettyDate, created: prettyDate };

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
      var kidsBtn = document.createElement('button');
      kidsBtn.textContent = 'Show child instances (1 level)';
      kidsBtn.style.marginTop = '6px';
      var kidsBox = document.createElement('div');
      kidsBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        loadChildren(it, kidsBox);
      });
      var sendBtn = document.createElement('button');
      sendBtn.textContent = 'Send to Epsilon3...';
      sendBtn.style.cssText = 'margin-top:6px;margin-left:8px';
      sendBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openSendDialog(it, obj);
      });
      cell.appendChild(kidsBtn);
      cell.appendChild(sendBtn);
      cell.appendChild(kidsBox);
    }).catch(function (e) { cell.textContent = e.message; });
    dr.addEventListener('click', function (ev) { ev.stopPropagation(); });
  }

  /* One level of child instances for a part the user clicked. Never recursive. */
  function loadChildren(it, box) {
    box.textContent = 'Loading children...';
    box.style.cssText = 'max-height:240px;overflow:auto;border:1px solid #ccd;margin-top:6px;padding:4px;background:#fff';
    var base = '/resources/v1/modeler/dseng/dseng:EngItem/' + encodeURIComponent(it.id) + '/dseng:EngInstance';
    // Try the Details mask (may expose the child reference); fall back to the plain call if rejected.
    get(base + '?$mask=dsmveng:EngInstanceMask.Details', true).catch(function () { return get(base, true); })
    .then(function (d) {
      var members = d.member || [];
      box.textContent = '';
      if (!members.length) { box.textContent = 'No child instances returned (see Raw response).'; return; }

      // Inferred quantity: count instances sharing a base name once the trailing <n> is stripped.
      var counts = {}, order = [];
      members.forEach(function (m) {
        var b = String(m.name || '').replace(/<\d+>$/, '');
        if (!(b in counts)) { counts[b] = 0; order.push(b); }
        counts[b]++;
      });
      var sum = document.createElement('table');
      var sh = sum.insertRow();
      ['Child (instance name without <n>)', 'Instances counted'].forEach(function (h) {
        var th = document.createElement('th'); th.textContent = h; sh.appendChild(th);
      });
      order.sort().forEach(function (b) {
        var r = sum.insertRow();
        r.insertCell().textContent = b;
        r.insertCell().textContent = counts[b];
      });
      box.appendChild(sum);

      var det = document.createElement('details');
      var sm = document.createElement('summary');
      sm.textContent = 'All ' + members.length + ' instances, every field returned';
      det.appendChild(sm);
      members.forEach(function (m, i) {
        var h = document.createElement('div');
        h.style.cssText = 'margin-top:6px;font-weight:bold';
        h.textContent = 'Child ' + (i + 1);
        det.appendChild(h);
        var t = document.createElement('table');
        flatten(m, '', []).forEach(function (r) {
          var row = t.insertRow();
          var a = row.insertCell(); a.textContent = r[0];
          row.insertCell().textContent = r[1];
        });
        det.appendChild(t);
      });
      box.appendChild(det);
    }).catch(function (e) { box.textContent = e.message; });
  }

  /* ---- Epsilon3 requests, via the dashboard proxy. The ONLY non-GET calls in this widget go
          to Epsilon3, and only from the Confirm button of the Send dialog. 3DX calls stay GET. ---- */
  var E3_BASE = 'https://api.epsilon3.io';
  var E3_PART_FORM_ID = '6c720982-92e6-411f-8ed7-9b0d6b1d8da3';       // "Part" form
  var E3_FIELD_3DX_NAME = '44b286d7-b36d-43eb-aa0f-0a812cb14957';      // custom Text field "3DX Name"
  var E3_FIELD_3DX_LINK = 'e9dd7977-28da-44bf-a819-5305716d3575';      // custom Text field "3DX Link"
  var E3_FIELD_MATURITY = '7c93a4ad-dfca-4f2b-b781-656f39d545df';      // custom List field "Maturity State"
  var E3_MATURITY_OPTIONS = ['Draft', 'In Work', 'Released', 'Frozen', 'Obsolete'];
  // Only 3DX states seen or standard are mapped; anything else is left for the operator to choose.
  var MATURITY_MAP = { IN_WORK: 'In Work', RELEASED: 'Released', FROZEN: 'Frozen', OBSOLETE: 'Obsolete', DRAFT: 'Draft' };
  function mapMaturity(state) {
    return MATURITY_MAP[String(state || '').toUpperCase().replace(/[\s-]+/g, '_')] || '';
  }

  function e3Request(method, path, body) {
    return new Promise(function (resolve, reject) {
      var key = widget.getValue('e3Key');
      var label = 'Epsilon3 ' + method + ' ' + path;
      if (!key) { reject(new Error('Save the Epsilon3 API key first (Epsilon3 section).')); return; }
      if (path.indexOf('/v1/') !== 0) { reject(new Error('Path must start with /v1/')); return; }
      var opts = {
        method: method,
        headers: { Accept: 'application/json', Authorization: 'Basic ' + btoa(key + ':') },
        type: 'json',
        onComplete: function (data) { showRaw(label, data); resolve(data); },
        onFailure: function (err, resp) {
          showRaw(label + ' FAILED', { error: String(err && err.message || err), response: resp });
          reject(new Error('Epsilon3 request failed: ' + (err && err.message || err) +
                           (resp ? ' ' + (typeof resp === 'string' ? resp : JSON.stringify(resp)) : '')));
        },
        onTimeout: function () { reject(new Error('Epsilon3 request timed out')); }
      };
      if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.data = JSON.stringify(body);
      }
      WAFData.proxifiedRequest(E3_BASE + path, opts);
    });
  }
  function e3Get(path) { return e3Request('GET', path); }

  /* ---- Send to Epsilon3: explicit click, read-only existence check, then a confirmation dialog
          showing the exact requests. Nothing is written until Confirm is clicked. ---- */
  function closeDialog() {
    var old = $('e3dlg');
    if (old) { old.parentNode.removeChild(old); }
  }

  function field(box, label, el) {
    var row = document.createElement('div');
    row.className = 'row';
    var l = document.createElement('label');
    l.textContent = label + ' ';
    row.appendChild(l);
    row.appendChild(el);
    box.appendChild(row);
    return el;
  }
  function input(value, readOnly, maxLen) {
    var el = document.createElement('input');
    el.type = 'text';
    el.value = value || '';
    el.style.width = '95%';
    if (readOnly) { el.readOnly = true; el.style.background = '#eee'; }
    if (maxLen) { el.maxLength = maxLen; }
    return el;
  }
  function select(options) {
    var el = document.createElement('select');
    options.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1]; el.appendChild(op);
    });
    return el;
  }

  // Read every Epsilon3 part (read-only), following pagination.next_page_token if present.
  function listE3Parts() {
    var parts = [], pages = 0;
    function page(token) {
      return e3Get('/v1/builds/parts' + (token ? '?page_token=' + encodeURIComponent(token) : '')).then(function (res) {
        parts = parts.concat(res.parts || res.data || []);
        var next = res.pagination && res.pagination.next_page_token;
        if (next && ++pages < 20) {
          return page(next).catch(function (e) { return { parts: parts, incomplete: e.message }; });
        }
        return { parts: parts, incomplete: next ? 'more than 20 pages' : '' };
      });
    }
    return page(null).then(function (r) { return r.parts ? r : { parts: parts, incomplete: '' }; });
  }

  function openSendDialog(it, d) {
    closeDialog();
    var ov = document.createElement('div');
    ov.id = 'e3dlg';
    ov.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45);overflow:auto;z-index:1000';
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;margin:10px auto;padding:10px;border-radius:4px;max-width:640px';
    ov.appendChild(box);
    document.body.appendChild(ov);
    var title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.textContent = 'Send to Epsilon3: ' + it.title + ' rev ' + it.revision;
    box.appendChild(title);
    var info = document.createElement('div');
    info.textContent = 'Checking Epsilon3 for an existing part (read-only)...';
    box.appendChild(info);
    var close = document.createElement('button');
    close.textContent = 'Cancel';
    close.addEventListener('click', closeDialog);

    // The list endpoint rejects a part_number filter (422), so read the list and match locally.
    listE3Parts().then(function (all) {
      var list = all.parts;
      var existing = list.filter(function (p) { return p.part_number === it.title; })[0] || null;
      var partialNote = (!existing && all.incomplete)
        ? ' Note: the Epsilon3 list could not be read completely (' + all.incomplete + '), so the part might already exist.'
        : '';
      info.textContent = existing
        ? 'This part number already exists in Epsilon3 (id ' + existing.id + ', revision ' + existing.revision +
          '). Only the revision and the 3DX fields will be updated.'
        : 'This part number was not found among ' + list.length + ' Epsilon3 parts. It will be created.' + partialNote;
      buildSendForm(box, it, d, existing, close);
    }).catch(function (e) {
      info.textContent = e.message;
      info.className = 'err';
      box.appendChild(close);
    });
  }

  function buildSendForm(box, it, d, existing, closeBtn) {
    var isNew = !existing;
    field(box, 'Part number (3DX Title):', input(it.title, true));
    field(box, 'Revision (3DX, sent as is):', input(it.revision, true));
    var name = field(box, 'Name:', input(d.title || it.title, !isNew, 128));
    var desc = field(box, 'Description:', input(d.description || '', !isNew, 512));
    var tracking = field(box, 'Tracking:', select([['', '-- choose --'], ['serial', 'serial'], ['lot', 'lot'], ['none', 'none']]));
    var proc = field(box, 'Procurement type:', select([['', '-- choose --'], ['buy', 'buy'], ['make', 'make'], ['make or buy', 'make or buy']]));
    var proj = field(box, 'Project id (optional):', input('', !isNew));
    if (!isNew) { tracking.disabled = true; proc.disabled = true; }
    var maturity = field(box, 'Maturity State (from 3DX "' + (it.state || '') + '"):',
      select([['', '-- choose --']].concat(E3_MATURITY_OPTIONS.map(function (o) { return [o, o]; }))));
    maturity.value = mapMaturity(it.state);
    field(box, '3DX Name:', input(it.name, true));
    var link = field(box, '3DX Link:', input(spaceUrl + '/resources/v1/modeler/dseng/dseng:EngItem/' + it.id, false, 1000));

    var prevLabel = document.createElement('div');
    prevLabel.style.cssText = 'font-weight:bold;margin-top:6px';
    prevLabel.textContent = 'Exactly what will be sent to Epsilon3:';
    var preview = document.createElement('pre');
    var msg = document.createElement('div');
    var confirm = document.createElement('button');
    confirm.textContent = 'Confirm and send';
    confirm.style.marginRight = '8px';
    box.appendChild(prevLabel);
    box.appendChild(preview);
    box.appendChild(confirm);
    box.appendChild(closeBtn);
    box.appendChild(msg);

    function plan() {
      var details = [
        { id: E3_FIELD_3DX_NAME, value: { recorded: it.name } },
        { id: E3_FIELD_3DX_LINK, value: { recorded: link.value.trim() } },
        { id: E3_FIELD_MATURITY, value: { recorded: maturity.value } }
      ];
      if (isNew) {
        var part = {
          part_number: it.title, name: name.value.trim(), revision: it.revision,
          tracking: tracking.value, procurement_type: proc.value, form_id: E3_PART_FORM_ID
        };
        if (desc.value.trim()) { part.description = desc.value.trim(); }
        if (proj.value.trim()) { part.project_id = proj.value.trim(); }
        return [
          { method: 'POST', path: '/v1/builds/parts', body: { parts: [part] } },
          { method: 'PATCH', path: '/v1/builds/parts/<id returned by the step above>', body: { details: details } }
        ];
      }
      var body = { details: details };
      if (existing.revision !== it.revision) { body.revision = it.revision; }
      return [{ method: 'PATCH', path: '/v1/builds/parts/' + existing.id, body: body }];
    }
    function valid() {
      if (!link.value.trim() || !maturity.value) { return false; }
      return !isNew || (name.value.trim() && tracking.value && proc.value);
    }
    function refresh() {
      preview.textContent = plan().map(function (s) {
        return s.method + ' ' + E3_BASE + s.path + '\n' + JSON.stringify(s.body, null, 2);
      }).join('\n\n');
      confirm.disabled = !valid();
      msg.textContent = valid() ? '' : 'Fill in name, tracking, procurement type, maturity and the link to enable sending.';
    }
    [name, desc, tracking, proc, proj, link, maturity].forEach(function (el) {
      el.addEventListener('input', refresh);
      el.addEventListener('change', refresh);
    });
    refresh();

    confirm.addEventListener('click', function () {
      confirm.disabled = true;
      var steps = plan(), newId = null;
      msg.className = '';
      msg.textContent = 'Sending...';
      steps.reduce(function (chain, s) {
        return chain.then(function () {
          var path = s.path.replace('<id returned by the step above>', newId || '');
          return e3Request(s.method, path, s.body).then(function (res) {
            if (s.method === 'POST') {
              var p = (res.parts && res.parts[0]) || res;
              newId = p.id;
              if (!newId) { throw new Error('Epsilon3 did not return a part id (see Raw response).'); }
            }
          });
        });
      }, Promise.resolve()).then(function () {
        msg.textContent = 'Done. The part was written to Epsilon3. The last response is in Raw response.';
        setStatus('Sent ' + it.title + ' rev ' + it.revision + ' to Epsilon3.');
      }).catch(function (e) {
        msg.className = 'err';
        msg.textContent = e.message + ' (Check Epsilon3: an earlier step may already have been applied.)';
      });
    });
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
      // Title + revision identifies one part revision. Several 3DX objects with the same pair are
      // edits of that revision, so show only the most recently modified one.
      var groups = {}, collapsed = [], notes = [];
      all.forEach(function (a) {
        var k = a.title + '\u0000' + a.revision;
        if (!groups[k]) { groups[k] = []; collapsed.push(k); }
        groups[k].push(a);
      });
      var hl = highlightIds || {};
      var shown = collapsed.map(function (k) {
        var g = groups[k];
        g.sort(function (x, y) { return parseDate(y.modified) - parseDate(x.modified); });
        var latest = g[0];
        if (g.length > 1) {
          notes.push(latest.title + ' ' + latest.revision + ': ' + g.length + ' edits, showing most recent');
          g.forEach(function (e) { if (hl[e.id]) { hl[latest.id] = true; } });
        }
        return latest;
      });
      if (notes.length) { msg += ' ' + notes.join('; ') + '.'; }
      setStatus(msg, !all.length);
      render(shown, hl);
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
    // Built here (not in index.html) so a cached copy of the page can't hide it.
    var probe = document.createElement('details');
    probe.innerHTML = '<summary>Epsilon3 probe (read-only GET)</summary>' +
      '<div class="row" style="margin-top:6px"><label for="e3key">API key:</label> ' +
      '<input type="password" id="e3key" autocomplete="off" style="width:200px" /> ' +
      '<button id="e3save" type="button">Save</button> <button id="e3clear" type="button">Clear</button> ' +
      '<span id="e3keystate"></span></div>' +
      '<div class="row"><input type="text" id="e3path" value="/v1/fields" style="width:260px" /> ' +
      '<button id="e3go" type="button">GET</button></div>' +
      '<div>The response appears in Raw response below.</div>';
    var rawDetails = $('raw').parentNode;
    rawDetails.parentNode.insertBefore(probe, rawDetails);

    if ($('e3save')) {
      var keyState = function () {
        $('e3keystate').textContent = widget.getValue('e3Key') ? 'API key is saved.' : 'No API key saved.';
      };
      keyState();
      $('e3save').addEventListener('click', function () {
        widget.setValue('e3Key', $('e3key').value.trim());
        $('e3key').value = '';
        keyState();
      });
      $('e3clear').addEventListener('click', function () {
        widget.setValue('e3Key', '');
        keyState();
      });
    }
    if ($('e3go') && $('e3path')) {
      $('e3go').addEventListener('click', function () {
        setStatus('Epsilon3 GET ' + $('e3path').value + '...');
        e3Get($('e3path').value.trim()).then(function () { setStatus('Epsilon3 response shown in Raw response.'); })
          .catch(function (e) { setStatus(e.message, true); });
      });
    }
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

