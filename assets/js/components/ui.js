/**
 * Shared UI Components
 * Plataforma PFO — GSE
 *
 * Reusable UI component generators.
 * All functions return HTML strings — no framework dependency.
 */

/**
 * Create a status badge.
 * @param {string} status - aprovado | pendente | reprovado | enviado
 * @returns {string} HTML
 */
export function badge(status) {
  const labels = {
    aprovado: 'aprovado',
    pendente: 'pendente',
    reprovado: 'reprovado',
    enviado: 'enviado',
    aguardando: 'aguardando',
        validado: 'validado',
  };
  const label = labels[status] || status || 'pendente';
  const cls = status === 'aguardando' ? 'enviado' : (labels[status] ? status : 'pendente');
  return `<span class="badge ${cls}">${label}</span>`;
}

/**
 * Create an alert box.
 * @param {string} type - info | warn | danger | success
 * @param {string} icon
 * @param {string} message
 * @returns {string} HTML
 */
export function alert(type, icon, message) {
  return `<div class="alert ${type}">
    <span class="alert-icon">${icon}</span>
    <span>${message}</span>
  </div>`;
}

/**
 * Create an empty state placeholder.
 * @param {string} message
 * @param {string} icon
 * @returns {string} HTML
 */
export function emptyState(message = 'Sem dados disponíveis', icon = '📋') {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-text">${message}</div>
  </div>`;
}

/**
 * Create a loading placeholder row for tables.
 * @param {number} colspan
 * @returns {string} HTML
 */
export function tableLoading(colspan = 4) {
  return `<tr><td colspan="${colspan}" class="td-muted" style="text-align:center;padding:20px">
    <div class="loading-overlay"><div class="spinner"></div> Carregando...</div>
  </td></tr>`;
}

/**
 * Create a table empty state row.
 * @param {number} colspan
 * @param {string} message
 * @returns {string} HTML
 */
export function tableEmpty(colspan = 4, message = 'Nenhum dado encontrado') {
  return `<tr><td colspan="${colspan}" class="td-muted" style="text-align:center;padding:30px">${message}</td></tr>`;
}

/**
 * Create skeleton loading placeholders.
 * @param {number} count
 * @param {number} height
 * @returns {string} HTML
 */
export function skeletons(count = 3, height = 42) {
  return Array.from({ length: count })
    .map(() => `<div class="skeleton" style="height:${height}px;margin-bottom:8px"></div>`)
    .join('');
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} type - success | error | warning
 * @param {number} duration - ms
 */
export function showToast(message, type = 'success', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
    if (container.children.length === 0) container.remove();
  }, duration);
}

/**
 * Render a simple markdown subset (bold, newlines).
 * @param {string} text
 * @returns {string} HTML
 */
export function renderMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}
