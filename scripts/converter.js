import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITE_POR_ARQUIVO = 100000;

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DATA_FILE_PATTERN = /^\d{3}_[1-9]\d*\.json$/;
const AREA_PATTERN = /^\d{3}$/;
const SCHEMA_VERSION = 1;

// Limites deliberadamente mais amplos que a CR17. Só são usados para recuperar
// coordenadas sem ponto; coordenadas já válidas não são restringidas à Bahia.
const BAHIA_BOUNDS = Object.freeze({
  latitude: Object.freeze({ min: -19, max: -8, globalMin: -90, globalMax: 90 }),
  longitude: Object.freeze({ min: -47.5, max: -36, globalMin: -180, globalMax: 180 })
});

const HEADER_ALIASES = Object.freeze({
  area: ['area'],
  mru: ['mru'],
  instalacao: ['instalacao'],
  medidor: ['medidor'],
  rua: ['rua'],
  numero: ['n', 'numero'],
  bairro: ['bairro'],
  local: ['local', 'cidade', 'localcidade'],
  cliente: ['cliente'],
  latitude: ['latitude'],
  longitude: ['longitude']
});

const REQUIRED_HEADERS = Object.keys(HEADER_ALIASES);

function sortStrings(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isBlankRow(row) {
  return row.every((value) => String(value ?? '').trim() === '');
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readJson(filename, description) {
  let text;
  try {
    text = fs.readFileSync(filename, 'utf8');
  } catch (error) {
    throw new Error(`${description} não encontrado: ${path.basename(filename)}.`, { cause: error });
  }

  try {
    return { text, value: JSON.parse(text) };
  } catch (error) {
    throw new Error(`${description} contém JSON inválido: ${path.basename(filename)}.`, { cause: error });
  }
}

export function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Parser CSV pequeno e estrito para arquivos delimitados por ponto e vírgula.
 * Suporta BOM, CRLF/LF, campos citados, quebras dentro de campos e aspas "".
 */
export function parseCsv(source, delimiter = ';') {
  if (typeof source !== 'string') throw new TypeError('O conteúdo CSV deve ser texto.');
  if (typeof delimiter !== 'string' || delimiter.length !== 1) {
    throw new TypeError('O delimitador CSV deve possuir um caractere.');
  }

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let afterQuote = false;
  let logicalLine = 1;

  const pushField = () => {
    row.push(field.trim());
    field = '';
    afterQuote = false;
  };

  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
        continue;
      }

      if (character === '\r') {
        if (source[index + 1] === '\n') index += 1;
        field += '\n';
        logicalLine += 1;
        continue;
      }

      if (character === '\n') {
        field += '\n';
        logicalLine += 1;
        continue;
      }

      field += character;
      continue;
    }

    if (afterQuote) {
      if (character === delimiter) {
        pushField();
        continue;
      }

      if (character === '\r' || character === '\n') {
        if (character === '\r' && source[index + 1] === '\n') index += 1;
        pushRow();
        logicalLine += 1;
        continue;
      }

      if (/\s/u.test(character)) continue;
      throw new Error(`Caractere inesperado após aspas na linha CSV ${logicalLine}.`);
    }

    if (character === '"') {
      if (field.trim() !== '') {
        throw new Error(`Aspas inesperadas na linha CSV ${logicalLine}.`);
      }
      field = '';
      inQuotes = true;
      continue;
    }

    if (character === delimiter) {
      pushField();
      continue;
    }

    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      pushRow();
      logicalLine += 1;
      continue;
    }

    field += character;
  }

  if (inQuotes) throw new Error(`Campo CSV com aspas não encerradas na linha ${logicalLine}.`);
  if (field !== '' || row.length > 0 || afterQuote) pushRow();

  if (rows[0]?.length) rows[0][0] = rows[0][0].replace(/^\uFEFF/u, '').trim();
  return rows;
}

