(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // Pré-visualização de imagens escolhidas
  $$('input[type=file][data-preview]').forEach((inp) => inp.addEventListener('change', () => {
    const t = document.getElementById(inp.dataset.preview); const f = inp.files && inp.files[0];
    if (t && f && f.type.startsWith('image/')) { t.src = URL.createObjectURL(f); t.hidden = false; }
  }));

  // Etapas: reordenar com botões subir/descer
  const list = $('#steps-list');
  if (list) {
    const renumber = () => $$('li.step-item', list).forEach((li, i) => { const p = $('[name=position]', li); if (p) p.value = i; });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-move]');
      if (b) {
        const li = b.closest('li'); const dir = b.dataset.move;
        if (dir === 'up' && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
        if (dir === 'down' && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
        renumber(); b.focus();
        const live = $('#steps-live'); if (live) live.textContent = 'Etapa movida para a posição ' + ($$('li.step-item', list).indexOf(li) + 1);
        return;
      }
      const d = e.target.closest('[data-remove-step]'); if (d) { d.closest('li').remove(); renumber(); }
    });
    list.addEventListener('change', (e) => { const s = e.target.closest('select[name=mode]'); if (s) s.closest('li').classList.toggle('is-none', s.value === 'nao_oferece'); });
    const add = $('[data-add-step]');
    if (add) add.addEventListener('click', () => {
      const tpl = $('#step-template').content.firstElementChild.cloneNode(true); list.appendChild(tpl); renumber(); $('[name=name]', tpl).focus();
    });
    renumber();
  }

  // Máquinas: ao escolher um tipo sugerido, preenche nome, setor e operação
  const mt = $('#m-type');
  if (mt) {
    const custom = $('#m-custom-wrap');
    const apply = () => {
      const o = mt.selectedOptions[0]; const isCustom = mt.value === '__outro';
      custom.hidden = !isCustom; $('#m-custom').required = isCustom;
      if (!isCustom && o && o.dataset.name) {
        const nm = $('#m-name'); if (!nm.value || nm.dataset.auto === '1') { nm.value = o.dataset.name; nm.dataset.auto = '1'; }
        if (!$('#m-sector').value) $('#m-sector').value = o.dataset.sector || '';
        if (!$('#m-op').value) $('#m-op').value = o.dataset.op || '';
      }
    };
    mt.addEventListener('change', apply); $('#m-name').addEventListener('input', (e) => { e.target.dataset.auto = '0'; }); apply();
  }

  // Localização: consulta de CEP e geocodificação
  const cepBtn = $('[data-cep-lookup]'), geoBtn = $('[data-geocode]'), msg = $('#geo-msg');
  const say = (t, ok) => { if (msg) { msg.textContent = t; msg.className = 'hint ' + (ok ? '' : 'error-text'); } };
  const f = (n) => document.querySelector('[name=' + n + ']');
  if (cepBtn) cepBtn.addEventListener('click', async () => {
    const cep = f('cep').value.replace(/\D/g, ''); if (cep.length !== 8) return say('Informe um CEP com 8 dígitos.', false);
    say('Consultando CEP…', true);
    const r = await fetch('/api/cep/' + cep).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r) return say('CEP não encontrado. Preencha o endereço manualmente.', false);
    if (r.street) f('street').value = r.street; if (r.neighborhood) f('neighborhood').value = r.neighborhood; f('city').value = r.city; f('state').value = r.state;
    say('Endereço preenchido. Confira os dados e clique em “Localizar no mapa”.', true);
  });
  if (geoBtn) geoBtn.addEventListener('click', async () => {
    const q = [f('street').value && (f('street').value + (f('number').value ? ', ' + f('number').value : '')), f('neighborhood').value, f('city').value, f('state').value, f('cep').value].filter(Boolean).join(', ');
    if (!f('city').value) return say('Informe ao menos a cidade e o estado.', false);
    say('Localizando…', true);
    const r = (await fetch('/api/geocode?q=' + encodeURIComponent(q)).then((x) => (x.ok ? x.json() : null)).catch(() => null))
      || (await fetch('/api/geocode?q=' + encodeURIComponent(f('city').value + ' ' + f('state').value)).then((x) => (x.ok ? x.json() : null)).catch(() => null));
    if (!r) return say('Não encontramos esse endereço. Você pode informar latitude e longitude manualmente.', false);
    f('lat').value = r.lat.toFixed(6); f('lng').value = r.lng.toFixed(6); say('Localizado: ' + r.label + '. A posição será salva ao enviar o formulário.', true);
  });
})();
