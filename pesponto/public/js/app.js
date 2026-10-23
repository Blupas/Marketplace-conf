/* Pesponto — comportamento global (sem dependências). */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const PP = (window.PP = window.PP || {});

  let toastTimer;
  PP.toast = (msg) => {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  };
  let csrfPromise;
  PP.csrf = () => (csrfPromise = csrfPromise || fetch('/api/csrf', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => j.token));
  PP.post = async (url, body) => {
    const token = await PP.csrf();
    const res = await fetch(url, { method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': token, 'x-requested-with': 'fetch', Accept: 'application/json' }, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch (e) { /* vazio */ }
    return { ok: res.ok, status: res.status, data };
  };
  PP.geolocate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Seu navegador não permite usar a localização.'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: +p.coords.latitude.toFixed(4), lng: +p.coords.longitude.toFixed(4) }),
      (e) => reject(new Error(e.code === 1 ? 'Você não permitiu o acesso à localização. Informe uma cidade ou CEP.' : 'Não foi possível obter sua localização. Informe uma cidade ou CEP.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  });

  // Menu móvel
  const toggle = $('.nav-toggle'), nav = $('#menu-principal');
  if (toggle && nav) toggle.addEventListener('click', () => { const o = nav.classList.toggle('is-open'); toggle.setAttribute('aria-expanded', String(o)); });
  document.addEventListener('click', (e) => { const d = $('.user-menu[open]'); if (d && !d.contains(e.target)) d.removeAttribute('open'); });

  // Favoritos
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fav]'); if (!b) return;
    e.preventDefault();
    const r = await PP.post('/api/favoritos/' + b.dataset.fav);
    if (r.status === 401) { location.href = '/entrar?next=' + encodeURIComponent(location.pathname + location.search); return; }
    if (!r.ok) return PP.toast(r.data.error || 'Não foi possível salvar. Tente de novo.');
    $$('[data-fav="' + b.dataset.fav + '"]').forEach((x) => {
      x.setAttribute('aria-pressed', String(r.data.favorite));
      const l = $('[data-fav-label]', x); if (l) l.textContent = r.data.favorite ? 'Favoritada' : 'Favoritar';
    });
    PP.toast(r.data.favorite ? 'Salva nos favoritos.' : 'Removida dos favoritos.');
  });

  // Comparação (salva neste navegador)
  const KEY = 'pp_compare', MAX = 4;
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { return []; } };
  const save = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) { /* sem armazenamento */ } };
  PP.syncCompare = () => {
    const list = load(), ids = new Set(list.map((x) => String(x.id)));
    $$('[data-compare]').forEach((c) => { c.checked = ids.has(c.dataset.compare); });
    const tray = $('#compare-tray'); if (!tray) return;
    tray.hidden = list.length === 0 || location.pathname === '/comparar';
    $('[data-compare-count]', tray).textContent = list.length;
    $('[data-compare-label]', tray).textContent = list.length === 1 ? 'empresa selecionada' : 'empresas selecionadas';
    const ul = $('[data-compare-list]', tray); ul.innerHTML = '';
    list.forEach((x) => {
      const li = document.createElement('li'); li.textContent = x.name + ' ';
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', 'Remover ' + x.name + ' da comparação'); b.dataset.compareDrop = x.id; b.innerHTML = '<svg class="i i-sm"><use href="#i-x"/></svg>';
      li.appendChild(b); ul.appendChild(li);
    });
    const go = $('[data-compare-go]', tray); go.href = '/comparar?ids=' + list.map((x) => x.id).join(',');
    go.setAttribute('aria-disabled', list.length < 2 ? 'true' : 'false');
  };
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-compare]'); if (!c) return;
    let list = load();
    if (c.checked) {
      if (list.length >= MAX) { c.checked = false; return PP.toast('Você pode comparar até ' + MAX + ' empresas. Remova uma para adicionar outra.'); }
      if (!list.some((x) => String(x.id) === c.dataset.compare)) list.push({ id: +c.dataset.compare, name: c.dataset.name, slug: c.dataset.slug });
    } else list = list.filter((x) => String(x.id) !== c.dataset.compare);
    save(list); PP.syncCompare();
  });
  document.addEventListener('click', (e) => {
    const drop = e.target.closest('[data-compare-drop]'); if (drop) { save(load().filter((x) => String(x.id) !== drop.dataset.compareDrop)); PP.syncCompare(); return; }
    if (e.target.closest('[data-compare-clear]')) { save([]); PP.syncCompare(); return; }
    const rm = e.target.closest('[data-compare-remove]');
    if (rm) { const rest = load().filter((x) => String(x.id) !== rm.dataset.compareRemove); save(rest); location.href = '/comparar' + (rest.length ? '?ids=' + rest.map((x) => x.id).join(',') : ''); return; }
    const go = e.target.closest('[data-compare-go]'); if (go && go.getAttribute('aria-disabled') === 'true') { e.preventDefault(); PP.toast('Selecione pelo menos 2 empresas para comparar.'); }
  });
  if (location.pathname === '/comparar') {
    const ids = new URLSearchParams(location.search).get('ids');
    if (!ids && load().length) location.replace('/comparar?ids=' + load().map((x) => x.id).join(','));
    else if (ids) {
      const known = load(); const list = ids.split(',').map((id) => known.find((x) => String(x.id) === id) || { id: +id, name: 'Empresa ' + id, slug: '' });
      $$('[data-compare-remove]').forEach((b) => { const k = list.find((x) => String(x.id) === b.dataset.compareRemove); const a = b.parentElement.querySelector('a'); if (k && a) k.name = a.textContent; });
      save(list);
    }
  }
  PP.syncCompare();

  // Copiar, compartilhar, rastrear contato
  const track = (type, company) => { if (company) PP.post('/api/evento', { type, company_id: +company }).catch(() => {}); };
  document.addEventListener('click', async (e) => {
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); PP.toast('Copiado: ' + cp.dataset.copy); }
      catch (err) { const t = document.createElement('textarea'); t.value = cp.dataset.copy; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); PP.toast('Copiado.'); } catch (x) { PP.toast('Não foi possível copiar.'); } t.remove(); }
      track('copiar_contato', cp.dataset.company); return;
    }
    const sh = e.target.closest('[data-share]');
    if (sh) {
      const data = { title: sh.dataset.title || document.title, url: location.href.split('#')[0] };
      if (navigator.share) { try { await navigator.share(data); } catch (err) { /* cancelado */ } }
      else { try { await navigator.clipboard.writeText(data.url); PP.toast('Link copiado.'); } catch (err) { PP.toast(data.url); } }
      return;
    }
    const t = e.target.closest('[data-track]'); if (t) track(t.dataset.track, t.dataset.company);
    const r = e.target.closest('[data-route]'); if (r) track('rota', r.dataset.route);
  });

  // Confirmações, autosubmit, filtros móveis, lightbox
  document.addEventListener('submit', (e) => { const f = e.target.closest('[data-confirm]'); if (f && !confirm(f.dataset.confirm)) e.preventDefault(); });
  document.addEventListener('change', (e) => { const s = e.target.closest('[data-autosubmit]'); if (s) s.form.submit(); });
  const ft = $('[data-filters-toggle]');
  if (ft) ft.addEventListener('click', () => { const f = $('#filters'); const o = f.classList.toggle('is-open'); ft.setAttribute('aria-expanded', String(o)); });
  const gf = $('[data-geo-fill]');
  if (gf) gf.addEventListener('click', async () => {
    try { const p = await PP.geolocate(); const f = gf.closest('form'); f.elements.lat.value = p.lat; f.elements.lng.value = p.lng; f.elements.perto.value = ''; f.elements.ordem.value = 'proximidade'; f.submit(); }
    catch (err) { PP.toast(err.message); }
  });
  const lb = $('#lightbox');
  if (lb && typeof lb.showModal === 'function') {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lightbox]');
      if (b) { $('img', lb).src = b.dataset.lightbox; $('img', lb).alt = b.dataset.caption || ''; $('figcaption', lb).textContent = b.dataset.caption || ''; lb.showModal(); return; }
      if (e.target.closest('[data-lightbox-close]') || e.target === lb) lb.close();
    });
  }

  // Seção atual na página da empresa
  const sub = $$('.co-subnav a');
  if (sub.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) sub.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
    }), { rootMargin: '-30% 0px -60% 0px' });
    sub.forEach((a) => { const s = $(a.getAttribute('href')); if (s) io.observe(s); });
  }
})();