export function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/u, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function mapHeaders(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error('O CSV não possui cabeçalho.');
  }

  const normalized = headers.map(normalizeHeader);
  const duplicateNames = normalized.filter(
    (name, index) => name && normalized.indexOf(name) !== index
  );
  if (duplicateNames.length) {
    throw new Error(`Cabeçalho CSV duplicado: ${duplicateNames[0]}.`);
  }

  const mapped = {};
  for (const key of REQUIRED_HEADERS) {
    const aliases = HEADER_ALIASES[key];
    const matches = normalized
      .map((name, index) => (aliases.includes(name) ? index : -1))
      .filter((index) => index >= 0);

    if (matches.length === 0) {
      throw new Error(`Coluna obrigatória ausente no CSV: ${key}.`);
    }
    if (matches.length > 1) {
      throw new Error(`Mais de uma coluna corresponde a ${key}.`);
    }
    mapped[key] = matches[0];
  }

  return Object.freeze(mapped);
}

function parseStrictNumber(value) {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeCoordinate(rawValue, axis) {
  const bounds = BAHIA_BOUNDS[axis];
  if (!bounds) throw new Error(`Eixo de coordenada desconhecido: ${axis}.`);

  const value = String(rawValue ?? '').trim().replaceAll(',', '.');
  const number = value === '' ? null : parseStrictNumber(value);

  if (number !== null && number >= bounds.globalMin && number <= bounds.globalMax) {
    return { value, status: 'normal' };
  }

  const integerWithoutPoint = /^[+-]?\d+$/.test(value) && !value.includes('.');
  const outsideGlobalBounds = number !== null
    && (number < bounds.globalMin || number > bounds.globalMax);

  if (integerWithoutPoint && outsideGlobalBounds) {
    const sign = value.startsWith('-') ? '-' : value.startsWith('+') ? '+' : '';
    const digits = value.replace(/^[+-]/, '');
    const candidates = new Map();

    for (let position = 1; position < digits.length; position += 1) {
      const candidate = `${sign}${digits.slice(0, position)}.${digits.slice(position)}`;
      const candidateNumber = parseStrictNumber(candidate);
      if (candidateNumber !== null && candidateNumber >= bounds.min && candidateNumber <= bounds.max) {
        candidates.set(candidateNumber, candidate);
      }
    }

    if (candidates.size === 1) {
      return { value: [...candidates.values()][0], status: 'recuperada' };
    }
  }

  return { value, status: 'invalida' };
}

export function buildRecord(row, headerMap) {
  const text = (key) => String(row[headerMap[key]] ?? '').trim();
  const latitude = normalizeCoordinate(text('latitude'), 'latitude');
  const longitude = normalizeCoordinate(text('longitude'), 'longitude');
  const coordinatesValid = latitude.status !== 'invalida' && longitude.status !== 'invalida';

  const instalacao = text('instalacao');
  const medidor = text('medidor');
  const cliente = text('cliente');
  const linkMapa = coordinatesValid
    ? `https://www.google.com/maps?q=${latitude.value},${longitude.value}`
    : '';
  const pesquisa = [instalacao, medidor, cliente]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');

  const record = [
    text('mru'),
    instalacao,
    medidor,
    text('rua'),
    text('numero'),
    text('bairro'),
    text('local'),
    cliente,
    latitude.value,
    longitude.value,
    linkMapa,
    pesquisa
  ];

  const coordinateStatus = !coordinatesValid
    ? 'invalida'
    : latitude.status === 'recuperada' || longitude.status === 'recuperada'
      ? 'recuperada'
      : 'normal';

  return { record, coordinateStatus };
}

export function convertCsvText(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0 || isBlankRow(rows[0])) throw new Error('O CSV não possui cabeçalho.');

  const headers = rows[0];
  const headerMap = mapHeaders(headers);
  const areas = new Map();
  const stats = {
    totalCsvAceito: 0,
    coordenadas: { normais: 0, recuperadas: 0, invalidas: 0 },
    registrosSemMedidor: 0
  };

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (isBlankRow(row)) continue;
    if (row.length !== headers.length) {
      throw new Error(
        `Registro CSV ${index + 1} possui ${row.length} colunas; esperado: ${headers.length}.`
      );
    }

    const area = String(row[headerMap.area] ?? '').trim();
    if (!AREA_PATTERN.test(area)) {
      throw new Error(`Registro CSV ${index + 1} possui Área inválida.`);
    }

    const instalacao = String(row[headerMap.instalacao] ?? '').trim();
    if (!instalacao) throw new Error(`Registro CSV ${index + 1} não possui Instalação.`);

    const { record, coordinateStatus } = buildRecord(row, headerMap);
    if (record.length !== 12 || record.some((value) => typeof value !== 'string')) {
      throw new Error(`Registro CSV ${index + 1} não produziu as 12 strings esperadas.`);
    }

    if (!areas.has(area)) areas.set(area, []);
    areas.get(area).push(record);
    stats.totalCsvAceito += 1;
    const coordinateCounter = coordinateStatus === 'normal' ? 'normais' : `${coordinateStatus}s`;
    stats.coordenadas[coordinateCounter] += 1;
    if (!record[2]) stats.registrosSemMedidor += 1;
  }

  if (stats.totalCsvAceito === 0) throw new Error('Nenhuma instalação foi encontrada no CSV.');
  if (areas.size === 0) throw new Error('Nenhuma área foi encontrada no CSV.');

  return { areas, stats, headers: headers.map((header) => String(header).trim()) };
}

