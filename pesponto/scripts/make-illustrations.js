'use strict';
// Gera ilustrações SVG originais (denim índigo + pesponto dourado) para os dados de demonstração.
// Uso: node scripts/make-illustrations.js
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'img', 'demo');
fs.mkdirSync(OUT, { recursive: true });

const C = { d950: '#0b1630', d900: '#0f1c38', d800: '#14264a', d700: '#1f3a68', d600: '#254583', d500: '#2f5597', d300: '#93a9d0', d200: '#c9d5ea', d100: '#e8edf5', gold: '#e4b33c', gold2: '#c8941a', white: '#ffffff' };
const f = (n) => +n.toFixed(1);
const svg = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const twill = (id, base, line, gap = 10) => `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><rect width="${gap}" height="${gap}" fill="${base}"/><line x1="0" y1="0" x2="0" y2="${gap}" stroke="${line}" stroke-width="2.2" opacity=".55"/></pattern>`;
const stitch = (d, color = C.gold, w = 3, dash = '12 9') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-dasharray="${dash}" stroke-linecap="round"/>`;
const bg = (w, h, a, b, id) => `<rect width="${w}" height="${h}" fill="url(#${id})"/>`;
const grad = (id, a, b, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 1}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

// ---------------- Capas (1600x600) ----------------
const W = 1600, H = 600;
const covers = [];
// 1 — sarja + bolso de jeans
covers.push(() => svg(W, H, `<rect width="${W}" height="${H}" fill="url(#t)"/><rect width="${W}" height="${H}" fill="url(#g)" opacity=".55"/>
<path d="M980 130h360v230q0 90-180 150q-180-60-180-150z" fill="${C.d600}" stroke="${C.d200}" stroke-width="3" opacity=".95"/>
${stitch('M1000 150h320v210q0 70-160 128q-160-58-160-128z', C.gold, 3.5)}
<path d="M1000 160l160 90 160-90" fill="none" stroke="${C.gold}" stroke-width="3" stroke-dasharray="12 9" opacity=".8"/>
<circle cx="1160" cy="262" r="12" fill="${C.gold}"/><circle cx="1160" cy="262" r="5" fill="${C.d800}"/>
${stitch('M60 520h760', C.gold, 3.5)}${stitch('M60 548h760', C.d200, 2.5, '8 8')}`, twill('t', C.d800, C.d600, 9) + grad('g', 'transparent', C.d950)));
// 2 — linha de costura
covers.push(() => svg(W, H, `<rect width="${W}" height="${H}" fill="url(#g)"/>
${[0, 1, 2, 3, 4].map((i) => stitch(`M-20 ${110 + i * 105}C400 ${40 + i * 105} 800 ${200 + i * 105} 1620 ${90 + i * 105}`, i % 2 ? C.d300 : C.gold, i % 2 ? 2.5 : 3.5, i % 2 ? '6 10' : '14 9')).join('')}
<g transform="translate(1180 190)"><rect width="260" height="26" rx="4" fill="${C.d200}"/><rect x="190" y="-90" width="26" height="90" fill="${C.d200}"/><rect x="120" y="-100" width="130" height="30" rx="6" fill="${C.d100}"/><rect x="60" y="26" width="26" height="170" fill="${C.d300}"/><rect x="28" y="196" width="90" height="16" rx="4" fill="${C.d300}"/><line x1="225" y1="-70" x2="225" y2="26" stroke="${C.gold}" stroke-width="3"/></g>`, grad('g', C.d800, C.d950)));
// 3 — rolos de tecido
covers.push(() => {
  const cols = [C.d600, C.d500, C.d700, C.gold2, C.d300, C.d600, C.d800];
  const rolls = cols.map((c, i) => { const x = 150 + i * 200, y = 150 + (i % 2) * 70; return `<g><rect x="${x}" y="${y}" width="150" height="320" rx="12" fill="${c}"/><rect x="${x}" y="${y}" width="150" height="320" rx="12" fill="url(#t${i % 2})" opacity=".35"/><ellipse cx="${x + 75}" cy="${y}" rx="75" ry="22" fill="${C.d100}"/><ellipse cx="${x + 75}" cy="${y}" rx="22" ry="7" fill="${C.d800}"/><path d="M${x + 6} ${y + 120}h138" stroke="${C.white}" stroke-width="2" stroke-dasharray="8 7" opacity=".6"/></g>`; }).join('');
  return svg(W, H, `<rect width="${W}" height="${H}" fill="${C.d900}"/><rect y="470" width="${W}" height="130" fill="${C.d950}"/>${rolls}${stitch('M0 500H1600', C.gold, 3, '16 10')}`, twill('t0', 'transparent', C.white, 7) + twill('t1', 'transparent', C.d950, 11));
});
// 4 — carretéis
covers.push(() => {
  const sp = (x, y, c, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="-60" y="-95" width="120" height="22" rx="5" fill="${C.d200}"/><rect x="-60" y="73" width="120" height="22" rx="5" fill="${C.d200}"/><rect x="-48" y="-73" width="96" height="146" fill="${c}"/>${Array.from({ length: 9 }, (_, i) => `<line x1="-48" y1="${-66 + i * 16}" x2="48" y2="${-58 + i * 16}" stroke="${C.white}" stroke-width="1.6" opacity=".28"/>`).join('')}</g>`;
  const items = [[260, 300, C.gold, 1.5], [520, 330, C.d500, 1.2], [760, 290, C.d300, 1.4], [1010, 340, C.gold2, 1.1], [1260, 300, C.d600, 1.5], [1460, 360, C.white, .9]];
  return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#g)"/>${items.map((i) => sp(...i)).join('')}${stitch('M0 520C400 470 900 570 1600 500', C.gold, 3.5)}`, grad('g', C.d700, C.d950));
});
// 5 — mesa de corte + tesoura
covers.push(() => svg(W, H, `<rect width="${W}" height="${H}" fill="${C.d900}"/><rect x="100" y="250" width="1400" height="30" rx="6" fill="${C.d200}"/><rect x="160" y="280" width="26" height="250" fill="${C.d300}"/><rect x="1414" y="280" width="26" height="250" fill="${C.d300}"/>
<rect x="190" y="215" width="1220" height="35" fill="${C.d600}"/><rect x="200" y="195" width="1200" height="20" fill="${C.d500}"/>
<path d="M330 150l260 20-40 30-200-10z M700 120l210 40-60 28z" fill="none" stroke="${C.gold}" stroke-width="3" stroke-dasharray="10 8"/>
<g transform="translate(1030 100) rotate(18)"><path d="M0 0l210 90M0 90L210 0" stroke="${C.d100}" stroke-width="12" stroke-linecap="round"/><circle cx="-12" cy="-6" r="32" fill="none" stroke="${C.gold}" stroke-width="12"/><circle cx="-12" cy="96" r="32" fill="none" stroke="${C.gold}" stroke-width="12"/></g>`));
// 6 — tambores de lavanderia
covers.push(() => {
  const drum = (x, y, c) => `<g transform="translate(${x} ${y})"><rect x="-130" y="-150" width="260" height="300" rx="22" fill="${C.d700}"/><circle r="92" fill="${C.d200}"/><circle r="74" fill="${c}"/><circle r="74" fill="url(#w)" opacity=".5"/><path d="M-50 10q25-30 50 0t50 0" fill="none" stroke="${C.white}" stroke-width="4" opacity=".7"/><rect x="-100" y="-130" width="60" height="14" rx="4" fill="${C.d300}"/><circle cx="80" cy="-122" r="8" fill="${C.gold}"/></g>`;
  return svg(W, H, `<rect width="${W}" height="${H}" fill="${C.d900}"/><rect y="470" width="${W}" height="130" fill="${C.d950}"/>${drum(330, 310, C.d500)}${drum(800, 310, C.d600)}${drum(1270, 310, C.d300)}${stitch('M0 490H1600', C.gold, 3, '16 10')}`, `<radialGradient id="w"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`);
});
// 7 — bastidores de bordado
covers.push(() => {
  const hoop = (x, y, r, c) => `<g transform="translate(${x} ${y})"><circle r="${r}" fill="${C.d100}"/><circle r="${r - 22}" fill="${c}"/><circle r="${r}" fill="none" stroke="${C.gold2}" stroke-width="14"/><circle r="${r - 36}" fill="none" stroke="${C.gold}" stroke-width="3.5" stroke-dasharray="7 6"/><path d="M-${r / 3} 0q${r / 6}-${r / 2.5} ${r / 3} 0t${r / 3} 0" fill="none" stroke="${C.white}" stroke-width="4"/><rect x="-14" y="-${r + 26}" width="28" height="30" rx="5" fill="${C.d300}"/></g>`;
  return svg(W, H, `<rect width="${W}" height="${H}" fill="url(#g)"/>${hoop(380, 320, 190, C.d600)}${hoop(860, 300, 150, C.d500)}${hoop(1250, 330, 200, C.d700)}`, grad('g', C.d800, C.d950));
});
// 8 — estamparia (rodo + padrão)
covers.push(() => svg(W, H, `<rect width="${W}" height="${H}" fill="${C.d100}"/><rect x="120" y="140" width="900" height="360" rx="10" fill="url(#p)"/><rect x="120" y="140" width="900" height="360" rx="10" fill="none" stroke="${C.d800}" stroke-width="12"/>
<g transform="translate(1120 120) rotate(14)"><rect width="300" height="40" rx="8" fill="${C.d800}"/><rect x="20" y="40" width="260" height="22" fill="${C.gold}"/><rect x="120" y="-120" width="60" height="130" rx="10" fill="${C.d600}"/></g>
${stitch('M60 560H1540', C.d800, 3, '14 10')}`, `<pattern id="p" width="60" height="60" patternUnits="userSpaceOnUse"><rect width="60" height="60" fill="${C.d800}"/><circle cx="15" cy="15" r="8" fill="${C.gold}"/><circle cx="45" cy="45" r="8" fill="${C.d300}"/><path d="M30 0l30 30-30 30-30-30z" fill="none" stroke="${C.d500}" stroke-width="2"/></pattern>`));
// 9 — malha fitness
covers.push(() => {
  let rows = '';
  for (let r = 0; r < 14; r++) { let cells = ''; for (let c = 0; c < 30; c++) cells += `<path d="M${c * 56 + (r % 2) * 28} ${r * 44}q14 22 28 0q14 22 28 0" />`; rows += cells; }
  return svg(W, H, `<rect width="${W}" height="${H}" fill="${C.d700}"/><g fill="none" stroke="${C.d300}" stroke-width="3" opacity=".55">${rows}</g><path d="M0 380C300 250 700 500 1100 330S1500 280 1600 300V600H0z" fill="${C.d900}" opacity=".85"/>${stitch('M0 395C300 265 700 515 1100 345S1500 295 1600 315', C.gold, 4)}`);
});
// 10 — camisas em cabides
covers.push(() => {
  const shirt = (x, y, c) => `<g transform="translate(${x} ${y})"><path d="M0-120q0-20 22-20" fill="none" stroke="${C.d300}" stroke-width="5"/><path d="M-110 -80l-30 40 36 34 22-18v130h164V-24l22 18 36-34-30-40-56-18q-12 26-48 26t-48-26z" fill="${c}"/><path d="M-26-98l26 38 26-38" fill="none" stroke="${C.white}" stroke-width="3" opacity=".7"/><line x1="0" y1="-60" x2="0" y2="92" stroke="${C.white}" stroke-width="2" stroke-dasharray="6 6" opacity=".6"/></g>`;
  return svg(W, H, `<rect width="${W}" height="${H}" fill="${C.d900}"/><rect x="40" y="80" width="1520" height="10" rx="5" fill="${C.d300}"/>${[[220, C.d500], [470, C.d600], [720, C.gold2], [970, C.d300], [1220, C.d500], [1440, C.d700]].map(([x, c]) => shirt(x, 250, c)).join('')}${stitch('M0 530H1600', C.gold, 3, '16 10')}`);
});

