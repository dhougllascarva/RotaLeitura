import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  LIMITE_POR_ARQUIVO,
  buildArtifacts,
  calculateSignificantReductions,
  convertCsvText,
  mapHeaders,
  normalizeCoordinate,
  parseCsv,
  validateOutput,
  writeArtifactsAtomically
} from '../scripts/converter.js';

const HEADER = 'Area;MRU;Instalacao;Medidor;Rua;N;Bairro;Local;Cliente;Latitude;Longitude';

function finalRow(overrides = {}) {
  const values = [
    '001', '0002', '0003', 'Rua', '01', 'Bairro', 'Cidade', 'Cliente',
    '-14.8', '-39.2', 'https://www.google.com/maps?q=-14.8,-39.2',
    '0002 0003 Cliente'
  ];
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value;
  return values;
}

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rotaleitura-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('CSV novo sem LinkMapa/Pesquisa gera as 12 strings por nome de cabeçalho', () => {
  const csv = [
    '\uFEFFCliente;Longitude;Área;Rua;Instalação;MRU;Número;Local;Latitude;Medidor;Bairro',
    '  "MARIA ""DA; SILVA"""  ;-39.2;171;"RUA; DOIS";000120;00117;0001;ITABUNA;-14.8;;CENTRO'
  ].join('\r\n');

  const { areas, stats } = convertCsvText(csv);
  const row = areas.get('171')[0];

  assert.equal(row.length, 12);
  assert.ok(row.every((value) => typeof value === 'string'));
  assert.equal(row[0], '00117');
  assert.equal(row[1], '000120');
  assert.equal(row[2], '');
  assert.equal(row[3], 'RUA; DOIS');
  assert.equal(row[4], '0001');
  assert.equal(row[7], 'MARIA "DA; SILVA"');
  assert.equal(row[10], 'https://www.google.com/maps?q=-14.8,-39.2');
  assert.equal(row[11], '000120 MARIA "DA; SILVA"');
  assert.equal(stats.registrosSemMedidor, 1);
  assert.deepEqual(stats.coordenadas, { normais: 1, recuperadas: 0, invalidas: 0 });
});

test('parser suporta BOM, CRLF/LF, aspas escapadas, newline e ponto e vírgula citados', () => {
  const parsed = parseCsv('\uFEFFA;B\r\n  "x;""y""\n z"  ;  valor  \n');
  assert.deepEqual(parsed, [
    ['A', 'B'],
    ['x;"y"\n z', 'valor']
  ]);
});

test('cabeçalhos acentuados e aliases são aceitos, mas ausentes e duplicados falham', () => {
  const mapping = mapHeaders([
    'Área', 'MRU', 'Instalação', 'Medidor', 'Rua', 'Número',
    'Bairro', 'Cidade', 'Cliente', 'Latitude', 'Longitude'
  ]);
  assert.equal(mapping.area, 0);
  assert.equal(mapping.numero, 5);
  assert.equal(mapping.local, 7);

  assert.throws(() => mapHeaders(['Area']), /obrigatória ausente/);
  assert.throws(
    () => mapHeaders([...HEADER.split(';'), 'Número']),
    /Mais de uma coluna corresponde a numero/
  );
});

test('coordenadas normais e com vírgula são normalizadas sem recuperação', () => {
  assert.deepEqual(normalizeCoordinate(' -14.8416 ', 'latitude'), {
    value: '-14.8416', status: 'normal'
  });
  assert.deepEqual(normalizeCoordinate('-39,347315', 'longitude'), {
    value: '-39.347315', status: 'normal'
  });
});

test('coordenadas sem ponto são recuperadas somente de forma única e plausível na Bahia', () => {
  assert.deepEqual(normalizeCoordinate('-14780643333333', 'latitude'), {
    value: '-14.780643333333', status: 'recuperada'
  });
  assert.deepEqual(normalizeCoordinate('-3927207', 'longitude'), {
    value: '-39.27207', status: 'recuperada'
  });
});

test('coordenada impossível não é inventada e impede LinkMapa', () => {
  const csv = `${HEADER}\n171;001;0002;0003;Rua;1;Bairro;Cidade;Cliente;-799999;-359999`;
  const { areas, stats } = convertCsvText(csv);
  const row = areas.get('171')[0];

  assert.equal(row[8], '-799999');
  assert.equal(row[9], '-359999');
  assert.equal(row[10], '');
  assert.deepEqual(stats.coordenadas, { normais: 0, recuperadas: 0, invalidas: 1 });
});

test('Pesquisa usa instalação, medidor e cliente com um espaço e tolera medidor vazio', () => {
  const csv = [
    HEADER,
    '171;001;0002;0003;Rua;1;Bairro;Cidade;  Cliente A  ;-14.8;-39.2',
    '171;002;0004;;Rua;2;Bairro;Cidade;  Cliente B  ;-14.8;-39.2'
  ].join('\n');
  const rows = convertCsvText(csv).areas.get('171');

  assert.equal(rows[0][11], '0002 0003 Cliente A');
  assert.equal(rows[1][11], '0004 Cliente B');
});

