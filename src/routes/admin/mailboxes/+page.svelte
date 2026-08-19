<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let newName = $state('');
	let createError = $state('');
	let creating = $state(false);

	// Per-mailbox add-member state keyed by mailbox id
	let addMemberUserId = $state<Record<string, string>>({});
	let addMemberRole = $state<Record<string, string>>({});
	let memberError = $state<Record<string, string>>({});

	// Per-mailbox attach-address state keyed by mailbox id
	let attachAddressId = $state<Record<string, string>>({});
	let addressError = $state<Record<string, string>>({});

	function unattachedAddresses(mailboxId: string) {
		const attached = data.mailboxes
			.filter((m) => m.id !== mailboxId)
			.flatMap((m) => m.addresses.map((a) => a.id));
		return data.addresses.filter((a) => !a.mailbox_id && !attached.includes(a.id));
	}

	function userName(userId: string) {
		return data.users.find((u) => u.id === userId)?.name ?? userId;
	}

	async function createMailbox(event: SubmitEvent) {
		event.preventDefault();
		createError = '';
		creating = true;
		try {
			const res = await fetch('/api/admin/mailboxes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName })
			});
			const body = await res.json();
			if (!res.ok) { createError = body.error ?? 'Failed to create'; return; }
			window.location.reload();
		} catch { createError = 'Network error'; }
		finally { creating = false; }
	}

	async function addMember(mailboxId: string) {
		memberError[mailboxId] = '';
		const userId = addMemberUserId[mailboxId];
		if (!userId) { memberError[mailboxId] = 'Select a user'; return; }
		const role = addMemberRole[mailboxId] ?? 'member';
		try {
			const res = await fetch(`/api/admin/mailboxes/${mailboxId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId, role })
			});
			const body = await res.json();
			if (!res.ok) { memberError[mailboxId] = body.error ?? 'Failed'; return; }
			window.location.reload();
		} catch { memberError[mailboxId] = 'Network error'; }
	}

	async function removeMember(mailboxId: string, userId: string) {
		memberError[mailboxId] = '';
		try {
			const res = await fetch(`/api/admin/mailboxes/${mailboxId}/members`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId })
			});
			if (res.ok) { window.location.reload(); return; }
			const body = await res.json();
			memberError[mailboxId] = body.error ?? 'Failed';
		} catch { memberError[mailboxId] = 'Network error'; }
	}

	async function attachAddress(mailboxId: string) {
		addressError[mailboxId] = '';
		const addressId = attachAddressId[mailboxId];
		if (!addressId) { addressError[mailboxId] = 'Select an address'; return; }
		try {
			const res = await fetch(`/api/admin/mailboxes/${mailboxId}/addresses`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ addressId })
			});
			const body = await res.json();
			if (!res.ok) { addressError[mailboxId] = body.error ?? 'Failed'; return; }
			window.location.reload();
		} catch { addressError[mailboxId] = 'Network error'; }
	}

	async function detachAddress(mailboxId: string, addressId: string) {
		addressError[mailboxId] = '';
		try {
			const res = await fetch(`/api/admin/mailboxes/${mailboxId}/addresses`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ addressId })
			});
			if (res.ok) { window.location.reload(); return; }
			const body = await res.json();
			addressError[mailboxId] = body.error ?? 'Failed';
		} catch { addressError[mailboxId] = 'Network error'; }
	}
</script>

<svelte:head>
	<title>Shared Mailboxes — Admin</title>
</svelte:head>

<div class="admin-page">
	<h1>Shared Mailboxes</h1>

	<section class="surface-lg admin-card">
		<h2>Create mailbox</h2>
		<p class="card-hint">A shared address that multiple users can read and reply from.</p>
		<form class="mt-4 space-y-3" onsubmit={createMailbox}>
			<input
				type="text"
				bind:value={newName}
				required
				placeholder="e.g. info@liftphilly.org"
				class="admin-input"
			/>
			{#if createError}<p class="error">{createError}</p>{/if}
			<button type="submit" disabled={creating} class="btn-primary">
				{creating ? 'Creating…' : 'Create'}
			</button>
		</form>
	</section>

	{#each data.mailboxes as mailbox (mailbox.id)}
		<section class="surface-lg admin-card">
			<h2>{mailbox.name}</h2>
			<p class="card-hint">Owner: {userName(mailbox.owner_user_id)}</p>

			<div class="mb-section">
				<h3 class="section-title">Addresses</h3>
				{#if mailbox.addresses.length === 0}
					<p class="card-hint">No addresses attached.</p>
				{:else}
					<ul class="user-list">
						{#each mailbox.addresses as addr (addr.id)}
							<li class="user-row">
								<span class="user-name flex-1">{addr.address}</span>
								<button
									type="button"
									class="btn-ghost text-xs"
									onclick={() => detachAddress(mailbox.id, addr.id)}
								>Detach</button>
							</li>
						{/each}
					</ul>
				{/if}

				{#if unattachedAddresses(mailbox.id).length > 0}
					<div class="add-row">
						<select
							bind:value={attachAddressId[mailbox.id]}
							class="control-select"
						>
							<option value="">— attach an address —</option>
							{#each unattachedAddresses(mailbox.id) as addr (addr.id)}
								<option value={addr.id}>{addr.address}</option>
							{/each}
						</select>
						<button
							type="button"
							class="btn-primary text-xs"
							onclick={() => attachAddress(mailbox.id)}
						>Attach</button>
					</div>
					{#if addressError[mailbox.id]}<p class="error">{addressError[mailbox.id]}</p>{/if}
				{/if}
			</div>

			<div class="mb-section">
				<h3 class="section-title">Members</h3>
				{#if mailbox.members.length === 0}
					<p class="card-hint">No members yet.</p>
				{:else}
					<ul class="user-list">
						{#each mailbox.members as member (member.user_id)}
							<li class="user-row">
								<div class="user-avatar">{(member.name[0] ?? '?').toUpperCase()}</div>
								<div class="min-w-0 flex-1">
									<p class="user-name">{member.name}</p>
									<p class="user-email">{member.email}</p>
								</div>
								<span class="admin-badge">{member.role}</span>
								<button
									type="button"
									class="btn-ghost text-xs"
									onclick={() => removeMember(mailbox.id, member.user_id)}
								>Remove</button>
							</li>
						{/each}
					</ul>
				{/if}

				<div class="add-row">
					<select bind:value={addMemberUserId[mailbox.id]} class="control-select">
						<option value="">— add a member —</option>
						{#each data.users.filter((u) => !mailbox.members.some((m) => m.user_id === u.id)) as user (user.id)}
							<option value={user.id}>{user.name}</option>
						{/each}
					</select>
					<select bind:value={addMemberRole[mailbox.id]} class="control-select-sm">
						<option value="member">member</option>
						<option value="manager">manager</option>
					</select>
					<button
						type="button"
						class="btn-primary text-xs"
						onclick={() => addMember(mailbox.id)}
					>Add</button>
				</div>
				{#if memberError[mailbox.id]}<p class="error">{memberError[mailbox.id]}</p>{/if}
			</div>
		</section>
	{/each}

	{#if data.mailboxes.length === 0}
		<p class="card-hint mt-4">No shared mailboxes yet.</p>
	{/if}
</div>

<style>
	.admin-page h1 {
		font-size: 1.375rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.admin-card {
		margin-top: 1.25rem;
		padding: 1.5rem;
	}

	.admin-card h2 {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.card-hint {
		margin-top: 0.375rem;
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--color-muted);
	}

	.mt-4 { margin-top: 1rem; }
	.mt-4.space-y-3 > * + * { margin-top: 0.75rem; }

	.admin-input {
		width: 100%;
		padding: 0.625rem 0.875rem;
		border-radius: 0.625rem;
		font-size: 0.875rem;
		background: var(--color-surface-muted);
		box-shadow: inset 0 0 0 1px var(--color-line);
		outline: none;
	}

	.admin-input:focus {
		box-shadow: inset 0 0 0 1px var(--color-focus-line), 0 0 0 3px var(--color-focus-halo);
	}

	.mb-section {
		margin-top: 1.25rem;
		padding-top: 1rem;
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.section-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
	}

	.user-list { margin-top: 0.5rem; }

	.user-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0;
	}

	.user-row + .user-row {
		box-shadow: inset 0 1px 0 var(--color-line);
	}

	.user-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		flex-shrink: 0;
	}

	.user-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.user-email {
		font-size: 0.8125rem;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.admin-badge {
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--color-text);
		background: var(--color-surface-muted);
		white-space: nowrap;
	}

	.add-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.control-select {
		flex: 1;
		min-width: 0;
		padding: 0.4375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		outline: none;
		cursor: pointer;
	}

	.control-select-sm {
		padding: 0.4375rem 0.625rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary);
		background: var(--color-surface-muted);
		outline: none;
		cursor: pointer;
	}

	.flex-1 { flex: 1; }
	.min-w-0 { min-width: 0; }

	.text-xs { font-size: 0.75rem; }

	.error {
		margin-top: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-danger);
	}
</style>
