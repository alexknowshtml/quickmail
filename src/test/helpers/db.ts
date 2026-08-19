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
		.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)')
		.bind(id, email, overrides.name ?? 'Test User', 'placeholder_hash')
		.run();
	return { id, email };
}
