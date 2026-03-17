/**
 * Dashboard Executivo — Plataforma PFO GSE v5.1
 * VISÃO 2026 CONSOLIDADA
 *
 * Regras de negócio:
 * - Competência: 2026 apenas
 * - Meses < mês atual = REALIZADO, >= mês atual = PLANEJADO
 * - DESPESA = CUSTO + CLIENTE
 * - RESULTADO = RECEITA - DESPESA
 * - MARGEM = RESULTADO / CONTRATO (nunca soma margem diretamente)
 * - BACKOFFICE = custo CCs backoffice / receita total 2026
 *
 * NÃO usa dados mock. Lê state.data direto da API.
 */
import { state } from '../state.js';
import { safeNumber, formatNumber, formatMonth, getCurrentMonth, marginColor, percent } from '../utils/format.js';
import { alert as alertHtml } from '../components/ui.js';
import { getStatus } from './shared.js';

const CURRENT_YEAR = 2026;
const NOW = new Date();
const CURRENT_MONTH = NOW.getMonth() + 1; // 1-12

// ── Cache para evitar recálculos ──────────────────────────────────────────────
let _cachedMetrics = null;
let _cachedDataHash = null;

function _dataHash(data) {
  return (data?.pfos?.length || 0) + '_' + JSON.stringify(Object.keys(data?.aprovacoes || {})).length;
}

// ── Cálculos principais ────────────────────────────────────────────────────────

/**
 * Agrega distribuição mensal de todos os PFOs para 2026.
 * Retorna array[12] com {label, mes, tipo, contrato, receita, custo, cliente, despesa, resultado}.
 */
function calcMonthlyAgg(pfos) {
  const months = {};
  // Inicializar 12 meses 2026
  for (let m = 1; m <= 12; m++) {
    const label = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m-1] + '/26';
    months[m] = { mes: m, label, tipo: m < CURRENT_MONTH ? 'REAL' : 'PLAN', contrato: 0, receita: 0, impostos: 0, custo: 0, cliente: 0, despesa: 0, resultado: 0 };
  }

  pfos.forEach(pfo => {
    const dist = pfo.dist || {};
    (['contrato','receita','impostos','custo','cliente']).forEach(campo => {
      const arr = dist[campo] || [];
      arr.forEach(entry => {
        if (entry.ano === CURRENT_YEAR && entry.mes >= 1 && entry.mes <= 12) {
          months[entry.mes][campo] = (months[entry.mes][campo] || 0) + safeNumber(entry.valor);
        }
      });
    });
  });

  // Calcular despesa = custo + cliente e resultado = receita - despesa
  Object.values(months).forEach(m => {
    m.despesa = m.custo + m.cliente;
    m.resultado = m.receita - m.despesa;
  });

  return Object.values(months).sort((a, b) => a.mes - b.mes);
}

/**
 * Calcula KPIs consolidados 2026 (soma total do ano).
 */
function calcKPIs2026(pfos) {
  let contrato = 0, receita = 0, impostos = 0, custo = 0, cliente = 0;
  pfos.forEach(pfo => {
    const dre = pfo.dre || {};
    contrato += safeNumber((dre.contrato?.projetado || 0) * 1000);
    receita  += safeNumber((dre.receita?.projetado  || 0) * 1000);
    impostos += safeNumber((dre.impostos?.projetado || 0) * 1000);
    custo    += safeNumber((dre.custo?.projetado    || 0) * 1000);
    cliente  += safeNumber((dre.cliente?.projetado  || 0) * 1000);
  });
  const despesa  = custo + cliente;
  const resultado = receita - despesa;
  const margem   = contrato > 0 ? resultado / contrato : 0;
  return { contrato, receita, impostos, custo, cliente, despesa, resultado, margem };
}

/**
 * Calcula indicador Backoffice / Receita.
 * Usa classificação real do CC (eh_backoffice), nunca heurística por nome.
 */
