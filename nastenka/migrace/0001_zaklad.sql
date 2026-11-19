-- Nástěnka: kopie stavu z GitHubu. Zdroj pravdy je GitHub, D1 jde kdykoli smazat a znovu načíst.

-- Repozitáře, na kterých je nainstalovaná GitHub App nástěnky. `polozky` je JSON snímek otevřených
-- a nedávno uzavřených issues a PR (viz src/github.mjs, polozkyZOdpovedi); přepisuje se celý.
CREATE TABLE repozitare (
  id INTEGER PRIMARY KEY,          -- id repozitáře na GitHubu
  full_name TEXT NOT NULL,
  installation_id INTEGER NOT NULL,
  pridano TEXT NOT NULL,
  synchronizovano TEXT,
  polozky TEXT,
  chyba TEXT
);
CREATE INDEX repozitare_instalace ON repozitare (installation_id);

-- Log webhooků: kdo co kdy změnil. Základ pro pozdější metriky; cron maže záznamy starší 90 dní.
CREATE TABLE udalosti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repozitar TEXT,
  typ TEXT NOT NULL,
  kdo TEXT,
  kdy TEXT NOT NULL
);
CREATE INDEX udalosti_kdy ON udalosti (kdy);

-- Přihlášení. `token` je uživatelský token GitHubu zašifrovaný AES-GCM klíčem SESSION_KEY.
-- Relace platí, dokud platí token (u GitHub App obvykle 8 hodin), pak se vlastník přihlásí znovu.
CREATE TABLE relace (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL,
  token TEXT NOT NULL,
  plati_do TEXT NOT NULL
);

-- Instalační tokeny aplikace (platí hodinu), zašifrované stejně. Šetří požadavky na GitHub.
CREATE TABLE tokeny (
  installation_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL,
  plati_do TEXT NOT NULL
);
