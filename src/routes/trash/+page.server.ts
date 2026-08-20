import type { PageServerLoad } from './$types';
import { loadMailbox } from '$lib/server/mailbox';

export const load: PageServerLoad = async ({ locals, platform, url }) =>
	loadMailbox(platform?.env.DB, locals.user ? { kind: 'user', userId: locals.user.id } : undefined, 'trash', url, locals.activeDomainId);
