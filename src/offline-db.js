const DB_NAME = 'RotaLeituraDB';
const DB_VERSION = 1;
const STORE_AREAS = 'areas';

export class OfflineDatabase {
  #db = null;

  async abrir() {
    if (this.#db) return this.#db;

    this.#db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_AREAS)) {
          db.createObjectStore(STORE_AREAS);
        }
      };

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => reject(request.error ?? new Error('Erro ao abrir IndexedDB'));
      request.onblocked = () => reject(new Error('IndexedDB bloqueado por outra aba'));
    });

    this.#db.onversionchange = () => {
      this.#db?.close();
      this.#db = null;
    };

    return this.#db;
  }

  async lerArea(area) {
    const db = await this.abrir();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_AREAS, 'readonly');
      const request = transaction.objectStore(STORE_AREAS).get(area);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error('Erro ao ler área offline'));
    });
  }

  async salvarArea(area, dados, versao) {
    const db = await this.abrir();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_AREAS, 'readwrite');
      transaction.objectStore(STORE_AREAS).put({
        dados,
        data: Date.now(),
        versao
      }, area);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Erro ao salvar área offline'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Gravação offline cancelada'));
    });
  }
}
