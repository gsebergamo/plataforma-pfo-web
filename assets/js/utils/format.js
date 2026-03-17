/**
 * Formatting Utilities
 * Plataforma PFO — GSE
 *
 * Pure utility functions for formatting numbers, dates, and strings.
 * No side effects, no state dependencies.
 */

/**
 * Safe number parser — returns 0 for any non-numeric input.
 * @param {*} value
 * @returns {number}
 */
export function safeNumber(value) {
  const n = parseFloat(value);
  return isNaN(n) ? 0 : n;
}

/**
 * Format a number for display.
 * Values >= 1000 are shown as "1.2M", otherwise locale-formatted.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (Math.abs(n) >= 1000) {
    return (n / 1000).toFixed(1) + 'M';
  }
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/**
 * Format a currency value (in thousands).
 * @param {number} value - value in R$
 * @param {boolean} showUnit - whether to append 'k'
 * @returns {string}
 */
export function formatCurrency(value, showUnit = true) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  const formatted = formatNumber(value / 1000);
  return 'R$ ' + formatted + (showUnit ? 'k' : '');
}

/**
 * Format a YYYY-MM month string to "Mmm/YYYY".
 * @param {string} monthStr - e.g. "2024-03"
 * @returns {string}
 */
export function formatMonth(monthStr) {
  if (!monthStr) return '—';
  const parts = monthStr.split('-');
  if (parts.length < 2) return monthStr;
  const [year, month] = parts;
  const months = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
  ];
  return (months[parseInt(month) - 1] || month) + '/' + year;
}

/**
 * Get current month as YYYY-MM string.
 * @returns {string}
 */
export function getCurrentMonth() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
}

/**
 * Format a percentage value.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
export function formatPercent(value, decimals = 1) {
  if (value === null || value === undefined || isNaN(value)) return '—';
  return value.toFixed(decimals) + '%';
}

/**
 * Format a date string to Brazilian locale.
 * @param {string} dateStr
 * @returns {string}
 */
export function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR');
  } catch {
    return dateStr;
  }
}

/**
 * Truncate a string to a max length with ellipsis.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
export function truncate(str, max = 30) {
  if (!str) return '—';
  return str.length > max ? str.substring(0, max) + '...' : str;
}

/**
 * Get the color variable for a margin value.
 * @param {number} margin - percentage
 * @returns {string}
 */
export function marginColor(margin) {
  if (margin < 0) return 'var(--red)';
  if (margin < 5) return 'var(--amber)';
  return 'var(--green)';
}

/**
 * Calculate percentage safely.
 * @param {number} value
 * @param {number} total
 * @returns {number}
 */
export function percent(value, total) {
  if (!total || total === 0) return 0;
  return Math.round((value / total) * 100);
}
