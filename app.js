/* =========================================================
   Bloom — a calm running total for the shops
   Everything lives in localStorage on this device.
   ========================================================= */
(function () {
  'use strict';

  var KEY = 'bloom.v1';
  var BACKUP_KEY = 'bloom.v1.backup';
  var SCHEMA = 2;

  /* ---------------- state ---------------- */

  function freshState() {
    return {
      version: SCHEMA,
      budget: 300,
      currency: '$',
      sort: 'price-desc',
      installDismissedAt: 0,
      listOpen: false,
      current: { id: uid(), startedAt: null, items: [] },
      list: [],
      draft: { name: '', price: '' },
      trips: [],
      savedAt: 0
    };
  }

  var recovered = '';
  var state = load();

  function load() {
    var main = null, backup = null;
    try { main = localStorage.getItem(KEY); } catch (e) {}
    try { backup = localStorage.getItem(BACKUP_KEY); } catch (e) {}

    var fromMain = parseState(main);
    if (fromMain) return fromMain;

    // Never throw away unreadable data silently — park it so it can be recovered,
    // then fall back to the rolling backup rather than starting from nothing.
    if (main) { try { localStorage.setItem('bloom.corrupt.' + Date.now(), main); } catch (e) {} }
    var fromBackup = parseState(backup);
    if (fromBackup) {
      if (main) recovered = 'The main copy was damaged — restored from the backup.';
      return fromBackup;
    }
    return freshState();
  }

  function parseState(raw) {
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return migrate(parsed);
    } catch (e) { return null; }
  }

  function migrate(d) {
    var base = freshState();
    if (!d || typeof d !== 'object') return base;
    base.budget = num(d.budget) > 0 ? num(d.budget) : 300;
    base.currency = typeof d.currency === 'string' && d.currency ? d.currency.slice(0, 3) : '$';
    base.sort = ['price-desc', 'price-asc', 'added', 'name'].indexOf(d.sort) > -1 ? d.sort : 'price-desc';
    base.installDismissedAt = num(d.installDismissedAt) || 0;
    base.listOpen = !!d.listOpen;
    base.savedAt = num(d.savedAt) || 0;
    if (d.draft && typeof d.draft === 'object') {
      base.draft = {
        name: String(d.draft.name == null ? '' : d.draft.name).slice(0, 80),
        price: String(d.draft.price == null ? '' : d.draft.price).slice(0, 40)
      };
    }
    if (Array.isArray(d.list)) base.list = d.list.map(cleanListEntry).filter(Boolean);
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

  function cleanListEntry(e) {
    if (!e) return null;
    var name = String(e.name == null ? '' : e.name).trim();
    if (!name) return null;
    var price = num(e.price);
    return {
      id: e.id || uid(),
      name: name,
      price: price > 0 ? round2(price) : null,
      addedAt: e.addedAt || Date.now(),
      gotAt: e.gotAt || null,
      paid: num(e.paid) > 0 ? round2(num(e.paid)) : null
    };
  }

  function cleanItem(i) {
    if (!i) return null;
    var name = String(i.name == null ? '' : i.name).trim();
    var price = num(i.price);
    if (!name && !price) return null;
    return { id: i.id || uid(), name: name || 'Item', price: price, addedAt: i.addedAt || Date.now() };
  }

  var saveTimer = null;
  var lastWrite = 0;

  // Anything that changes the basket goes straight to disk: a shop in progress is
  // the one thing that cannot be got back.
  function save() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    indexDirty = true;
    writeThrough();
  }

  // For keystrokes, where a write per character would be silly. Still flushed by
  // pagehide, visibilitychange and the next real save.
  function saveSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; writeThrough(); }, 500);
  }

  function writeThrough() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    state.version = SCHEMA;
    state.savedAt = lastWrite = Date.now();
    var json;
    try { json = JSON.stringify(state); } catch (e) { return; }
    try {
      var prev = localStorage.getItem(KEY);
      if (prev && prev !== json) localStorage.setItem(BACKUP_KEY, prev);
      localStorage.setItem(KEY, json);
    } catch (e) {
      toast('Could not save — phone storage is full.', null, null, 6000);
    }
  }

  /* Two copies of Bloom can be open at once — a Safari tab and the Home Screen
     app share one store. Last-write-wins would quietly bin whatever the other
     one is holding, so take the union: a line reappearing is a two-second fix,
     a basket vanishing at the till is not. */
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    var theirs = parseState(e.newValue);
    if (!theirs || (theirs.savedAt && theirs.savedAt === lastWrite)) return;
    var mine = state;
    state = mergeStates(mine, theirs);
    indexDirty = true;
    renderAll(false);
    // Put the merged view back only when this window is holding something the
    // other one has not seen, so the two do not bounce writes off each other.
    if (state.current.items.length > theirs.current.items.length ||
        state.trips.length > theirs.trips.length ||
        state.list.length > theirs.list.length) writeThrough();
  });

  function mergeStates(mine, theirs) {
    var newer = (theirs.savedAt || 0) >= (mine.savedAt || 0) ? theirs : mine;
    var out = freshState();
    out.budget = newer.budget;
    out.currency = newer.currency;
    out.sort = newer.sort;
    out.listOpen = newer.listOpen;
    out.draft = newer.draft && (newer.draft.name || newer.draft.price) ? newer.draft : mine.draft;
    out.installDismissedAt = Math.max(mine.installDismissedAt || 0, theirs.installDismissedAt || 0);
    out.savedAt = Math.max(mine.savedAt || 0, theirs.savedAt || 0);
    out.trips = unionById(mine.trips, theirs.trips).sort(function (a, b) {
      return (b.finishedAt || 0) - (a.finishedAt || 0);
    });
    // Different basket ids means one side has finished the shop; that basket is
    // already in the trips union above, so take the newer side whole.
    out.current = mine.current.id === theirs.current.id
      ? {
          id: mine.current.id,
          startedAt: mine.current.startedAt || theirs.current.startedAt || null,
          items: unionById(mine.current.items, theirs.current.items)
        }
      : newer.current;
    out.list = unionById(mine.list, theirs.list).map(function (entry) {
      var other = findById(newer === mine ? theirs.list : mine.list, entry.id);
      if (other && other.gotAt && !entry.gotAt) { entry.gotAt = other.gotAt; entry.paid = other.paid; }
      return entry;
    });
    return out;
  }

  function findById(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }

  function unionById(a, b) {
    var out = a.slice();
    b.forEach(function (x) { if (!findById(out, x.id)) out.push(x); });
    return out;
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

  // "Free range eggs " and "free-range  eggs" are the same thing on a list.
  function normName(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

  // Positive means budget left on the table, negative means over.
  function unspent(trip) {
    return round2((num(trip.budget) || 0) - total(trip.items));
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
    suggest: $('suggestList'),
    plan: $('planPanel'), planToggle: $('planToggle'), planBody: $('planBody'), planMeta: $('planMeta'),
    planForm: $('planForm'), planName: $('planName'), planItems: $('planItems'), planNote: $('planNote'),
    planFill: $('planFillBtn'), planTidy: $('planTidyBtn'),
    savedCard: $('savedCard'), savedTotal: $('savedTotal'), savedSub: $('savedSub'), savedChart: $('savedChart'),
    tripList: $('tripList'), historyEmpty: $('historyEmpty'), statRow: $('statRow'),
    statLast: $('statLast'), statAvg: $('statAvg'), statTrips: $('statTrips'),
    budgetInput: $('budgetInput'), currencyInput: $('currencyInput'),
    storageMsg: $('storageMsg'), installMsg: $('installMsg'),
    install: $('installBanner'), installBody: $('installBody'), installSteps: $('installSteps'),
    installHow: $('installHowBtn'), installLater: $('installLaterBtn'),
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

  /* ---------------- the shopping list ---------------- */

  function planTodo() { return state.list.filter(function (e) { return !e.gotAt; }); }
  function planGot() { return state.list.filter(function (e) { return !!e.gotAt; }); }

  function renderPlan() {
    var todo = planTodo(), got = planGot();

    if (!state.list.length) el.planMeta.textContent = '· nothing on it yet';
    else if (!todo.length) el.planMeta.textContent = '· all ' + got.length + ' ticked off';
    else el.planMeta.textContent = '· ' + todo.length + ' to get' + (got.length ? ', ' + got.length + ' in the basket' : '');

    el.planBody.hidden = !state.listOpen;
    el.planToggle.setAttribute('aria-expanded', String(!!state.listOpen));

    el.planItems.innerHTML = '';
    todo.concat(got.sort(function (a, b) { return b.gotAt - a.gotAt; })).forEach(function (entry) {
      el.planItems.appendChild(planNode(entry));
    });

    if (state.list.length) {
      el.planNote.hidden = true;
    } else {
      el.planNote.hidden = false;
      el.planNote.textContent = 'Write down what you need before you go. In the shop, tap a line to drop it in the add box, put the real price on it and it counts towards this shop.';
    }
    el.planFill.hidden = !(state.trips.length && !state.list.length);
    el.planTidy.hidden = got.length === 0;
  }

  // What we think this will cost: what you told the list, else what you paid last.
  function planPrice(entry) {
    if (entry.paid != null) return entry.paid;
    if (entry.price != null) return entry.price;
    var known = indexFor(entry.name);
    return known ? known.price : null;
  }

  function planNode(entry) {
    var li = document.createElement('li');
    li.className = 'pitem' + (entry.gotAt ? ' is-got' : '');

    var go = document.createElement('button');
    go.type = 'button';
    go.className = 'pitem__go';
    go.innerHTML =
      '<span class="pitem__tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<span class="pitem__name"></span><span class="pitem__price"></span>';
    go.querySelector('.pitem__name').textContent = entry.name;

    var guess = planPrice(entry);
    var priceEl = go.querySelector('.pitem__price');
    if (entry.gotAt) {
      priceEl.textContent = entry.paid != null ? money(entry.paid) : 'in the basket';
      go.setAttribute('aria-label', 'Untick ' + entry.name);
    } else {
      priceEl.textContent = guess != null ? '~' + money(guess) : '';
      go.setAttribute('aria-label', 'Put ' + entry.name + ' in the add box');
    }

    go.addEventListener('click', function () {
      if (entry.gotAt) { untickPlan(entry.id); return; }
      el.name.value = entry.name;
      el.price.value = guess != null ? guess.toFixed(2) : '';
      closeSuggest();
      el.price.focus();
      el.price.select();
      rememberDraft();
      showHint(guess != null
        ? 'Last time ' + entry.name + ' was ' + money(guess) + ' — change it if it has moved.'
        : 'Put the price on ' + entry.name + ' and it joins this shop.');
      el.addForm.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'pitem__del';
    del.setAttribute('aria-label', 'Take ' + entry.name + ' off the list');
    del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    del.addEventListener('click', function () { removeFromPlan(entry.id); });

    li.appendChild(go);
    li.appendChild(del);
    return li;
  }

  function addToPlan(name, price) {
    var clean = String(name || '').trim();
    if (!clean) return null;
    var key = normName(clean);
    var already = null;
    state.list.forEach(function (e) { if (!already && normName(e.name) === key) already = e; });
    if (already) {
      if (price != null) already.price = round2(price);
      if (already.gotAt) { already.gotAt = null; already.paid = null; }
      save();
      renderPlan();
      return already;
    }
    var entry = {
      id: uid(), name: titleish(clean),
      price: price != null ? round2(price) : null,
      addedAt: Date.now(), gotAt: null, paid: null
    };
    state.list.push(entry);
    save();
    renderPlan();
    return entry;
  }

  function removeFromPlan(id) {
    var idx = -1;
    state.list.forEach(function (e, i) { if (e.id === id) idx = i; });
    if (idx < 0) return;
    var gone = state.list.splice(idx, 1)[0];
    save();
    renderPlan();
    toast(gone.name + ' off the list', 'Undo', function () {
      state.list.splice(Math.min(idx, state.list.length), 0, gone);
      save();
      renderPlan();
    });
  }

  function untickPlan(id) {
    state.list.forEach(function (e) { if (e.id === id) { e.gotAt = null; e.paid = null; } });
    save();
    renderPlan();
  }

  // Adding something to the basket ticks it off the list if it is on there.
  function tickPlan(name, price) {
    var key = normName(name), hit = null;
    state.list.forEach(function (e) { if (!hit && !e.gotAt && normName(e.name) === key) hit = e; });
    if (!hit) return null;
    hit.gotAt = Date.now();
    hit.paid = round2(price);
    return hit;
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
    var row = document.createElement('div');
    row.className = 'reuse';

    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'reuse__main';
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
      closeSuggest();
      rememberDraft();
      el.price.focus();
      el.price.select();
      showHint('Ready — change the price if it has moved.');
    });

    // The other thing you do at the sofa with last week's shop: build this week's list.
    var toList = document.createElement('button');
    toList.type = 'button';
    toList.className = 'reuse__list';
    toList.setAttribute('aria-label', 'Put ' + item.name + ' on the shopping list');
    toList.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3.5 6.2l1.3 1.3L7.2 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 12.2l1.3 1.3L7.2 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 18.2l1.3 1.3L7.2 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    toList.addEventListener('click', function () {
      addToPlan(item.name, item.price);
      toast(item.name + ' is on the list', 'See it', function () {
        goto('shop');
        openPlan();
      });
    });

    row.appendChild(b);
    row.appendChild(toList);
    return row;
  }

  function openPlan() {
    state.listOpen = true;
    save();
    renderPlan();
    el.plan.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function renderHistory() {
    var trips = state.trips;
    renderSaved();
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
      var left = unspent(trip);
      head.querySelector('.trip__sub').textContent =
        trip.items.length + (trip.items.length === 1 ? ' thing' : ' things') + ' · ' +
        moneyShort(Math.abs(left)) + (left < 0 ? ' over ' : ' left of ') + moneyShort(trip.budget);
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

  /* ---------------- unspent budget over time ---------------- */

  function renderSaved() {
    var trips = state.trips;
    el.savedCard.hidden = trips.length === 0;
    if (!trips.length) return;

    var deltas = trips.map(unspent);                       // newest first
    var net = round2(deltas.reduce(function (a, b) { return a + b; }, 0));
    var avg = round2(net / trips.length);
    var under = deltas.filter(function (d) { return d >= 0; }).length;

    el.savedTotal.textContent = money(Math.abs(net));
    el.savedTotal.classList.toggle('is-over', net < 0);
    el.savedSub.textContent = (net < 0 ? 'over budget in total' : 'kept back in total') +
      ' across ' + trips.length + (trips.length === 1 ? ' shop' : ' shops') + '. ' +
      (avg < 0 ? 'Over by ' : 'That is ') + money(Math.abs(avg)) + ' a shop' +
      (trips.length > 1 ? ', under budget on ' + under + ' of ' + trips.length : '') + '.';

    var shown = trips.slice(0, 14).reverse();              // oldest on the left
    var peak = shown.reduce(function (m, t) { return Math.max(m, Math.abs(unspent(t))); }, 0) || 1;

    el.savedChart.innerHTML = '';
    el.savedChart.setAttribute('role', 'img');
    el.savedChart.setAttribute('aria-label',
      'Budget left over on the last ' + shown.length + (shown.length === 1 ? ' shop' : ' shops') +
      ': ' + shown.map(function (t) {
        var d = unspent(t);
        return dayLabel(t.finishedAt) + ' ' + money(Math.abs(d)) + (d < 0 ? ' over' : ' left');
      }).join(', ') + '.');

    shown.forEach(function (trip) {
      var d = unspent(trip);
      var h = Math.max(Math.round(Math.abs(d) / peak * 100), d === 0 ? 0 : 6);
      var col = document.createElement('span');
      col.className = 'spark__col' + (d < 0 ? ' is-over' : '');
      col.title = dayLabel(trip.finishedAt) + ' · ' + money(Math.abs(d)) + (d < 0 ? ' over' : ' left');
      col.innerHTML = '<span class="spark__up"><i style="height:' + (d >= 0 ? h : 0) + '%"></i></span>' +
        '<span class="spark__dn"><i style="height:' + (d < 0 ? h : 0) + '%"></i></span>';
      el.savedChart.appendChild(col);
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
    renderInstall();
    renderPlan();
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
    var ticked = tickPlan(item.name, item.price);
    state.draft = { name: '', price: '' };
    save();
    renderCounter(true);
    renderList();
    renderPlan();
    renderInstall();
    if (ticked && !state.listOpen) toast(ticked.name + ' ticked off the list', 'Show list', openPlan);
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
    // Ticked things were bought; anything still outstanding stays on for next time.
    var stillNeeded = planTodo();
    var carried = stillNeeded.length;
    state.list = stillNeeded;
    state.draft = { name: '', price: '' };
    el.name.value = '';
    el.price.value = '';
    el.hint.hidden = true;
    save();
    renderAll(true);
    toast('Shop saved · ' + money(spent) +
      (carried ? ' · ' + carried + ' still on the list' : ''), 'See it', function () { goto('history'); });
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

  /* ---------------- what you have bought before ---------------- */

  var indexDirty = true;
  var indexCache = [];
  var indexByKey = {};

  function buildIndex() {
    var map = {};
    function feed(name, price, when) {
      var key = normName(name);
      if (!key) return;
      var e = map[key];
      if (!e) e = map[key] = { key: key, name: titleish(String(name).trim()), count: 0, price: null, lastAt: 0, onList: false };
      e.count++;
      if ((when || 0) >= e.lastAt) {
        e.lastAt = when || 0;
        e.name = titleish(String(name).trim());
        if (price != null) e.price = round2(price);
      }
      if (e.price == null && price != null) e.price = round2(price);
    }

    state.trips.forEach(function (t) {
      t.items.forEach(function (it) { feed(it.name, it.price, t.finishedAt || it.addedAt); });
    });
    state.current.items.forEach(function (it) { feed(it.name, it.price, it.addedAt); });

    // Things you have written down but never bought are worth offering too.
    state.list.forEach(function (entry) {
      var key = normName(entry.name);
      if (!key) return;
      if (!map[key]) map[key] = { key: key, name: entry.name, count: 0, price: entry.price, lastAt: entry.addedAt || 0, onList: true };
      else map[key].onList = true;
      if (map[key].price == null && entry.price != null) map[key].price = entry.price;
    });

    indexByKey = map;
    indexCache = Object.keys(map).map(function (k) { return map[k]; });
    indexCache.forEach(function (e) {
      var weeks = Math.max(0, (Date.now() - e.lastAt) / (7 * 86400000));
      e.score = e.count + 6 / (1 + weeks) + (e.onList ? 4 : 0);
    });
    indexCache.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
    indexDirty = false;
  }

  function itemIndex() {
    if (indexDirty) buildIndex();
    return indexCache;
  }

  function indexFor(name) {
    itemIndex();
    var e = indexByKey[normName(name)];
    return e && e.price != null ? e : null;
  }

  function suggestFor(query, limit) {
    var all = itemIndex();
    var q = normName(query);
    if (!q) return all.slice(0, limit);
    var starts = [], holds = [];
    all.forEach(function (e) {
      if (e.key === q) return;               // already typed in full
      if (e.key.indexOf(q) === 0) starts.push(e);
      else if ((' ' + e.key).indexOf(' ' + q) > -1) starts.push(e);   // matches a later word
      else if (e.key.indexOf(q) > -1) holds.push(e);
    });
    return starts.concat(holds).slice(0, limit);
  }

  function lastPaidFor(name) {
    var q = normName(name);
    if (q.length < 2) return null;
    for (var t = 0; t < state.trips.length; t++) {
      var trip = state.trips[t];
      for (var i = 0; i < trip.items.length; i++) {
        var n = normName(trip.items[i].name);
        if (n === q || n.indexOf(q) === 0) {
          return { item: trip.items[i], when: trip.finishedAt };
        }
      }
    }
    return null;
  }

  /* ---------------- the suggestion drop-down ---------------- */

  var sugRows = [], sugAt = -1, nameHasFocus = false;

  function closeSuggest() {
    el.suggest.hidden = true;
    el.suggest.innerHTML = '';
    el.name.setAttribute('aria-expanded', 'false');
    el.name.removeAttribute('aria-activedescendant');
    sugRows = [];
    sugAt = -1;
  }

  function renderSuggest() {
    if (!nameHasFocus) return closeSuggest();
    var typed = el.name.value;
    if (splitCombined(typed)) return closeSuggest();   // "chicken 10" — stay out of the way
    sugRows = suggestFor(typed, 5);
    if (!sugRows.length) return closeSuggest();

    el.suggest.innerHTML = '';
    sugRows.forEach(function (e, i) {
      var li = document.createElement('li');
      li.className = 'suggest__row';
      li.id = 'sug-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggest__btn';
      b.tabIndex = -1;
      var meta = e.onList ? 'on your list' : (e.count > 1 ? 'bought ' + e.count + ' times' : agoLabel(e.lastAt));
      b.innerHTML = '<span class="suggest__name"></span><span class="suggest__meta"></span><span class="suggest__price"></span>';
      b.querySelector('.suggest__name').textContent = e.name;
      b.querySelector('.suggest__meta').textContent = meta;
      b.querySelector('.suggest__price').textContent = e.price != null ? money(e.price) : '';
      b.setAttribute('aria-label', e.name + (e.price != null ? ', ' + money(e.price) + ' last time' : '') + ', ' + meta);
      b.addEventListener('click', function () { useSuggestion(e); });

      li.appendChild(b);
      el.suggest.appendChild(li);
    });

    sugAt = -1;
    el.suggest.hidden = false;
    el.name.setAttribute('aria-expanded', 'true');
    el.hint.hidden = true;   // the drop-down says the same thing, louder
  }

  function moveSuggest(step) {
    if (el.suggest.hidden || !sugRows.length) return;
    sugAt += step;
    if (sugAt < 0) sugAt = sugRows.length - 1;
    if (sugAt >= sugRows.length) sugAt = 0;
    Array.prototype.forEach.call(el.suggest.children, function (li, i) {
      var on = i === sugAt;
      li.classList.toggle('is-on', on);
      li.setAttribute('aria-selected', String(on));
    });
    if (sugAt >= 0) el.name.setAttribute('aria-activedescendant', 'sug-' + sugAt);
    else el.name.removeAttribute('aria-activedescendant');
  }

  function useSuggestion(e) {
    el.name.value = e.name;
    if (e.price != null && !el.price.value.trim()) el.price.value = e.price.toFixed(2);
    closeSuggest();
    rememberDraft();
    el.price.focus();
    el.price.select();
    if (e.price == null) showHint('No price on record for ' + e.name + ' yet.');
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
    if (!el.suggest.hidden) { el.hint.hidden = true; return; }
    if (el.price.value.trim()) { el.hint.hidden = true; return; }
    var found = lastPaidFor(el.name.value);
    if (!found) { el.hint.hidden = true; return; }
    var p = found.item.price;
    showHint(found.item.name + ' was ' + money(p) + ' ' + agoLabel(found.when) + '.', 'Use it', function () {
      el.price.value = p.toFixed(2);
      el.hint.hidden = true;
      rememberDraft();
      el.price.focus();
    });
  }

  /* ---------------- the half-typed item ---------------- */

  /* The basket is written to disk the moment anything lands in it, but the thing
     you are in the middle of typing is not in the basket yet. iOS can kill a
     backgrounded app at any moment, so the add box is kept on disk too. */
  function rememberDraft() {
    state.draft = { name: el.name.value.slice(0, 80), price: el.price.value.slice(0, 40) };
    saveSoon();
  }

  function restoreDraft() {
    var d = state.draft || {};
    if (!d.name && !d.price) return;
    el.name.value = d.name || '';
    el.price.value = d.price || '';
    if (d.name) showHint('Picked up where you left off.');
  }

  /* ---------------- export / import ---------------- */

  function csv() {
    var rows = [['Shop date', 'Item', 'Price', 'Budget', 'Shop total', 'Left over']];
    function push(dateLabel, items, budget) {
      var t = total(items);
      var left = round2(budget - t);
      items.slice().sort(function (a, b) { return b.price - a.price; }).forEach(function (it) {
        rows.push([dateLabel, it.name, it.price.toFixed(2), budget.toFixed(2), t.toFixed(2), left.toFixed(2)]);
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
      ', ' + incoming.current.items.length + ' thing(s) in the basket and ' +
      incoming.list.length + ' thing(s) on the shopping list.\n\nWhat is on this phone now will be replaced.')) return;
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

  /* ---------------- add to home screen ---------------- */

  var REMIND_AFTER = 5 * 86400000; // a nudge every five days, not every load
  var nativePrompt = null;

  function isStandalone() {
    return window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  }

  function isIOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
      (/Mac/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS pretends to be a Mac
  }

  function renderInstall() {
    // Nothing to protect yet, already installed, or waved away recently — stay quiet.
    var hasData = state.current.items.length > 0 || state.trips.length > 0 || state.list.length > 0;
    var due = Date.now() - (state.installDismissedAt || 0) > REMIND_AFTER;
    if (isStandalone() || !hasData || !due) { el.install.hidden = true; return; }

    var saved = state.trips.length;
    var why = 'It works with no signal in the shop, and stops iOS clearing what you have saved.';
    if (saved) {
      why = 'Your ' + (saved === 1 ? 'saved shop lives' : saved + ' saved shops live') +
        ' on this phone and nowhere else. On the Home Screen iOS cannot clear that, ' +
        'and Bloom works with no signal in the shop.';
    }
    el.installBody.textContent = why;

    el.installHow.textContent = nativePrompt ? 'Install' : 'Show me how';
    if (!nativePrompt && !isIOS() && !el.installSteps.dataset.generic) {
      // Not Safari on an iPhone, so the Share-sheet wording would be wrong.
      el.installSteps.dataset.generic = '1';
      el.installSteps.innerHTML =
        '<li>Open your browser\'s menu and choose <strong>Install</strong> or <strong>Add to Home Screen</strong>.</li>';
    }
    if (el.install.hidden) { // only collapse when the banner is coming back
      el.installSteps.hidden = true;
      el.installHow.setAttribute('aria-expanded', 'false');
    }
    el.install.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    nativePrompt = e;
    renderInstall();
  });

  window.addEventListener('appinstalled', function () {
    state.installDismissedAt = Date.now() + 3650 * 86400000; // done; stop asking
    save();
    renderInstall();
  });

  el.installHow.addEventListener('click', function () {
    if (nativePrompt) {
      nativePrompt.prompt();
      nativePrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') {
          state.installDismissedAt = Date.now() + 3650 * 86400000;
          save();
        }
        nativePrompt = null;
        renderInstall();
      });
      return;
    }
    var open = el.installSteps.hidden;
    el.installSteps.hidden = !open;
    el.installHow.setAttribute('aria-expanded', String(open));
    el.installHow.textContent = open ? 'Got it' : 'Show me how';
    if (!open) {
      state.installDismissedAt = Date.now();
      save();
      renderInstall();
    }
  });

  el.installLater.addEventListener('click', function () {
    state.installDismissedAt = Date.now();
    save();
    renderInstall();
    toast('Fine. Nudging you again in a few days.');
  });

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
    closeSuggest();
    suppressSuggest = true;   // do not throw a menu over the list they just added to
    el.name.focus();          // keep the keyboard up for the next thing
  });

  var suppressSuggest = false;

  el.name.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (el.suggest.hidden) renderSuggest();
      if (!el.suggest.hidden) { e.preventDefault(); moveSuggest(e.key === 'ArrowDown' ? 1 : -1); }
      return;
    }
    if (e.key === 'Escape' && !el.suggest.hidden) { e.preventDefault(); closeSuggest(); return; }
    if (e.key === 'Enter') {
      if (sugAt > -1 && sugRows[sugAt]) { e.preventDefault(); useSuggestion(sugRows[sugAt]); return; }
      var combo = splitCombined(el.name.value);
      if (combo && !el.price.value.trim()) { closeSuggest(); return; } // let submit handle "chicken, $10"
      e.preventDefault();
      closeSuggest();
      el.price.focus();
    }
  });

  el.name.addEventListener('input', function () {
    rememberDraft();
    renderSuggest();
    refreshHint();
  });

  el.name.addEventListener('focus', function () {
    nameHasFocus = true;
    if (suppressSuggest) { suppressSuggest = false; return; }
    renderSuggest();
  });

  el.name.addEventListener('blur', function () {
    nameHasFocus = false;
    setTimeout(function () { if (!nameHasFocus) closeSuggest(); }, 140);
  });

  // Tapping a suggestion must not close the keyboard out from under it.
  ['pointerdown', 'mousedown'].forEach(function (evt) {
    el.suggest.addEventListener(evt, function (e) { e.preventDefault(); });
  });

  el.price.addEventListener('input', function () {
    rememberDraft();
    if (el.price.value.trim()) el.hint.hidden = true;
  });

  /* ---------------- shopping list wiring ---------------- */

  el.planToggle.addEventListener('click', function () {
    state.listOpen = !state.listOpen;
    save();
    renderPlan();
    if (state.listOpen && !state.list.length) setTimeout(function () { el.planName.focus(); }, 60);
  });

  el.planForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var typed = el.planName.value.trim();
    if (!typed) { el.planName.focus(); return; }
    // "milk, 1.20" on the list means you already know roughly what it costs.
    var combo = splitCombined(typed);
    var entry = combo ? addToPlan(combo.name, combo.price) : addToPlan(typed, null);
    el.planName.value = '';
    el.planName.focus();
    if (entry) toast(entry.name + ' is on the list');
  });

  el.planFill.addEventListener('click', function () {
    var last = state.trips[0];
    if (!last) return;
    last.items.forEach(function (it) { addToPlan(it.name, it.price); });
    renderPlan();
    toast('Last shop copied onto the list');
  });

  el.planTidy.addEventListener('click', function () {
    var got = planGot();
    if (!got.length) return;
    var kept = planTodo();
    state.list = kept;
    save();
    renderPlan();
    toast(got.length + (got.length === 1 ? ' ticked line' : ' ticked lines') + ' cleared', 'Undo', function () {
      state.list = kept.concat(got);
      save();
      renderPlan();
    });
  });

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
    if (!window.confirm('Erase the basket, the shopping list and all ' + state.trips.length + ' saved shop(s) on this device?\n\nThis cannot be undone. Download a backup first if you are not sure.')) return;
    state = freshState();
    try { localStorage.removeItem(BACKUP_KEY); } catch (e) {}
    save();
    renderAll(true);
    goto('shop');
    toast('All clear');
  });

  window.addEventListener('pagehide', writeThrough);
  window.addEventListener('beforeunload', writeThrough);
  window.addEventListener('blur', function () { if (saveTimer) writeThrough(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') writeThrough();
  });

  /* ---------------- go ---------------- */

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.classList.toggle('is-on', c.dataset.sort === state.sort);
  });
  renderAll(false);
  restoreDraft();
  checkStorage();
  if (recovered) toast(recovered, null, null, 7000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
