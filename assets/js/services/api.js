/**
 * Base API Service
 * Plataforma PFO — GSE
 *
 * Centralized HTTP request handler with error handling and retries.
 */

const DEFAULT_TIMEOUT = 30000; // 30s

/**
 * Make an HTTP request with error handling.
 * @param {string} url
 * @param {Object} options - fetch options
 * @param {number} timeout - timeout in ms
 * @returns {Promise<Object>}
 */
export async function request(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') {
      throw new ApiError('Requisição expirou. Tente novamente.', 408);
    }
    throw new ApiError(
      'Erro de conexão. Verifique sua internet.',
      0,
      { originalError: error.message }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Custom API Error class.
 */
export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}
