import { defineConfig } from 'vitest/config';
import base from '../../../vitest.config';

// A Node-run DOM harness keeps the real node:sqlite Store available without
// asking Vite's browser transform to bundle Node built-ins. Production config is unchanged.
export default defineConfig({
  resolve: base.resolve,
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/regression/studio/*.dom.test.tsx'],
    setupFiles: ['./tests/regression/studio/dom.setup.ts', './tests/vitest.dom.setup.ts'],
    testTimeout: 10000,
  },
});
