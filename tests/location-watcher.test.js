import test from 'node:test';
import assert from 'node:assert/strict';
import { LocationWatcher } from '../src/location-watcher.js';

test('GPS pausa, retoma somente quando estava ativo e não duplica watches', () => {
  let nextId = 0;
  const watches = [];
  const cleared = [];
  const geolocation = {
    watchPosition() {
      const id = ++nextId;
      watches.push(id);
      return id;
    },
    clearWatch(id) {
      cleared.push(id);
    }
  };
  const watcher = new LocationWatcher(geolocation, () => {});

  watcher.start();
  watcher.start();
  assert.deepEqual(watches, [1]);

  watcher.pause();
  watcher.pause();
  assert.deepEqual(cleared, [1]);

  watcher.resume();
  watcher.resume();
  assert.deepEqual(watches, [1, 2]);

  watcher.stop();
  watcher.resume();
  assert.deepEqual(cleared, [1, 2]);
  assert.deepEqual(watches, [1, 2]);
});
