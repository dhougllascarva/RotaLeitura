import { coordenadaValida, escapeHtml, urlSegura } from './utils.js';
import { LocationWatcher } from './location-watcher.js';

const TILE_OPTIONS = Object.freeze({
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1,
  maxZoom: 19
});

export class MapController {
  #containerId;
  #statusCallback;
  #map = null;
  #pointsLayer = null;
  #userMarker = null;
  #locationWatcher;
  #lastPosition = null;
  #visible = false;

  constructor(containerId, statusCallback = () => {}) {
    this.#containerId = containerId;
    this.#statusCallback = statusCallback;
    this.#locationWatcher = new LocationWatcher(
      navigator.geolocation,
      (position) => this.#atualizarLocalizacao(position)
    );
  }

  setVisible(visible, temporary = false) {
    this.#visible = visible;

    if (!visible) {
      if (temporary) {
        this.#locationWatcher.pause();
        this.#removerMarcadorUsuario();
      } else {
        this.pararLocalizacao();
        this.limparPontos();
      }
      return;
    }

    if (temporary) this.#locationWatcher.resume();
    window.setTimeout(() => this.#map?.invalidateSize(false), 80);
  }

  #ensureMap(center) {
    if (this.#map) return this.#map;

    this.#map = L.map(this.#containerId, {
      preferCanvas: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      zoomControl: true
    }).setView(center, 15);

    const mapaPadrao = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        ...TILE_OPTIONS,
        attribution: '© OpenStreetMap'
      }
    );

    const mapaSatelite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        ...TILE_OPTIONS,
        maxNativeZoom: 19,
        attribution: '© Esri'
      }
    );

    mapaPadrao.addTo(this.#map);
    L.control.layers({
      '🗺 Mapa': mapaPadrao,
      '🛰 Satélite': mapaSatelite
    }, null, { collapsed: true }).addTo(this.#map);

    return this.#map;
  }

  async exibir(rows) {
    const validos = [];

    for (const row of rows) {
      if (!coordenadaValida(row[8], row[9])) continue;
      validos.push({
        row,
        lat: Number.parseFloat(row[8]),
        lng: Number.parseFloat(row[9])
      });
    }

    if (!validos.length) {
      throw new Error('A MRU não possui coordenadas válidas');
    }

    const map = this.#ensureMap([validos[0].lat, validos[0].lng]);
    this.limparPontos();
    this.#statusCallback(`Preparando ${validos.length} pontos…`);

    const icon = L.divIcon({
      className: '',
      html: '<div class="instalacao-marker" aria-hidden="true"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const clusterGroup = L.markerClusterGroup({
      animate: false,
      maxClusterRadius: 34,
      removeOutsideVisibleBounds: true,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
      chunkInterval: 80,
      chunkDelay: 20,
      iconCreateFunction(cluster) {
        return L.divIcon({
          className: '',
          html: `<div class="cluster-marker">${cluster.getChildCount()}</div>`,
          iconSize: [42, 42],
          iconAnchor: [21, 21]
        });
      },
      chunkProgress: (processed, total) => {
        this.#statusCallback(
          processed >= total
            ? `${total} instalações exibidas.`
            : `Carregando pontos: ${processed}/${total}`
        );
      }
    });

    const markers = [];
    const bounds = L.latLngBounds();

    for (const point of validos) {
      bounds.extend([point.lat, point.lng]);

      const marker = L.marker([point.lat, point.lng], {
        icon,
        keyboard: false,
        riseOnHover: false,
        title: String(point.row[1] ?? '')
      });

      marker.once('click', () => {
        marker.bindPopup(this.#popup(point.row), { maxWidth: 320 }).openPopup();
      });

      markers.push(marker);
    }

    this.#pointsLayer = clusterGroup;
    map.addLayer(clusterGroup);
    clusterGroup.addLayers(markers);
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 18 });
    map.invalidateSize(false);

    this.iniciarLocalizacao();
  }

  #popup(row) {
    const link = urlSegura(row[10]);
    const botao = link === '#'
      ? ''
      : `<a class="popup-rota__botao" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">🗺 Navegar</a>`;

    return `
      <div class="popup-rota">
        <div class="popup-rota__titulo">⚡ ${escapeHtml(row[1] || '-')}</div>
        <div class="popup-rota__linha"><b>👤 Cliente:</b><br>${escapeHtml(row[7] || '-')}</div>
        <div class="popup-rota__linha"><b>🔢 Medidor:</b><br>${escapeHtml(row[2] || '-')}</div>
        <div class="popup-rota__linha"><b>📍 Endereço:</b><br>${escapeHtml(row[3] || '-')}, ${escapeHtml(row[4] || '')}</div>
        ${botao}
      </div>
    `;
  }

  iniciarLocalizacao() {
    if (!this.#visible || !this.#map) return;
    this.#locationWatcher.start();
  }

  #atualizarLocalizacao(position) {
    if (!this.#visible || !this.#map) return;
    const current = L.latLng(position.coords.latitude, position.coords.longitude);
    const now = Date.now();

    if (this.#lastPosition) {
      const distance = current.distanceTo(this.#lastPosition.latLng);
      const elapsed = now - this.#lastPosition.time;
      if (distance < 3 && elapsed < 5000) return;
    }

    this.#lastPosition = { latLng: current, time: now };

    if (this.#userMarker) {
      this.#userMarker.setLatLng(current);
      return;
    }

    this.#userMarker = L.circleMarker(current, {
      radius: 9,
      color: '#fff',
      weight: 3,
      fillColor: '#00e676',
      fillOpacity: 1,
      interactive: true
    })
      .bindPopup('📍 Sua localização')
      .addTo(this.#map);
  }

  pararLocalizacao() {
    this.#locationWatcher.stop();
    this.#lastPosition = null;
    this.#removerMarcadorUsuario();
  }

  #removerMarcadorUsuario() {
    if (this.#userMarker && this.#map) {
      this.#map.removeLayer(this.#userMarker);
      this.#userMarker = null;
    }
  }

  limparPontos() {
    if (this.#pointsLayer && this.#map) {
      this.#pointsLayer.clearLayers();
      this.#map.removeLayer(this.#pointsLayer);
      this.#pointsLayer = null;
    }
    this.#statusCallback('');
  }

  destruir() {
    this.pararLocalizacao();
    this.limparPontos();
    this.#map?.remove();
    this.#map = null;
  }
}
