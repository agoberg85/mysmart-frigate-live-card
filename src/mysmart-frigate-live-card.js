import { LitElement, html, css } from 'lit';
import Hls from 'hls.js';

class FrigateLiveCard extends LitElement {
  static get properties() {
    return {
      hass: {},
      config: {},
      _videoUrl: { state: true },
      _error: { state: true },
      _zoom: { state: true },
      _panX: { state: true },
      _panY: { state: true },
      _isDragging: { state: true },
      _isMuted: { state: true },
      _isLoading: { state: true },
      _streamType: { state: true }
    };
  }

  constructor() {
    super();
    this._hls = null;
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._isDragging = false;
    this._isMuted = true;
    this._isLoading = true;
    this._startPan = { x: 0, y: 0 };
    this._pointers = new Map();
    this._lastPinchDist = null;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define "entity" (camera entity_id)');
    }
    this.config = {
      title: '',
      ...config
    };
  }

  // --- Lifecycle ---

  async firstUpdated() {
    this.initCamera();
  }

  async updated(changedProps) {
    if (changedProps.has('config') && changedProps.get('config')) {
      this.resetView();
      this.initCamera();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanupPlayer();
  }

  cleanupPlayer() {
    if (this._hls) {
      this._hls.destroy();
      this._hls = null;
    }
  }

  // --- HLS & Video Handling ---

  async initCamera() {
    this._error = null;
    this._isLoading = true;
    this.cleanupPlayer();

    try {
      const entity = this.hass.states[this.config.entity];
      if (!entity) throw new Error(`Entity ${this.config.entity} not found`);

      // Attempt 1: Try to get HLS Stream (High Quality)
      try {
        const result = await this.hass.callWS({
          type: 'camera/stream',
          entity_id: this.config.entity
        });

        let url = result.url;
        // Fix for relative URLs
        if (url.startsWith('/')) {
          url = new URL(url, window.location.href).href;
        }

        this._streamType = 'hls';
        this._videoUrl = url;
        await this.updateComplete;
        this.initPlayer(url);

      } catch (streamError) {
        // Attempt 2: Fallback to MJPEG Stream
        console.warn("HLS Stream failed, falling back to MJPEG:", streamError.message);

        let mjpegUrl = entity.attributes.entity_picture;

        if (mjpegUrl) {
          // Switch from single image to stream
          if (mjpegUrl.includes('/camera_proxy/')) {
            mjpegUrl = mjpegUrl.replace('/camera_proxy/', '/camera_proxy_stream/');
          }

          this._videoUrl = mjpegUrl;
          this._streamType = 'mjpeg';
          this._isLoading = false;
        } else {
          throw new Error("Camera does not support Streaming or MJPEG");
        }
      }

    } catch (e) {
      this._error = e.message;
      this._isLoading = false;
    }
  }

  initPlayer(url) {
    const videoEl = this.shadowRoot.querySelector('video');
    if (!videoEl) return;

    if (Hls.isSupported()) {
      this._hls = new Hls({
        liveSyncDurationCount: 3,
        maxMaxBufferLength: 10,
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 0
      });

      this._hls.loadSource(url);
      this._hls.attachMedia(videoEl);

      this._hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this._isLoading = false;
        videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
      });

      this._hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log("Fatal network error, attempting recovery");
              this._hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log("Fatal media error, attempting recovery");
              this._hls.recoverMediaError();
              break;
            default:
              this._error = "Stream playback failed";
              this._isLoading = false;
              this.cleanupPlayer();
              break;
          }
        }
      });
    } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Safari/iOS support
      videoEl.src = url;
      videoEl.addEventListener('loadedmetadata', () => {
        this._isLoading = false;
      });
      videoEl.play().catch(e => console.warn('Autoplay prevented:', e));
    }
  }

  // --- Pan & Zoom Logic ---

  handleWheel(e) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomSensitivity = 0.1;
    const delta = e.deltaY > 0 ? -zoomSensitivity : zoomSensitivity;
    this.applyZoom(delta, mouseX, mouseY);
  }

  handlePointerDown(e) {
    e.preventDefault();
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this._pointers.size === 1) {
      this._isDragging = true;
      this._startPan = { x: e.clientX - this._panX, y: e.clientY - this._panY };
    } else if (this._pointers.size === 2) {
      this._isDragging = false;
      const pointers = Array.from(this._pointers.values());
      this._lastPinchDist = this.getDistance(pointers[0], pointers[1]);
    }

    e.target.setPointerCapture(e.pointerId);
  }

  handlePointerUp(e) {
    this._pointers.delete(e.pointerId);

    if (this._pointers.size === 0) {
      this._isDragging = false;
      this._lastPinchDist = null;
    } else if (this._pointers.size === 1) {
      // Switch back to pan mode
      const remaining = Array.from(this._pointers.values())[0];
      this._isDragging = true;
      this._startPan = { x: remaining.x - this._panX, y: remaining.y - this._panY };
    }

    if (e.target.hasPointerCapture(e.pointerId)) {
      e.target.releasePointerCapture(e.pointerId);
    }
  }

  handlePointerMove(e) {
    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (this._pointers.size === 2) {
      // Pinch to zoom
      e.preventDefault();
      const pointers = Array.from(this._pointers.values());
      const currentDist = this.getDistance(pointers[0], pointers[1]);

      if (this._lastPinchDist) {
        const delta = (currentDist - this._lastPinchDist) * 0.01;
        const centerX = (pointers[0].x + pointers[1].x) / 2;
        const centerY = (pointers[0].y + pointers[1].y) / 2;
        const rect = e.currentTarget.getBoundingClientRect();
        this.applyZoom(delta, centerX - rect.left, centerY - rect.top);
      }

      this._lastPinchDist = currentDist;
    } else if (this._isDragging && this._pointers.size === 1) {
      // Pan
      e.preventDefault();
      const newPanX = e.clientX - this._startPan.x;
      const newPanY = e.clientY - this._startPan.y;

      // Apply bounds checking
      const bounds = this.calculatePanBounds();
      this._panX = Math.max(bounds.minX, Math.min(bounds.maxX, newPanX));
      this._panY = Math.max(bounds.minY, Math.min(bounds.maxY, newPanY));
    }
  }

  getDistance(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  calculatePanBounds() {
    if (this._zoom <= 1) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }

    const wrapper = this.shadowRoot.querySelector('.video-wrapper');
    if (!wrapper) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    const rect = wrapper.getBoundingClientRect();
    const scaledWidth = rect.width * this._zoom;
    const scaledHeight = rect.height * this._zoom;

    const maxPanX = (scaledWidth - rect.width) / 2;
    const maxPanY = (scaledHeight - rect.height) / 2;

    return {
      minX: -maxPanX,
      maxX: maxPanX,
      minY: -maxPanY,
      maxY: maxPanY
    };
  }

  applyZoom(delta, centerX = null, centerY = null) {
    const oldZoom = this._zoom;
    let newZoom = this._zoom + delta;

    // Clamp zoom
    if (newZoom < 1) newZoom = 1;
    if (newZoom > 5) newZoom = 5;

    // Zoom towards cursor/touch point
    if (centerX !== null && centerY !== null && oldZoom !== newZoom) {
      const zoomRatio = newZoom / oldZoom;
      this._panX = centerX - (centerX - this._panX) * zoomRatio;
      this._panY = centerY - (centerY - this._panY) * zoomRatio;
    }

    this._zoom = newZoom;

    // Reset pan if zoomed out completely
    if (newZoom === 1) {
      this._panX = 0;
      this._panY = 0;
    } else {
      // Apply bounds after zoom
      const bounds = this.calculatePanBounds();
      this._panX = Math.max(bounds.minX, Math.min(bounds.maxX, this._panX));
      this._panY = Math.max(bounds.minY, Math.min(bounds.maxY, this._panY));
    }
  }

  resetView() {
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
  }

  toggleMute() {
    this._isMuted = !this._isMuted;
    const video = this.shadowRoot.querySelector('video');
    if (video) {
      video.muted = this._isMuted;
    }
  }

  takeSnapshot() {
    const video = this.shadowRoot.querySelector('video');
    const img = this.shadowRoot.querySelector('img');

    if (video && video.readyState >= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const link = document.createElement('a');
      link.download = `snapshot-${new Date().toISOString()}.jpg`;
      link.href = canvas.toDataURL('image/jpeg');
      link.click();
    } else if (img) {
      // For MJPEG, we'll download the current frame
      const link = document.createElement('a');
      link.download = `snapshot-${new Date().toISOString()}.jpg`;
      link.href = this._videoUrl;
      link.click();
    }
  }

  toggleFullscreen() {
    const el = this.shadowRoot.querySelector('.player-container');

    if (!document.fullscreenElement &&
      !document.webkitFullscreenElement &&
      !document.mozFullScreenElement) {
      if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else if (el.mozRequestFullScreen) {
        el.mozRequestFullScreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
      }
    }
  }

  render() {
    return html`
      <ha-card>
        <div class="header">
          <div class="live-indicator">
            <span class="blink" style="background: ${this._streamType === 'mjpeg' ? '#ff9800' : '#f44336'}"></span> 
            ${this._streamType === 'mjpeg' ? 'LIVE (MJPEG)' : 'LIVE'}
          </div>
          <div class="title">${this.config.title}</div>
          <div class="controls">
            ${this._streamType === 'hls' ? html`
              <button class="icon-btn" @click=${this.toggleMute} title="${this._isMuted ? 'Unmute' : 'Mute'}">
                <ha-icon icon="mdi:${this._isMuted ? 'volume-off' : 'volume-high'}"></ha-icon>
              </button>
            ` : ''}
            <button class="icon-btn" @click=${this.takeSnapshot} title="Snapshot">
              <ha-icon icon="mdi:camera"></ha-icon>
            </button>
            <button class="icon-btn" @click=${this.toggleFullscreen} title="Fullscreen">
              <ha-icon icon="mdi:fullscreen"></ha-icon>
            </button>
          </div>
        </div>

        <div class="player-container">
          ${this._isLoading ? html`
            <div class="loading">
              <div class="spinner"></div>
              <div>Loading stream...</div>
            </div>
          ` : ''}

          <div class="video-wrapper" 
               style="transform: scale(${this._zoom}) translate(${this._panX}px, ${this._panY}px); cursor: ${this._zoom > 1 ? (this._isDragging ? 'grabbing' : 'grab') : 'default'}"
               @wheel=${this.handleWheel}
               @pointerdown=${this.handlePointerDown}
               @pointermove=${this.handlePointerMove}
               @pointerup=${this.handlePointerUp}
               @pointercancel=${this.handlePointerUp}
               @pointerleave=${this.handlePointerUp}
          >
            ${this._error ? html`<div class="error">${this._error}</div>` : ''}
            
            ${this._streamType === 'hls' ? html`
              <video 
                autoplay 
                ?muted=${this._isMuted}
                playsinline 
                style="width: 100%; height: 100%; display: block; object-fit: contain;"
              ></video>
            ` : this._streamType === 'mjpeg' ? html`
              <img 
                src="${this._videoUrl}" 
                style="width: 100%; height: 100%; display: block; object-fit: contain;"
                @load=${() => this._isLoading = false}
                @error=${() => { this._error = 'Failed to load MJPEG stream'; this._isLoading = false; }}
              />
            ` : ''}
          </div>
          
          <div class="overlay-controls">
            <div class="zoom-controls">
              <button @click=${() => this.applyZoom(0.5)} title="Zoom In">
                <ha-icon icon="mdi:plus"></ha-icon>
              </button>
              <span class="zoom-level">${Math.round(this._zoom * 100)}%</span>
              <button @click=${() => this.applyZoom(-0.5)} title="Zoom Out">
                <ha-icon icon="mdi:minus"></ha-icon>
              </button>
              ${this._zoom > 1 ? html`
                <button @click=${this.resetView} class="reset-btn" title="Reset View">Reset</button>
              ` : ''}
            </div>
          </div>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host { display: block; }
      ha-card { overflow: hidden; background: #000; color: white; position: relative; isolation: isolate; }
      
      .header {
        position: absolute;
        top: 0; left: 0; right: 0;
        z-index: 10;
        background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
        padding: 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        pointer-events: none;
      }
      
      .header > * { pointer-events: auto; }

      .live-indicator {
        display: flex; align-items: center; gap: 6px;
        font-size: 10px; font-weight: bold; color: #f44336;
        background: rgba(0,0,0,0.5); padding: 4px 8px; border-radius: 4px;
      }
      .blink { 
        width: 8px; height: 8px; background: #f44336; border-radius: 50%; 
        animation: blinker 1s linear infinite; 
      }
      
      .title { 
        font-weight: 500; font-size: 14px; text-shadow: 0 1px 2px black;
        flex: 1; text-align: center; margin: 0 10px;
      }

      .controls { display: flex; gap: 8px; }
      .icon-btn { 
        background: rgba(255,255,255,0.2); border: none; color: white; 
        border-radius: 50%; width: 32px; height: 32px; cursor: pointer; 
        display: flex; align-items: center; justify-content: center; 
        backdrop-filter: blur(4px); transition: background 0.2s;
      }
      .icon-btn:hover { background: rgba(255,255,255,0.4); }
      .icon-btn:active { background: rgba(255,255,255,0.5); }

      .player-container {
        position: relative;
        width: 100%;
        aspect-ratio: 16/9;
        overflow: hidden;
        background: #111;
      }

      .video-wrapper {
        width: 100%; height: 100%;
        transform-origin: center center;
        transition: transform 0.05s linear;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }

      .loading {
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        color: #aaa;
        z-index: 5;
      }

      .spinner {
        width: 40px;
        height: 40px;
        border: 4px solid rgba(255,255,255,0.1);
        border-top-color: #f44336;
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .overlay-controls {
        position: absolute;
        bottom: 16px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 10;
        pointer-events: none;
      }

      .zoom-controls {
        display: flex;
        flex-direction: column;
        background: rgba(0,0,0,0.6);
        border-radius: 16px;
        padding: 4px;
        backdrop-filter: blur(4px);
        align-items: center;
        pointer-events: auto;
      }

      .zoom-controls button {
        background: transparent;
        border: none;
        color: white;
        padding: 8px;
        cursor: pointer;
        transition: background 0.2s;
        border-radius: 8px;
      }
      
      .zoom-controls button:hover {
        background: rgba(255,255,255,0.1);
      }
      
      .zoom-level { 
        font-size: 10px; font-weight: bold; color: #aaa; 
        padding: 4px 0;
      }
      
      .reset-btn { 
        font-size: 10px !important; text-transform: uppercase; 
        color: #f44336 !important; 
      }

      .error {
        position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
        color: #f44336; background: rgba(0,0,0,0.8); padding: 16px; 
        border-radius: 8px; z-index: 10; text-align: center;
        max-width: 80%;
      }

      @keyframes blinker { 50% { opacity: 0; } }
      @keyframes spin { to { transform: rotate(360deg); } }

      @media (max-width: 600px) {
        .title { font-size: 12px; }
        .icon-btn { width: 28px; height: 28px; }
        .overlay-controls { bottom: 12px; right: 12px; }
      }
    `;
  }
}

customElements.define('mysmart-frigate-live', FrigateLiveCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "mysmart-frigate-live",
  name: "Frigate Live",
  description: "Native Live View with Pan & Zoom"
});
