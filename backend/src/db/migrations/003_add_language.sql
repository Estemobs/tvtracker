ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en'));
ALTER TABLE shows ADD COLUMN synopsis_fr TEXT;
ALTER TABLE movies ADD COLUMN synopsis_fr TEXT;
