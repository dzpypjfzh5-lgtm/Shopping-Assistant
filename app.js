/* =========================================================
   Bloom — a calm running total for the shops
   Everything lives in localStorage on this device.
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'bloom.v1';
  var BACKUP_KEY = 'bloom.v1.backup';
  var SCHEMA = 1;

  /* ---------------- state ---------------- */

  function freshState() {
    return {
      version: SCHEMA,
      budget: 300,
      currency: '$',
      sort: 'price-desc',
      current: { id: uid(), startedAt: null, items: [] },
      trips: []
    };
  }

  var state = load();

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY) || localStorage.getItem(BACKUP_KEY); } catch (e) {}
    if (!raw) return freshState();
    try {
      var parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (e) {
      // Never throw away unreadable data silently — park it so it can be recovered.
      try { localStorage.setItem('bloom.corrupt.' + Date.now(), raw); } catch (e2) {}
      return freshState();
    }
  }

  function migrate(d) {
    var base = freshState();
    if (!d || typeof d !== 'object') return base;
    base.budget = num(d.budget) > 0 ? num(d.budget) : 300;
    base.currency = typeof d.currency === 'string' && d.currency ? d.currency.slice(0, 3) : '$';
    base.sort = ['price-desc', 'price-asc', 'added', 'name'].indexOf(d.sort) > -1 ? d.sort : 'price-desc';
    if (d.current && Array.isArray(d.current.items)) {
      base.current = {
        id: d.current.id || uid(),
        startedAt: d.current.startedAt || null,
        items: d.current.items.map(cleanItem).filter(Boolean)
      };
    }
    if (Array.isArray(d.trips)) {
      base.trips = d.trips.map(function (t) {
        if (!t || !Array.isArray(t.items)) return null;
        return {
          id: t.id || uid(),
          startedAt: t.startedAt || t.finishedAt || null,
          finishedAt: t.finishedAt || t.startedAt || null,
          budget: num(t.budget) || base.budget,
          items: t.items.map(cleanItem).filter(Boolean)
        };
      }).filter(Boolean);
    }
    return base;
  }

  function cleanItem(i) {
    if (!i) return null;
    var name = String(i.name == null ? '' : i.name).trim();
    var price = num(i.price);
    if (!name && !price) return null;
    return { id: i.id || uid(), name: name || 'Item', price: price, addedAt: i.addedAt || Date.now() };
  }

  var saveTimer = null;
  function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(writeThrough, 120);
    writeThrough(); // write immediately too; the timer only covers rapid bursts
  }

  function writeThrough() {
    var json;
    try { json = JSON.stringify(state); } catch (e) { return; }
    try {
      var prev = localStorage.getItem(KEY);
      if (prev) localStorage.setItem(BACKUP_KEY, prev);
      localStorage.setItem(KEY, json);
    } catch (e) {
      toast('Could not save — phone storage is full.', null, null, 6000);
    }
  }

  /* ---------------- helpers ---------------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  function money(n) {
    var neg = n < 0;
    var s = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? '-' : '') + state.currency + s;
  }

  function moneyShort(n) {
    var s = Math.abs(n) >= 100
      ? Math.round(Math.abs(n)).toLocaleString()
      : Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : '') + state.currency + s;
  }

  // "3.50*2" and "1.20+0.80" are normal shop maths, so allow them.
  function parsePrice(text) {
    if (text == null) return null;
    var t = String(text).replace(/[^\d+\-*/().\s]/g, '').trim();
    if (!t) return null;
    if (/^[\d.\s]+$/.test(t)) return round2(num(t.replace(/\s/g, '')));
    if (!/[+\-*/]/.test(t)) return null;
    try {
      /* eslint-disable no-new-func */
      var v = Function('"use strict";return (' + t + ')')();
      return isFinite(v) ? round2(v) : null;
    } catch (e) { return null; }
  }

  // "chicken, $10" / "chicken 10" typed into the name box alone.
  var SPLIT_RE = /^(.*?[^\d\s,$£€¥.])[\s,]*[$£€¥]?\s*(\d+(?:[.,]\d{1,2})?)\s*$/;

  function splitCombined(text) {
    var m = SPLIT_RE.exec(String(text || '').trim());
    if (!m) return null;
    var price = round2(num(m[2].replace(',', '.')));
    if (!price) return null;
    return { name: m[1].trim().replace(/[,\s]+$/, ''), price: price };
  }

  function titleish(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function dayLabel(ts) {
    if (!ts) return 'Undated';
    var d = new Date(ts);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var that = new Date(ts); that.setHours(0, 0, 0, 0);
    var days = Math.round((today - that) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    var opts = { weekday: 'short', day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
  }

  function agoLabel(ts) {
    if (!ts) return '';
    var days = Math.round((Date.now() - ts) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return days + ' days ago';
    if (days < 60) return Math.round(days / 7) + ' weeks ago';
    return Math.round(days / 30) + ' months ago';
  }

  function total(items) {
    return round2(items.reduce(function (s, i) { return s + i.price; }, 0));
  }

  function $(id) { return document.getElementById(id); }

  /* ---------------- elements ---------------- */

  var el = {
    sky: $('sky'), remaining: $('remaining'), remainingLabel: $('remainingLabel'),
    spent: $('spent'), budgetBtn: $('budgetBtn'), bar: $('bar'), barFill: $('barFill'),
    addForm: $('addForm'), name: $('nameInput'), price: $('priceInput'), hint: $('addHint'),
    list: $('itemList'), empty: $('emptyState'), count: $('itemCount'),
    finishWrap: $('finishWrap'), finishBtn: $('finishBtn'),
    lastPanel: $('lastShopPanel'), lastToggle: $('lastShopToggle'), lastBody: $('lastShopBody'), lastMeta: $('lastShopMeta'),
    tripList: $('tripList'), historyEmpty: $('historyEmpty'), statRow: $('statRow'),
    statLast: $('statLast'), statAvg: $('statAvg'), statTrips: $('statTrips'),
    budgetInput: $('budgetInput'), currencyInput: $('currencyInput'),
    storageMsg: $('storageMsg'), installMsg: $('installMsg'),
    minibar: $('minibar'), miniValue: $('miniValue'), miniLabel: $('miniLabel'), miniFill: $('miniFill'),
    editSheet: $('editSheet'), editForm: $('editForm'), editName: $('editName'),
    editPrice: $('editPrice'), editDelete: $('editDelete'),
    toast: $('toast'), toastMsg: $('toastMsg'), toastAction: $('toastAction')
  };

  /* ---------------- rendering ---------------- */

  function sortedItems() {
    var items = state.current.items.slice();
    switch (state.sort) {
      case 'price-asc': items.sort(function (a, b) { return a.price - b.price || b.addedAt - a.addedAt; }); break;
      case 'added': items.sort(function (a, b) { return b.addedAt - a.addedAt; }); break;
      case 'name': items.sort(function (a, b) { return a.name.localeCompare(b.name); }); break;
      default: items.sort(function (a, b) { return b.price - a.price || b.addedAt - a.addedAt; });
    }
    return items;
  }

  function renderCounter(bump) {
    var spent = total(state.current.items);
    var budget = state.budget;
    var left = round2(budget - spent);
    var p = budget > 0 ? Math.min(spent / budget, 1.35) : 0;

    el.remaining.textContent = money(Math.abs(left));
    if (left < 0) {
      el.remainingLabel.textContent = 'Over by';
      el.remaining.classList.add('is-over');
      el.bar.classList.add('is-over');
    } else {
      el.remainingLabel.textContent = 'Left to spend';
      el.remaining.classList.remove('is-over');
      el.bar.classList.remove('is-over');
    }
    el.spent.textContent = money(spent);
    el.budgetBtn.textContent = moneyShort(budget);
    el.barFill.style.width = Math.min(p, 1) * 100 + '%';
    el.bar.setAttribute('aria-valuenow', Math.round(Math.min(p, 1) * 100));

    // sky drifts from dawn to dusk as the budget is used
    var q = Math.min(Math.max(p, 0), 1);
    el.sky.style.setProperty('--p', q.toFixed(3));
    el.sky.style.setProperty('--dawn', clamp01(1 - q * 1.9).toFixed(3));
    el.sky.style.setProperty('--noon', clamp01(1 - Math.abs(q - 0.55) * 2.6).toFixed(3));
    el.sky.style.setProperty('--dusk', clamp01((q - 0.55) * 2.4).toFixed(3));

    el.miniValue.textContent = money(Math.abs(left));
    el.miniLabel.textContent = left < 0 ? 'Over by' : 'Left';
    el.miniValue.classList.toggle('is-over', left < 0);
    el.minibar.classList.toggle('is-over', left < 0);
    el.miniFill.style.width = Math.min(p, 1) * 100 + '%';

    if (bump) {
      el.remaining.classList.remove('pop');
      void el.remaining.offsetWidth;
      el.remaining.classList.add('pop');
    }
  }

  function clamp01(n) { return Math.min(1, Math.max(0, n)); }

  function itemNode(item, rank) {
    var li = document.createElement('li');
    li.className = 'item';
    li.dataset.id = item.id;

    var rankWrap = document.createElement('span');
    rankWrap.className = 'item__rank';
    rankWrap.setAttribute('aria-hidden', 'true');
    rankWrap.innerHTML = '<svg viewBox="0 0 64 64"><use href="#' + (rank % 2 ? 'sprig' : 'flower') + '"/></svg>';

    var body = document.createElement('button');
    body.type = 'button';
    body.className = 'item__body';
    body.setAttribute('aria-label', 'Edit ' + item.name + ', ' + money(item.price));
    var name = document.createElement('span');
    name.className = 'item__name';
    name.textContent = item.name;
    var price = document.createElement('span');
    price.className = 'item__price';
    price.textContent = money(item.price);
    body.appendChild(name);
    body.appendChild(price);
    body.addEventListener('click', function () { openEdit(item.id); });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'item__del';
    del.setAttribute('aria-label', 'Remove ' + item.name);
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    del.addEventListener('click', function (e) { e.stopPropagation(); removeItem(item.id); });

    li.appendChild(rankWrap);
    li.appendChild(body);
    li.appendChild(del);
    return li;
  }

  var justAddedId = null;

  function renderList() {
    var items = sortedItems();

    // FLIP: remember where every row sits before the list is rebuilt
    var before = {};
    Array.prototype.forEach.call(el.list.children, function (li) {
      before[li.dataset.id] = li.getBoundingClientRect().top;
    });

    el.list.innerHTML = '';
    items.forEach(function (item, i) {
      var li = itemNode(item, i);
      if (item.id === justAddedId) li.classList.add('is-new');
      el.list.appendChild(li);
    });

    if (!prefersReducedMotion()) {
      Array.prototype.forEach.call(el.list.children, function (li) {
        var was = before[li.dataset.id];
        if (was == null) return;
        var delta = was - li.getBoundingClientRect().top;
        if (!delta) return;
        li.style.transform = 'translateY(' + delta + 'px)';
        li.style.transition = 'none';
        requestAnimationFrame(function () {
          li.style.transition = 'transform .45s cubic-bezier(.22,.9,.28,1)';
          li.style.transform = '';
        });
      });
    }
    justAddedId = null;

    var n = items.length;
    el.empty.hidden = n > 0;
    el.count.textContent = n ? n + (n === 1 ? ' thing' : ' things') : '';
    el.finishWrap.hidden = n === 0;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function renderLastShop() {
    var last = state.trips[0];
    if (!last) { el.lastPanel.hidden = true; return; }
    el.lastPanel.hidden = false;
    el.lastMeta.textContent = '· ' + money(total(last.items)) + ' · ' + agoLabel(last.finishedAt);

    el.lastBody.innerHTML = '';
    last.items.slice().sort(function (a, b) { return b.price - a.price; }).forEach(function (item) {
      el.lastBody.appendChild(reuseRow(item));
    });
  }

  function reuseRow(item) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'reuse';
    b.setAttribute('aria-label', 'Put ' + item.name + ' in the add box at ' + money(item.price));
    b.innerHTML =
      '<span class="reuse__plus" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></span>' +
      '<span class="reuse__name"></span><span class="reuse__price"></span>';
    b.querySelector('.reuse__name').textContent = item.name;
    b.querySelector('.reuse__price').textContent = money(item.price);
    b.addEventListener('click', function () {
      goto('shop');
      el.name.value = item.name;
      el.price.value = item.price.toFixed(2);
      el.price.focus();
      el.price.select();
      showHint('Ready — change the price if it has moved.');
    });
    return b;
  }

  function renderHistory() {
    var trips = state.trips;
    el.historyEmpty.hidden = trips.length > 0;
    el.statRow.hidden = trips.length === 0;
    el.tripList.innerHTML = '';

    if (trips.length) {
      var recent = trips.slice(0, 6);
      var avg = recent.reduce(function (s, t) { return s + total(t.items); }, 0) / recent.length;
      el.statLast.textContent = moneyShort(total(trips[0].items));
      el.statAvg.textContent = moneyShort(round2(avg));
      el.statTrips.textContent = String(trips.length);
    }

    trips.forEach(function (trip, idx) {
      var t = total(trip.items);
      var wrap = document.createElement('article');
      wrap.className = 'trip';

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'trip__head';
      head.setAttribute('aria-expanded', idx === 0 ? 'true' : 'false');
      head.innerHTML =
        '<svg class="trip__flower" viewBox="0 0 64 64" aria-hidden="true"><use href="#' + (idx % 2 ? 'sprig' : 'flower') + '"/></svg>' +
        '<span class="trip__meta"><span class="trip__date"></span><span class="trip__sub"></span></span>' +
        '<span class="trip__total"></span>';
      head.querySelector('.trip__date').textContent = dayLabel(trip.finishedAt);
      head.querySelector('.trip__sub').textContent =
        trip.items.length + (trip.items.length === 1 ? ' thing' : ' things') +
        ' · budget ' + moneyShort(trip.budget);
      var tot = head.querySelector('.trip__total');
      tot.textContent = moneyShort(t);
      if (t > trip.budget) tot.classList.add('is-over');

      var body = document.createElement('div');
      body.className = 'trip__body';
      body.hidden = idx !== 0;
      trip.items.slice().sort(function (a, b) { return b.price - a.price; }).forEach(function (item) {
        body.appendChild(reuseRow(item));
      });

      head.addEventListener('click', function () {
        body.hidden = !body.hidden;
        head.setAttribute('aria-expanded', String(!body.hidden));
      });

      wrap.appendChild(head);
      wrap.appendChild(body);
      el.tripList.appendChild(wrap);
    });
  }

  function renderSettings() {
    el.budgetInput.value = String(state.budget);
    el.currencyInput.value = state.currency;
    $('curSign').textContent = state.currency;
    $('curSign2').textContent = state.currency;
    $('curSign3').textContent = state.currency;
  }

  function renderAll(bump) {
    renderCounter(bump);
    renderList();
    renderLastShop();
    renderHistory();
    renderSettings();
  }

  /* ---------------- actions ---------------- */

  function addItem(name, price) {
    var item = { id: uid(), name: titleish(name.trim()), price: round2(price), addedAt: Date.now() };
    if (!state.current.startedAt) state.current.startedAt = Date.now();
    state.current.items.push(item);
    justAddedId = item.id;
    save();
    renderCounter(true);
    renderList();
    return item;
  }

  var undoBuffer = null;

  function removeItem(id) {
    var idx = -1;
    state.current.items.forEach(function (it, i) { if (it.id === id) idx = i; });
    if (idx < 0) return;
    var removed = state.current.items.splice(idx, 1)[0];
    undoBuffer = { item: removed, index: idx };
    save();
    renderCounter(true);
    renderList();
    toast(removed.name + ' removed', 'Undo', function () {
      if (!undoBuffer) return;
      state.current.items.splice(undoBuffer.index, 0, undoBuffer.item);
      undoBuffer = null;
      save();
      renderCounter(true);
      renderList();
    });
  }

  function finishTrip() {
    if (!state.current.items.length) return;
    var spent = total(state.current.items);
    state.trips.unshift({
      id: state.current.id,
      startedAt: state.current.startedAt || Date.now(),
      finishedAt: Date.now(),
      budget: state.budget,
      items: state.current.items.slice()
    });
    state.current = { id: uid(), startedAt: null, items: [] };
    save();
    renderAll(true);
    toast('Shop saved · ' + money(spent), 'See it', function () { goto('history'); });
  }

  /* ---------------- edit sheet ---------------- */

  var editingId = null;

  function openEdit(id) {
    var item = null;
    state.current.items.forEach(function (it) { if (it.id === id) item = it; });
    if (!item) return;
    editingId = id;
    el.editName.value = item.name;
    el.editPrice.value = item.price.toFixed(2);
    el.editSheet.hidden = false;
    setTimeout(function () { el.editPrice.focus(); el.editPrice.select(); }, 60);
  }

  function closeEdit() {
    el.editSheet.hidden = true;
    editingId = null;
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;

  function toast(msg, actionLabel, onAction, ms) {
    el.toastMsg.textContent = msg;
    if (actionLabel) {
      el.toastAction.textContent = actionLabel;
      el.toastAction.hidden = false;
      el.toastAction.onclick = function () { hideToast(); if (onAction) onAction(); };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }
    el.toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms || 4200);
  }

  function hideToast() {
    el.toast.hidden = true;
    if (toastTimer) clearTimeout(toastTimer);
  }

  /* ---------------- hints (last price paid) ---------------- */

  function lastPaidFor(name) {
    var q = name.trim().toLowerCase();
    if (q.length < 2) return null;
    for (var t = 0; t < state.trips.length; t++) {
      var trip = state.trips[t];
      for (var i = 0; i < trip.items.length; i++) {
        var n = trip.items[i].name.toLowerCase();
        if (n === q || n.indexOf(q) === 0) {
          return { item: trip.items[i], when: trip.finishedAt };
        }
      }
    }
    return null;
  }

  function showHint(text, actionLabel, onAction) {
    el.hint.innerHTML = '';
    el.hint.appendChild(document.createTextNode(text));
    if (actionLabel) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = actionLabel;
      b.addEventListener('click', onAction);
      el.hint.appendChild(b);
    }
    el.hint.hidden = false;
  }

  function refreshHint() {
    if (el.price.value.trim()) { el.hint.hidden = true; return; }
    var found = lastPaidFor(el.name.value);
    if (!found) { el.hint.hidden = true; return; }
    var p = found.item.price;
    showHint(found.item.name + ' was ' + money(p) + ' ' + agoLabel(found.when) + '.', 'Use it', function () {
      el.price.value = p.toFixed(2);
      el.hint.hidden = true;
      el.price.focus();
    });
  }

  /* ---------------- export / import ---------------- */

  function csv() {
    var rows = [['Shop date', 'Item', 'Price', 'Budget', 'Shop total']];
    function push(dateLabel, items, budget) {
      var t = total(items);
      items.slice().sort(function (a, b) { return b.price - a.price; }).forEach(function (it) {
        rows.push([dateLabel, it.name, it.price.toFixed(2), budget.toFixed(2), t.toFixed(2)]);
      });
    }
    if (state.current.items.length) push('In progress', state.current.items, state.budget);
    state.trips.forEach(function (t) {
      push(new Date(t.finishedAt || Date.now()).toISOString().slice(0, 10), t.items, t.budget);
    });
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\r\n');
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function download(text, filename, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function shareFile(text, filename, type) {
    var file;
    try { file = new File([text], filename, { type: type }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: filename }).catch(function () {});
      return;
    }
    if (navigator.share) {
      navigator.share({ title: filename, text: text }).catch(function () { download(text, filename, type); });
      return;
    }
    download(text, filename, type);
  }

  function importJson(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) {
      toast('That file is not a Bloom backup.');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || (!parsed.trips && !parsed.current)) {
      toast('That file is not a Bloom backup.');
      return;
    }
    var incoming = migrate(parsed);
    var n = incoming.trips.length;
    if (!window.confirm('Restore this backup?\n\n' + n + ' saved shop' + (n === 1 ? '' : 's') +
      ' and ' + incoming.current.items.length + ' thing(s) in the basket.\n\nWhat is on this phone now will be replaced.')) return;
    state = incoming;
    save();
    renderAll(true);
    goto('shop');
    toast('Backup restored');
  }

  /* ---------------- views ---------------- */

  function goto(name) {
    ['shop', 'history', 'data'].forEach(function (v) {
      $('view-' + v).hidden = v !== name;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.dataset.goto === name;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
    });
    window.scrollTo(0, 0);
    counterOffScreen = false;
    syncMinibar();
  }

  /* ---------------- sticky mini counter ---------------- */

  var counterOffScreen = false;

  function syncMinibar() {
    var onShop = !$('view-shop').hidden;
    el.minibar.hidden = !(onShop && counterOffScreen);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      counterOffScreen = !entries[0].isIntersecting;
      syncMinibar();
    }, { threshold: 0, rootMargin: '-4px 0px 0px 0px' }).observe(el.bar);
  }

  el.minibar.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });

  /* ---------------- storage health ---------------- */

  function checkStorage() {
    var standalone = (window.navigator.standalone === true) ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    el.installMsg.hidden = standalone;

    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (already) {
        if (already) {
          el.storageMsg.textContent = 'Saved on this device with persistent storage. iOS will not clear it on its own.';
          return;
        }
        if (navigator.storage.persist) {
          return navigator.storage.persist().then(function (granted) {
            el.storageMsg.textContent = granted
              ? 'Saved on this device with persistent storage. iOS will not clear it on its own.'
              : (standalone
                ? 'Saved on this device. Download a backup now and then, just in case.'
                : 'Saved in Safari. If you do not open this for a couple of weeks, iOS can clear it — adding it to your Home Screen stops that.');
          });
        }
      }).catch(function () {
        el.storageMsg.textContent = 'Saved on this device. Keep a backup now and then.';
      });
    } else {
      el.storageMsg.textContent = 'Saved on this device. Keep a backup now and then.';
    }
  }

  /* ---------------- wiring ---------------- */

  el.addForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var rawName = el.name.value.trim();
    var price = parsePrice(el.price.value);

    if (price == null) {
      var combo = splitCombined(rawName);
      if (combo) { rawName = combo.name; price = combo.price; }
    }
    if (!rawName) { el.name.focus(); return; }
    if (price == null) {
      showHint('Add a price for ' + rawName + '.');
      el.price.focus();
      return;
    }

    addItem(rawName, price);
    el.name.value = '';
    el.price.value = '';
    el.hint.hidden = true;
    el.name.focus(); // keep the keyboard up for the next thing
  });

  el.name.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var combo = splitCombined(el.name.value);
      if (combo && !el.price.value.trim()) return; // let submit handle "chicken, $10"
      e.preventDefault();
      el.price.focus();
    }
  });

  el.name.addEventListener('input', refreshHint);
  el.price.addEventListener('input', function () { if (el.price.value.trim()) el.hint.hidden = true; });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (chip) {
    chip.addEventListener('click', function () {
      state.sort = chip.dataset.sort;
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
        c.classList.toggle('is-on', c === chip);
      });
      save();
      renderList();
    });
  });

  el.finishBtn.addEventListener('click', function () {
    var spent = total(state.current.items);
    if (!window.confirm('Finish this shop at ' + money(spent) + '?\n\nIt moves to History and the basket starts empty.')) return;
    finishTrip();
  });

  el.lastToggle.addEventListener('click', function () {
    var open = el.lastBody.hidden;
    el.lastBody.hidden = !open;
    el.lastToggle.setAttribute('aria-expanded', String(open));
  });

  el.budgetBtn.addEventListener('click', function () {
    goto('data');
    setTimeout(function () { el.budgetInput.focus(); el.budgetInput.select(); }, 80);
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.addEventListener('click', function () { goto(t.dataset.goto); });
  });

  el.budgetInput.addEventListener('change', function () {
    var v = parsePrice(el.budgetInput.value);
    if (v == null || v <= 0) { el.budgetInput.value = String(state.budget); return; }
    state.budget = round2(v);
    save();
    renderCounter(true);
    renderSettings();
  });

  el.currencyInput.addEventListener('change', function () {
    var v = el.currencyInput.value.trim().slice(0, 3) || '$';
    state.currency = v;
    save();
    renderAll(false);
  });

  el.editForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editingId) return closeEdit();
    var price = parsePrice(el.editPrice.value);
    var name = el.editName.value.trim();
    state.current.items.forEach(function (it) {
      if (it.id !== editingId) return;
      if (name) it.name = titleish(name);
      if (price != null) it.price = round2(price);
    });
    closeEdit();
    save();
    renderCounter(true);
    renderList();
  });

  el.editDelete.addEventListener('click', function () {
    var id = editingId;
    closeEdit();
    if (id) removeItem(id);
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (n) {
    n.addEventListener('click', closeEdit);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.editSheet.hidden) closeEdit();
  });

  $('downloadCsvBtn').addEventListener('click', function () {
    download(csv(), 'bloom-shopping-' + stamp() + '.csv', 'text/csv;charset=utf-8');
  });
  $('shareCsvBtn').addEventListener('click', function () {
    shareFile(csv(), 'bloom-shopping-' + stamp() + '.csv', 'text/csv');
  });
  $('downloadJsonBtn').addEventListener('click', function () {
    download(JSON.stringify(state, null, 2), 'bloom-backup-' + stamp() + '.json', 'application/json');
  });
  $('shareJsonBtn').addEventListener('click', function () {
    shareFile(JSON.stringify(state, null, 2), 'bloom-backup-' + stamp() + '.json', 'application/json');
  });

  $('importFile').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { importJson(String(reader.result)); };
    reader.onerror = function () { toast('Could not read that file.'); };
    reader.readAsText(f);
    e.target.value = '';
  });

  $('wipeBtn').addEventListener('click', function () {
    if (!window.confirm('Erase the basket and all ' + state.trips.length + ' saved shop(s) on this device?\n\nThis cannot be undone. Download a backup first if you are not sure.')) return;
    state = freshState();
    try { localStorage.removeItem(BACKUP_KEY); } catch (e) {}
    save();
    renderAll(true);
    goto('shop');
    toast('All clear');
  });

  window.addEventListener('pagehide', writeThrough);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') writeThrough();
  });

  /* ---------------- go ---------------- */

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.classList.toggle('is-on', c.dataset.sort === state.sort);
  });
  renderAll(false);
  checkStorage();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
