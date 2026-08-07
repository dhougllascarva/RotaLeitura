import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import {
  calcularSha256,
  fetchWithTimeout,
  sincronizarDados,
  validarManifesto
} from '../src/data-sync.js';

const VERSION_A = `sha256:${'a'.repeat(64)}`;

function criarLinha(id = '1') {
  return [
    `MRU${id}`,
    `INST${id}`,
    `MED${id}`,
    'Rua',
    '10',
    'Bairro',
    'Cidade',
    'Cliente',
    '-14.8',
    '-39.2',
    'https://www.google.com/maps?q=-14.8,-39.2',
    `INST${id} MED${id} Cliente`
  ];
}

function hashText(text) {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function criarInfo(area, parts, { version, total } = {}) {
  const files = parts.map((_, index) => `${area}_${index + 1}.json`);
  const fileHashes = Object.fromEntries(
    files.map((file, index) => [file, hashText(parts[index])])
  );
  const rows = version === undefined || total === undefined
    ? parts.flatMap((part) => JSON.parse(part))
    : null;

  return {
    version: version ?? hashText(JSON.stringify(rows)),
    total: total ?? rows.length,
    files,
    fileHashes
  };
}

function criarManifesto(areas) {
  return { schemaVersion: 1, areas };
}

function resposta(text, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return text;
    }
  };
}

function criarFetch(manifest, files = {}) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });

    if (url === './data-manifest.json') {
      if (manifest instanceof Error) throw manifest;
      return resposta(typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    }

    const file = url.replace(/^\.\//, '').split('?')[0];
    const configured = files[file];
    if (configured instanceof Error) throw configured;
    if (configured?.response) return configured.response;
    if (typeof configured !== 'string') return resposta('', { ok: false, status: 404 });
    return resposta(configured);
  };

  return { calls, fetchFn };
}

function criarDb(initial = {}, { failSaveFor = '' } = {}) {
  const records = new Map(Object.entries(initial));
  const saveAttempts = [];
  const saves = [];

  return {
    records,
    saveAttempts,
    saves,
    async lerArea(area) {
      return records.get(area) ?? null;
    },
    async salvarArea(area, dados, versao) {
      saveAttempts.push({ area, dados, versao });
      if (area === failSaveFor) throw new Error('IndexedDB sem espaço');

      const record = { dados, versao };
      records.set(area, record);
      saves.push({ area, dados, versao });
    }
  };
}

function syncOptions(areas, offlineDb, fetchFn) {
  return {
    areas,
    offlineDb,
    fetchFn,
    hashText,
    yieldFn: async () => {}
  };
}

test('calcula SHA-256 em UTF-8 com o formato usado pelo manifesto', async () => {
  assert.equal(
    await calcularSha256('abc', webcrypto),
    'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('timeout de rede encerra uma requisição pendurada', async () => {
  await assert.rejects(
    fetchWithTimeout(() => new Promise(() => {}), './parte.json', {}, 10),
    /Tempo esgotado/
  );
});

test('valida versão, partes contíguas e um hash para cada arquivo', () => {
  const text = JSON.stringify([criarLinha()]);
  const valid = criarManifesto({ '171': criarInfo('171', [text]) });
  assert.strictEqual(validarManifesto(valid), valid);

  const missingPart = structuredClone(valid);
  missingPart.areas['171'].files = ['171_2.json'];
  missingPart.areas['171'].fileHashes = { '171_2.json': hashText(text) };
  assert.throws(() => validarManifesto(missingPart), /contíguas/);

  const invalidHash = structuredClone(valid);
  invalidHash.areas['171'].fileHashes['171_1.json'] = 'abc';
  assert.throws(() => validarManifesto(invalidHash), /Hash inválido/);
});

test('mesmo hash não baixa partes nem grava novamente', async () => {
  const rows = [criarLinha()];
  const part = JSON.stringify(rows);
  const info = criarInfo('171', [part]);
  const manifest = criarManifesto({ '171': info });
  const old = { dados: rows, versao: info.version };
  const db = criarDb({ '171': old });
  const remote = criarFetch(manifest, { '171_1.json': part });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'atual');
  assert.deepEqual(remote.calls.map((call) => call.url), ['./data-manifest.json']);
  assert.equal(db.saveAttempts.length, 0);
  assert.strictEqual(db.records.get('171'), old);
});

test('mesma versão com total local divergente baixa novamente a área', async () => {
  const rows = [criarLinha()];
  const part = JSON.stringify(rows);
  const info = criarInfo('171', [part]);
  const manifest = criarManifesto({ '171': info });
  const db = criarDb({
    '171': { dados: [criarLinha('a'), criarLinha('b')], versao: info.version }
  });
  const remote = criarFetch(manifest, { '171_1.json': part });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'atualizada');
  assert.equal(db.saves.length, 1);
  assert.deepEqual(db.records.get('171').dados, rows);
});

