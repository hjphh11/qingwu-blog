ALTER TABLE accounts ADD COLUMN username TEXT COLLATE NOCASE;
ALTER TABLE accounts ADD COLUMN username_provisional INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN email_verified_at INTEGER;
ALTER TABLE accounts ADD COLUMN password_set_at INTEGER;
ALTER TABLE accounts ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN locked_until INTEGER;
ALTER TABLE accounts ADD COLUMN matrix_user_id TEXT;
ALTER TABLE accounts ADD COLUMN migration_notice_at INTEGER;
ALTER TABLE accounts ADD COLUMN matrix_hs TEXT;
ALTER TABLE accounts ADD COLUMN matrix_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE accounts ADD COLUMN matrix_created_at INTEGER;
ALTER TABLE accounts ADD COLUMN matrix_pw_synced_at INTEGER;
ALTER TABLE accounts ADD COLUMN matrix_name_synced_at INTEGER;

UPDATE accounts SET username = 'user_' || id, username_provisional = 1,
  email_verified_at = created_at, password_set_at = CASE WHEN pass_hash IS NOT NULL THEN created_at END;
CREATE UNIQUE INDEX idx_accounts_username ON accounts(username) WHERE username IS NOT NULL;

-- One reservation per email and username until expiration. OTP purpose includes id.
CREATE TABLE auth_tickets (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL, token_hash TEXT UNIQUE, expires_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_tickets_exp ON auth_tickets(expires_at);

CREATE TABLE account_security_log (
  account_id INTEGER NOT NULL, action TEXT NOT NULL, ip_hash TEXT NOT NULL, ts INTEGER NOT NULL
);
