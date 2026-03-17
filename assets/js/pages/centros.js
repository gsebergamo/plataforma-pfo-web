/**
 * Centros de Custo Page
 * Plataforma PFO — GSE
 */

import { state } from '../state.js';
import { safeNumber, formatNumber, marginColor } from '../utils/format.js';
import { badge, tableEmpty } from '../components/ui.js';
import { getStatus } from './shared.js';

/**
 * Render centros de custo page — builds the full list.
 */
export function renderCentros() {
  const data = state.data;
  if (!data) return;

  const ccs = data.centros_custo || {};
  const pfos = data.pfos || [];
  const apr = data.aprovacoes || {};

  const ccList = Object.entries(ccs).map(([cod, cc]) => {
    const pf = pfos.find(
      (p) =>
        p.projeto === cod ||
        p.projeto === (cc.nome || cc.name) ||
        (p.arquivo || '').includes(cod)
    );
    const rc = pf ? safeNumber((pf.dre?.receita?.projetado || 0) * 1000) : 0;
    const cs = pf ? safeNumber((pf.dre?.custo?.projetado || 0) * 1000) : 0;
    const mg = rc > 0 ? ((rc - cs) / rc) * 100 : 0;
    const st = pf ? getStatus(pf, apr) : 'pendente';

    return {
      cod,
      nome: cc.nome || cc.name || cod,
      gestor: cc.gestor || '—',
      st,
      mg,
      res: rc - cs,
    };
  });

  // Store for filtering
  state.ccFilteredData = ccList;
  renderCentrosTable(ccList);
}

/**
 * Render the centros table with given data.
 * @param {Array} data
 */
export function renderCentrosTable(data) {
  const tbody = document.getElementById('cc-tbody');
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = tableEmpty(6, 'Nenhum centro de custo encontrado');
    return;
  }

  tbody.innerHTML = data
    .slice(0, 50)
    .map((c) => {
      const mc = marginColor(c.mg);
      return `<tr>
        <td class="td-mono">${c.cod}</td>
        <td>${c.nome.substring(0, 30)}</td>
        <td class="td-muted">${c.gestor.substring(0, 20)}</td>
        <td>${badge(c.st)}</td>
        <td style="color:${mc};font-family:var(--mono);font-size:11px">${c.mg.toFixed(1)}%</td>
        <td class="td-mono" style="color:${c.res >= 0 ? 'var(--green)' : 'var(--red)'}">R$ ${formatNumber(c.res / 1000)}k</td>
      </tr>`;
    })
    .join('');
}

/**
 * Filter centros by search query.
 * @param {string} query
 */
export function filterCentros(query) {
  const q = query.toLowerCase();
  const filtered = state.ccFilteredData.filter(
    (c) =>
      c.cod.toLowerCase().includes(q) ||
      c.nome.toLowerCase().includes(q) ||
      c.gestor.toLowerCase().includes(q)
  );
  renderCentrosTable(filtered);
}
