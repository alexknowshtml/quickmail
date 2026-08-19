import { json, type RequestHandler } from '@sveltejs/kit';
import { addMailboxMember, removeMailboxMember } from '$lib/server/mailbox-auth';

export const POST: RequestHandler = async ({ request, locals, platform, params }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	const body = (await request.json()) as { userId?: string; role?: string };
	if (!body.userId) return json({ error: 'userId is required' }, { status: 400 });
	const role = body.role === 'manager' ? 'manager' : 'member';
	await addMailboxMember(db, params.id!, body.userId, role);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals, platform, params }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	const body = (await request.json()) as { userId?: string };
	if (!body.userId) return json({ error: 'userId is required' }, { status: 400 });
	await removeMailboxMember(db, params.id!, body.userId);
	return json({ ok: true });
};
