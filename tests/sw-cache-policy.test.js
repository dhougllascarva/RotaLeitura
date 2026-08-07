import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadPolicy() {
  const context = vm.createContext({});
  const source = fs.readFileSync(new URL('../src/sw-cache-policy.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return context.RotaLeituraCachePolicy;
}

test('limpeza preserva caches de outros projetos e versões atuais', () => {
  const policy = loadPolicy();
  const current = ['rotaleitura-static-v2', 'rotaleitura-map-v2'];
  const keys = [...current, 'rotaleitura-static-v1', 'outro-projeto-v1'];

  assert.deepEqual(
    [...policy.cachesToDelete(keys, current)],
    ['rotaleitura-static-v1']
  );
});

test('mapa e satélite possuem contadores de limpeza independentes', () => {
  const policy = loadPolicy();
  const shouldTrim = policy.createTileWriteTracker(3);

  assert.equal(shouldTrim('mapa'), false);
  assert.equal(shouldTrim('satelite'), false);
  assert.equal(shouldTrim('mapa'), false);
  assert.equal(shouldTrim('mapa'), true);
  assert.equal(shouldTrim('satelite'), false);
  assert.equal(shouldTrim('satelite'), true);
});

test('índice e manifesto usam a política de configuração, sem confundir partes grandes', () => {
  const policy = loadPolicy();

  assert.equal(policy.isConfigurationPath('/app/indexes.json'), true);
  assert.equal(policy.isConfigurationPath('/app/data-manifest.json'), true);
  assert.equal(policy.isConfigurationPath('/app/171_1.json'), false);
  assert.equal(policy.isAreaDataPath('/app/171_1.json'), true);
  assert.equal(policy.isAreaDataPath('/app/data-manifest.json'), false);
});

test('network-first só aceita respostas HTTP utilizáveis', () => {
  const policy = loadPolicy();

  assert.equal(policy.isUsableNetworkResponse({ ok: true, type: 'basic' }), true);
  assert.equal(policy.isUsableNetworkResponse({ ok: false, type: 'opaque' }), true);
  assert.equal(policy.isUsableNetworkResponse({ ok: false, type: 'basic' }), false);
  assert.equal(policy.isUsableNetworkResponse(null), false);
});
