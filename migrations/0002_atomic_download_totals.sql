CREATE TRIGGER IF NOT EXISTS increment_download_total
AFTER INSERT ON download_events
BEGIN
  INSERT INTO download_totals (book_id, format, count, updated_at)
  VALUES (NEW.book_id, NEW.format, 1, NEW.created_at)
  ON CONFLICT(book_id, format) DO UPDATE SET
    count = count + 1,
    updated_at = excluded.updated_at;
END;
