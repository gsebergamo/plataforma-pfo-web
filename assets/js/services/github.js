/**
 * GitHub Data Service
 * Plataforma PFO — GSE
 *
 * Handles data fetching from the GitHub-backed API.
 * Primary: server-side proxy at /api/data (uses GITHUB_TOKEN from Vercel env).
 * Fallback: retries with exponential backoff on failure.
 *
 * BACKWARD COMPATIBILITY:
 *   - Returns the same JSON structure as before
 *   - All fields preserved: pfos, aprovacoes, centros_custo, config, etc.
 *   - No schema changes
 */

import { state } from '../state.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

/**
 * Load platform data with retry logic.
 * Uses /api/data proxy which authenticates via server-side GITHUB_TOKEN.
 *
 * @param {boolean} forceRefresh - bypass cache
 * @returns {Promise<Object>} The platform data
 */
export async function loadPlatformData(forceRefresh = false) {
  // Return cached data if still valid
  if (!forceRefresh && state.isCacheValid) {
    console.log('[GitHub] Using cached data');
    return state.data;
  }

  state.isLoading = true;
  state.error = null;

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`[GitHub] Retry attempt ${attempt}/${MAX_RETRIES}...`);
        await sleep(RETRY_DELAYS[attempt - 1] || 4000);
      }

      console.log('[GitHub] Fetching data from /api/data...');
      const response = await fetch('/api/data', {
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        let errorMsg;
        try {
          const parsed = JSON.parse(errorBody);
          errorMsg = parsed.error || `Erro HTTP ${response.status}`;
        } catch {
          errorMsg = `Erro HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();

      // Validate we got real data
      if (!data || typeof data !== 'object') {
        throw new Error('Dados inválidos recebidos do servidor.');
      }

      // Check if it looks like an error response
      if (data.error) {
        throw new Error(data.error);
      }

      // Normalize and store
      const normalizedData = normalizeData(data);
      state.data = normalizedData;
      state.isLoading = false;

      const pfoCount = normalizedData.pfos?.length || 0;
      const ccCount = Object.keys(normalizedData.centros_custo || {}).length;
      console.log(`[GitHub] Data loaded: ${pfoCount} PFOs, ${ccCount} centros de custo`);

      return normalizedData;
    } catch (error) {
      lastError = error;
      console.error(`[GitHub] Attempt ${attempt + 1} failed:`, error.message);
    }
  }

  // All retries failed
  const errorMessage = `Falha ao carregar dados após ${MAX_RETRIES + 1} tentativas: ${lastError?.message || 'Erro desconhecido'}`;
  console.error('[GitHub]', errorMessage);
  state.error = errorMessage;
  state.isLoading = false;
  throw new Error(errorMessage);
}

/**
 * Normalize data to ensure backward compatibility.
 * Adds missing fields with safe defaults — NEVER removes existing fields.
 *
 * @param {Object} data - Raw data from API
 * @returns {Object} Normalized data
 */
function normalizeData(data) {
  return {
    // Preserve ALL existing fields from the original data
    ...data,

    // Ensure required arrays/objects exist with safe defaults
    pfos: Array.isArray(data.pfos) ? data.pfos : [],
    pfos_mensais: Array.isArray(data.pfos_mensais) ? data.pfos_mensais : [],
    aprovacoes: data.aprovacoes && typeof data.aprovacoes === 'object' ? data.aprovacoes : {},
    centros_custo: data.centros_custo && typeof data.centros_custo === 'object' ? data.centros_custo : {},
    config: data.config && typeof data.config === 'object' ? data.config : {},
  };
}

/**
 * Refresh data — invalidates cache and reloads.
 * @returns {Promise<Object>}
 */
export async function refreshData() {
  state.invalidateCache();
  return loadPlatformData(true);
}

/**
 * Sleep helper for retry delays.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
