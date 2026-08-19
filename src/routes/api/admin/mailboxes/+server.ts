import { json, type RequestHandler } from '@sveltejs/kit';
import { createMailbox, listAllMailboxes } from '$lib/server/mailbox-auth';

export const GET: RequestHandler = async ({ locals, platform }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	const mailboxes = await listAllMailboxes(db);
	return json({ mailboxes });
};

export const POST: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	const body = (await request.json()) as { name?: string };
	if (!body.name?.trim()) return json({ error: 'Name is required' }, { status: 400 });
	const mailbox = await createMailbox(db, { name: body.name.trim(), ownerUserId: locals.user.id });
	return json({ mailbox }, { status: 201 });
};
