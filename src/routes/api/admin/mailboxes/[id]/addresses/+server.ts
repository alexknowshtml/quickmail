import { json, type RequestHandler } from '@sveltejs/kit';
import { attachAddressToMailbox } from '$lib/server/mailbox-auth';

export const POST: RequestHandler = async ({ request, locals, platform, params }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	const body = (await request.json()) as { addressId?: string };
	if (!body.addressId) return json({ error: 'addressId is required' }, { status: 400 });
	await attachAddressToMailbox(db, body.addressId, params.id!);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals, platform }) => {
	if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
	const db = platform?.env.DB;
	if (!db) return json({ error: 'Database unavailable' }, { status: 503 });
	const body = (await request.json()) as { addressId?: string };
	if (!body.addressId) return json({ error: 'addressId is required' }, { status: 400 });
	await attachAddressToMailbox(db, body.addressId, null);
	return json({ ok: true });
};
