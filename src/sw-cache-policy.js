(function exposeCachePolicy(scope) {
  const CACHE_PREFIX = 'rotaleitura-';
  const TRIM_INTERVAL = 25;

  function cachesToDelete(keys, validCaches) {
    const valid = new Set(validCaches);
    return keys.filter((key) => key.startsWith(CACHE_PREFIX) && !valid.has(key));
  }

  function createTileWriteTracker(interval = TRIM_INTERVAL) {
    const writes = new Map();

    return function shouldTrim(cacheName) {
      const count = (writes.get(cacheName) ?? 0) + 1;
      writes.set(cacheName, count);
      return count % interval === 0;
    };
  }

  function isConfigurationPath(pathname) {
    return pathname.endsWith('/indexes.json')
      || pathname.endsWith('/data-manifest.json');
  }

  function isAreaDataPath(pathname) {
    return /^\/?(?:.*\/)?\d+_\d+\.json$/i.test(pathname);
  }

  function isUsableNetworkResponse(response) {
    return Boolean(response)
      && (response.ok || response.type === 'opaque');
  }

  scope.RotaLeituraCachePolicy = {
    CACHE_PREFIX,
    cachesToDelete,
    createTileWriteTracker,
    isAreaDataPath,
    isConfigurationPath,
    isUsableNetworkResponse
  };
})(globalThis);