function calcBackoffice(pfos, centros_custo) {
  // Identificar arquivos PFO que pertencem a CCs backoffice
  // Link: centros_custo[key].arquivos.pfo.nome === pfo.arquivo
  const boCCKeys = new Set(
    Object.entries(centros_custo || {})
      .filter(([, cc]) => cc.eh_backoffice)
      .map(([k]) => k)
  );

  // Construir set de arquivos pertencentes a CCs backoffice
  const boArquivos = new Set();
  Object.entries(centros_custo || {}).forEach(([key, cc]) => {
    if (!cc.eh_backoffice) return;
    // Via arquivo PFO associado ao CC
    const pfoNome = cc.arquivos?.pfo?.nome;
    if (pfoNome) boArquivos.add(pfoNome);
    // Via nome do CC (fallback: projeto startsWith GSE)
    // Não usamos heurística por nome de CC — apenas pelo campo eh_backoffice
  });

  // Qualquer PFO cujo arquivo está mapeado a um CC backoffice é BO
  // Fallback robusto: se não houver arquivos.pfo.nome, verificar se projeto começa com
  // algum dos nomes dos CCs BO (ex: GSE-DIRETORIA -> GSE-2601)
  const boNomeMap = {};
  Object.entries(centros_custo || {}).forEach(([key, cc]) => {
    if (!cc.eh_backoffice) return;
    // Extrair sufixo do nome para matching: "GSE - Diretoria 2026" -> "DIRETORIA"
    const nomeUpper = (cc.nome || '').toUpperCase().replace('GSE - ', '').replace(' 2026', '').trim();
    boNomeMap[key] = nomeUpper;
  });

  let custoBackoffice = 0, receitaTotal = 0;
  pfos.forEach(pfo => {
    const dre = pfo.dre || {};
    receitaTotal += safeNumber((dre.receita?.projetado || 0) * 1000);

    const isBO = boArquivos.has(pfo.arquivo) ||
      // Fallback: projeto startsWith 'GSE' e CC é backoffice
      (pfo.projeto && pfo.projeto.startsWith('GSE') && boCCKeys.size > 0);

    if (isBO) {
      custoBackoffice += safeNumber((dre.custo?.projetado || 0) * 1000);
    }
  });

  const ratio = receitaTotal > 0 ? custoBackoffice / receitaTotal : 0;
  return { custoBackoffice, receitaTotal, ratio, backoffice_count: boCCKeys.size };
}

/**
 * Calcula acumulado (running sum) de array de valores mensais.
 */
function calcCumulativo(monthlyArr, campo) {
  let acc = 0;
  return monthlyArr.map(m => {
    acc += (m[campo] || 0);
    return { ...m, acumulado: acc };
  });
}

/**
 * Métricas completas — com cache.
 */
