import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const swSource = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

function loadServiceWorker({ fetchFn, cache }) {
  const scope = {
    addEventListener() {},
    location: { origin: 'https://example.test' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {}
  };
  const sandbox = {
    URL,
    Response,
    Request,
    console,
    self: scope,
    fetch: fetchFn,
    caches: {
      async open() { return cache; },
      async keys() { return []; },
      async match() { return null; },
      async delete() { return true; }
    }
  };
  sandbox.importScripts = () => {
    sandbox.RotaLeituraCachePolicy = {
      createTileWriteTracker: () => () => false,
      cachesToDelete: () => [],
      isAreaDataPath: () => false,
      isConfigurationPath: () => false,
      isUsableNetworkResponse: (response) => response.ok || response.type === 'opaque'
    };
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(swSource, context);
  return context;
}

test('resposta de rede válida vence mesmo quando Cache Storage está sem espaço', async () => {
  let fallbackReads = 0;
  const context = loadServiceWorker({
    fetchFn: async () => new Response('{"novo":true}', { status: 200 }),
    cache: {
      async put() { throw new Error('quota'); },
      async match() {
        fallbackReads += 1;
        return new Response('{"antigo":true}', { status: 200 });
      }
    }
  });

  const response = await context.networkFirst(
    new Request('https://example.test/data-manifest.json'),
    'runtime'
  );

  assert.equal(await response.text(), '{"novo":true}');
  assert.equal(fallbackReads, 0);
});

test('rollout força import atualizado sem descartar caches de tiles', () => {
  assert.match(swSource, /importScripts\('\.\/src\/sw-cache-policy\.js\?v=2\.1\.0'\)/);
  assert.match(swSource, /const VERSION = 'v2\.1\.0'/);
  assert.match(swSource, /const TILE_CACHE_VERSION = 'v2\.0\.0'/);
  assert.match(appSource, /updateViaCache: 'none'/);
  assert.match(appSource, /controllerchange/);
});
