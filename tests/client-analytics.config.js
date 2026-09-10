import config from './vitest.config.js';
import { transformWithEsbuild } from 'vite';
export default { ...config, plugins: [{ name: 'source-jsx', async transform(code, id) {
  if (id.includes('/src/') && id.endsWith('.js')) return transformWithEsbuild(code, id, { loader: 'jsx', jsx: 'automatic' });
} }], esbuild: { jsx: 'automatic' } };
