/**
 * Aprovações Page
 * Plataforma PFO — GSE
 *
 * BACKWARD COMPATIBILITY:
 *   - Uses pfos (with pfos_mensais fallback) like original code
 *   - Same status detection logic
 *   - Same approval stage detection
 */

import { state } from '../state.js';
import { badge, tableEmpty } from '../components/ui.js';
import { getStatus, STREAMLIT_URL } from './shared.js';

export function renderAprovacoes() {
  const data = state.data;
  if (!data) return;

  // Use pfos as primary source (same data, full list)
  const pfos = data.pfos || [];
  const apr = data.aprovacoes || {};
  const tbody = document.getElementById('apr-tbody');
  if (!tbody) return;

  // Filter PFOs that are in 'enviado' status (awaiting approval)
  const aguardando = pfos.filter((p) => getStatus(p, apr) === 'enviado');

  if (!aguardando.length) {
    tbody.innerHTML = tableEmpty(5, 'Nenhum PFO aguardando aprovação');
    return;
  }

  tbody.innerHTML = aguardando
    .map((p) => {
      const key = (p.arquivo || '')
        .replace(/\.xlsm$/, '')
        .replace(/\.xlsx$/, '')
        .replace(/\.xls$/, '');
      const a = apr[key] || {};
      const dirs = a.aprovacoes_diretoria || {};
      const dirCount = Object.keys(dirs).length;
      const etapa =
        dirCount >= 2 ? 'Dir. Financeiro' :
        dirCount >= 1 ? 'Dir. Técnico' : 'Backoffice';

      return `<tr>
        <td class="td-mono">${p.projeto || p.cc_codigo || '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${key.substring(0, 25) || '—'}</td>
        <td class="td-muted">${etapa}</td>
        <td>${badge('aguardando')}</td>
        <td><a href="${STREAMLIT_URL}" target="_blank" class="section-action">Aprovar ↗</a></td>
      </tr>`;
    })
    .join('');
}