test('hash novo baixa todas as partes, valida e salva uma única vez', async () => {
  const first = JSON.stringify([criarLinha('1')]);
  const second = JSON.stringify([criarLinha('2')]);
  const info = criarInfo('171', [first, second]);
  const manifest = criarManifesto({ '171': info });
  const db = criarDb({ '171': { dados: [criarLinha('antiga')], versao: VERSION_A } });
  const remote = criarFetch(manifest, {
    '171_1.json': first,
    '171_2.json': second
  });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'atualizada');
  assert.equal(db.saves.length, 1);
  assert.equal(db.saves[0].versao, info.version);
  assert.deepEqual(db.saves[0].dados, [criarLinha('1'), criarLinha('2')]);
  assert.deepEqual(
    remote.calls.slice(1).map((call) => call.options.cache),
    ['no-store', 'no-store']
  );
  assert.match(remote.calls[1].url, /171_1\.json\?v=sha256%3A/);
});

test('não grava quando o hash canônico da área diverge da versão do manifesto', async () => {
  const part = JSON.stringify([criarLinha()]);
  const info = criarInfo('171', [part], { version: VERSION_A });
  const manifest = criarManifesto({ '171': info });
  const old = { dados: [criarLinha('antiga')], versao: '1.0.5' };
  const db = criarDb({ '171': old });
  const remote = criarFetch(manifest, { '171_1.json': part });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'degradada');
  assert.match(result.areas['171'].erro, /versão da área/);
  assert.equal(db.saveAttempts.length, 0);
  assert.strictEqual(db.records.get('171'), old);
});

test('cache legado 1.0.5 atualiza uma vez e depois usa o hash', async () => {
  const part = JSON.stringify([criarLinha()]);
  const manifest = criarManifesto({ '171': criarInfo('171', [part]) });
  const db = criarDb({ '171': { dados: [criarLinha('antiga')], versao: '1.0.5' } });
  const firstRemote = criarFetch(manifest, { '171_1.json': part });

  const first = await sincronizarDados(syncOptions(['171'], db, firstRemote.fetchFn));
  assert.equal(first.areas['171'].status, 'atualizada');
  assert.equal(db.saves.length, 1);

  const secondRemote = criarFetch(manifest, { '171_1.json': part });
  const second = await sincronizarDados(syncOptions(['171'], db, secondRemote.fetchFn));
  assert.equal(second.areas['171'].status, 'atual');
  assert.deepEqual(secondRemote.calls.map((call) => call.url), ['./data-manifest.json']);
  assert.equal(db.saves.length, 1);
});

