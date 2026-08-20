import { json, type RequestHandler } from '@sveltejs/kit';
import {
	describeProviderError,
	getEmailProvider,
	statusForProviderError
} from '$lib/server/context';
import { getAddressForMailbox } from '$lib/server/domains';
import {
	deleteEmailsPermanently,
	expandToThreads,
	getEmailForScope,
	listThreadMessages,
	markThreadRead,
	setEmailFlags
} from '$lib/server/mail-store';
import { sendAndStore } from '$lib/server/outbox';
import { buildReferences, displaySubject } from '$lib/server/threads';
import type { MailScope, OutboundAttachmentInput } from '$lib/types';

type ReplyBody = {
	fromAddressId?: string;
	text?: string;
	html?: string;
	attachments?: OutboundAttachmentInput[];
};

export const GET: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const scope = { kind: 'user' as const, userId: locals.user.id };
	const email = await getEmailForScope(db, scope, params.id!);
	if (!email) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	await markThreadRead(db, scope, email);
	const messages = await listThreadMessages(db, scope, email);

	return json({
		threadId: email.thread_id ?? email.id,
		subject: displaySubject(messages[0]?.subject ?? email.subject),
		messages
	});
};

/** Flag toggles from the list and the reader — applied to the whole thread. */
export const PATCH: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const body = (await request.json()) as {
		isRead?: boolean;
		isStarred?: boolean;
		trashed?: boolean;
		/** Set to limit the change to this one message instead of the thread. */
		messageOnly?: boolean;
	};

	const scope = { kind: 'user' as const, userId: locals.user.id };
	const ids = body.messageOnly
		? [params.id!]
		: await expandToThreads(db, scope, [params.id!]);

	const changed = await setEmailFlags(db, scope, ids, {
		isRead: body.isRead,
		isStarred: body.isStarred,
		trashed: body.trashed
	});

	if (changed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals, platform }) => {
	const db = platform?.env.DB;
	if (!db || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const scope = { kind: 'user' as const, userId: locals.user.id };
	const ids = await expandToThreads(db, scope, [params.id!]);
	const removed = await deleteEmailsPermanently(db, platform?.env.ATTACHMENTS, scope, ids);

	if (removed === 0) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return json({ ok: true });
};

export const POST: RequestHandler = async ({ params, request, locals, platform }) => {
	const db = platform?.env.DB;
	const bucket = platform?.env.ATTACHMENTS;
	if (!db || !bucket || !locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// Find the email across personal and shared mailbox scopes.
	let scope: MailScope = { kind: 'user', userId: locals.user.id };
	let original = await getEmailForScope(db, scope, params.id!);
	let replyMailboxId: string | null = null;

	if (!original) {
		for (const mailbox of locals.mailboxes) {
			const mbScope: MailScope = { kind: 'mailbox', mailboxId: mailbox.id };
			const found = await getEmailForScope(db, mbScope, params.id!);
			if (found) {
				original = found;
				scope = mbScope;
				replyMailboxId = mailbox.id;
				break;
			}
		}
	}

	if (!original) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	const body = (await request.json()) as ReplyBody;
	if (!body.text?.trim() && !body.html?.trim()) {
		return json({ error: 'Message body is required' }, { status: 400 });
	}

	// Shared mailbox replies must use the mailbox's sending address — reject early
	// with a clear message if none is attached, rather than leaking personal identity.
	if (replyMailboxId) {
		const mailboxAddr = await getAddressForMailbox(db, replyMailboxId);
		if (!mailboxAddr) {
			return json(
				{ error: 'No sending address is attached to this mailbox. Ask an admin to add one in Admin → Mailboxes.' },
				{ status: 422 }
			);
		}
	}

	const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
	// Replying to our own message continues the conversation with its recipient.
	const to = original.direction === 'inbound' ? original.from_addr : original.to_addr;

	// For personal replies, prefer the address the original was sent to/from.
	const preferredAddress = replyMailboxId
		? undefined
		: original.direction === 'inbound'
			? locals.addresses.find(
					(address) => address.address.toLowerCase() === original.to_addr.toLowerCase()
				)
			: locals.addresses.find(
					(address) => address.address.toLowerCase() === original.from_addr.toLowerCase()
				);

	try {
		const provider = getEmailProvider(platform);
		const { emailId } = await sendAndStore(
			{ DB: db, ATTACHMENTS: bucket },
			provider,
			locals.user,
			{
				fromAddressId: replyMailboxId ? undefined : (body.fromAddressId ?? preferredAddress?.id),
				mailboxId: replyMailboxId,
				to,
				subject,
				text: body.text,
				html: body.html,
				inReplyTo: original.message_id,
				// Carry the chain forward so the recipient's client — and ours,
				// when they answer — keeps the conversation together.
				references: buildReferences(original.references_header, original.message_id),
				replyToEmailId: original.id,
				attachments: body.attachments
			}
		);

		return json({ ok: true, id: emailId });
	} catch (error) {
		return json(
			{ error: describeProviderError(error, 'Failed to send reply') },
			{ status: statusForProviderError(error) }
		);
	}
};
