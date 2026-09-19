-- M7: make system-notification dedupe structural instead of best-effort.
-- Concurrent identical events raced check-then-insert and produced duplicate
-- feed messages. Identical (room, dedupeId, content) inserts now collide at
-- the database; delivery code converges onto the winner (P2002 → adopt).
-- Different content under the same dedupeId still delivers (re-marks with new
-- information are not suppressed).
CREATE UNIQUE INDEX "chat_messages_room_dedupe_content_uniq"
  ON "chat_messages" ("roomId", ((metadata ->> 'dedupeId')), md5(coalesce(title, '') || '|' || coalesce(content, '')))
  WHERE metadata ->> 'dedupeId' IS NOT NULL;
