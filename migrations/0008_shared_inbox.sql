-- Shared mailbox support: Step 1 — DB schema
--
-- Decision: is_read and is_starred remain shared across all members (Front-style).
-- One row per email; mailbox_id scopes queries instead of user_id for shared mail.
-- emails.user_id stays NOT NULL; for shared inbound it holds owner_user_id as bookkeeping.

CREATE TABLE mailboxes (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE mailbox_members (
	mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
	user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role       TEXT NOT NULL DEFAULT 'member', -- 'member' | 'manager'
	PRIMARY KEY (mailbox_id, user_id)
);

ALTER TABLE emails    ADD COLUMN mailbox_id TEXT REFERENCES mailboxes(id);
ALTER TABLE addresses ADD COLUMN mailbox_id TEXT REFERENCES mailboxes(id);
ALTER TABLE domains   ADD COLUMN catchall_mailbox_id TEXT REFERENCES mailboxes(id);

-- Member lookup (hooks.server.ts loads mailboxes per user on every request)
CREATE INDEX idx_mailbox_members_user ON mailbox_members(user_id, mailbox_id);

-- List queries: replaces the plan's incomplete (mailbox_id, deleted_at, is_read) index
CREATE INDEX idx_emails_mailbox_created ON emails(mailbox_id, created_at DESC)
  WHERE mailbox_id IS NOT NULL;

-- Thread resolution: resolveThreadId and listThreadMessages scope by mailbox_id
CREATE INDEX idx_emails_mailbox_thread ON emails(mailbox_id, thread_id)
  WHERE mailbox_id IS NOT NULL;

CREATE INDEX idx_emails_mailbox_thread_key ON emails(mailbox_id, thread_key)
  WHERE mailbox_id IS NOT NULL;

CREATE INDEX idx_emails_mailbox_message_id ON emails(mailbox_id, message_id)
  WHERE mailbox_id IS NOT NULL;
