import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listAllMailboxes } from '$lib/server/mailbox-auth';
import { listAllAddresses } from '$lib/server/domains';
import { listUsers } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) throw error(403, 'Forbidden');
	const db = platform?.env.DB;
	if (!db) return { mailboxes: [], users: [], addresses: [] };
	const [mailboxes, users, addresses] = await Promise.all([
		listAllMailboxes(db),
		listUsers(db),
		listAllAddresses(db)
	]);
	return { mailboxes, users, addresses };
};
