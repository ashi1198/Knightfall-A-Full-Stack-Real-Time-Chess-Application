-- Fresh install
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(50) UNIQUE NOT NULL,
  password   TEXT,                    -- NULL for Google-only accounts
  email      TEXT UNIQUE,
  google_id  TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Existing database (run once if your users table already exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
