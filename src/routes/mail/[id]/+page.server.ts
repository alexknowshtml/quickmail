import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAddressForMailbox } from '$lib/server/domains';
import { getEmailForScope, listThreadMessages, markThreadRead } from '$lib/server/mail-store';
import { displaySubject } from '$lib/server/threads';
import type { MailScope } from '$lib/types';

export const load: PageServerLoad = async ({ params, locals, platform }) => {
	if (!locals.user || !platform?.env.DB) {
		throw error(401, 'Unauthorized');
	}

	const db = platform.env.DB;
	let scope: MailScope = { kind: 'user', userId: locals.user.id };
	let email = await getEmailForScope(db, scope, params.id);

	// Personal scope filters mailbox_id IS NULL, so shared emails aren't found there.
	// Fall back to each mailbox the user is a member of.
	if (!email) {
		for (const mailbox of locals.mailboxes) {
			const mbScope: MailScope = { kind: 'mailbox', mailboxId: mailbox.id };
			const found = await getEmailForScope(db, mbScope, params.id);
			if (found) {
				email = found;
				scope = mbScope;
				break;
			}
		}
	}

	if (!email) {
		throw error(404, 'Email not found');
	}

	// Opening any message opens its whole conversation.
	await markThreadRead(db, scope, email);
	const messages = await listThreadMessages(db, scope, email);

	// For shared mailbox threads, surface the sending address so the reply form
	// can show it before the user hits Send.
	let replyFromAddress: string | null = null;
	if (scope.kind === 'mailbox') {
		const addr = await getAddressForMailbox(db, scope.mailboxId);
		replyFromAddress = addr?.address ?? null;
	}

	return {
		threadId: email.thread_id ?? email.id,
		/** The message that was linked to — expanded first when the page opens. */
		focusId: email.id,
		trashed: Boolean(email.deleted_at),
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		messages: messages.map((message) => ({ ...message, is_read: true })),
		replyFromAddress,
		/** Set when this thread belongs to a shared mailbox. Drives back-navigation. */
		mailboxId: scope.kind === 'mailbox' ? scope.mailboxId : null
	};
};
