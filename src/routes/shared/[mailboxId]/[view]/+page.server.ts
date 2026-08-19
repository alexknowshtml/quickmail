import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mailbox';
import { requireMailboxAccess } from '$lib/server/mailbox-auth';
import type { MailboxView } from '$lib/types';

const VALID_VIEWS: MailboxView[] = ['inbox', 'starred', 'sent', 'trash'];

export const load: PageServerLoad = async ({ params, locals, platform, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const view = params.view as MailboxView;
	if (!VALID_VIEWS.includes(view)) throw error(404, 'Not found');

	const db = platform?.env.DB;
	if (!db) throw error(503, 'Database unavailable');

	const sharedMailbox = await requireMailboxAccess(locals.user.id, params.mailboxId, db);
	const scope = { kind: 'mailbox' as const, mailboxId: params.mailboxId };

	const { mailbox, filters } = await loadMailbox(db, scope, view, url, null);

	return { view, mailbox, filters, sharedMailbox };
};
