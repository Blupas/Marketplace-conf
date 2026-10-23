-- Pesponto — esquema relacional (SQLite). Portável para PostgreSQL com ajustes mínimos de tipos.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'buscador' CHECK (role IN ('buscador','anunciante','admin')),
  phone           TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  lgpd_consent_at TEXT,
  terms_version   TEXT,
  reset_token_hash TEXT,
  reset_expires   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  slug      TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'empresa' CHECK (kind IN ('empresa','segmento','servico')),
  icon      TEXT,
  description TEXT,
  position  INTEGER NOT NULL DEFAULT 0,
  active    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  features    TEXT NOT NULL DEFAULT '[]',
  search_boost INTEGER NOT NULL DEFAULT 0,
  available   INTEGER NOT NULL DEFAULT 0,   -- 0 = "em breve" (cobrança desativada no lançamento)
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS companies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  legal_name    TEXT,
  cnpj          TEXT,
  tagline       TEXT,
  description   TEXT,
  history       TEXT,
  founded_year  INTEGER,
  specialties   TEXT,
  fabrics       TEXT,
  logo          TEXT,
  cover         TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  email         TEXT,
  website       TEXT,
  instagram     TEXT,
  facebook      TEXT,
  linkedin      TEXT,
  hours         TEXT,
  employees     INTEGER,
  shifts        TEXT,
  min_batch     INTEGER,
  lead_time_days INTEGER,
  attends_small  INTEGER NOT NULL DEFAULT 0,
  attends_medium INTEGER NOT NULL DEFAULT 0,
  attends_large  INTEGER NOT NULL DEFAULT 0,
  availability  TEXT CHECK (availability IN ('disponivel','limitada','indisponivel')),
  availability_updated_at TEXT,
  availability_note TEXT,
  status        TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','pendente','aprovado','rejeitado','suspenso')),
  status_reason TEXT,
  featured      INTEGER NOT NULL DEFAULT 0,
  featured_until TEXT,
  plan_id       INTEGER REFERENCES plans(id),
  is_demo       INTEGER NOT NULL DEFAULT 0,
  name_norm     TEXT NOT NULL DEFAULT '',
  search_text   TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_companies_status ON companies(status);
CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_id);

CREATE TABLE IF NOT EXISTS company_addresses (
  company_id   INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  cep          TEXT,
  street       TEXT,
  number       TEXT,
  complement   TEXT,
  neighborhood TEXT,
  city         TEXT,
  state        TEXT,
  lat          REAL,
  lng          REAL,
  pub_lat      REAL,   -- coordenadas PÚBLICAS (exatas ou aproximadas conforme 'privacy')
  pub_lng      REAL,
  geocoded     INTEGER NOT NULL DEFAULT 0,
  privacy      TEXT NOT NULL DEFAULT 'exata' CHECK (privacy IN ('exata','aproximada','cidade'))
);
CREATE INDEX IF NOT EXISTS idx_addr_city ON company_addresses(city, state);

CREATE TABLE IF NOT EXISTS company_categories (
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, category_id)
);

CREATE TABLE IF NOT EXISTS company_capacity (
  company_id      INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  avg_monthly     INTEGER,
  max_monthly     INTEGER,
  available_monthly INTEGER,
  per_day         INTEGER,
  per_shift       INTEGER,
  production_staff INTEGER,
  piece_types     TEXT,
  min_batch       INTEGER,
  lead_time_days  INTEGER,
  notes           TEXT,
  updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS services (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'servico' CHECK (kind IN ('servico','produto')),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  fabrics     TEXT,
  piece_types TEXT,
  min_batch   INTEGER,
  capacity_note TEXT,
  lead_time_days INTEGER,
  price_min_cents INTEGER,
  price_max_cents INTEGER,
  price_unit  TEXT,
  conditions  TEXT,
  search_text TEXT NOT NULL DEFAULT '',
  views       INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_services_company ON services(company_id);

CREATE TABLE IF NOT EXISTS machines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  brand       TEXT,
  model       TEXT,
  operation   TEXT,
  sector      TEXT,
  photo       TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_machines_company ON machines(company_id);

CREATE TABLE IF NOT EXISTS production_steps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  step_key    TEXT,
  name        TEXT NOT NULL,
  description TEXT,
  mode        TEXT NOT NULL DEFAULT 'interna' CHECK (mode IN ('interna','terceirizada','nao_oferece')),
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_steps_company ON production_steps(company_id);

CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('imagem','video_upload','video_embed')),
  path        TEXT NOT NULL,
  thumb       TEXT,
  caption     TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  hidden      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_media_company ON media(company_id);

CREATE TABLE IF NOT EXISTS quote_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  quantity    INTEGER,
  message     TEXT NOT NULL,
  consent_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','visto','respondido','arquivado')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_company ON quote_requests(company_id, created_at);

-- Eventos de uso (sem IP, sem dados pessoais)
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  service_id  INTEGER REFERENCES services(id) ON DELETE CASCADE,
  term        TEXT,
  day         TEXT NOT NULL DEFAULT (date('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_company ON events(company_id, type, day);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, day);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reporter_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL,
  details     TEXT,
  contact     TEXT,
  status      TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','procedente','improcedente')),
  resolution  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS moderation_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banners (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT NOT NULL,
  text      TEXT,
  link      TEXT,
  cta       TEXT,
  active    INTEGER NOT NULL DEFAULT 1,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  message    TEXT NOT NULL,
  handled    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geocode_cache (
  query      TEXT PRIMARY KEY,
  lat        REAL,
  lng        REAL,
  label      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
