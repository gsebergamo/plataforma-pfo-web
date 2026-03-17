/**
 * GitHub Data Service
 * Plataforma PFO — GSE
 *
 * Handles data fetching from the GitHub-backed API.
 * Uses the server-side proxy at /api/data to avoid exposing tokens.
 *
 * BACKWARD COMPATIBILITY:
 *   - Returns the same JSON structure as before
 *   - All fields preserved: pfos, aprovacoes, centros_custo, config, etc.
 *   - No schema changes — purely a transport improvement
 */

import { request, ApiError } from './api.js';
import { state } from '../state.js';

/**
 * Load platform data from the GitHub proxy.
 * Uses cache if valid, otherwise fetches fresh data.
 *
 * @param {boolean} forceRefresh - bypass cache
 * @returns {Promise<Object>} The platform data
 */
export async function loadPlatformData(forceRefresh = false) {
  // Return cached data if still valid
  if (!forceRefresh && state.isCacheValid) {
    return state.data;
  }

  state.isLoading = true;

  try {
    const data = await request('/api/data');

    // Validate response has expected structure
    if (!data || typeof data !== 'object') {
      throw new ApiError('Dados inválidos recebidos do servidor.');
    }

    // Ensure backward-compatible structure
    const normalizedData = normalizeData(data);
    state.data = normalizedData;
    return normalizedData;
  } catch (error) {
    state.error = error.message || 'Erro ao carregar dados.';
    throw error;
  }
}

/**
 * Normalize data to ensure backward compatibility.
 * Adds missing fields with safe defaults — never removes existing fields.
 *
 * @param {Object} data - Raw data from API
 * @returns {Object} Normalized data
 */
function normalizeData(data) {
  return {
    // Preserve ALL existing fields
    ...data,

    // Ensure required arrays/objects exist with safe defaults
    pfos: data.pfos || [],
    aprovacoes: data.aprovacoes || {},
    centros_custo: data.centros_custo || {},
    config: data.config || {},

    // Keep any extra fields that may exist in the data
    // This ensures backward compatibility with any schema extensions
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
