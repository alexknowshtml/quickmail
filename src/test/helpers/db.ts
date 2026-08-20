import { inject } from 'vitest';
import { applyD1Migrations } from 'cloudflare:test';
import type { D1Database } from '@cloudflare/workers-types';

export async function applyMigrations(db: D1Database): Promise<void> {
	const migrations = inject('migrations');
	await applyD1Migrations(db, migrations);
}

export async function seedUser(
	db: D1Database,
	overrides: Partial<{ id: string; email: string; name: string; isAdmin: boolean }> = {}
): Promise<{ id: string; email: string }> {
	const id = overrides.id ?? crypto.randomUUID();
	const email = overrides.email ?? `user-${id.slice(0, 8)}@test.example`;
	await db
		.prepare(
			'INSERT INTO users (id, email, name, password_hash, is_admin) VALUES (?, ?, ?, ?, ?)'
		)
		.bind(id, email, overrides.name ?? 'Test User', 'placeholder_hash', overrides.isAdmin ? 1 : 0)
		.run();
	return { id, email };
}

export async function seedDomain(
	db: D1Database,
	overrides: Partial<{ id: string; name: string; userId: string }> = {}
): Promise<{ id: string; name: string }> {
	const id = overrides.id ?? crypto.randomUUID();
	const name = overrides.name ?? `domain-${id.slice(0, 8)}.example`;
	const userId = overrides.userId ?? (await seedUser(db)).id;
	await db
		.prepare(
			`INSERT INTO domains (id, name, status, sending_enabled, receiving_enabled, catchall_user_id)
			 VALUES (?, ?, 'verified', 1, 1, ?)`
		)
		.bind(id, name, userId)
		.run();
	return { id, name };
}

export async function seedAddress(
	db: D1Database,
	opts: { userId: string; domainId: string; address?: string; mailboxId?: string | null }
): Promise<{ id: string; address: string }> {
	const id = crypto.randomUUID();
	const address = opts.address ?? `addr-${id.slice(0, 8)}@test.example`;
	await db
		.prepare(
			`INSERT INTO addresses (id, user_id, domain_id, address, is_default, mailbox_id)
			 VALUES (?, ?, ?, ?, 1, ?)`
		)
		.bind(id, opts.userId, opts.domainId, address, opts.mailboxId ?? null)
		.run();
	return { id, address };
}
