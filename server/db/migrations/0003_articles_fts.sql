CREATE VIRTUAL TABLE articles_fts USING fts5(title, content, tokenize='unicode61 remove_diacritics 2');

INSERT INTO articles_fts(rowid, title, content)
SELECT id, title, coalesce(full_text_html, content_html, summary_html, '') FROM articles;

CREATE TRIGGER articles_fts_insert AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, content) VALUES (new.id, new.title, coalesce(new.full_text_html, new.content_html, new.summary_html, ''));
END;

CREATE TRIGGER articles_fts_delete AFTER DELETE ON articles BEGIN
  DELETE FROM articles_fts WHERE rowid = old.id;
END;

CREATE TRIGGER articles_fts_update AFTER UPDATE OF title, summary_html, content_html, full_text_html ON articles BEGIN
  DELETE FROM articles_fts WHERE rowid = old.id;
  INSERT INTO articles_fts(rowid, title, content) VALUES (new.id, new.title, coalesce(new.full_text_html, new.content_html, new.summary_html, ''));
END;
