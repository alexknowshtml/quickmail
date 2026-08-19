import { error } from '@sveltejs/kit';
import type { D1Database } from '@cloudflare/workers-types';
import type { SharedMailbox, SharedMailboxDetail, MailboxMember, MailAddress } from '$lib/types';

export async function listMailboxesForUser(
	db: D1Database,
	userId: string
): Promise<SharedMailbox[]> {
	const rows = await db
		.prepare(
			`SELECT m.id, m.name, m.owner_user_id, m.created_at, mm.role
			 FROM mailboxes m
			 JOIN mailbox_members mm ON mm.mailbox_id = m.id
			 WHERE mm.user_id = ?`
		)
		.bind(userId)
		.all<SharedMailbox>();
	return rows.results;
}

export async function requireMailboxAccess(
	userId: string,
	mailboxId: string,
	db: D1Database
): Promise<SharedMailbox> {
	const row = await db
		.prepare(
			`SELECT m.id, m.name, m.owner_user_id, m.created_at, mm.role
			 FROM mailboxes m
			 JOIN mailbox_members mm ON mm.mailbox_id = m.id
			 WHERE m.id = ? AND mm.user_id = ?`
		)
		.bind(mailboxId, userId)
		.first<SharedMailbox>();
	if (!row) throw error(403, 'Forbidden');
	return row;
}

export async function listAllMailboxes(db: D1Database): Promise<SharedMailboxDetail[]> {
	const mailboxes = await db
		.prepare(`SELECT id, name, owner_user_id, created_at FROM mailboxes ORDER BY created_at DESC`)
		.all<Omit<SharedMailbox, 'role'>>();

	const members = await db
		.prepare(
			`SELECT mm.mailbox_id, mm.user_id, mm.role, u.name, u.email
			 FROM mailbox_members mm JOIN users u ON u.id = mm.user_id`
		)
		.all<MailboxMember>();

	const addresses = await db
		.prepare(
			`SELECT a.id, a.mailbox_id, a.user_id, a.domain_id, d.name AS domain_name,
			        a.address, a.label, a.is_default, a.created_at
			 FROM addresses a JOIN domains d ON d.id = a.domain_id
			 WHERE a.mailbox_id IS NOT NULL`
		)
		.all<MailAddress>();

	return mailboxes.results.map((m) => ({
		...m,
		role: 'manager' as const,
		members: members.results.filter((mb) => mb.mailbox_id === m.id),
		addresses: addresses.results.filter((a) => a.mailbox_id === m.id)
	}));
}

export async function createMailbox(
	db: D1Database,
	{ name, ownerUserId }: { name: string; ownerUserId: string }
): Promise<SharedMailbox> {
	const id = crypto.randomUUID();
	await db
		.prepare(`INSERT INTO mailboxes (id, name, owner_user_id) VALUES (?, ?, ?)`)
		.bind(id, name, ownerUserId)
		.run();
	// Owner is always a manager member.
	await db
		.prepare(`INSERT INTO mailbox_members (mailbox_id, user_id, role) VALUES (?, ?, 'manager')`)
		.bind(id, ownerUserId)
		.run();
	const row = await db
		.prepare(`SELECT id, name, owner_user_id, created_at FROM mailboxes WHERE id = ?`)
		.bind(id)
		.first<Omit<SharedMailbox, 'role'>>();
	return { ...row!, role: 'manager' };
}

export async function addMailboxMember(
	db: D1Database,
	mailboxId: string,
	userId: string,
	role: 'member' | 'manager' = 'member'
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO mailbox_members (mailbox_id, user_id, role) VALUES (?, ?, ?)
			 ON CONFLICT(mailbox_id, user_id) DO UPDATE SET role = excluded.role`
		)
		.bind(mailboxId, userId, role)
		.run();
}

export async function removeMailboxMember(
	db: D1Database,
	mailboxId: string,
	userId: string
): Promise<void> {
	await db
		.prepare(`DELETE FROM mailbox_members WHERE mailbox_id = ? AND user_id = ?`)
		.bind(mailboxId, userId)
		.run();
}

export async function attachAddressToMailbox(
	db: D1Database,
	addressId: string,
	mailboxId: string | null
): Promise<void> {
	await db
		.prepare(`UPDATE addresses SET mailbox_id = ? WHERE id = ?`)
		.bind(mailboxId, addressId)
		.run();
}