export function buildArtifacts(areas, { limit = LIMITE_POR_ARQUIVO } = {}) {
  if (!(areas instanceof Map) || areas.size === 0) throw new Error('Nenhuma área para gerar.');
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Limite por arquivo inválido.');

  const artifacts = new Map();
  const indexes = {};
  const manifest = { schemaVersion: SCHEMA_VERSION, areas: {} };
  const sortedAreas = [...areas.keys()].sort(sortStrings);

  for (const area of sortedAreas) {
    if (!AREA_PATTERN.test(area)) throw new Error(`Área inválida: ${area}.`);
    const records = areas.get(area);
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error(`A área ${area} não possui instalações.`);
    }

    for (const record of records) {
      if (!Array.isArray(record) || record.length !== 12
          || record.some((value) => typeof value !== 'string')) {
        throw new Error(`A área ${area} contém registro final inválido.`);
      }
    }

    const files = [];
    const fileHashes = {};
    for (let offset = 0, partNumber = 1; offset < records.length; offset += limit, partNumber += 1) {
      const filename = `${area}_${partNumber}.json`;
      const text = JSON.stringify(records.slice(offset, offset + limit));
      files.push(filename);
      fileHashes[filename] = sha256Text(text);
      artifacts.set(filename, text);
    }

    indexes[area] = files;
    manifest.areas[area] = {
      version: sha256Text(JSON.stringify(records)),
      total: records.length,
      files,
      fileHashes
    };
  }

  artifacts.set('indexes.json', `${JSON.stringify(indexes, null, 2)}\n`);
  artifacts.set('data-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  return { artifacts, indexes, manifest };
}

function totalsFromIndexes(directory) {
  const indexPath = path.join(directory, 'indexes.json');
  if (!fs.existsSync(indexPath)) return {};

  const { value: indexes } = readJson(indexPath, 'indexes.json da base anterior');
  if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)) return {};

  const totals = {};
  for (const [area, files] of Object.entries(indexes)) {
    if (!AREA_PATTERN.test(area) || !Array.isArray(files)) continue;
    let total = 0;
    for (const filename of files) {
      if (typeof filename !== 'string' || !DATA_FILE_PATTERN.test(filename)) continue;
      const filePath = path.join(directory, filename);
      if (!fs.existsSync(filePath)) continue;
      const { value } = readJson(filePath, `Parte anterior da área ${area}`);
      if (Array.isArray(value)) total += value.length;
    }
    totals[area] = total;
  }
  return totals;
}

export function calculateSignificantReductions(previousTotals, newTotals) {
  const reductions = [];
  const previousAreas = Object.keys(previousTotals).sort(sortStrings);

  for (const area of previousAreas) {
    const previous = Number(previousTotals[area] ?? 0);
    const current = Number(newTotals[area] ?? 0);
    if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) continue;

    // Estritamente superior a 15%; uma redução de exatamente 15% é aceita.
    if (current * 100 < previous * 85) {
      reductions.push({
        area,
        anterior: previous,
        novo: current,
        percentual: Number((((previous - current) / previous) * 100).toFixed(2))
      });
    }
  }

  return reductions;
}

