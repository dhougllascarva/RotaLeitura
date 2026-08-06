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

test('carregamento antigo não sobrescreve área escolhida depois', async () => {
  let resolverA;
  let resolverB;
  const leituraA = new Promise((resolve) => { resolverA = resolve; });
  const leituraB = new Promise((resolve) => { resolverB = resolve; });
  const repository = new DataRepository({
    lerArea(area) {
      return area === 'A' ? leituraA : leituraB;
    }
  });

  const carregamentoA = repository.carregarArea('A');
  const carregamentoB = repository.carregarArea('B');
  const rowsB = [['00200', 'B']];
  resolverB({ dados: rowsB });
  const resumoB = await carregamentoB;
  resolverA({ dados: [['00100', 'A']] });
  const resumoA = await carregamentoA;

  assert.equal(resumoB.area, 'B');
  assert.equal(resumoA, null);
  assert.equal(repository.activeArea, 'B');
  assert.strictEqual(repository.rows, rowsB);
});