// ---------------- Galeria (1200x800) ----------------
const GW = 1200, GH = 800;
const room = (inner, tone = C.d100) => svg(GW, GH, `<rect width="${GW}" height="${GH}" fill="${tone}"/><rect y="610" width="${GW}" height="190" fill="${C.d200}"/><rect y="604" width="${GW}" height="8" fill="${C.d300}"/>${inner}`);
const gallery = [];
// 1 máquina reta
gallery.push(() => room(`<rect x="250" y="470" width="700" height="40" rx="6" fill="${C.d700}"/><rect x="300" y="510" width="26" height="150" fill="${C.d600}"/><rect x="874" y="510" width="26" height="150" fill="${C.d600}"/>
<path d="M330 470v-170q0-50 50-50h360q40 0 40 40v60h-90v120z" fill="${C.d800}"/><rect x="360" y="300" width="200" height="90" rx="10" fill="${C.d500}"/><circle cx="780" cy="300" r="26" fill="${C.gold}"/><rect x="700" y="400" width="14" height="70" fill="${C.d300}"/>${stitch('M360 440H860', C.gold, 3.5)}<rect x="480" y="540" width="240" height="14" rx="7" fill="${C.d300}"/>`));
// 2 overloque
gallery.push(() => room(`<rect x="230" y="480" width="740" height="40" rx="6" fill="${C.d700}"/><rect x="290" y="520" width="26" height="140" fill="${C.d600}"/><rect x="884" y="520" width="26" height="140" fill="${C.d600}"/>
<rect x="340" y="300" width="460" height="180" rx="22" fill="${C.d600}"/><rect x="380" y="330" width="120" height="70" rx="8" fill="${C.d100}"/><circle cx="640" cy="360" r="40" fill="${C.d800}"/><circle cx="640" cy="360" r="15" fill="${C.gold}"/>
<path d="M800 380h80l30 100h-110z" fill="${C.d500}"/>${[0, 1, 2].map((i) => `<line x1="${420 + i * 90}" y1="210" x2="${420 + i * 90}" y2="300" stroke="${C.gold}" stroke-width="4"/><circle cx="${420 + i * 90}" cy="200" r="12" fill="${C.d300}"/>`).join('')}${stitch('M340 450H900', C.gold, 3)}`));
// 3 mesa de corte
gallery.push(() => room(`<rect x="120" y="440" width="960" height="34" rx="6" fill="${C.d200}"/><rect x="170" y="474" width="26" height="190" fill="${C.d300}"/><rect x="1004" y="474" width="26" height="190" fill="${C.d300}"/>
<rect x="160" y="380" width="880" height="60" fill="${C.d600}"/><rect x="160" y="350" width="880" height="30" fill="${C.d500}"/><rect x="160" y="330" width="880" height="20" fill="${C.d700}"/>
<path d="M260 300h220M520 300h300" stroke="${C.gold}" stroke-width="4" stroke-dasharray="10 8"/><g transform="translate(860 190) rotate(16)"><path d="M0 0l120 60M0 60l120-60" stroke="${C.d800}" stroke-width="9" stroke-linecap="round"/><circle cx="-8" cy="-2" r="22" fill="none" stroke="${C.gold}" stroke-width="8"/><circle cx="-8" cy="62" r="22" fill="none" stroke="${C.gold}" stroke-width="8"/></g>`));
// 4 prateleira de tecidos
gallery.push(() => {
  const cols = [C.d600, C.d500, C.gold2, C.d700, C.d300, C.d800];
  const row = (y) => cols.map((c, i) => `<g><rect x="${120 + i * 165}" y="${y}" width="140" height="150" rx="8" fill="${c}"/><ellipse cx="${190 + i * 165}" cy="${y + 75}" rx="30" ry="34" fill="${C.d100}" opacity=".85"/><ellipse cx="${190 + i * 165}" cy="${y + 75}" rx="9" ry="10" fill="${C.d800}"/></g>`).join('');
  return room(`<rect x="90" y="120" width="1020" height="500" fill="${C.d800}"/>${row(150)}${row(340)}<rect x="90" y="300" width="1020" height="14" fill="${C.d300}"/><rect x="90" y="490" width="1020" height="14" fill="${C.d300}"/>${stitch('M90 560H1110', C.gold, 3)}`);
});
// 5 lavanderia
gallery.push(() => {
  const m = (x, c) => `<g transform="translate(${x} 0)"><rect x="0" y="220" width="320" height="400" rx="20" fill="${C.d700}"/><circle cx="160" cy="400" r="112" fill="${C.d200}"/><circle cx="160" cy="400" r="88" fill="${c}"/><path d="M100 410q30-34 60 0t60 0" fill="none" stroke="${C.white}" stroke-width="5" opacity=".7"/><rect x="30" y="245" width="110" height="18" rx="5" fill="${C.d300}"/><circle cx="270" cy="254" r="10" fill="${C.gold}"/></g>`;
  return room(`${m(130, C.d500)}${m(560, C.d600)}<rect x="1000" y="260" width="110" height="360" fill="${C.d300}" opacity=".6"/>`);
});
// 6 bordadeira
gallery.push(() => room(`<rect x="150" y="470" width="900" height="36" rx="6" fill="${C.d700}"/><rect x="200" y="506" width="24" height="160" fill="${C.d600}"/><rect x="976" y="506" width="24" height="160" fill="${C.d600}"/>
<rect x="190" y="250" width="820" height="220" rx="16" fill="${C.d800}"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${230 + i * 125}" y="200" width="70" height="60" rx="8" fill="${C.d500}"/><line x1="${265 + i * 125}" y1="260" x2="${265 + i * 125}" y2="330" stroke="${C.gold}" stroke-width="4"/><circle cx="${265 + i * 125}" cy="400" r="34" fill="${C.d100}"/><circle cx="${265 + i * 125}" cy="400" r="22" fill="${[C.d600, C.gold2, C.d500][i % 3]}"/>`).join('')}`));
// 7 passadoria
gallery.push(() => room(`<path d="M200 470h620l80 40H200z" fill="${C.d300}"/><rect x="300" y="510" width="24" height="150" fill="${C.d600}"/><rect x="640" y="510" width="24" height="150" fill="${C.d600}"/>
<rect x="230" y="440" width="560" height="30" rx="8" fill="${C.d100}"/><path d="M420 440l60-90h150q40 0 40 40v50z" fill="${C.d800}"/><rect x="470" y="370" width="120" height="16" rx="6" fill="${C.gold}"/>${[0, 1, 2].map((i) => `<path d="M${520 + i * 70} 330q-14-34 6-60t-4-52" fill="none" stroke="${C.d300}" stroke-width="5" stroke-linecap="round" opacity=".8"/>`).join('')}<path d="M900 140v470M900 140h160" stroke="${C.d300}" stroke-width="10" fill="none"/>${[0, 1].map((i) => `<path d="M${950 + i * 60} 150l-40 20 14 36 26-12v90h56v-90l26 12 14-36-40-20q-8 18-28 18t-28-18z" fill="${[C.d500, C.d600][i]}"/>`).join('')}`));
// 8 revisão de qualidade
gallery.push(() => room(`<rect x="130" y="420" width="940" height="30" rx="6" fill="${C.d200}"/><rect x="180" y="450" width="24" height="210" fill="${C.d300}"/><rect x="996" y="450" width="24" height="210" fill="${C.d300}"/>
<path d="M300 420l40-90 90 20 80-20 80 20 90-20 40 90z" fill="${C.d600}"/>${stitch('M340 420l40-60M430 350l30 70M510 330l30 90', C.gold, 3)}<rect x="720" y="250" width="14" height="170" fill="${C.d300}"/><path d="M727 250q-120-10-150 60" fill="none" stroke="${C.d300}" stroke-width="12"/><ellipse cx="560" cy="318" rx="62" ry="20" fill="${C.gold}" opacity=".9"/><path d="M850 330l50 52 100-110" fill="none" stroke="${C.gold2}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`));
// 9 embalagem e expedição
gallery.push(() => {
  const box = (x, y, w, h, c) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/><rect x="${x + w * 0.42}" y="${y}" width="${w * 0.16}" height="${h}" fill="${C.d100}" opacity=".7"/><path d="M${x} ${y + 16}h${w}" stroke="${C.d950}" stroke-width="2" opacity=".35"/></g>`;
  return room(`${box(150, 420, 260, 200, C.d600)}${box(430, 470, 220, 150, C.d500)}${box(680, 400, 280, 220, C.d700)}${box(190, 260, 200, 160, C.d500)}${box(720, 230, 200, 170, C.gold2)}<rect x="980" y="480" width="130" height="140" fill="${C.d100}"/>${stitch('M980 540h130', C.d300, 3, '8 6')}`);
});
// 10 mesa de modelagem
gallery.push(() => room(`<rect x="110" y="430" width="980" height="30" rx="6" fill="${C.d200}"/><rect x="160" y="460" width="24" height="200" fill="${C.d300}"/><rect x="1016" y="460" width="24" height="200" fill="${C.d300}"/>
<path d="M200 430l120-210 140 20 20 190z" fill="${C.d100}" stroke="${C.d500}" stroke-width="4"/>${stitch('M240 410l90-150 100 14', C.gold, 3, '9 7')}
<g transform="translate(640 330) rotate(-12)"><rect width="320" height="34" rx="4" fill="${C.gold}"/>${Array.from({ length: 16 }, (_, i) => `<line x1="${i * 20 + 10}" y1="0" x2="${i * 20 + 10}" y2="${i % 2 ? 12 : 20}" stroke="${C.d800}" stroke-width="2"/>`).join('')}</g><path d="M830 190l50-10-10 50z" fill="${C.d600}"/><path d="M1000 410l60-190" stroke="${C.d300}" stroke-width="8" stroke-linecap="round"/>`));

// ---------------- Logotipos (256x256) ----------------
const logos = [
  ['DS', C.d800, C.gold], ['PC', C.gold, C.d900], ['RC', C.d600, C.white], ['CP', C.d900, C.gold], ['LO', C.d700, C.gold], ['CT', C.gold2, C.white], ['FM', C.d500, C.white], ['DR', C.d800, C.d200],
  ['Q4', C.d600, C.gold], ['NF', C.gold, C.d800], ['ML', C.d700, C.white], ['MP', C.d900, C.d200], ['FM', C.d500, C.gold], ['CB', C.gold2, C.d900], ['AV', C.d800, C.gold], ['CS', C.d600, C.d100],
];
const logo = ([t, bgc, fg], i) => svg(256, 256, `<rect width="256" height="256" rx="48" fill="${bgc}"/><rect width="256" height="256" rx="48" fill="url(#t)" opacity=".28"/><rect x="14" y="14" width="228" height="228" rx="36" fill="none" stroke="${fg}" stroke-width="3" stroke-dasharray="10 8" opacity=".75"/><text x="128" y="156" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="800" font-size="${t.length > 1 ? 96 : 120}" letter-spacing="-4" fill="${fg}">${t}</text><path d="M60 196h136" stroke="${fg}" stroke-width="5" stroke-dasharray="14 9" stroke-linecap="round" opacity=".9"/>`, twill('t', 'transparent', C.white, 9));

const write = (name, content) => {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, content);
  const kb = Buffer.byteLength(content) / 1024;
  if (kb > 40) throw new Error(`${name} tem ${kb.toFixed(1)} KB (limite 40 KB)`);
};
covers.forEach((fn, i) => write(`cover-${i + 1}.svg`, fn()));
gallery.forEach((fn, i) => write(`gal-${i + 1}.svg`, fn()));
logos.forEach((l, i) => write(`logo-${i + 1}.svg`, logo(l, i)));
console.log(`Ilustrações geradas em ${OUT}: ${covers.length} capas, ${gallery.length} galeria, ${logos.length} logotipos.`);