export function validateOutput(directory, { limit = LIMITE_POR_ARQUIVO } = {}) {
  const resolvedDirectory = path.resolve(directory);
  const { value: indexes } = readJson(path.join(resolvedDirectory, 'indexes.json'), 'indexes.json');
  const { value: manifest } = readJson(
    path.join(resolvedDirectory, 'data-manifest.json'),
    'data-manifest.json'
  );

  if (!indexes || typeof indexes !== 'object' || Array.isArray(indexes)
      || Object.keys(indexes).length === 0) {
    throw new Error('indexes.json não contém áreas.');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)
      || manifest.schemaVersion !== SCHEMA_VERSION
      || !manifest.areas || typeof manifest.areas !== 'object' || Array.isArray(manifest.areas)) {
    throw new Error('data-manifest.json possui estrutura inválida.');
  }

  const indexAreas = Object.keys(indexes);
  const manifestAreas = Object.keys(manifest.areas);
  const sortedAreas = [...indexAreas].sort(sortStrings);
  if (JSON.stringify(indexAreas) !== JSON.stringify(sortedAreas)
      || JSON.stringify(indexAreas) !== JSON.stringify(manifestAreas)) {
    throw new Error('Áreas de indexes.json e data-manifest.json divergem ou estão fora de ordem.');
  }

  const referencedFiles = new Set();
  const summaryAreas = {};
  let grandTotal = 0;

  for (const area of sortedAreas) {
    const files = indexes[area];
    const info = manifest.areas[area];
    if (!AREA_PATTERN.test(area) || !Array.isArray(files) || files.length === 0
        || !info || typeof info !== 'object' || Array.isArray(info)) {
      throw new Error(`Configuração inválida para a área ${area}.`);
    }
    if (!HASH_PATTERN.test(info.version) || !Number.isSafeInteger(info.total) || info.total <= 0) {
      throw new Error(`Versão ou total inválido para a área ${area}.`);
    }
    if (JSON.stringify(info.files) !== JSON.stringify(files)
        || !info.fileHashes || typeof info.fileHashes !== 'object'
        || Array.isArray(info.fileHashes)) {
      throw new Error(`Manifesto inconsistente para a área ${area}.`);
    }

    const hashKeys = Object.keys(info.fileHashes);
    if (JSON.stringify(hashKeys) !== JSON.stringify(files)) {
      throw new Error(`Mapa de hashes inconsistente para a área ${area}.`);
    }

    const areaRecords = [];
    for (let index = 0; index < files.length; index += 1) {
      const filename = files[index];
      const expected = `${area}_${index + 1}.json`;
      if (filename !== expected || !DATA_FILE_PATTERN.test(filename)) {
        throw new Error(`Parte inválida ou não contígua para a área ${area}.`);
      }
      if (referencedFiles.has(filename)) throw new Error(`Arquivo referenciado mais de uma vez: ${filename}.`);
      referencedFiles.add(filename);

      const { text, value: part } = readJson(path.join(resolvedDirectory, filename), `Parte ${filename}`);
      if (sha256Text(text) !== info.fileHashes[filename] || !HASH_PATTERN.test(info.fileHashes[filename])) {
        throw new Error(`Hash divergente para ${filename}.`);
      }
      if (!Array.isArray(part) || part.length === 0 || part.length > limit) {
        throw new Error(`Quantidade inválida de registros em ${filename}.`);
      }
      if (index < files.length - 1 && part.length !== limit) {
        throw new Error(`A parte ${filename} não atingiu o limite antes da parte seguinte.`);
      }

      for (const record of part) {
        if (!Array.isArray(record) || record.length !== 12
            || record.some((value) => typeof value !== 'string')) {
          throw new Error(`${filename} contém registro que não possui exatamente 12 strings.`);
        }
        areaRecords.push(record);
      }
    }

    if (areaRecords.length !== info.total) {
      throw new Error(`Total divergente para a área ${area}.`);
    }
    if (sha256Text(JSON.stringify(areaRecords)) !== info.version) {
      throw new Error(`Hash da área ${area} diverge dos dados finais.`);
    }

    summaryAreas[area] = {
      total: info.total,
      arquivos: files.length,
      version: info.version
    };
    grandTotal += info.total;
  }

  const numericFiles = fs.readdirSync(resolvedDirectory)
    .filter((filename) => DATA_FILE_PATTERN.test(filename))
    .sort(sortStrings);
  const expectedFiles = [...referencedFiles].sort(sortStrings);
  if (JSON.stringify(numericFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('Há partes numéricas ausentes ou obsoletas no diretório de saída.');
  }
  if (grandTotal === 0) throw new Error('Nenhuma instalação foi gerada.');

  return { totalGeral: grandTotal, areas: summaryAreas };
}

