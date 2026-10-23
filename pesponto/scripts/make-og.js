'use strict';
const sharp = require('sharp');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#14264A"/>
<g stroke="#1B3463" stroke-width="2">${Array.from({ length: 40 }, (_, i) => `<path d="M${-200 + i * 40} 630 L${430 + i * 40} 0"/>`).join('')}</g>
<rect x="80" y="90" width="84" height="84" rx="20" fill="#fff"/>
<path d="M104 150V112h22a11 11 0 0 1 0 22h-22" fill="none" stroke="#14264A" stroke-width="7" stroke-linecap="round"/>
<text x="190" y="150" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="64" fill="#fff">Pesponto</text>
<text x="80" y="330" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="78" fill="#fff">Encontre a confecção</text>
<text x="80" y="420" font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="78" fill="#fff">pela estrutura e pela capacidade</text>
<path d="M80 480h1040" stroke="#E4B33C" stroke-width="5" stroke-dasharray="18 14" stroke-linecap="round"/>
<text x="80" y="548" font-family="Helvetica,Arial,sans-serif" font-size="34" fill="#C9D5EA">Máquinas, processo, localização e contato direto.</text></svg>`;
sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '..', 'public', 'img', 'og-default.png')).then(() => console.log('og ok'));
