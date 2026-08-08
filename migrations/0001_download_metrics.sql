CREATE TABLE IF NOT EXISTS download_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS download_attempts_fingerprint_created
  ON download_attempts (fingerprint, created_at);

CREATE TABLE IF NOT EXISTS download_tickets (
  token TEXT PRIMARY KEY,
  book_key TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS download_tickets_expires
  ON download_tickets (expires_at);

CREATE TABLE IF NOT EXISTS download_events (
  fingerprint TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
  event_day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, book_id, format, event_day)
);

CREATE TABLE IF NOT EXISTS download_totals (
  book_id INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('epub', 'pdf')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, format)
);
