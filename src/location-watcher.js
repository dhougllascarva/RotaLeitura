export class LocationWatcher {
  #geolocation;
  #onPosition;
  #watchId = null;
  #requested = false;
  #resumeAfterPause = false;

  constructor(geolocation, onPosition) {
    this.#geolocation = geolocation;
    this.#onPosition = onPosition;
  }

  start() {
    this.#requested = true;
    this.#resumeAfterPause = false;
    this.#ensureWatch();
  }

  pause() {
    if (this.#requested && this.#watchId !== null) {
      this.#resumeAfterPause = true;
    }
    this.#clearWatch();
  }

  resume() {
    if (!this.#resumeAfterPause) return;
    this.#resumeAfterPause = false;
    this.#ensureWatch();
  }

  stop() {
    this.#requested = false;
    this.#resumeAfterPause = false;
    this.#clearWatch();
  }

  #ensureWatch() {
    if (!this.#requested || !this.#geolocation || this.#watchId !== null) return;

    this.#watchId = this.#geolocation.watchPosition(
      this.#onPosition,
      () => {},
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 12000
      }
    );
  }

  #clearWatch() {
    if (this.#watchId === null) return;
    this.#geolocation.clearWatch(this.#watchId);
    this.#watchId = null;
  }
}
