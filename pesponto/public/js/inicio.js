(function () {
  'use strict';
  const form = document.querySelector('[data-near-form]'); if (!form) return;
  const out = document.querySelector('[data-near-results]'), hint = document.querySelector('[data-near-hint]');
  const load = async (params) => {
    out.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    hint.hidden = true;
    try {
      const r = await fetch('/fragmento/empresas?' + new URLSearchParams(params), { credentials: 'same-origin' });
      if (!r.ok) { const j = await r.json().catch(() => ({})); out.innerHTML = ''; hint.hidden = false; hint.textContent = j.error || 'Não foi possível buscar agora. Tente novamente.'; return; }
      out.innerHTML = await r.text(); PP.syncCompare();
    } catch (e) { out.innerHTML = ''; hint.hidden = false; hint.textContent = 'Sem conexão. Tente novamente.'; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); const v = form.elements.perto.value.trim(); if (!v) { PP.toast('Informe uma cidade ou CEP.'); return; } load({ perto: v }); });
  form.querySelector('[data-geo]').addEventListener('click', async () => {
    const b = form.querySelector('[data-geo]'); b.disabled = true;
    try { const p = await PP.geolocate(); await load({ lat: p.lat, lng: p.lng }); } catch (e) { hint.hidden = false; hint.textContent = e.message; } finally { b.disabled = false; }
  });
})();
