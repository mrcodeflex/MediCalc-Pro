/* ==========================================================================
   MediCalc Pro — app.js
   UI layer: routing, lists, forms, result sheet, settings, subscription gate.
   Calculations live in calc.js; field definitions and validation in registry.js.
   ========================================================================== */
(function () {
    'use strict';

    const { CATEGORIES, CALCULATORS, BY_ID, FieldError, collect, toText } = window.Registry;

    // ---------- Settings (edit these) ----------
    const APP_VERSION = '1.0.0';
    const CONFIG = {
        // Access ends at the END of this day, in the device's local time. Month is 0-based (11 = December).
        // NOTE: a client-side check is only a deterrent: it can be bypassed by editing the app or the
        // device clock. For real enforcement, verify a licence on a server.
        subscriptionExpiry: new Date(2026, 11, 31, 23, 59, 59),
        showBannerWithinDays: 14,
        contactUrl: 'https://wa.me/+8801646889918',
        recheckIntervalMs: 60 * 1000
    };

    // ---------- Small helpers ----------
    const $ = (sel, root = document) => root.querySelector(sel);

    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        }
        kids.flat(Infinity).forEach((c) => {
            if (c === null || c === undefined || c === false) return;
            el.append(c.nodeType ? c : document.createTextNode(String(c)));
        });
        return el;
    }

    /** Like el.append(), but skips null/undefined (native append writes the text "null"). */
    function put(el, ...kids) {
        kids.forEach((k) => { if (k !== null && k !== undefined && k !== false) el.append(k); });
        return el;
    }

    const ICONS = {
        home: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
        star: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
        tune: '<path d="M4 7h8M18 7h2M4 17h2M12 17h8"/><circle cx="15" cy="7" r="2.4"/><circle cx="9" cy="17" r="2.4"/>',
        back: '<path d="M15 5l-7 7 7 7"/>',
        close: '<path d="M6 6l12 12M18 6L6 18"/>',
        search: '<circle cx="11" cy="11" r="6.2"/><path d="M16 16l4.2 4.2"/>',
        copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
        share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/>',
        alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.4v.1"/>'
    };

    function icon(name, cls) {
        const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        s.setAttribute('viewBox', '0 0 24 24');
        s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
        s.setAttribute('aria-hidden', 'true');
        s.innerHTML = ICONS[name]; // constant strings only
        return s;
    }

    const store = {
        get(k, d) { try { const v = localStorage.getItem('mc.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem('mc.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
    };

    const state = {
        fav: store.get('fav', []).filter((id) => BY_ID[id]),
        recent: store.get('recent', []).filter((id) => BY_ID[id]),
        theme: store.get('theme', 'system'),
        haptics: store.get('haptics', true),
        tab: 'home',
        query: '',
        cat: 'all',
        last: null // { id, model, inputs, text }
    };

    // ---------- Native bridge (all optional; falls back to web APIs) ----------
    const isNative = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
    function plugin(name) {
        try { return window.Capacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins[name] : null; } catch (e) { return null; }
    }
    function haptic(kind) {
        if (!state.haptics) return;
        try {
            const H = plugin('Haptics');
            if (H) {
                const p = kind === 'error' ? H.notification({ type: 'ERROR' })
                    : kind === 'success' ? H.notification({ type: 'SUCCESS' })
                        : H.impact({ style: 'LIGHT' });
                if (p && p.catch) p.catch(() => {});
            } else if (navigator.vibrate) {
                navigator.vibrate(kind === 'error' ? [30, 50, 30] : 12);
            }
        } catch (e) { /* ignore */ }
    }

    // ---------- Theme ----------
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function applyTheme() {
        const dark = state.theme === 'dark' || (state.theme === 'system' && media && media.matches);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        const meta = $('#meta-theme');
        if (meta) meta.setAttribute('content', dark ? '#0a141f' : '#f3f6f9');
        try {
            const SB = plugin('SystemBars');
            // DARK = light icons for dark backgrounds
            if (SB && SB.setStyle) { const p = SB.setStyle({ style: dark ? 'DARK' : 'LIGHT' }); if (p && p.catch) p.catch(() => {}); }
        } catch (e) { /* ignore */ }
    }
    if (media && media.addEventListener) media.addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });

    // ---------- Toast, copy, share ----------
    let toastTimer = null;
    function toast(msg) {
        const t = $('#toast');
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
    }

    async function copyText(text) {
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
            try {
                const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;top:0' });
                ta.value = text; document.body.append(ta); ta.select();
                ok = document.execCommand('copy'); ta.remove();
            } catch (e2) { ok = false; }
        }
        toast(ok ? 'Copied to clipboard' : 'Could not copy');
        if (ok) haptic('tap');
    }

    function canShare() { return !!(plugin('Share') || navigator.share); }
    async function shareText(text) {
        try {
            const S = plugin('Share');
            if (S && S.share) { await S.share({ title: 'MediCalc Pro', text, dialogTitle: 'Share result' }); return; }
            if (navigator.share) { await navigator.share({ title: 'MediCalc Pro', text }); return; }
        } catch (e) {
            if (e && (e.name === 'AbortError' || /cancel/i.test(String(e.message)))) return;
        }
        copyText(text);
    }

    // ---------- Favorites / recents ----------
    const isFav = (id) => state.fav.includes(id);
    function toggleFav(id) {
        state.fav = isFav(id) ? state.fav.filter((x) => x !== id) : [id, ...state.fav];
        store.set('fav', state.fav);
        haptic('tap');
        document.querySelectorAll(`.star[data-fav="${id}"]`).forEach(syncStar);
        if (state.tab === 'favorites') renderFavorites();
        toast(isFav(id) ? 'Added to favorites' : 'Removed from favorites');
    }
    function syncStar(btn) {
        const id = btn.dataset.fav, on = isFav(id);
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${BY_ID[id].name} ${on ? 'from' : 'to'} favorites`);
        const svg = btn.querySelector('svg');
        if (svg) svg.classList.toggle('filled', on);
    }
    function starButton(id) {
        const b = h('button', { class: 'star', type: 'button', dataset: { fav: id } }, icon('star'));
        syncStar(b);
        return b;
    }
    function pushRecent(id) {
        state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 5);
        store.set('recent', state.recent);
    }

    // ---------- Subscription ----------
    function subscriptionInfo() {
        const now = new Date();
        const expired = now > CONFIG.subscriptionExpiry;
        const days = Math.ceil((CONFIG.subscriptionExpiry - now) / 86400000);
        const dateText = CONFIG.subscriptionExpiry.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
        return { expired, days, dateText };
    }

    function setLocked(locked) {
        ['#app', '#pages', '#sheet-root'].forEach((sel) => {
            const el = $(sel);
            el.inert = locked;
            if (locked) el.setAttribute('aria-hidden', 'true'); else el.removeAttribute('aria-hidden');
            el.querySelectorAll('input, button').forEach((c) => { c.disabled = locked; });
        });
    }

    function checkSubscription() {
        const s = subscriptionInfo();
        const lock = $('#lock');
        $('#lock-contact').href = CONFIG.contactUrl;
        if (s.expired) {
            $('#lock-expiry').textContent = `Expired on ${s.dateText}`;
            const wasHidden = lock.hidden;
            lock.hidden = false;
            setLocked(true);
            if (wasHidden) $('#lock-contact').focus();
        } else {
            if (!lock.hidden) { lock.hidden = true; setLocked(false); }
        }
        updateBanner(s);
        if (state.tab === 'settings') renderSettings();
    }

    function updateBanner(s) {
        const slot = $('#home-banner');
        if (!slot) return;
        slot.replaceChildren();
        if (!s.expired && s.days <= CONFIG.showBannerWithinDays) {
            slot.append(h('div', { class: 'banner', role: 'status' },
                h('span', { text: `Subscription ends in ${s.days} day${s.days === 1 ? '' : 's'}` }),
                h('a', { href: CONFIG.contactUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Renew' })));
        }
    }

    // ---------- Home ----------
    function matches(c, q) {
        if (!q) return true;
        const hay = [c.name, c.desc, c.tag, ...c.kw].join(' ').toLowerCase();
        return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
    }

    function calcRow(c) {
        return h('li', { class: 'row' },
            h('button', { class: 'row-main', type: 'button', dataset: { open: c.id } },
                h('span', { class: 'tile', text: c.tag }),
                h('span', { class: 'row-text' },
                    h('span', { class: 'row-title', text: c.name }),
                    h('span', { class: 'row-desc', text: c.desc }))),
            starButton(c.id));
    }

    function buildHome() {
        const v = $('#view-home');
        const search = h('label', { class: 'search' },
            icon('search'),
            h('input', { id: 'search', type: 'search', placeholder: 'Search calculators', enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search calculators' }),
            h('button', { class: 'clear', type: 'button', id: 'search-clear', hidden: true, 'aria-label': 'Clear search' }, icon('close')));
        const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by category' },
            [{ id: 'all', short: 'All' }, ...CATEGORIES].map((c) =>
                h('button', { class: 'chip', type: 'button', dataset: { cat: c.id }, 'aria-pressed': String(c.id === 'all'), text: c.short })));
        v.replaceChildren(
            h('header', { class: 'brand' },
                h('img', { src: 'assets/icons/mark.svg', alt: '', width: 44, height: 44 }),
                h('div', {}, h('div', { class: 'brand-title', text: 'MediCalc Pro' }), h('div', { class: 'brand-sub', text: 'Laboratory calculators' }))),
            h('div', { id: 'home-banner' }),
            h('div', { class: 'tools' }, search, chips),
            h('div', { id: 'home-list', class: 'view-pad' }));
        const input = $('#search');
        input.addEventListener('input', () => {
            state.query = input.value.trim();
            $('#search-clear').hidden = !input.value;
            renderHomeList();
        });
        $('#search-clear').addEventListener('click', () => { input.value = ''; state.query = ''; $('#search-clear').hidden = true; renderHomeList(); input.focus(); });
        chips.addEventListener('click', (e) => {
            const b = e.target.closest('[data-cat]');
            if (!b) return;
            state.cat = b.dataset.cat;
            chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
            renderHomeList();
        });
        renderHomeList();
    }

    function renderHomeList() {
        const root = $('#home-list');
        const out = [];
        const filtering = !!state.query || state.cat !== 'all';
        if (!filtering && state.recent.length) {
            out.push(h('div', { class: 'recents-title', text: 'Recent' }));
            out.push(h('div', { class: 'recents' }, state.recent.map((id) => h('button', { class: 'recent', type: 'button', dataset: { open: id } },
                h('span', { class: 'tile', text: BY_ID[id].tag }), BY_ID[id].name))));
        }
        let shown = 0;
        CATEGORIES.forEach((cat) => {
            if (state.cat !== 'all' && state.cat !== cat.id) return;
            const items = CALCULATORS.filter((c) => c.cat === cat.id && matches(c, state.query));
            if (!items.length) return;
            shown += items.length;
            out.push(h('div', { class: 'sec-title' }, h('span', { text: cat.name }), h('span', { text: String(items.length) })));
            out.push(h('ul', {}, items.map(calcRow)));
        });
        if (!shown) {
            out.push(h('div', { class: 'empty' }, icon('search'), h('strong', { text: 'No calculators found' }),
                h('span', { text: state.query ? `Nothing matches “${state.query}”.` : 'Nothing in this category.' })));
        }
        root.replaceChildren(...out);
    }

    // ---------- Favorites ----------
    function renderFavorites() {
        const v = $('#view-favorites');
        const items = state.fav.map((id) => BY_ID[id]);
        v.replaceChildren(
            h('h1', { class: 'screen-title', text: 'Favorites' }),
            items.length
                ? h('ul', { class: 'view-pad' }, items.map(calcRow))
                : h('div', { class: 'empty' }, icon('star'), h('strong', { text: 'No favorites yet' }),
                    h('span', { text: 'Tap the star next to a calculator to keep it here for quick access.' })));
    }

    // ---------- Settings ----------
    function segmented(options, value, onChange, label, extra) {
        const wrap = h('div', { class: 'seg ' + (extra || ''), role: 'radiogroup', 'aria-label': label });
        const btns = options.map(([v, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), dataset: { v }, text: t }));
        put(wrap, ...btns);
        wrap.addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            set(b.dataset.v, true);
        });
        wrap.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
            const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
            set(btns[n].dataset.v, true); btns[n].focus(); e.preventDefault();
        });
        function set(v, fire) {
            btns.forEach((b) => { const on = b.dataset.v === v; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
            if (fire) onChange(v);
        }
        set(value, false);
        return { el: wrap, get: () => (btns.find((b) => b.getAttribute('aria-checked') === 'true') || btns[0]).dataset.v, set: (v) => set(v, false) };
    }

    function renderSettings() {
        const v = $('#view-settings');
        const s = subscriptionInfo();
        const theme = segmented([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], state.theme, (val) => {
            state.theme = val; store.set('theme', val); applyTheme();
        }, 'Theme');
        const hapticsBox = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: 'haptics', checked: state.haptics });
        hapticsBox.addEventListener('change', () => { state.haptics = hapticsBox.checked; store.set('haptics', state.haptics); if (state.haptics) haptic('tap'); });

        const statusText = s.expired ? `Expired on ${s.dateText}` : `Active until ${s.dateText} (${s.days} day${s.days === 1 ? '' : 's'} left)`;

        v.replaceChildren(
            h('h1', { class: 'screen-title', text: 'Settings' }),
            h('div', { class: 'view-pad' },
                h('div', { class: 'group-title', text: 'Appearance' }),
                h('div', { class: 'group' }, h('div', { class: 'setting' },
                    h('div', { class: 'setting-label', text: 'Theme' }),
                    h('div', { class: 'setting-sub', text: 'System follows your phone’s dark mode.' }),
                    theme.el)),
                h('div', { class: 'group-title', text: 'Feedback' }),
                h('div', { class: 'group' }, h('label', { class: 'setting setting-row', for: 'haptics' },
                    h('span', {}, h('div', { class: 'setting-label', text: 'Haptic feedback' }), h('div', { class: 'setting-sub', text: 'A light tap on results and errors.' })),
                    hapticsBox)),
                h('div', { class: 'group-title', text: 'Subscription' }),
                h('div', { class: 'group' }, h('div', { class: 'setting' },
                    h('div', { class: 'setting-label', text: s.expired ? 'Expired' : 'Active' }),
                    h('div', { class: 'setting-sub', text: statusText }),
                    h('a', { class: 'link-btn', href: CONFIG.contactUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Contact to renew' }))),
                h('div', { class: 'group-title', text: 'Data on this device' }),
                h('div', { class: 'group' }, h('div', { class: 'setting' },
                    h('div', { class: 'setting-sub', text: 'Calculator values are never saved. Only your favorites, recent calculators and settings are kept on this device.' }),
                    h('button', { class: 'btn danger', type: 'button', style: 'margin-top:12px;width:100%', id: 'clear-data', text: 'Clear favorites and recents' }))),
                h('div', { class: 'group-title', text: 'About' }),
                h('div', { class: 'group' }, h('div', { class: 'setting about' },
                    h('p', {}, h('strong', { text: `MediCalc Pro ${APP_VERSION}` }), ' · Developed by Imad'),
                    h('p', { text: 'For healthcare professional use. Results support, and never replace, clinical judgment. Always verify against your laboratory’s validated methods and reference ranges.' }),
                    h('p', { text: 'Typeface: Inter, SIL Open Font License 1.1.' })))));
        $('#clear-data').addEventListener('click', () => {
            state.fav = []; state.recent = []; store.set('fav', []); store.set('recent', []);
            document.querySelectorAll('.star[data-fav]').forEach(syncStar);
            renderHomeList(); toast('Cleared');
        });
    }

    // ---------- Calculator page ----------
    const pages = {};

    function normalizeTyping(el) {
        el.value = el.value.replace(/[^0-9.,٫০-৯\s]/g, '');
    }

    function buildPage(calc) {
        const controls = {};
        const pageId = 'page-' + calc.id;

        // ---- fields ----
        const fieldEls = calc.fields.map((field) => {
            const id = `${pageId}-${field.id}`;
            const wrap = h('div', { class: 'field', dataset: { field: field.id } });
            const errEl = h('div', { class: 'error', id: id + '-err', role: 'alert', hidden: true });
            const hintEl = field.hint ? h('div', { class: 'hint', id: id + '-hint', text: field.hint }) : null;
            const describedBy = [hintEl && id + '-hint', id + '-err'].filter(Boolean).join(' ');
            let ctl;

            if (field.type === 'number') {
                const input = h('input', {
                    id, class: 'num', type: 'text', inputmode: 'decimal', enterkeyhint: 'next',
                    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: field.ph || '',
                    value: field.def || '', 'aria-describedby': describedBy
                });
                input.addEventListener('input', () => { normalizeTyping(input); clearFieldError(ctl); });
                const box = h('div', { class: 'input-box' }, input);
                const row = h('div', { class: 'input-row' }, box);
                let seg = null;
                const units = field.units || [];
                if (units.length === 1) box.append(h('span', { class: 'suffix', text: units[0][1] }));
                else if (field.suffix && !units.length) box.append(h('span', { class: 'suffix', text: field.suffix }));
                let segBelow = false;
                if (units.length > 1) {
                    segBelow = units.length > 2;
                    seg = segmented(units, units[0][0], () => clearFieldError(ctl), `${field.label} unit`, segBelow ? 'full below' : 'inline');
                    if (!segBelow) row.append(seg.el);
                }
                put(wrap, 
                    h('label', { class: 'field-label', for: id }, h('span', { text: field.label }), field.optional ? h('span', { class: 'optional', text: 'optional' }) : null),
                    row, segBelow ? seg.el : null, hintEl, errEl);
                ctl = {
                    field, wrap, input, errEl,
                    value: () => input.value,
                    unit: () => (seg ? seg.get() : (units[0] ? units[0][0] : null)),
                    unitText: () => { const u = units.find((x) => x[0] === (seg ? seg.get() : units[0] && units[0][0])); return u ? u[1] : (field.suffix || ''); },
                    reset: () => { input.value = field.def || ''; if (seg) seg.set(units[0][0]); },
                    focus: () => input.focus()
                };
            } else if (field.type === 'choice') {
                const seg = segmented(field.options, field.def || field.options[0][0], () => { clearFieldError(ctl); refreshVisibility(); }, field.label, 'full');
                put(wrap, h('div', { class: 'field-label' }, h('span', { id: id + '-lbl', text: field.label })), seg.el, hintEl, errEl);
                ctl = {
                    field, wrap, errEl,
                    value: () => seg.get(), unit: () => null,
                    optionText: () => (field.options.find((o) => o[0] === seg.get()) || [])[1],
                    reset: () => seg.set(field.def || field.options[0][0]),
                    focus: () => seg.el.querySelector('[aria-checked="true"]').focus()
                };
            } else { // switch
                const box = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id });
                box.addEventListener('change', () => { refreshVisibility(); });
                put(wrap, h('label', { class: 'switch-row', for: id }, h('span', { class: 'switch-text' }, field.label, field.hint ? h('small', { text: field.hint }) : null), box), errEl);
                ctl = { field, wrap, errEl, value: () => box.checked, unit: () => null, reset: () => { box.checked = false; }, focus: () => box.focus() };
            }
            controls[field.id] = ctl;
            return wrap;
        });

        function clearFieldError(c) {
            if (!c) return;
            c.wrap.classList.remove('invalid');
            c.errEl.hidden = true; c.errEl.replaceChildren();
            if (c.input) c.input.removeAttribute('aria-invalid');
        }
        function clearAllErrors() { Object.values(controls).forEach(clearFieldError); }
        function showFieldError(fieldId, message) {
            const c = controls[fieldId] || Object.values(controls)[0];
            clearAllErrors();
            c.wrap.classList.add('invalid');
            c.errEl.replaceChildren(icon('alert'), h('span', { text: message }));
            c.errEl.hidden = false;
            if (c.input) c.input.setAttribute('aria-invalid', 'true');
            c.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
            c.focus();
        }

        const source = { value: (fid) => controls[fid].value(), unit: (fid) => controls[fid].unit() };
        function peek() { const p = {}; calc.fields.forEach((f) => { p[f.id] = controls[f.id].value(); }); return p; }

        function refreshVisibility() {
            const p = peek();
            calc.fields.forEach((f) => { controls[f.id].wrap.hidden = !!(f.showIf && !f.showIf(p)); });
            // Enter key shows "Next", except on the last visible number field ("Done")
            const nums = calc.fields.filter((f) => f.type === 'number' && !controls[f.id].wrap.hidden);
            nums.forEach((f, i) => controls[f.id].input.setAttribute('enterkeyhint', i === nums.length - 1 ? 'done' : 'next'));
        }

        function summary() {
            const out = [];
            calc.fields.forEach((f) => {
                const c = controls[f.id];
                if (c.wrap.hidden) return;
                if (f.type === 'number') {
                    const val = c.value().trim();
                    if (val) out.push(`${f.label}: ${val} ${c.unitText()}`.trim());
                } else if (f.type === 'choice') out.push(`${f.label}: ${c.optionText()}`);
                else if (c.value()) out.push(`${f.label}: yes`);
            });
            return out;
        }

        function calculate() {
            clearAllErrors();
            try {
                const values = collect(calc, source);
                const model = calc.compute(values);
                state.last = { id: calc.id, model, inputs: summary() };
                state.last.text = toText(calc, model, state.last.inputs);
                haptic(model.warnings && model.warnings.length ? 'tap' : 'success');
                navigate(`#/c/${calc.id}/result`, { sheet: true });
            } catch (e) {
                if (e instanceof FieldError) { haptic('error'); showFieldError(e.fieldId, e.message); }
                else { console.error(e); haptic('error'); toast('Something went wrong. Check the values and try again.'); }
            }
        }

        function reset() {
            Object.values(controls).forEach((c) => { c.reset(); clearFieldError(c); });
            refreshVisibility();
            state.last = state.last && state.last.id === calc.id ? null : state.last;
            toast('Cleared');
        }

        // Enter jumps to the next empty number field, or calculates when none are left
        const scroll = h('div', { class: 'page-scroll' }, h('p', { class: 'blurb', text: calc.blurb }), ...fieldEls);
        scroll.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            const t = e.target;
            if (!(t instanceof HTMLInputElement) || t.type !== 'text') return;
            e.preventDefault();
            const inputs = calc.fields.filter((f) => f.type === 'number' && !controls[f.id].wrap.hidden).map((f) => controls[f.id].input);
            const next = inputs.slice(inputs.indexOf(t) + 1).find((i) => !i.value.trim());
            if (next) next.focus(); else calculate();
        });

        const title = h('h2', { class: 'page-title', id: pageId + '-title', tabindex: '-1', text: calc.name });
        const el = h('section', { class: 'page', id: pageId, 'aria-labelledby': pageId + '-title' },
            h('header', { class: 'page-bar' },
                h('button', { class: 'icon-btn', type: 'button', dataset: { back: '1' }, 'aria-label': 'Back' }, icon('back')),
                title,
                starButton(calc.id)),
            scroll,
            h('footer', { class: 'actions' },
                h('button', { class: 'btn ghost', type: 'button', onclick: reset, text: 'Reset' }),
                h('button', { class: 'btn primary', type: 'button', onclick: calculate, text: 'Calculate' })));

        $('#pages').append(el);
        refreshVisibility();
        return { el, title, calc };
    }

    // ---------- Result sheet ----------
    function renderSheet() {
        const root = $('#sheet-root');
        const { id, model, text } = state.last;
        const calc = BY_ID[id];
        const kids = [];

        if (model.primary) {
            const val = model.primary.value;
            kids.push(h('div', { class: 'readout-label', text: model.primary.label }));
            kids.push(h('div', { class: 'readout-value' },
                h('span', { class: 'num-xl' + (val.length > 7 ? ' long' : ''), text: val }),
                model.primary.unit ? h('span', { class: 'unit', text: model.primary.unit }) : null));
        }
        if (model.chip) kids.push(h('div', { class: 'tone-chip tone-' + model.chip.tone, text: model.chip.text }));
        if (model.scale) {
            const { items, active } = model.scale;
            kids.push(h('div', { class: 'scale', role: 'img', 'aria-label': `${items[active].code} (${items[active].sub}) on a scale from ${items[0].code} to ${items[items.length - 1].code}` },
                items.map((it, i) => h('div', { class: 'scale-item' + (i === active ? ' on' : '') },
                    h('div', { class: 'scale-bar bar-' + it.tone }),
                    h('div', { class: 'scale-code', text: it.code }),
                    h('div', { class: 'scale-sub', text: it.sub })))));
        }
        if (model.rows && model.rows.length) {
            kids.push(h('ul', { class: 'kv' }, model.rows.map(([k, v]) => h('li', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })))));
        }
        (model.warnings || []).forEach((w) => kids.push(h('div', { class: 'callout', role: 'alert', text: w })));
        (model.notes || []).forEach((n) => kids.push(h('div', { class: 'note', text: n })));

        const grab = h('div', { class: 'sheet-grab' },
            h('div', { class: 'sheet-handle' }),
            h('div', { class: 'sheet-head' },
                h('div', { class: 'sheet-kicker', id: 'sheet-title', tabindex: '-1', text: calc.name }),
                h('button', { class: 'icon-btn', type: 'button', onclick: closeSheet, 'aria-label': 'Close result' }, icon('close'))));
        const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', tabindex: '-1' },
            grab,
            h('div', { class: 'sheet-body' }, kids),
            h('div', { class: 'sheet-actions' },
                h('button', { class: 'btn outline', type: 'button', onclick: () => copyText(text) }, icon('copy'), 'Copy'),
                canShare() ? h('button', { class: 'btn outline', type: 'button', onclick: () => shareText(text) }, icon('share'), 'Share') : null));
        const scrim = h('div', { class: 'scrim', onclick: closeSheet });
        root.replaceChildren(scrim, sheet);
        requestAnimationFrame(() => { scrim.classList.add('show'); sheet.classList.add('show'); });
        setTimeout(() => { const t = $('#sheet-title'); if (t) t.focus({ preventScroll: true }); }, 60);

        // swipe down on the handle / header to dismiss
        let startY = null, dy = 0;
        grab.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            startY = e.clientY; dy = 0; sheet.style.transition = 'none';
            grab.setPointerCapture(e.pointerId);
        });
        grab.addEventListener('pointermove', (e) => {
            if (startY === null) return;
            dy = Math.max(0, e.clientY - startY);
            sheet.style.transform = `translateY(${dy}px)`;
        });
        const end = () => {
            if (startY === null) return;
            sheet.style.transition = '';
            if (dy > 90) closeSheet(); else sheet.style.transform = '';
            startY = null;
        };
        grab.addEventListener('pointerup', end);
        grab.addEventListener('pointercancel', end);
    }

    function hideSheet() {
        const root = $('#sheet-root');
        if (!root.firstChild) return;
        const sheet = $('.sheet', root), scrim = $('.scrim', root);
        if (sheet) { sheet.style.transform = ''; sheet.classList.remove('show'); }
        if (scrim) scrim.classList.remove('show');
        setTimeout(() => { if (!state.route || !state.route.sheet) root.replaceChildren(); }, 320);
    }

    function closeSheet() {
        if (history.state && history.state.sheet) history.back();
        else if (state.route && state.route.id) navigate('#/c/' + state.route.id, { replace: true });
    }

    // ---------- Router ----------
    function parseRoute() {
        const parts = location.hash.replace(/^#\/?/, '').split('/');
        if (parts[0] === 'c' && BY_ID[parts[1]]) return { name: 'calc', id: parts[1], sheet: parts[2] === 'result' };
        if (parts[0] === 'favorites') return { name: 'favorites' };
        if (parts[0] === 'settings') return { name: 'settings' };
        return { name: 'home' };
    }

    function navigate(hash, opts) {
        const o = opts || {};
        history[o.replace ? 'replaceState' : 'pushState']({ mc: 1, sheet: !!o.sheet }, '', hash);
        render();
    }

    function showTab(tab) {
        state.tab = tab;
        ['home', 'favorites', 'settings'].forEach((t) => { $('#view-' + t).hidden = t !== tab; });
        document.querySelectorAll('.tab').forEach((b) => {
            if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        if (tab === 'favorites') renderFavorites();
        if (tab === 'settings') renderSettings();
    }

    function render() {
        const r = parseRoute();
        state.route = r;
        if (r.name !== 'calc') showTab(r.name);
        else showTab(state.tab);

        const openId = r.name === 'calc' ? r.id : null;
        let openPage = null;
        if (openId) {
            if (!pages[openId]) pages[openId] = buildPage(BY_ID[openId]);
            openPage = pages[openId];
        }
        const locked = !$('#lock').hidden;
        Object.entries(pages).forEach(([id, p]) => {
            const open = id === openId;
            if (open && !p.el.classList.contains('open')) {
                void p.el.offsetWidth; // let the slide-in start from the off-screen position
                p.el.classList.add('open');
                p.title.focus({ preventScroll: true });
            }
            if (!open) p.el.classList.remove('open');
            p.el.inert = locked || !open || !!(r.sheet);
        });
        $('#app').inert = locked || !!openId;

        if (r.name === 'calc' && r.sheet) {
            if (state.last && state.last.id === r.id) {
                if (!$('.sheet', $('#sheet-root')) || !$('.sheet', $('#sheet-root')).classList.contains('show')) renderSheet();
            } else {
                navigate('#/c/' + r.id, { replace: true });
            }
        } else {
            hideSheet();
        }
    }

    function openCalc(id) {
        pushRecent(id);
        renderHomeList();
        navigate('#/c/' + id);
    }

    function goBack() {
        if (history.state && history.state.mc) history.back();
        else navigate('#/', { replace: true });
    }

    // ---------- Events ----------
    document.addEventListener('click', (e) => {
        const open = e.target.closest('[data-open]');
        if (open) { haptic('tap'); openCalc(open.dataset.open); return; }
        const star = e.target.closest('.star[data-fav]');
        if (star) { toggleFav(star.dataset.fav); return; }
        if (e.target.closest('[data-back]')) { goBack(); return; }
        const tab = e.target.closest('.tab[data-tab]');
        if (tab) {
            haptic('tap');
            const t = tab.dataset.tab;
            navigate(t === 'home' ? '#/' : '#/' + t, { replace: true });
        }
    });

    window.addEventListener('popstate', render);

    // ---------- Init ----------
    function init() {
        const tabDefs = { home: ['home', 'Calculators'], favorites: ['star', 'Favorites'], settings: ['tune', 'Settings'] };
        document.querySelectorAll('.tab').forEach((b) => {
            const [ic, label] = tabDefs[b.dataset.tab];
            b.replaceChildren(h('span', { class: 'pill' }, icon(ic)), h('span', { text: label }));
        });
        applyTheme();
        buildHome();
        checkSubscription();
        render();
        setInterval(checkSubscription, CONFIG.recheckIntervalMs);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSubscription(); });

        // Offline support for the web/PWA build (the native app already ships its files locally)
        if (!isNative && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
            navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
