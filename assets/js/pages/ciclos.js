/**
 * Ciclos & Governanca Page
 * Plataforma PFO — GSE
 *
 * Displays ALL 22 cost centers from centros_custo with pfo_mensal status.
 * Status mapping:
 *   enviado        -> "Enviado / Em analise"
 *   validado       -> "Validado"
 *   aprovado       -> "Aprovado"
 *   reprovado      -> "Em revisao"
 *   pendente       -> "Pendente"
 *
 * After a rejection, if the user uploads a new file the status
 * resets to "enviado" (Enviado / Em analise) and the flow restarts.
 */

import { state } from '../state.js';
import {
    safeNumber, formatNumber, getCurrentMonth, formatMonth,
    formatDate, marginColor,
} from '../utils/format.js';
import { badge, tableEmpty } from '../components/ui.js';

/**
 * Map raw status to display label.
 */
function statusLabel(raw) {
    const map = {
          enviado: 'Enviado / Em analise',
          validado: 'Validado',
          aprovado: 'Aprovado',
          reprovado: 'Em revisao',
          pendente: 'Pendente',
    };
    return map[raw] || raw || 'Pendente';
}

/**
 * Build the list of PFOs from centros_custo with pfo_mensal for the
 * current month.  Falls back to the legacy data.pfos array when a CC
 * has a matching uploaded PFO (so we can still show receita / margem).
 */
function buildPfoList(data, mes) {
    const cc = data.centros_custo || {};
    const pfos = data.pfos || [];
    const list = [];

  for (const [code, centro] of Object.entries(cc)) {
        if (!centro.requer_pfo) continue;
        const mensal = centro.pfo_mensal && centro.pfo_mensal[mes];
        if (!mensal && centro.status !== 'ativo') continue;

      // Try to find a matching uploaded PFO for receita/margem
      const pfo = pfos.find(p =>
              p.projeto && centro.nome && (
                        centro.nome.includes(p.projeto) || p.projeto.includes(centro.nome)
                      )
                                );

      const rc = pfo ? safeNumber((pfo.dre?.receita?.projetado || 0) * 1000) : 0;
        const cs = pfo ? safeNumber((pfo.dre?.custo?.projetado || 0) * 1000) : 0;
        const mg = rc > 0 ? ((rc - cs) / rc) * 100 : 0;

      let status = 'pendente';
        let enviadoEm = '';
      let enviadoPor = '';

      if (mensal) {
              status = mensal.status || 'enviado';
              enviadoEm = mensal.enviado_em || '';
              enviadoPor = mensal.enviado_por_nome || '';
      }

      list.push({
              code,
              nome: centro.nome || code,
              status,
              enviadoEm,
              enviadoPor,
              rc,
              mg,
      });
  }

  // Sort: pendente last, then reprovado, enviado, validado, aprovado
  const order = { aprovado: 0, validado: 1, enviado: 2, reprovado: 3, pendente: 4 };
    list.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));

  return list;
}

export function renderCiclos() {
    const data = state.data;
    if (!data) return;

  const mes = getCurrentMonth();
    const items = buildPfoList(data, mes);

  // Header info
  const cicloInfo = document.getElementById('ciclo-info');
    if (cicloInfo) cicloInfo.textContent = `Ciclo ${formatMonth(mes)} \u00b7 ${items.length} PFOs`;

  const cicloBadge = document.getElementById('ciclo-badge');
    if (cicloBadge) cicloBadge.textContent = items.length + ' PFOs';

  const tbody = document.getElementById('ciclos-tbody');
    if (!tbody) return;

  if (!items.length) {
        tbody.innerHTML = tableEmpty(6, 'Nenhum PFO neste ciclo');
        return;
  }

  tbody.innerHTML = items
      .map((item) => {
              const mc = marginColor(item.mg);
              const dt = item.enviadoEm ? formatDate(item.enviadoEm) : '\u2014';

                 return `<tr>
                         <td class="td-mono">${item.nome}</td>
                                 <td style="font-size:11px;color:var(--muted)">${item.code}</td>
                                         <td style="font-size:11px;color:var(--muted)">${item.enviadoPor}</td>
                                                 <td>${badge(item.status)}</td>
                                                         <td class="td-muted td-mono">${dt}</td>
                                                               </tr>`;
      })
      .join('');
}