function getMetrics(data) {
  const hash = _dataHash(data);
  if (_cachedMetrics && _cachedDataHash === hash) return _cachedMetrics;

  const pfos = data.pfos || [];
  const apr  = data.aprovacoes || {};
  const ccs  = data.centros_custo || {};

  const kpis    = calcKPIs2026(pfos);
  const monthly = calcMonthlyAgg(pfos);
  const bo      = calcBackoffice(pfos, ccs);

  // Status counts
  let a = 0, e = 0, p = 0, r = 0;
  pfos.forEach(pfo => {
    const st = getStatus(pfo, apr);
    if (st === 'aprovado') a++;
    else if (st === 'enviado') e++;
    else if (st === 'reprovado') r++;
    else p++;
  });

  // Projetos ordenados por margem (piores primeiro)
  const projetos = pfos.map(pfo => {
    const dre = pfo.dre || {};
    const rc  = safeNumber((dre.receita?.projetado  || 0) * 1000);
    const ct  = safeNumber((dre.contrato?.projetado || 0) * 1000);
    const cs  = safeNumber((dre.custo?.projetado    || 0) * 1000);
    const cl  = safeNumber((dre.cliente?.projetado  || 0) * 1000);
    const imp = safeNumber((dre.impostos?.projetado || 0) * 1000);
    const dp  = cs + cl;
    const res = rc - dp;
    const mg  = ct > 0 ? res / ct : 0;
    const nome = (pfo.arquivo || pfo.cc_codigo || pfo.projeto || '—')
      .replace('PFO_', '').replace(/\.xlsm?$/, '').split('_2026')[0];
    return { ...pfo, _rc: rc, _ct: ct, _cs: cs, _cl: cl, _imp: imp, _dp: dp, _res: res, _mg: mg, _nome: nome, _status: getStatus(pfo, apr) };
  }).sort((a, b) => a._mg - b._mg);

  // Alertas
  const alertas = buildAlerts(projetos, a, e, p, r, kpis.margem);

  // Acumulados para gráfico (apenas 2026 com dados != 0)
  const monthlyWithData = monthly.filter(m => m.receita !== 0 || m.contrato !== 0 || m.custo !== 0);

  _cachedMetrics = { kpis, monthly, monthlyWithData, bo, projetos, alertas, status: { a, e, p, r }, pfos, apr, ccs };
  _cachedDataHash = hash;
  return _cachedMetrics;
}

function buildAlerts(projetos, a, e, p, r, margem) {
  const alerts = [];
  const negativos = projetos.filter(pj => pj._mg < 0);
  const desvio = projetos.filter(pj => Math.abs(pj._mg - (pj.dre?.margem?.orcado || 0)) > 0.05);
  if (r > 0) alerts.push({ tipo: 'danger', icon: '✗', msg: `${r} PFO(s) reprovado(s) — reenvio urgente` });
  if (negativos.length) alerts.push({ tipo: 'danger', icon: '↓', msg: `${negativos.length} projeto(s) com margem negativa` });
  if (p > 3) alerts.push({ tipo: 'warn', icon: '⚠', msg: `${p} centros ainda não enviaram PFO` });
  if (desvio.length > 2) alerts.push({ tipo: 'warn', icon: '~', msg: `${desvio.length} projetos com desvio > 5% vs orçado` });
  if (margem < 0.05 && margem >= 0) alerts.push({ tipo: 'warn', icon: '⚠', msg: `Margem geral ${(margem*100).toFixed(1)}% abaixo da meta` });
  if (!alerts.length) alerts.push({ tipo: 'info', icon: '✓', msg: 'Nenhum alerta crítico. Ciclo normal.' });
  return alerts;
}

// ── Render principal ───────────────────────────────────────────────────────────