test('atualização de uma área não baixa novamente as demais', async () => {
  const part171 = JSON.stringify([criarLinha('171')]);
  const part172 = JSON.stringify([criarLinha('172')]);
  const info171 = criarInfo('171', [part171]);
  const info172 = criarInfo('172', [part172]);
  const manifest = criarManifesto({
    '171': info171,
    '172': info172
  });
  const db = criarDb({
    '171': { dados: [criarLinha('171')], versao: info171.version },
    '172': { dados: [criarLinha('antiga')], versao: VERSION_A }
  });
  const remote = criarFetch(manifest, {
    '171_1.json': part171,
    '172_1.json': part172
  });

  const result = await sincronizarDados(syncOptions(['171', '172'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'atual');
  assert.equal(result.areas['172'].status, 'atualizada');
  assert.deepEqual(db.saves.map((save) => save.area), ['172']);
  assert.deepEqual(
    remote.calls.slice(1).map((call) => call.url.replace(/^\.\//, '').split('?')[0]),
    ['172_1.json']
  );
});

test('falha de rede preserva a área anterior e não impede outra área', async () => {
  const part171 = JSON.stringify([criarLinha('171')]);
  const part172 = JSON.stringify([criarLinha('172')]);
  const manifest = criarManifesto({
    '171': criarInfo('171', [part171]),
    '172': criarInfo('172', [part172])
  });
  const old171 = { dados: [criarLinha('antiga')], versao: '1.0.5' };
  const db = criarDb({ '171': old171 });
  const remote = criarFetch(manifest, {
    '171_1.json': new Error('sem conexão'),
    '172_1.json': part172
  });

  const result = await sincronizarDados(syncOptions(['171', '172'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'degradada');
  assert.equal(result.areas['172'].status, 'atualizada');
  assert.strictEqual(db.records.get('171'), old171);
  assert.deepEqual(db.saves.map((save) => save.area), ['172']);
});

test('parte ausente após download válido não causa gravação parcial', async () => {
  const first = JSON.stringify([criarLinha('1')]);
  const second = JSON.stringify([criarLinha('2')]);
  const manifest = criarManifesto({ '171': criarInfo('171', [first, second]) });
  const old = { dados: [criarLinha('antiga')], versao: '1.0.5' };
  const db = criarDb({ '171': old });
  const remote = criarFetch(manifest, { '171_1.json': first });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'degradada');
  assert.deepEqual(
    remote.calls.slice(1).map((call) => call.url.replace(/^\.\//, '').split('?')[0]),
    ['171_1.json', '171_2.json']
  );
  assert.equal(db.saveAttempts.length, 0);
  assert.strictEqual(db.records.get('171'), old);
});

test('manifesto indisponível permite caches existentes e marca os demais indisponíveis', async () => {
  const old171 = { dados: [criarLinha()], versao: '1.0.5' };
  const db = criarDb({ '171': old171 });
  const remote = criarFetch(new Error('offline'));

  const result = await sincronizarDados(syncOptions(['171', '172'], db, remote.fetchFn));

  assert.equal(result.manifestoDisponivel, false);
  assert.equal(result.areas['171'].status, 'degradada');
  assert.equal(result.areas['172'].status, 'indisponivel');
  assert.strictEqual(db.records.get('171'), old171);
  assert.equal(db.saveAttempts.length, 0);
  assert.equal(remote.calls.length, 1);
});

test('array local vazio não é tratado como base offline utilizável', async () => {
  const db = criarDb({ '171': { dados: [], versao: VERSION_A } });
  const remote = criarFetch(new Error('offline'));

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'indisponivel');
  assert.deepEqual(result.indisponiveis, ['171']);
});

test('erros de parte nunca substituem uma base válida', async (t) => {
  const validRows = [criarLinha()];
  const validPart = JSON.stringify(validRows);

  const cases = [
    {
      name: 'erro HTTP',
      body: validPart,
      configured: { response: resposta('', { ok: false, status: 503 }) },
      total: 1
    },
    { name: 'JSON inválido', body: '{', configured: '{', total: 1, version: VERSION_A },
    { name: 'raiz não é array', body: '{}', configured: '{}', total: 1 },
    {
      name: 'registro não possui 12 posições',
      body: JSON.stringify([['curto']]),
      configured: JSON.stringify([['curto']]),
      total: 1
    },
    {
      name: 'registro contém valor que não é string',
      body: JSON.stringify([[...criarLinha().slice(0, 11), 12]]),
      configured: JSON.stringify([[...criarLinha().slice(0, 11), 12]]),
      total: 1
    },
    {
      name: 'hash de arquivo diverge',
      body: validPart,
      configured: `${validPart} `,
      keepExpectedHash: true,
      total: 1
    },
    { name: 'total diverge', body: validPart, configured: validPart, total: 2 }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const info = criarInfo('171', [scenario.body], {
        total: scenario.total,
        version: scenario.version
      });
      if (scenario.keepExpectedHash) info.fileHashes['171_1.json'] = hashText(scenario.body);
      const manifest = criarManifesto({ '171': info });
      const old = { dados: [criarLinha('antiga')], versao: '1.0.5' };
      const db = criarDb({ '171': old });
      const remote = criarFetch(manifest, { '171_1.json': scenario.configured });

      const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

      assert.equal(result.areas['171'].status, 'degradada');
      assert.strictEqual(db.records.get('171'), old);
      assert.equal(db.saves.length, 0);
    });
  }
});

test('falha do IndexedDB mantém o registro anterior e marca modo degradado', async () => {
  const part = JSON.stringify([criarLinha()]);
  const manifest = criarManifesto({ '171': criarInfo('171', [part]) });
  const old = { dados: [criarLinha('antiga')], versao: '1.0.5' };
  const db = criarDb({ '171': old }, { failSaveFor: '171' });
  const remote = criarFetch(manifest, { '171_1.json': part });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'degradada');
  assert.match(result.areas['171'].erro, /IndexedDB/);
  assert.equal(db.saveAttempts.length, 1);
  assert.equal(db.saves.length, 0);
  assert.strictEqual(db.records.get('171'), old);
});

test('falha sem cache anterior marca somente a área como indisponível', async () => {
  const part = JSON.stringify([criarLinha()]);
  const manifest = criarManifesto({ '171': criarInfo('171', [part]) });
  const db = criarDb();
  const remote = criarFetch(manifest, { '171_1.json': new Error('offline') });

  const result = await sincronizarDados(syncOptions(['171'], db, remote.fetchFn));

  assert.equal(result.areas['171'].status, 'indisponivel');
  assert.deepEqual(result.indisponiveis, ['171']);
  assert.equal(db.saveAttempts.length, 0);
});
