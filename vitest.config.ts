import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'url';

const poolOptions = {
	miniflare: {
		compatibilityDate: '2025-06-01',
		compatibilityFlags: ['nodejs_compat'],
		d1Databases: { DB: 'test-db' },
	},
};

export default defineConfig({
	plugins: [cloudflareTest(poolOptions)],
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
	test: {
		pool: cloudflarePool(poolOptions),
		globalSetup: ['./src/test/global-setup.ts'],
	},
});
