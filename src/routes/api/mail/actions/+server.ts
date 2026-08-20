import { json, type RequestHandler } from '@sveltejs/kit';
import {
	deleteEmailsPermanently,
	emptyTrash,
	expandToThreads,
	markAllRead,
	setEmailFlags,
	getMailboxCounts
} from '$lib/server/mail-store';
import { requireMailboxAccess } from '$lib/server/mailbox-auth';
import type { MailScope } from '$lib/types';

/** Bulk actions from the list toolbar. */
const ACTIONS = [
	'read',
	'unread',
	'star',
	'unstar',
	'trash',
	'restore',
	'delete',
	'read-all',
	'empty-trash'
] as const;

/** Actions that operate on the whole mailbox rather than a selection. */
const WHOLE_MAILBOX: Action[] = ['read-all', 'empty-trash'];

type Action = (typeof ACTIONS)[number];

type ActionBody = {
	action?: Action;
	ids?: string[];
	mailboxId?: string;
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as ActionBody;
	const action = body.action;

	if (!action || !ACTIONS.includes(action)) {
		return json({ error: 'Unknown action' }, { status: 400 });
	}

	const selected = (body.ids ?? []).filter((id) => typeof id === 'string' && id.length > 0);
	if (selected.length === 0 && !WHOLE_MAILBOX.includes(action)) {
		return json({ error: 'No messages selected' }, { status: 400 });
	}

	let scope: MailScope = { kind: 'user', userId: locals.user.id };
	if (body.mailboxId) {
		try {
			await requireMailboxAccess(locals.user.id, body.mailboxId, db);
			scope = { kind: 'mailbox', mailboxId: body.mailboxId };
		} catch {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	// The list works in conversations, so an action on a row applies to every
	// message in it — trashing a thread takes its replies along.
	const ids = await expandToThreads(db, scope, selected);

	let affected = 0;

	switch (action) {
		case 'read':
			affected = await setEmailFlags(db, scope, ids, { isRead: true });
			break;
		case 'unread':
			affected = await setEmailFlags(db, scope, ids, { isRead: false });
			break;
		case 'star':
			affected = await setEmailFlags(db, scope, ids, { isStarred: true });
			break;
		case 'unstar':
			affected = await setEmailFlags(db, scope, ids, { isStarred: false });
			break;
		case 'trash':
			affected = await setEmailFlags(db, scope, ids, { trashed: true });
			break;
		case 'restore':
			affected = await setEmailFlags(db, scope, ids, { trashed: false });
			break;
		case 'delete':
			affected = await deleteEmailsPermanently(db, platform?.env.ATTACHMENTS, scope, ids);
			break;
		case 'read-all':
			affected = await markAllRead(db, scope, locals.activeDomainId);
			break;
		case 'empty-trash':
			affected = await emptyTrash(db, platform?.env.ATTACHMENTS, scope);
			break;
	}

	const userScope = { kind: 'user' as const, userId: locals.user.id };
	const counts = await getMailboxCounts(db, userScope, locals.activeDomainId);

	return json({ ok: true, affected, counts });
};
