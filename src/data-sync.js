const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MANIFEST_SCHEMA_VERSION = 1;
const RESULT_LISTS = Object.freeze({
  atual: 'atuais',
  atualizada: 'atualizadas',
  degradada: 'degradadas',
  indisponivel: 'indisponiveis'
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hasUsableCache(cache, expectedTotal = null) {
  if (!Array.isArray(cache?.dados) || cache.dados.length === 0) return false;
  return expectedTotal === null || cache.dados.length === expectedTotal;
}

async function notify(callback, detail) {
  try {
    await callback(detail);
  } catch {
    // A falha de uma atualização visual não pode invalidar dados já baixados.
  }
}

function registerResult(result, area, status, error = null) {
  const detail = { status };
  if (error) detail.erro = errorMessage(error);

  result.areas[area] = detail;
  result[RESULT_LISTS[status]].push(area);
}

function validateRows(rows, file) {
  if (!Array.isArray(rows)) {
    throw new Error(`${file} não contém um array JSON.`);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!Array.isArray(row) || row.length !== 12 || row.some((value) => typeof value !== 'string')) {
      throw new Error(`${file} contém registro inválido na posição ${index + 1}.`);
    }
  }
}

async function readResponseText(response, resource) {
  if (!response?.ok) {
    const status = response?.status ? ` (HTTP ${response.status})` : '';
    throw new Error(`Não foi possível baixar ${resource}${status}.`);
  }

  if (typeof response.text !== 'function') {
    throw new Error(`Resposta inválida ao baixar ${resource}.`);
  }

  return response.text();
}

export async function fetchWithTimeout(fetchFn, url, options = {}, timeoutMs = 30000) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || typeof AbortController !== 'function') {
    return fetchFn(url, options);
  }

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Tempo esgotado ao baixar ${url}.`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve(fetchFn(url, { ...options, signal: controller.signal })),
      timeout
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function calcularSha256(text, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) {
    throw new Error('Web Crypto não está disponível para validar os dados.');
  }

  const bytes = new TextEncoder().encode(String(text));
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `sha256:${hex}`;
}

export function validarManifesto(manifest) {
  if (!isObject(manifest)) {
    throw new Error('data-manifest.json deve conter um objeto JSON.');
  }

  if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Versão de manifesto não suportada: ${manifest.schemaVersion ?? 'ausente'}.`);
  }

  if (!isObject(manifest.areas)) {
    throw new Error('data-manifest.json não contém o mapa de áreas.');
  }

  for (const [area, info] of Object.entries(manifest.areas)) {
    if (!/^\d+$/.test(area) || !isObject(info)) {
      throw new Error(`Configuração inválida para a área ${area}.`);
    }

    if (!HASH_PATTERN.test(info.version)) {
      throw new Error(`Versão inválida para a área ${area}.`);
    }

    if (!Number.isSafeInteger(info.total) || info.total < 0) {
      throw new Error(`Total inválido para a área ${area}.`);
    }

    if (!Array.isArray(info.files) || info.files.length === 0) {
      throw new Error(`Lista de arquivos inválida para a área ${area}.`);
    }

    if (!isObject(info.fileHashes)) {
      throw new Error(`Hashes dos arquivos ausentes para a área ${area}.`);
    }

    for (let index = 0; index < info.files.length; index += 1) {
      const expectedFile = `${area}_${index + 1}.json`;
      const file = info.files[index];
      if (file !== expectedFile) {
        throw new Error(`Partes não contíguas ou fora de ordem para a área ${area}.`);
      }

      if (!Object.prototype.hasOwnProperty.call(info.fileHashes, file)
          || !HASH_PATTERN.test(info.fileHashes[file])) {
        throw new Error(`Hash inválido ou ausente para ${file}.`);
      }
    }

    const hashFiles = Object.keys(info.fileHashes);
    if (hashFiles.length !== info.files.length || hashFiles.some((file) => !info.files.includes(file))) {
      throw new Error(`Mapa de hashes inconsistente para a área ${area}.`);
    }
  }

  return manifest;
}

