ALTER TABLE download_tickets
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'download'
  CHECK (purpose IN ('read', 'download'));