test('divisão cria automaticamente partes 2 e 3 com limite de 100.000', () => {
  const repeated = finalRow();
  const areas = new Map([['171', Array.from({ length: 200001 }, () => repeated)]]);
  const bundle = buildArtifacts(areas);

  assert.equal(LIMITE_POR_ARQUIVO, 100000);
  assert.deepEqual(bundle.indexes['171'], ['171_1.json', '171_2.json', '171_3.json']);
  assert.equal(JSON.parse(bundle.artifacts.get('171_1.json')).length, 100000);
  assert.equal(JSON.parse(bundle.artifacts.get('171_2.json')).length, 100000);
  assert.equal(JSON.parse(bundle.artifacts.get('171_3.json')).length, 1);
  assert.equal(bundle.manifest.areas['171'].total, 200001);
});

test('promoção validada remove partes antigas sem apagar arquivos alheios', (t) => {
  const directory = tempDirectory(t);
  fs.writeFileSync(path.join(directory, '171_2.json'), '[]');
  fs.writeFileSync(path.join(directory, '171_3.json'), '[]');
  fs.writeFileSync(path.join(directory, 'anotacoes.json'), '{}');

  const bundle = buildArtifacts(new Map([['171', [finalRow()]]]));
  writeArtifactsAtomically(directory, bundle);

  assert.equal(fs.existsSync(path.join(directory, '171_1.json')), true);
  assert.equal(fs.existsSync(path.join(directory, '171_2.json')), false);
  assert.equal(fs.existsSync(path.join(directory, '171_3.json')), false);
  assert.equal(fs.existsSync(path.join(directory, 'anotacoes.json')), true);
  assert.equal(validateOutput(directory).totalGeral, 1);
});

test('indexes e manifesto são determinísticos e áreas ficam em ordem', () => {
  const row171 = finalRow({ 1: '171' });
  const row172 = finalRow({ 1: '172' });
  const first = buildArtifacts(new Map([['172', [row172]], ['171', [row171]]]));
  const second = buildArtifacts(new Map([['171', [row171]], ['172', [row172]]]));

  assert.equal(first.artifacts.get('indexes.json'), second.artifacts.get('indexes.json'));
  assert.equal(first.artifacts.get('data-manifest.json'), second.artifacts.get('data-manifest.json'));
  assert.deepEqual(Object.keys(first.indexes), ['171', '172']);
});

test('mesmos dados mantêm hash e alteração em uma área muda somente seu hash', () => {
  const row171 = finalRow({ 1: '171' });
  const row172 = finalRow({ 1: '172' });
  const original = buildArtifacts(new Map([['171', [row171]], ['172', [row172]]]));
  const identical = buildArtifacts(new Map([['171', [structuredClone(row171)]], ['172', [row172]]]));
  const changed = buildArtifacts(new Map([
    ['171', [finalRow({ 1: '171-alterada' })]],
    ['172', [row172]]
  ]));

  assert.equal(
    original.manifest.areas['171'].version,
    identical.manifest.areas['171'].version
  );
  assert.notEqual(
    original.manifest.areas['171'].version,
    changed.manifest.areas['171'].version
  );
  assert.equal(
    original.manifest.areas['172'].version,
    changed.manifest.areas['172'].version
  );
});

test('validação detecta arquivo ausente, JSON inválido e registro fora do schema', (t) => {
  const directory = tempDirectory(t);
  const bundle = buildArtifacts(new Map([['171', [finalRow()]]]));
  writeArtifactsAtomically(directory, bundle);

  fs.rmSync(path.join(directory, '171_1.json'));
  assert.throws(() => validateOutput(directory), /não encontrado/);

  writeArtifactsAtomically(directory, bundle);
  fs.writeFileSync(path.join(directory, '171_1.json'), '{');
  assert.throws(() => validateOutput(directory), /JSON inválido/);

  writeArtifactsAtomically(directory, bundle);
  const invalidText = JSON.stringify([['curto']]);
  fs.writeFileSync(path.join(directory, '171_1.json'), invalidText);
  const manifestPath = path.join(directory, 'data-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.areas['171'].fileHashes['171_1.json'] = bundle.manifest.areas['171'].fileHashes['171_1.json'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => validateOutput(directory), /Hash divergente|12 strings/);
});

test('redução acima de 15% é sinalizada, mas 15% exatos e crescimento são aceitos', () => {
  assert.deepEqual(calculateSignificantReductions(
    { '171': 100, '172': 100, '173': 100, '174': 100 },
    { '171': 85, '172': 84, '173': 120 }
  ), [
    { area: '172', anterior: 100, novo: 84, percentual: 16 },
    { area: '174', anterior: 100, novo: 0, percentual: 100 }
  ]);
});

test('CLI ESM converte fixture real sem require e gera manifesto validável', (t) => {
  const directory = tempDirectory(t);
  const input = path.join(directory, 'dbcr17.csv');
  const output = path.join(directory, 'saida');
  const report = path.join(directory, 'report.json');
  fs.writeFileSync(
    input,
    `${HEADER}\n171;001;0002;;Rua;1;Bairro;Cidade;Cliente;-14,8;-39,2\n`
  );

  const execution = spawnSync(process.execPath, [
    path.resolve('scripts/converter.js'),
    '--input', input,
    '--output', output,
    '--report', report
  ], { encoding: 'utf8' });

  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(validateOutput(output).totalGeral, 1);
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).totalCsvAceito, 1);
  assert.doesNotMatch(execution.stderr, /require is not defined/);

  const revalidation = spawnSync(process.execPath, [
    path.resolve('scripts/converter.js'),
    '--validate-output', output,
    '--baseline', output,
    '--report', report
  ], { encoding: 'utf8' });
  assert.equal(revalidation.status, 0, revalidation.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')).reducoesSignificativas, []);
});
