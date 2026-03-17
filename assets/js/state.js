/**
 * State Management Module
 * Plataforma PFO — GSE
 *
 * Centralized state management with caching, subscriptions,
 * and derived data computation. Replaces global variables D, CH, ccData.
 *
 * BACKWARD COMPATIBILITY:
 *   - state.data maps to the old D global
 *   - state.chatHistory maps to the old chatHist/CH global
 *   - state.ccFilteredData maps to the old ccData global
 *   - Data schema is untouched — reads the same JSON structure from GitHub
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class AppState {
  constructor() {
    /** @type {Object|null} Raw data from GitHub (same schema as before) */
    this._data = null;

    /** @type {number|null} Timestamp of last data fetch */
    this._dataTimestamp = null;

    /** @type {Array} Chat message history */
    this._chatHistory = [];

    /** @type {Array} Filtered center data for search */
    this._ccFilteredData = [];

    /** @type {Array<Function>} State change listeners */
    this._listeners = [];

    /** @type {boolean} Whether data is currently being fetched */
    this._loading = false;

    /** @type {string|null} Last error message */
    this._error = null;
  }

  // -- Data --

  get data() {
    return this._data;
  }

  set data(value) {
    this._data = value;
    this._dataTimestamp = Date.now();
    this._error = null;
    this._loading = false;
    this._notify('data');
  }

  get isLoading() {
    return this._loading;
  }

  set isLoading(value) {
    this._loading = value;
    this._notify('loading');
  }

  get error() {
    return this._error;
  }

  set error(value) {
    this._error = value;
    this._loading = false;
    this._notify('error');
  }

  /**
   * Check if cached data is still valid.
   */
  get isCacheValid() {
    return (
      this._data !== null &&
      this._dataTimestamp !== null &&
      Date.now() - this._dataTimestamp < CACHE_TTL
    );
  }

  /**
   * Invalidate the cache (e.g., after a mutation).
   */
  invalidateCache() {
    this._dataTimestamp = null;
  }

  // -- Derived Data Accessors (preserving old data schema) --

  get pfos() {
    return this._data?.pfos || [];
  }

  get aprovacoes() {
    return this._data?.aprovacoes || {};
  }

  get centrosCusto() {
    return this._data?.centros_custo || {};
  }

  get config() {
    return this._data?.config || {};
  }

  // -- Chat --

  get chatHistory() {
    return [...this._chatHistory];
  }

  addChatMessage(message) {
    this._chatHistory.push(message);
    this._notify('chat');
  }

  clearChat() {
    this._chatHistory = [];
    this._notify('chat');
  }

  // -- CC Filtered Data --

  get ccFilteredData() {
    return this._ccFilteredData;
  }

  set ccFilteredData(value) {
    this._ccFilteredData = value;
  }

  // -- Subscriptions --

  /**
   * Subscribe to state changes.
   * @param {Function} listener - Called with (eventType) on changes
   * @returns {Function} Unsubscribe function
   */
  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  _notify(eventType) {
    this._listeners.forEach((fn) => {
      try {
        fn(eventType);
      } catch (e) {
        console.error('[State] Listener error:', e);
      }
    });
  }
}

/** Singleton state instance */
export const state = new AppState();