export function writeArtifactsAtomically(outputDirectory, artifactBundle) {
  const output = path.resolve(outputDirectory);
  ensureDirectory(output);
  const stage = fs.mkdtempSync(path.join(output, '.rotaleitura-stage-'));
  const backup = path.join(stage, 'backup');
  const promoted = [];
  const backedUp = [];

  try {
    for (const [filename, text] of artifactBundle.artifacts) {
      if (!(DATA_FILE_PATTERN.test(filename)
          || filename === 'indexes.json'
          || filename === 'data-manifest.json')) {
        throw new Error(`Nome de artefato não permitido: ${filename}.`);
      }
      fs.writeFileSync(path.join(stage, filename), text, 'utf8');
    }

    validateOutput(stage);
    ensureDirectory(backup);

    const generatedParts = new Set(
      [...artifactBundle.artifacts.keys()].filter((filename) => DATA_FILE_PATTERN.test(filename))
    );
    const existingParts = fs.readdirSync(output).filter((filename) => DATA_FILE_PATTERN.test(filename));
    const targets = new Set([
      ...generatedParts,
      ...existingParts,
      'indexes.json',
      'data-manifest.json'
    ]);

    for (const filename of targets) {
      const target = path.join(output, filename);
      if (!fs.existsSync(target)) continue;
      fs.renameSync(target, path.join(backup, filename));
      backedUp.push(filename);
    }

    const metadata = new Set(['indexes.json', 'data-manifest.json']);
    const orderedFiles = [
      ...[...artifactBundle.artifacts.keys()].filter((filename) => !metadata.has(filename)),
      'indexes.json',
      'data-manifest.json'
    ];
    for (const filename of orderedFiles) {
      fs.renameSync(path.join(stage, filename), path.join(output, filename));
      promoted.push(filename);
    }

    validateOutput(output);
  } catch (error) {
    for (const filename of promoted.reverse()) {
      const target = path.join(output, filename);
      if (fs.existsSync(target)) fs.rmSync(target, { force: true });
    }
    for (const filename of backedUp) {
      const saved = path.join(backup, filename);
      if (fs.existsSync(saved)) fs.renameSync(saved, path.join(output, filename));
    }
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

export function createReport({ stats, manifest, previousTotals = {} }) {
  const areas = {};
  const newTotals = {};
  for (const [area, info] of Object.entries(manifest.areas)) {
    areas[area] = {
      total: info.total,
      arquivos: info.files.length,
      version: info.version
    };
    newTotals[area] = info.total;
  }

  const totalGeral = Object.values(newTotals).reduce((sum, total) => sum + total, 0);
  if (totalGeral !== stats.totalCsvAceito) {
    throw new Error('O total gerado não corresponde ao total aceito do CSV.');
  }

  return {
    totalGeral,
    totalCsvAceito: stats.totalCsvAceito,
    areas,
    coordenadas: { ...stats.coordenadas },
    registrosSemMedidor: stats.registrosSemMedidor,
    reducoesSignificativas: calculateSignificantReductions(previousTotals, newTotals)
  };
}

function printReport(report) {
  console.log(`Total geral: ${report.totalGeral}`);
  for (const [area, info] of Object.entries(report.areas)) {
    console.log(`Área ${area}: ${info.total} instalações, ${info.arquivos} arquivo(s), ${info.version}`);
  }
  console.log(`Coordenadas normais: ${report.coordenadas.normais}`);
  console.log(`Coordenadas recuperadas: ${report.coordenadas.recuperadas}`);
  console.log(`Coordenadas inválidas: ${report.coordenadas.invalidas}`);
  console.log(`Registros sem medidor: ${report.registrosSemMedidor}`);

  for (const reduction of report.reducoesSignificativas) {
    console.warn(
      `ATENÇÃO: área ${reduction.area} reduziu ${reduction.percentual}% `
      + `(${reduction.anterior} → ${reduction.novo}).`
    );
  }
}

function parseArguments(argv) {
  const options = {};
  const valueOptions = new Set(['--input', '--output', '--baseline', '--report', '--validate-output']);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check-header') {
      options.checkHeader = true;
      continue;
    }
    if (!valueOptions.has(argument)) throw new Error(`Argumento desconhecido: ${argument}.`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Valor ausente para ${argument}.`);
    index += 1;

    if (argument === '--input') options.input = value;
    if (argument === '--output') options.output = value;
    if (argument === '--baseline') options.baseline = value;
    if (argument === '--report') options.report = value;
    if (argument === '--validate-output') options.validateOutput = value;
  }

  return options;
}

function writeReport(filename, report) {
  ensureDirectory(path.dirname(path.resolve(filename)));
  fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function revalidateReport(reportFilename, validation, baselineDirectory) {
  const { value: report } = readJson(path.resolve(reportFilename), 'Relatório da conversão');
  if (report.totalGeral !== validation.totalGeral
      || report.totalCsvAceito !== validation.totalGeral
      || !report.areas || typeof report.areas !== 'object') {
    throw new Error('O relatório não corresponde aos artefatos validados.');
  }

  const newTotals = {};
  for (const [area, info] of Object.entries(validation.areas)) {
    const reportInfo = report.areas[area];
    if (!reportInfo || reportInfo.total !== info.total
        || reportInfo.arquivos !== info.arquivos
        || reportInfo.version !== info.version) {
      throw new Error(`O relatório diverge dos dados validados da área ${area}.`);
    }
    newTotals[area] = info.total;
  }

  if (Object.keys(report.areas).length !== Object.keys(validation.areas).length) {
    throw new Error('O relatório contém áreas divergentes dos artefatos validados.');
  }

  const previousTotals = baselineDirectory ? totalsFromIndexes(path.resolve(baselineDirectory)) : {};
  report.reducoesSignificativas = calculateSignificantReductions(previousTotals, newTotals);
  writeReport(reportFilename, report);
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);

  if (options.validateOutput) {
    const validation = validateOutput(options.validateOutput);
    if (options.report) {
      revalidateReport(options.report, validation, options.baseline);
    }
    console.log(`Saída válida: ${validation.totalGeral} instalações em ${Object.keys(validation.areas).length} áreas.`);
    return validation;
  }

  const input = path.resolve(options.input ?? './entrada/dbcr17.csv');
  const csvText = fs.readFileSync(input, 'utf8');

  if (options.checkHeader) {
    const rows = parseCsv(csvText);
    if (!rows.length) throw new Error('O CSV não possui cabeçalho.');
    mapHeaders(rows[0]);
    console.log(`Cabeçalho CSV reconhecido: ${rows[0].map((value) => String(value).trim()).join(';')}`);
    return { headers: rows[0] };
  }

  const output = path.resolve(options.output ?? '.');
  const baseline = path.resolve(options.baseline ?? output);
  const converted = convertCsvText(csvText);
  const bundle = buildArtifacts(converted.areas);
  const previousTotals = totalsFromIndexes(baseline);
  const report = createReport({
    stats: converted.stats,
    manifest: bundle.manifest,
    previousTotals
  });

  writeArtifactsAtomically(output, bundle);
  if (options.report) writeReport(options.report, report);
  printReport(report);
  console.log('Conversão concluída.');
  return report;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(`Erro na conversão: ${error.message}`);
    process.exitCode = 1;
  });
}