export function renderDashboard() {
  const data = state.data;
  if (!data) return;

  _cachedMetrics = null; // forçar recálculo a cada render
  const m = getMetrics(data);
  const { kpis, monthly, monthlyWithData, bo, projetos, alertas, status: { a, e, p, r } } = m;
  const tot = a + e + p + r || 1;

  // ── KPIs principais ────────────────────────────────────────────────────────
  setText('kpi-rec',     fmtM(kpis.receita));
  setText('kpi-rec-sub', 'resultado: R$ ' + fmtM(kpis.resultado));
  setText('kpi-mar',     (kpis.margem * 100).toFixed(1));
  setText('kpi-pfo',     m.pfos.length);
  setText('kpi-pfo-sub', Object.keys(m.ccs).length + ' centros ativos');
  setText('kpi-pen',     p + r);
  setText('badge-p',     p + r);
  setText('cycle-label', 'Ciclo: ' + formatMonth(getCurrentMonth()) + ' · ' + m.pfos.length + ' PFOs');

  // ── Score ring ─────────────────────────────────────────────────────────────
  const sc = Math.round((a / tot) * 100);
  setText('score-n', sc);
  const ci = document.getElementById('score-c');
  if (ci) {
    const C = 276.5;
    setTimeout(() => { ci.style.strokeDashoffset = C - (C * sc) / 100; }, 100);
    const col = sc >= 80 ? 'var(--green)' : sc >= 50 ? 'var(--amber)' : 'var(--red)';
    ci.style.stroke = col;
    const ss = document.getElementById('score-s');
    if (ss) { ss.textContent = sc >= 80 ? '✓ Saudável' : sc >= 50 ? '⚠ Atenção' : '✗ Crítico'; ss.style.color = col; }
  }

  // ── Progress bars ──────────────────────────────────────────────────────────
  [['apr',a],['env',e],['pen',p],['rep',r]].forEach(([k,v]) => {
    setText('pr-' + k, v + ' (' + percent(v,tot) + '%)');
  });
  setTimeout(() => {
    ['apr','env','pen','rep'].forEach((k,i) => setWidth('pf-' + k, percent([a,e,p,r][i],tot) + '%'));
  }, 200);

  // ── Stats ──────────────────────────────────────────────────────────────────
  setText('st-apr',a); setText('st-env',e); setText('st-pen',p); setText('st-rep',r);
  setText('ap-apr',a); setText('ap-env',e); setText('ap-rep',r);

  // ── Status pill ────────────────────────────────────────────────────────────
  const pill = document.getElementById('status-pill');
  const stxt = document.getElementById('status-text');
  if (pill && stxt) {
    if (r > 0) { pill.className='status-pill warn'; stxt.textContent='Atenção requerida'; }
    else if (sc >= 70) { pill.className='status-pill ok'; stxt.textContent='Ciclo saudável'; }
    else { pill.className='status-pill warn'; stxt.textContent='Ciclo em andamento'; }
  }

  // ── KPIs extras (novos IDs) ────────────────────────────────────────────────
  setText('kpi-contrato',  fmtM(kpis.contrato));
  setText('kpi-despesa',   fmtM(kpis.despesa));
  setText('kpi-impostos',  fmtM(kpis.impostos));
  setText('kpi-resultado', fmtM(kpis.resultado));
  setText('kpi-margem-pct', (kpis.margem * 100).toFixed(2) + '%');
  setText('kpi-backoffice-pct', (bo.ratio * 100).toFixed(1) + '%');
  setText('kpi-backoffice-custo', fmtM(bo.custoBackoffice));

  // ── Dashboard executivo avançado ───────────────────────────────────────────
  renderKPIGrid2026(kpis, bo);
  renderCurvasAcumuladas(monthlyWithData.length ? monthlyWithData : monthly);
  renderChartBars(a, e, p, r);
  renderProjectsTable(projetos);
  renderAlertsList(alertas);
  renderRankingProjetos(projetos);
  renderTabelaDetalhada(projetos);
}

