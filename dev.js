// 本地开发模拟 Cloudflare KV
const kvStore = new Map();

export const RESTAURANT_DB = {
  get: async (key) => kvStore.get(key) || null,
  put: async (key, value) => kvStore.set(key, value),
  delete: async (key) => kvStore.delete(key)
};

export const RESTAURANT_IMAGES = {
  get: async (key) => kvStore.get('img_' + key) || null,
  put: async (key, value) => kvStore.set('img_' + key, value),
  delete: async (key) => kvStore.delete('img_' + key)
};

import { fetch as fetchPolyfill } from 'undici';
export { fetchPolyfill as fetch };

const app = (await import('./server.js')).default;

export default {
  fetch: (req, env, ctx) => {
    globalThis.RESTAURANT_DB = RESTAURANT_DB;
    globalThis.RESTAURANT_IMAGES = RESTAURANT_IMAGES;
    globalThis.fetch = fetchPolyfill;
    return app.fetch(req, env, ctx);
  }
};
