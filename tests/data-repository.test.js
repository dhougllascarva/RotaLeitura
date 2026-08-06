import test from 'node:test';
import assert from 'node:assert/strict';
import { DataRepository } from '../src/data-repository.js';

const rows = [
  ['00100', 'A', 'M1'],
  ['00100', 'B', 'M2'],
  ['00200', 'C', 'M3']
];

function criarFakeDb() {
  return {
    leituras: 0,
    async lerArea(area) {
      this.leituras += 1;
      return area === '171' ? { dados: rows } : null;
    }
  };
}


test('carrega uma área uma única vez e compartilha as mesmas linhas', async () => {
  const fakeDb = criarFakeDb();
  const repository = new DataRepository(fakeDb);
  const first = await repository.carregarArea('171');
  const second = await repository.carregarArea('171');

  assert.equal(fakeDb.leituras, 1);
  assert.equal(first.total, 3);
  assert.deepEqual(second.mrus, ['00100', '00200']);
  assert.strictEqual(repository.rows, rows);
});

test('localiza MRU exata e parcial sem copiar a área inteira', async () => {
  const fakeDb = criarFakeDb();
  const repository = new DataRepository(fakeDb);
  await repository.carregarArea('171');

  assert.deepEqual(repository.linhasDaMru('00100'), rows.slice(0, 2));
  assert.equal(repository.candidatosPorMru('002').length, 1);
});

test('libera referências da área ativa', async () => {
  const fakeDb = criarFakeDb();
  const repository = new DataRepository(fakeDb);
  await repository.carregarArea('171');
  repository.liberar();

  assert.equal(repository.activeArea, '');
  assert.equal(repository.rows.length, 0);
});