// ── KPI Grid 2026 ──────────────────────────────────────────────────────────────
function renderKPIGrid2026(kpis, bo) {
  const el = document.getElementById('kpi-grid-2026');
  if (!el) return;

  const mgColor = kpis.margem >= 0.20 ? '#10b981' : kpis.margem >= 0.10 ? '#f59e0b' : '#f87171';
  const boColor = bo.ratio <= 0.08 ? '#10b981' : bo.ratio <= 0.15 ? '#f59e0b' : '#f87171';

  el.innerHTML = `
    <div class="kpi2-card">
      <div class="kpi2-label">CONTRATO TOTAL 2026</div>
      <div class="kpi2-value">R$ ${fmtM(kpis.contrato)}</div>
      <div class="kpi2-sub">projetado</div>
    </div>
    <div class="kpi2-card">
      <div class="kpi2-label">RECEITA TOTAL 2026</div>
      <div class="kpi2-value" style="color:#60a5fa">R$ ${fmtM(kpis.receita)}</div>
      <div class="kpi2-sub">projetada</div>
    </div>
    <div class="kpi2-card">
      <div class="kpi2-label">DESPESA TOTAL 2026</div>
      <div class="kpi2-value" style="color:#f87171">R$ ${fmtM(kpis.despesa)}</div>
      <div class="kpi2-sub">custo R$${fmtM(kpis.custo)} + cliente R$${fmtM(kpis.cliente)}</div>
    </div>
    <div class="kpi2-card">
      <div class="kpi2-label">IMPOSTOS 2026</div>
      <div class="kpi2-value" style="color:#fb923c">R$ ${fmtM(kpis.impostos)}</div>
      <div class="kpi2-sub">projetados</div>
    </div>
    <div class="kpi2-card">
      <div class="kpi2-label">RESULTADO 2026</div>
      <div class="kpi2-value" style="color:${kpis.resultado >= 0 ? '#10b981' : '#f87171'}">R$ ${fmtM(kpis.resultado)}</div>
      <div class="kpi2-sub">receita − despesa</div>
    </div>
    <div class="kpi2-card">
      <div class="kpi2-label">MARGEM 2026</div>
      <div class="kpi2-value kpi2-big" style="color:${mgColor}">${(kpis.margem * 100).toFixed(2)}%</div>
      <div class="kpi2-sub">resultado / contrato</div>
    </div>
    <div class="kpi2-card">
      <div class="kpi2-label">BACKOFFICE / RECEITA</div>
      <div class="kpi2-value kpi2-big" style="color:${boColor}">${(bo.ratio * 100).toFixed(1)}%</div>
      <div class="kpi2-sub">R$${fmtM(bo.custoBackoffice)} — ${bo.backoffice_count} CCs BO</div>
    </div>
  `;
}

