import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';

declare module 'vitest' {
	interface ProvidedContext {
		migrations: D1Migration[];
	}
}

export async function setup({ provide }: { provide: (key: 'migrations', value: D1Migration[]) => void }) {
	const migrations = await readD1Migrations('./migrations');
	provide('migrations', migrations);
}
