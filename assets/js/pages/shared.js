/**
 * Shared Page Utilities
 * Plataforma PFO — GSE
 *
 * Functions shared across multiple pages.
 * Preserves the exact same status detection logic as before.
 */

/**
 * Determine the status of a PFO entry.
 * EXACT same logic as the original getSt() function.
 *
 * @param {Object} pfo - PFO entry
 * @param {Object} aprovacoes - Aprovações map
 * @returns {string} - aprovado | reprovado | enviado | pendente
 */
export function getStatus(pfo, aprovacoes) {
  const key = (pfo.arquivo || '')
    .replace(/\.xlsm$/, '')
    .replace(/\.xlsx$/, '')
    .replace(/\.xls$/, '');
  const a = aprovacoes[key] || {};
  const st = a.status || '';

  if (st === 'aprovado') return 'aprovado';
  if (st === 'reprovado') return 'reprovado';
    if (st === 'validado') return 'validado';
  if (
    st.includes('aguardando') ||
    st.includes('validacao') ||
    st.includes('aprovacao')
  )
    return 'enviado';
  if (pfo.arquivo) return 'enviado';
  return 'pendente';
}

/**
 * Streamlit app URL — centralized for easy update.
 */
export const STREAMLIT_URL =
  'https://plataforma-pfo-ghjcxccztnvn2yatcnsfr4.streamlit.app';
