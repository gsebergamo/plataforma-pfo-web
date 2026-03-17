/**
 * Dashboard Page
 * Plataforma PFO — GSE
 *
 * Renders the executive dashboard with KPIs, score ring,
 * project attention list, status distribution, and alerts.
 *
 * BACKWARD COMPATIBILITY:
 *   - Same DOM element IDs preserved
 *   - Same data reading logic from state.data
 *   - Same calculation formulas
 */

import { state } from '../state.js';
import {
  safeNumber, formatNumber, formatMonth, getCurrentMonth,
  marginColor, percent,
} from '../utils/format.js';
import { alert as alertHtml } from '../components/ui.js';
import { getStatus } from './shared.js';

/**
 * Render the dashboard page.
 */
export function renderDashboard() {
  const data = state.data;
  if (!data) return;

  const pfos = data.pfos || [];
  const apr = data.aprovacoes || {};
  const ccs = data.centros_custo || {};
  const mes = getCurrentMonth();

  // Calculate metrics
  let rec = 0, cst = 0, a = 0, e = 0, p = 0, r = 0;
  pfos.forEach((pfo) => {
    rec += safeNumber((pfo.dre?.receita?.projetado || 0) * 1000);
    cst += safeNumber((pfo.dre?.custo?.projetado || 0) * 1000);
    const st = getStatus(pfo, apr);
    if (st === 'aprovado') a++;
    else if (st === 'enviado') e++;
    else if (st === 'reprovado') r++;
    else p++;
  });

  const tot = a + e + p + r || 1;
  const res = rec - cst;
  const mar = rec > 0 ? (res / rec) * 100 : 0;

  // KPIs
  setText('kpi-rec', formatNumber(rec / 1000));
  setText('kpi-rec-sub', `resultado: R$ ${formatNumber(res / 1000)}k`);
  setText('kpi-mar', mar.toFixed(1));
  setText('kpi-pfo', pfos.length);
  setText('kpi-pfo-sub', Object.keys(ccs).length + ' centros ativos');
  const pend = p + r;
  setText('kpi-pen', pend);

  // Badge count in sidebar
  setText('badge-p', pend);

  // Cycle label in topbar
  setText('cycle-label', 'Ciclo: ' + formatMonth(mes) + ' · ' + pfos.length + ' PFOs');

  // Score ring
  const sc = Math.round((a / tot) * 100);
  setText('score-n', sc);
  const ci = document.getElementById('score-c');
  if (ci) {
    const circumference = 276.5; // 2 * PI * 44 (SVG radius)
    setTimeout(() => {
      ci.style.strokeDashoffset = circumference - (circumference * sc) / 100;
    }, 100);
    const col = sc >= 80 ? 'var(--green)' : sc >= 50 ? 'var(--amber)' : 'var(--red)';
    ci.style.stroke = col;
    const ss = document.getElementById('score-s');
    if (ss) {
      ss.textContent = sc >= 80 ? '✓ Saudável' : sc >= 50 ? '⚠ Atenção' : '✗ Crítico';
      ss.style.color = col;
    }
  }

  // Progress bars
  const pct = (n) => percent(n, tot);
  const progressItems = [
    { key: 'apr', val: a },
    { key: 'env', val: e },
    { key: 'pen', val: p },
    { key: 'rep', val: r },
  ];
  progressItems.forEach(({ key, val }) => {
    setText('pr-' + key, val + ' (' + pct(val) + '%)');
  });
  setTimeout(() => {
    setWidth('pf-apr', pct(a) + '%');
    setWidth('pf-env', pct(e) + '%');
    setWidth('pf-pen', pct(p) + '%');
    setWidth('pf-rep', pct(r) + '%');
  }, 200);

  // Stats
  setText('st-apr', a);
  setText('st-env', e);
  setText('st-pen', p);
  setText('st-rep', r);

  // Approval KPIs
  setText('ap-apr', a);
  setText('ap-env', e);
  setText('ap-rep', r);

  // Status bar
  updateStatusPill(r, sc);

  // Chart bars
  renderChartBars(a, e, p, r);

  // Projects in attention (sorted by lowest margin)
  renderProjectsTable(pfos, apr);

  // Alerts
  renderAlerts(r, p, mar);
}

