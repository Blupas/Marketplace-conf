'use strict';
// Limitador simples em memória (por processo). Em múltiplas instâncias, troque por Redis.
const buckets = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k); }, 60_000).unref();

function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return { ok: b.n <= max, retryAfter: Math.ceil((b.reset - now) / 1000) };
}
function limit(name, max, windowMs, message = 'Muitas tentativas. Aguarde alguns instantes e tente de novo.') {
  return (req, res, next) => {
    if (process.env.DISABLE_RATE_LIMIT === '1') return next();
    const r = hit(`${name}:${req.ip}`, max, windowMs);
    if (r.ok) return next();
    res.set('Retry-After', String(r.retryAfter));
    if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') return res.status(429).json({ error: message });
    return res.status(429).render('erro', { title: 'Muitas tentativas', code: 429, message });
  };
}
module.exports = { limit, hit };
