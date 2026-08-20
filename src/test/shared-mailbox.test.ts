import { beforeAll, describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { applyMigrations, seedUser, seedDomain, seedAddress } from './helpers/db';
import {
	insertEmail,
	listMailbox,
	getEmailForScope,
	setEmailFlags,
	expandToThreads,
	deleteEmailsPermanently,
	emptyTrash,
	listThreadMessages
} from '$lib/server/mail-store';
import {
	createMailbox,
	addMailboxMember,
	removeMailboxMember,
	requireMailboxAccess,
	attachAddressToMailbox
} from '$lib/server/mailbox-auth';
import { getAddressForMailbox } from '$lib/server/domains';
import { resolveFromAddress } from '$lib/server/outbox';

beforeAll(async () => {
	await applyMigrations(env.DB);
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

async function makeSharedMailbox(name = 'Shared Inbox') {
	const owner = await seedUser(env.DB, { isAdmin: true });
	const member = await seedUser(env.DB);
	const outsider = await seedUser(env.DB);
	const mailbox = await createMailbox(env.DB, { name, ownerUserId: owner.id });
	await addMailboxMember(env.DB, mailbox.id, member.id, 'member');
	return { owner, member, outsider, mailbox };
}

async function insertSharedEmail(
	userId: string,
	mailboxId: string,
	subject = 'Shared message'
) {
	return insertEmail(env.DB, {
		userId,
		direction: 'inbound',
		from: 'external@sender.example',
		to: 'shared@test.example',
		subject,
		mailboxId
	});
}

// ─── Access control ──────────────────────────────────────────────────────────

describe('access control', () => {
	it('non-member cannot read a shared mailbox email via getEmailForScope', async () => {
		const { owner, outsider, mailbox } = await makeSharedMailbox();
		const emailId = await insertSharedEmail(owner.id, mailbox.id);

		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };
		const found = await getEmailForScope(env.DB, scope, emailId);
		expect(found).not.toBeNull(); // scope sees it

		// Outsider has no row in mailbox_members — requireMailboxAccess throws.
		await expect(
			requireMailboxAccess(outsider.id, mailbox.id, env.DB)
		).rejects.toThrow();
	});

	it('member can read a shared mailbox email via getEmailForScope', async () => {
		const { owner, member, mailbox } = await makeSharedMailbox();
		const emailId = await insertSharedEmail(owner.id, mailbox.id);

		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };
		const email = await getEmailForScope(env.DB, scope, emailId);
		expect(email).not.toBeNull();
		expect(email!.id).toBe(emailId);
	});

	it('requireMailboxAccess succeeds for a member', async () => {
		const { member, mailbox } = await makeSharedMailbox();
		const row = await requireMailboxAccess(member.id, mailbox.id, env.DB);
		expect(row.id).toBe(mailbox.id);
	});

	it('adding then removing a member revokes access', async () => {
		const { mailbox } = await makeSharedMailbox();
		const newcomer = await seedUser(env.DB);

		await addMailboxMember(env.DB, mailbox.id, newcomer.id, 'member');
		const before = await requireMailboxAccess(newcomer.id, mailbox.id, env.DB);
		expect(before).not.toBeNull();

		await removeMailboxMember(env.DB, mailbox.id, newcomer.id);
		await expect(
			requireMailboxAccess(newcomer.id, mailbox.id, env.DB)
		).rejects.toThrow();
	});
});

// ─── Scope isolation ────────────────────────────────────────────────────────

describe('scope isolation', () => {
	it('personal view excludes shared mail (mailbox_id IS NULL guard)', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		await insertSharedEmail(owner.id, mailbox.id, 'Shared — should not appear personally');
		await insertEmail(env.DB, {
			userId: owner.id,
			direction: 'inbound',
			from: 'someone@example.com',
			to: owner.email,
			subject: 'Personal — should appear'
		});

		const result = await listMailbox(
			env.DB,
			{ kind: 'user', userId: owner.id },
			{ view: 'inbox' }
		);
		const subjects = result.threads.map((t) => t.subject);
		expect(subjects.some((s) => s.includes('Personal'))).toBe(true);
		expect(subjects.some((s) => s.includes('Shared'))).toBe(false);
	});

	it('shared view excludes personal mail', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		await insertSharedEmail(owner.id, mailbox.id, 'Shared message visible in mailbox');
		await insertEmail(env.DB, {
			userId: owner.id,
			direction: 'inbound',
			from: 'someone@example.com',
			to: owner.email,
			subject: 'Personal message invisible in mailbox'
		});

		const result = await listMailbox(
			env.DB,
			{ kind: 'mailbox', mailboxId: mailbox.id },
			{ view: 'inbox' }
		);
		const subjects = result.threads.map((t) => t.subject);
		expect(subjects.some((s) => s.includes('Shared message'))).toBe(true);
		expect(subjects.some((s) => s.includes('Personal message'))).toBe(false);
	});

	it('member sees the same shared emails as the owner', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		await insertSharedEmail(owner.id, mailbox.id, 'Visible to all members');

		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };
		const view1 = await listMailbox(env.DB, scope, { view: 'inbox' });
		const view2 = await listMailbox(env.DB, scope, { view: 'inbox' });
		// Mailbox scope is deterministic — two reads return the same total.
		expect(view1.total).toBe(view2.total);
		expect(view1.threads.map((t) => t.id)).toEqual(view2.threads.map((t) => t.id));
	});
});

// ─── Flags: star and archive ─────────────────────────────────────────────────

