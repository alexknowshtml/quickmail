import { beforeAll, describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedUser } from './helpers/db';
import { insertEmail, listMailbox } from '$lib/server/mail-store';

describe('smoke: personal mailbox isolation', () => {
	beforeAll(async () => {
		await applyMigrations(env.DB);
	});

	it('listMailbox returns only the requesting user\'s emails', async () => {
		const alice = await seedUser(env.DB, { email: 'alice@test.example' });
		const bob = await seedUser(env.DB, { email: 'bob@test.example' });

		await insertEmail(env.DB, {
			userId: alice.id,
			direction: 'inbound',
			from: 'sender@external.example',
			to: alice.email,
			subject: 'Hello Alice',
		});

		await insertEmail(env.DB, {
			userId: bob.id,
			direction: 'inbound',
			from: 'sender@external.example',
			to: bob.email,
			subject: 'Hello Bob',
		});

		const result = await listMailbox(env.DB, { kind: 'user', userId: alice.id }, { view: 'inbox' });

		expect(result.total).toBe(1);
		expect(result.threads).toHaveLength(1);
		expect(result.threads[0].subject).toContain('Hello Alice');
	});
});
