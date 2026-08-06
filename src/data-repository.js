import { normalizar } from './utils.js';

/**
 * Mantém apenas uma área ativa em memória.
 * Busca e mapa compartilham a mesma referência, evitando três cópias dos dados.
 */
export class DataRepository {
  #offlineDb;
  #activeArea = '';
  #rows = [];
  #mruIndex = new Map();
  #normalizedMruIndex = new Map();
  #loadingPromise = null;
  #loadGeneration = 0;

  constructor(offlineDb) {
    this.#offlineDb = offlineDb;
  }

  get activeArea() {
    return this.#activeArea;
  }

  get rows() {
    return this.#rows;
  }

  async carregarArea(area) {
    if (!area) {
      this.liberar();
      return this.resumo();
    }

    if (this.#activeArea === area && this.#rows.length) {
      return this.resumo();
    }

    if (this.#loadingPromise?.area === area) {
      return this.#loadingPromise.promise;
    }

    const generation = ++this.#loadGeneration;
    const promise = this.#carregar(area, generation);
    this.#loadingPromise = { area, promise };

    try {
      return await promise;
    } finally {
      if (this.#loadingPromise?.promise === promise) {
        this.#loadingPromise = null;
      }
    }
  }

  async #carregar(area, generation) {
    const cache = await this.#offlineDb.lerArea(area);
    if (!cache?.dados) {
      throw new Error('Área não sincronizada offline');
    }

    if (generation !== this.#loadGeneration) {
      return null;
    }

    this.#limparDados();
    this.#activeArea = area;
    this.#rows = cache.dados;

    for (const row of this.#rows) {
      const mru = String(row[0] ?? '').trim();
      if (!mru) continue;

      let rowsDaMru = this.#mruIndex.get(mru);
      if (!rowsDaMru) {
        rowsDaMru = [];
        this.#mruIndex.set(mru, rowsDaMru);
        this.#normalizedMruIndex.set(normalizar(mru), rowsDaMru);
      }
      rowsDaMru.push(row);
    }

    return this.resumo();
  }

  resumo() {
    return {
      area: this.#activeArea,
      total: this.#rows.length,
      mrus: [...this.#mruIndex.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    };
  }

  linhasDaMru(valor) {
    const chave = normalizar(valor);
    return this.#normalizedMruIndex.get(chave) ?? [];
  }

  candidatosPorMru(valor) {
    const filtro = normalizar(valor);
    if (!filtro) return this.#rows;

    const exato = this.#normalizedMruIndex.get(filtro);
    if (exato) return exato;

    const candidatos = [];
    for (const [mruNormalizada, rows] of this.#normalizedMruIndex) {
      if (!mruNormalizada.includes(filtro)) continue;
      for (const row of rows) candidatos.push(row);
    }

    return candidatos;
  }

  liberar() {
    this.#loadGeneration += 1;
    this.#limparDados();
  }

  #limparDados() {
    this.#activeArea = '';
    this.#rows = [];
    this.#mruIndex.clear();
    this.#normalizedMruIndex.clear();
  }
}
