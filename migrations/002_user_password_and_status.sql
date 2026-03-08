-- Add email/password auth and user status (pending vs active).
-- New registrations are pending; only active users can use the system.

-- Add password hash for email/password login (nullable; OAuth users don't have one)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Add status: 'pending' = awaiting approval, 'active' = can use system
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

-- Ensure existing users are active
UPDATE users SET status = 'active' WHERE status IS NULL OR status = '';

-- Constraint so status is one of allowed values
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('pending', 'active'));