function updateStatusPill(reprovados, score) {
  const pill = document.getElementById('status-pill');
  const text = document.getElementById('status-text');
  if (!pill || !text) return;

  if (reprovados > 0) {
    pill.className = 'status-pill warn';
    text.textContent = 'Atenção requerida';
  } else if (score >= 70) {
    pill.className = 'status-pill ok';
    text.textContent = 'Ciclo saudável';
  } else {
    pill.className = 'status-pill warn';
    text.textContent = 'Ciclo em andamento';
  }
}

function renderChartBars(a, e, p, r) {
  const el = document.getElementById('chart-bars');
  if (!el) return;
  const mx = Math.max(a, e, p, r, 1);
  const bars = [
    { l: 'Aprov.', v: a, c: 'var(--green)' },
    { l: 'Env.', v: e, c: 'var(--accent)' },
    { l: 'Pend.', v: p, c: 'var(--amber)' },
    { l: 'Repr.', v: r, c: 'var(--red)' },
  ];
  el.innerHTML = bars
    .map(
      (b) =>
        `<div class="bar-col">
          <div class="bar-fill" style="background:${b.c};height:${Math.round((b.v / mx) * 72) + 4}px"></div>
          <div class="bar-label">${b.l}</div>
        </div>`
    )
    .join('');
}

function renderProjectsTable(pfos, apr) {
  const tbody = document.getElementById('proj-tbody');
  if (!tbody) return;

  const sorted = [...pfos]
    .map((pf) => {
      const rc = safeNumber((pf.dre?.receita?.projetado || 0) * 1000);
      const cs = safeNumber((pf.dre?.custo?.projetado || 0) * 1000);
      const mg = rc > 0 ? ((rc - cs) / rc) * 100 : 0;
      return { ...pf, _rc: rc, _cs: cs, _mg: mg };
    })
    .sort((x, y) => x._mg - y._mg)
    .slice(0, 6);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="td-muted" style="text-align:center;padding:20px">Sem dados</td></tr>`;
    return;
  }

  tbody.innerHTML = sorted
    .map((pf) => {
      const st = getStatus(pf, apr);
      const mc = marginColor(pf._mg);
      const nm = (pf.arquivo || pf.cc_codigo || '—')
        .replace('PFO_', '')
        .replace('.xlsx', '');
      return `<tr>
        <td class="td-mono">${nm.substring(0, 20)}</td>
        <td class="td-mono">R$ ${formatNumber(pf._rc / 1000)}k</td>
        <td style="color:${mc};font-family:var(--mono);font-size:11px">${pf._mg.toFixed(1)}%</td>
        <td><span class="badge ${st}">${st}</span></td>
      </tr>`;
    })
    .join('');
}

function renderAlerts(reprovados, pendentes, margem) {
  const el = document.getElementById('alertas-list');
  if (!el) return;

  const alerts = [];
  if (reprovados > 0)
    alerts.push(alertHtml('danger', '✗', `${reprovados} PFO(s) reprovado(s) aguardando reenvio urgente.`));
  if (pendentes > 3)
    alerts.push(alertHtml('warn', '⚠', `${pendentes} centros ainda não enviaram o PFO.`));
  if (margem < 5)
    alerts.push(alertHtml('warn', '⚠', `Margem de ${margem.toFixed(1)}% abaixo da meta.`));
  if (!alerts.length)
    alerts.push(alertHtml('info', '✓', 'Nenhum alerta crítico. Ciclo normal.'));

  el.innerHTML = alerts.join('');
}

// Helpers
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setWidth(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = value;
}