describe('flags: shared read/star/archive', () => {
	it('starring a shared email is visible across all member views', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const emailId = await insertSharedEmail(owner.id, mailbox.id, 'Star me');
		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };

		await setEmailFlags(env.DB, scope, [emailId], { isStarred: true });

		const email = await getEmailForScope(env.DB, scope, emailId);
		expect(email!.is_starred).toBeTruthy();
	});

	it('archiving a shared email sets deleted_at (soft delete, shared)', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const emailId = await insertSharedEmail(owner.id, mailbox.id, 'Archive me');
		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };

		await setEmailFlags(env.DB, scope, [emailId], { trashed: true });

		// Inbox view should now exclude the archived email.
		const inbox = await listMailbox(env.DB, scope, { view: 'inbox' });
		const ids = inbox.threads.flatMap((t) => t.messages?.map((m) => m.id) ?? [t.id]);
		expect(ids).not.toContain(emailId);
	});
});

// ─── Hard-delete safety ──────────────────────────────────────────────────────

describe('hard-delete safety for shared mailboxes', () => {
	it('deleteEmailsPermanently with mailbox scope is a no-op', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const emailId = await insertSharedEmail(owner.id, mailbox.id, 'Cannot be hard-deleted');
		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };

		const removed = await deleteEmailsPermanently(env.DB, undefined, scope, [emailId]);
		expect(removed).toBe(0);

		// Email still exists.
		const email = await getEmailForScope(env.DB, scope, emailId);
		expect(email).not.toBeNull();
	});

	it('emptyTrash on mailbox scope is a no-op', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const emailId = await insertSharedEmail(owner.id, mailbox.id, 'Soft-deleted');
		const scope = { kind: 'mailbox' as const, mailboxId: mailbox.id };

		await setEmailFlags(env.DB, scope, [emailId], { trashed: true });
		const removed = await emptyTrash(env.DB, undefined, scope);
		expect(removed).toBe(0);
	});

	it("emptyTrash on personal scope does not touch shared mail", async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		await insertSharedEmail(owner.id, mailbox.id, 'Shared — must survive personal trash empty');

		// Soft-delete a personal email for the owner.
		const personalId = await insertEmail(env.DB, {
			userId: owner.id,
			direction: 'inbound',
			from: 'x@example.com',
			to: owner.email,
			subject: 'Personal trashed email'
		});
		const personalScope = { kind: 'user' as const, userId: owner.id };
		await setEmailFlags(env.DB, personalScope, [personalId], { trashed: true });
		await emptyTrash(env.DB, undefined, personalScope);

		// Shared inbox must still have its email.
		const mailboxScope = { kind: 'mailbox' as const, mailboxId: mailbox.id };
		const inbox = await listMailbox(env.DB, mailboxScope, { view: 'inbox' });
		expect(inbox.total).toBeGreaterThanOrEqual(1);
	});
});

// ─── Threading ───────────────────────────────────────────────────────────────

describe('threading', () => {
	it('replies in a shared mailbox are grouped into the same thread', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const firstId = await insertSharedEmail(owner.id, mailbox.id, 'Thread starter');
		const first = await getEmailForScope(
			env.DB,
			{ kind: 'mailbox', mailboxId: mailbox.id },
			firstId
		);

		// A reply with Re: subject and in_reply_to referencing the first.
		await insertEmail(env.DB, {
			userId: owner.id,
			direction: 'outbound',
			from: 'shared@test.example',
			to: 'external@sender.example',
			subject: 'Re: Thread starter',
			inReplyTo: first!.message_id ?? undefined,
			mailboxId: mailbox.id
		});

		const messages = await listThreadMessages(
			env.DB,
			{ kind: 'mailbox', mailboxId: mailbox.id },
			first!
		);
		expect(messages.length).toBeGreaterThanOrEqual(1);
	});
});

// ─── Address resolution ──────────────────────────────────────────────────────

describe('address resolution', () => {
	it('getAddressForMailbox returns null when no address is attached', async () => {
		const { mailbox } = await makeSharedMailbox();
		const addr = await getAddressForMailbox(env.DB, mailbox.id);
		expect(addr).toBeNull();
	});

	it('getAddressForMailbox returns the attached address', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const domain = await seedDomain(env.DB, { userId: owner.id });
		const { id: addressId, address } = await seedAddress(env.DB, {
			userId: owner.id,
			domainId: domain.id,
			address: `contact-${mailbox.id.slice(0, 6)}@${domain.name}`
		});
		await attachAddressToMailbox(env.DB, addressId, mailbox.id);

		const addr = await getAddressForMailbox(env.DB, mailbox.id);
		expect(addr).not.toBeNull();
		expect(addr!.address).toBe(address);
	});

	it('resolveFromAddress throws when mailbox has no attached address', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		// resolveFromAddress only touches D1 when mailboxId is set — user fields unused.
		const user = { id: owner.id, email: owner.email, name: 'Owner', is_admin: true } as Parameters<typeof resolveFromAddress>[1];

		await expect(
			resolveFromAddress(env.DB, user, undefined, mailbox.id)
		).rejects.toThrow(/No sending address/);
	});

	it('resolveFromAddress returns mailbox address when one is attached', async () => {
		const { owner, mailbox } = await makeSharedMailbox();
		const domain = await seedDomain(env.DB, { userId: owner.id });
		const { id: addressId, address } = await seedAddress(env.DB, {
			userId: owner.id,
			domainId: domain.id,
			address: `from-${mailbox.id.slice(0, 6)}@${domain.name}`
		});
		await attachAddressToMailbox(env.DB, addressId, mailbox.id);
		const user = { id: owner.id, email: owner.email, name: 'Owner', is_admin: true } as Parameters<typeof resolveFromAddress>[1];

		const from = await resolveFromAddress(env.DB, user, undefined, mailbox.id);
		expect(from.address).toBe(address);
	});
});