export async function carregarManifesto({
  fetchFn = globalThis.fetch,
  manifestUrl = './data-manifest.json',
  timeoutMs = 30000
} = {}) {
  if (typeof fetchFn !== 'function') {
    throw new Error('Função de download indisponível.');
  }

  const response = await fetchWithTimeout(
    fetchFn,
    manifestUrl,
    { cache: 'no-cache' },
    timeoutMs
  );
  const text = await readResponseText(response, 'data-manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    throw new Error('data-manifest.json contém JSON inválido.');
  }

  return validarManifesto(manifest);
}

async function downloadArea({
  area,
  info,
  fetchFn,
  hashText,
  yieldFn,
  onProgress,
  timeoutMs
}) {
  const rows = [];

  for (let index = 0; index < info.files.length; index += 1) {
    const file = info.files[index];
    await notify(onProgress, {
      etapa: 'baixando',
      area,
      arquivo: file,
      parte: index + 1,
      partes: info.files.length
    });

    const url = `./${file}?v=${encodeURIComponent(info.version)}`;
    const response = await fetchWithTimeout(fetchFn, url, { cache: 'no-store' }, timeoutMs);
    const text = await readResponseText(response, file);
    const actualHash = await hashText(text);

    if (actualHash !== info.fileHashes[file]) {
      throw new Error(`Falha de integridade em ${file}.`);
    }

    let part;
    try {
      part = JSON.parse(text);
    } catch {
      throw new Error(`${file} contém JSON inválido.`);
    }

    validateRows(part, file);
    for (const row of part) rows.push(row);

    if (rows.length > info.total) {
      throw new Error(`A área ${area} excede o total declarado no manifesto.`);
    }

    await yieldFn();
  }

  if (rows.length !== info.total) {
    throw new Error(
      `Total divergente para a área ${area}: esperado ${info.total}, recebido ${rows.length}.`
    );
  }

  const areaHash = await hashText(JSON.stringify(rows));
  if (areaHash !== info.version) {
    throw new Error(`Falha de integridade na versão da área ${area}.`);
  }

  return rows;
}

export async function sincronizarDados({
  areas,
  offlineDb,
  fetchFn = globalThis.fetch,
  hashText = calcularSha256,
  yieldFn = async () => {},
  onProgress = async () => {},
  manifestUrl = './data-manifest.json',
  manifestTimeoutMs = 30000,
  partTimeoutMs = 180000
} = {}) {
  if (!Array.isArray(areas) || !offlineDb || typeof offlineDb.lerArea !== 'function'
      || typeof offlineDb.salvarArea !== 'function') {
    throw new Error('Parâmetros inválidos para sincronização offline.');
  }

  const result = {
    manifestoDisponivel: false,
    erroManifesto: null,
    areas: {},
    atuais: [],
    atualizadas: [],
    degradadas: [],
    indisponiveis: []
  };

  let manifest = null;
  try {
    manifest = await carregarManifesto({
      fetchFn,
      manifestUrl,
      timeoutMs: manifestTimeoutMs
    });
    result.manifestoDisponivel = true;
  } catch (error) {
    result.erroManifesto = errorMessage(error);
  }

  const uniqueAreas = [...new Set(areas.map(String))];
  for (const area of uniqueAreas) {
    await notify(onProgress, { etapa: 'verificando', area });

    let cache = null;
    try {
      cache = await offlineDb.lerArea(area);
    } catch (error) {
      registerResult(result, area, 'indisponivel', error);
      continue;
    }

    const cacheAvailable = hasUsableCache(cache);
    if (!manifest) {
      registerResult(
        result,
        area,
        cacheAvailable ? 'degradada' : 'indisponivel',
        result.erroManifesto
      );
      continue;
    }

    const info = manifest.areas[area];
    if (!info) {
      registerResult(
        result,
        area,
        cacheAvailable ? 'degradada' : 'indisponivel',
        new Error(`Área ${area} ausente em data-manifest.json.`)
      );
      continue;
    }

    if (hasUsableCache(cache, info.total) && cache.versao === info.version) {
      registerResult(result, area, 'atual');
      continue;
    }

    try {
      const rows = await downloadArea({
        area,
        info,
        fetchFn,
        hashText,
        yieldFn,
        onProgress,
        timeoutMs: partTimeoutMs
      });

      await notify(onProgress, { etapa: 'salvando', area });
      await offlineDb.salvarArea(area, rows, info.version);
      registerResult(result, area, 'atualizada');
    } catch (error) {
      registerResult(result, area, cacheAvailable ? 'degradada' : 'indisponivel', error);
    }
  }

  return result;
}
