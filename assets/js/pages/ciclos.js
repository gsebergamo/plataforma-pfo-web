/**
 * Ciclos & Governança Page
 * Plataforma PFO — GSE
 */

import { state } from '../state.js';
import {
  safeNumber, formatNumber, getCurrentMonth, formatMonth,
  formatDate, marginColor,
} from '../utils/format.js';
import { badge, tableEmpty } from '../components/ui.js';
import { getStatus } from './shared.js';

export function renderCiclos() {
  const data = state.data;
  if (!data) return;

  const pfos = data.pfos || [];
  const apr = data.aprovacoes || {};
  const mes = getCurrentMonth();

  const cicloInfo = document.getElementById('ciclo-info');
  if (cicloInfo) cicloInfo.textContent = `Ciclo ${formatMonth(mes)} · ${pfos.length} PFOs`;

  const cicloBadge = document.getElementById('ciclo-badge');
  if (cicloBadge) cicloBadge.textContent = pfos.length + ' PFOs';

  const tbody = document.getElementById('ciclos-tbody');
  if (!tbody) return;

  if (!pfos.length) {
    tbody.innerHTML = tableEmpty(6, 'Nenhum PFO neste ciclo');
    return;
  }

  tbody.innerHTML = pfos
    .map((p) => {
      const rc = safeNumber((p.dre?.receita?.projetado || 0) * 1000);
      const cs = safeNumber((p.dre?.custo?.projetado || 0) * 1000);
      const mg = rc > 0 ? ((rc - cs) / rc) * 100 : 0;
      const st = getStatus(p, apr);
      const mc = marginColor(mg);
      const dt = formatDate(p.data_upload);
      const arquivo = (p.arquivo || '—').replace('.xlsx', '').substring(0, 30);

      return `<tr>
        <td class="td-mono">${p.projeto || '—'}</td>
        <td style="font-size:11px;color:var(--muted)">${arquivo}</td>
        <td class="td-mono">R$ ${formatNumber(rc / 1000)}k</td>
        <td style="color:${mc};font-family:var(--mono);font-size:11px">${mg.toFixed(1)}%</td>
        <td>${badge(st)}</td>
        <td class="td-muted td-mono">${dt}</td>
      </tr>`;
    })
    .join('');
}