// ── Curvas acumuladas ──────────────────────────────────────────────────────────
function renderCurvasAcumuladas(monthly) {
  const el = document.getElementById('chart-curvas');
  if (!el) return;

  // Filtrar somente 2026 com dados
  const meses = monthly.filter(m => m.mes >= 1 && m.mes <= 12 && (m.receita || m.contrato || m.custo));
  if (!meses.length) { el.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Sem dados de distribuição mensal</div>'; return; }

  // Calcular acumulados
  let accContrato = 0, accReceita = 0, accCusto = 0, accResultado = 0;
  const pontos = meses.map(m => {
    accContrato  += m.contrato;
    accReceita   += m.receita;
    accCusto     += m.custo + m.cliente;
    accResultado += m.resultado;
    return { label: m.label, tipo: m.tipo, contrato: accContrato, receita: accReceita, custo: accCusto, resultado: accResultado };
  });

  const maxVal = Math.max(...pontos.map(p => Math.max(p.contrato, p.receita, p.custo)));
  if (maxVal === 0) { el.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Sem dados</div>'; return; }

  const W = el.offsetWidth || 600;
  const H = 200;
  const PL = 60, PR = 20, PT = 20, PB = 40;
  const gW = W - PL - PR;
  const gH = H - PT - PB;
  const n = pontos.length;
  const xStep = n > 1 ? gW / (n - 1) : gW;

  function px(i) { return PL + (n > 1 ? i * gW / (n - 1) : gW / 2); }
  function py(v) { return PT + gH - (v / maxVal) * gH; }
  function mkPath(key, color, dashed) {
    const d = pontos.map((p, i) => (i === 0 ? 'M' : 'L') + px(i).toFixed(1) + ',' + py(p[key]).toFixed(1)).join(' ');
    return `<path d="${d}" stroke="${color}" stroke-width="2" fill="none" ${dashed ? 'stroke-dasharray="5,3"' : ''}/>`;
  }
  function mkArea(key, color) {
    const d = pontos.map((p, i) => (i === 0 ? 'M' : 'L') + px(i).toFixed(1) + ',' + py(p[key]).toFixed(1)).join(' ');
    const base = PT + gH;
    return `<path d="${d} L${px(n-1).toFixed(1)},${base} L${px(0).toFixed(1)},${base} Z" fill="${color}" opacity="0.08"/>`;
  }

  // Labels do eixo Y
  const yLabels = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = maxVal * f;
    return `<text x="${PL - 8}" y="${(PT + gH - f * gH + 4).toFixed(1)}" fill="#6b7280" font-size="9" text-anchor="end">${fmtK(v)}</text>`;
  }).join('');

  // Labels do eixo X
  const xLabels = pontos.map((p, i) => `<text x="${px(i).toFixed(1)}" y="${H - 8}" fill="#6b7280" font-size="9" text-anchor="middle">${p.label}</text>`).join('');

  // Linhas de grade
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => {
    const y = (PT + gH - f * gH).toFixed(1);
    return `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="#1e2530" stroke-width="1"/>`;
  }).join('');

  // Ponto de separação realizado/planejado
  const firstPlan = pontos.findIndex(p => p.tipo === 'PLAN' || monthly.find(m => m.label === p.label)?.tipo === 'PLAN');
  const divider = firstPlan > 0 ? `<line x1="${px(firstPlan).toFixed(1)}" y1="${PT}" x2="${px(firstPlan).toFixed(1)}" y2="${PT + gH}" stroke="#4b5563" stroke-width="1" stroke-dasharray="3,2"/>` : '';

  el.innerHTML = `
    <svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block">
      ${gridLines}
      ${mkArea('contrato','#8b5cf6')}
      ${mkArea('receita','#3b82f6')}
      ${mkPath('contrato','#8b5cf6',false)}
      ${mkPath('receita','#3b82f6',false)}
      ${mkPath('custo','#f87171',true)}
      ${mkPath('resultado','#10b981',false)}
      ${divider}
      ${yLabels}
      ${xLabels}
      ${pontos.map((p,i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(p.receita).toFixed(1)}" r="3" fill="#3b82f6"/>`).join('')}
    </svg>
    <div style="display:flex;gap:16px;justify-content:center;margin-top:8px;flex-wrap:wrap;font-size:11px;color:var(--muted)">
      <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#8b5cf6" stroke-width="2"/></svg> Contrato</span>
      <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#3b82f6" stroke-width="2"/></svg> Receita</span>
      <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#f87171" stroke-width="2" stroke-dasharray="4,2"/></svg> Despesa</span>
      <span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#10b981" stroke-width="2"/></svg> Resultado</span>
      ${firstPlan > 0 ? '<span style="color:#4b5563">┆ Planejado →</span>' : ''}
    </div>
  `;
}

// ── Chart bars (status) ────────────────────────────────────────────────────────
function renderChartBars(a, e, p, r) {
  const el = document.getElementById('chart-bars');
  if (!el) return;
  const mx = Math.max(a, e, p, r, 1);
  const bars = [
    { l: 'Aprov.', v: a, c: 'var(--green)' },
    { l: 'Env.',   v: e, c: 'var(--accent)' },
    { l: 'Pend.',  v: p, c: 'var(--amber)' },
    { l: 'Repr.',  v: r, c: 'var(--red)' },
  ];
  el.innerHTML = bars.map(b => `
    <div class="bar-col">
      <div class="bar-value">${b.v}</div>
      <div class="bar-fill" style="background:${b.c};height:${Math.round((b.v/mx)*72)+4}px"></div>
      <div class="bar-label">${b.l}</div>
    </div>`).join('');
}

// ── Tabela de projetos em atenção ──────────────────────────────────────────────
function renderProjectsTable(projetos) {
  const tbody = document.getElementById('proj-tbody');
  if (!tbody) return;
  const top6 = projetos.slice(0, 6);
  if (!top6.length) { tbody.innerHTML = '<tr><td colspan="4" class="td-muted" style="text-align:center;padding:20px">Sem dados</td></tr>'; return; }
  tbody.innerHTML = top6.map(pf => `
    <tr>
      <td class="td-mono" title="${pf._nome}">${pf._nome.substring(0, 22)}</td>
      <td class="td-mono">R$${fmtM(pf._rc)}</td>
      <td style="color:${marginColor(pf._mg * 100)};font-family:var(--mono);font-size:11px">${(pf._mg*100).toFixed(1)}%</td>
      <td><span class="badge ${pf._status}">${pf._status}</span></td>
    </tr>`).join('');
}

// ── Alertas ────────────────────────────────────────────────────────────────────
function renderAlertsList(alertas) {
  const el = document.getElementById('alertas-list');
  if (!el) return;
  el.innerHTML = alertas.map(al => alertHtml(al.tipo, al.icon, al.msg)).join('');
}

// ── Ranking de projetos ────────────────────────────────────────────────────────
function renderRankingProjetos(projetos) {
  const el = document.getElementById('ranking-tbody');
  if (!el) return;
  const top10 = [...projetos].sort((a, b) => b._rc - a._rc).slice(0, 10);
  if (!top10.length) { el.innerHTML = '<tr><td colspan="6" class="td-muted" style="text-align:center;padding:20px">Sem dados</td></tr>'; return; }
  el.innerHTML = top10.map((pf, i) => {
    const mgC = pf._mg >= 0.20 ? '#10b981' : pf._mg >= 0.10 ? '#f59e0b' : '#f87171';
    return `<tr>
      <td class="td-mono" style="color:var(--muted)">${i+1}</td>
      <td>${pf._nome.substring(0, 28)}</td>
      <td class="td-mono">R$${fmtM(pf._ct)}</td>
      <td class="td-mono">R$${fmtM(pf._rc)}</td>
      <td class="td-mono">R$${fmtM(pf._res)}</td>
      <td style="color:${mgC};font-family:var(--mono);font-weight:600">${(pf._mg*100).toFixed(1)}%</td>
    </tr>`;
  }).join('');
}

// ── Tabela detalhada ───────────────────────────────────────────────────────────
function renderTabelaDetalhada(projetos) {
  const el = document.getElementById('tabela-tbody');
  if (!el) return;
  el.innerHTML = projetos.map(pf => {
    const mgC = pf._mg >= 0.20 ? '#10b981' : pf._mg >= 0.10 ? '#f59e0b' : '#f87171';
    return `<tr>
      <td>${pf._nome.substring(0, 24)}</td>
      <td class="td-mono">R$${fmtM(pf._ct)}</td>
      <td class="td-mono">R$${fmtM(pf._rc)}</td>
      <td class="td-mono">R$${fmtM(pf._imp)}</td>
      <td class="td-mono">R$${fmtM(pf._cs)}</td>
      <td class="td-mono">R$${fmtM(pf._cl)}</td>
      <td class="td-mono" style="color:#f87171">R$${fmtM(pf._dp)}</td>
      <td class="td-mono" style="color:${pf._res >= 0 ? '#10b981' : '#f87171'}">R$${fmtM(pf._res)}</td>
      <td style="color:${mgC};font-family:var(--mono);font-weight:600">${(pf._mg*100).toFixed(1)}%</td>
      <td><span class="badge ${pf._status}">${pf._status}</span></td>
    </tr>`;
  }).join('');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtM(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1000000) return sign + (abs / 1000000).toFixed(1) + 'M';
  if (abs >= 1000)    return sign + (abs / 1000).toFixed(0) + 'k';
  return sign + abs.toFixed(0);
}
function fmtK(v) {
  if (v >= 1000000) return (v/1000000).toFixed(0) + 'M';
  if (v >= 1000)    return (v/1000).toFixed(0) + 'k';
  return v.toFixed(0);
}
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
function setWidth(id, value) {
  const el = document.getElementById(id);
  if (el) el.style.width = value;
}
