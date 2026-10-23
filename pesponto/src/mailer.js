'use strict';
const config = require('./config');
let transport = null;
if (config.smtp) transport = require('nodemailer').createTransport(config.smtp);

async function sendMail({ to, subject, text }) {
  if (!transport) {
    if (process.env.NODE_ENV !== 'test') console.log(`\n[e-mail não enviado — SMTP não configurado]\nPara: ${to}\nAssunto: ${subject}\n${text}\n`);
    return { logged: true };
  }
  await transport.sendMail({ from: config.smtp.from, to, subject, text });
  return { sent: true };
}
module.exports = { sendMail };
