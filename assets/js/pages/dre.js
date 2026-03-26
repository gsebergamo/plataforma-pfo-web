/**
 * DRE Consolidado — Plataforma PFO GSE
 * Página: Demonstrativo de Resultado do Exercício
 *
 * Exibe:
 * 1. Tabela DRE com Contrato, Custo (custo+cliente), Resultado
 * 2. Gráfico de barras mês a mês do Resultado 2026
 * 3. Curva S acumulada do Resultado 2026
 */

import { state } from '../state.js';
import { safeNumber } from '../utils/format.js';

const YEAR = 2026;

function fmtBRL(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  return sign + 'R$ ' + abs.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtK(v) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(0) + 'k';
  return sign + abs.toFixed(0);
}

function calcDRE(pfos) {
  const lines = ['contrato', 'custo', 'cliente'];
  const monthly = {};
  for (let m = 1; m <= 12; m++) {
    const label = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m - 1] + '/26';
    monthly[m] = { mes: m, label, contrato: 0, custo: 0, cliente: 0, tipo: '' };
  }

  pfos.forEach(pfo => {
    const dist = pfo.dist || {};
    lines.forEach(line => {
      (dist[line] || []).forEach(entry => {
        if (entry.ano === YEAR && entry.mes >= 1 && entry.mes <= 12) {
          monthly[entry.mes][line] += safeNumber(entry.valor);
          if (!monthly[entry.mes].tipo) monthly[entry.mes].tipo = entry.tipo;
        }
      });
    });
  });

  Object.values(monthly).forEach(m => {
    if (!m.tipo) m.tipo = m.mes < 3 ? 'REAL' : 'PLAN';
  });

  const months = Object.values(monthly).sort((a, b) => a.mes - b.mes);

  let realContrato = 0, planContrato = 0;
  let realCusto = 0, planCusto = 0;
  let realCliente = 0, planCliente = 0;

  months.forEach(m => {
    m.despesa = m.custo + m.cliente;
    m.resultado = m.contrato - m.despesa;
    if (m.tipo === 'REAL') {
      realContrato += m.contrato;
      realCusto += m.custo;
      realCliente += m.cliente;
    } else {
      planContrato += m.contrato;
      planCusto += m.custo;
      planCliente += m.cliente;
    }
  });

  const mult = 1000;
  const realDesp = (realCusto + realCliente) * mult;
  const planDesp = (planCusto + planCliente) * mult;
  const realCt = realContrato * mult;
  const planCt = planContrato * mult;

  return {
    months,
    table: {
      contrato:  { real: realCt, plan: planCt, total: realCt + planCt },
      custo:     { real: realDesp, plan: planDesp, total: realDesp + planDesp },
      resultado: { real: realCt - realDesp, plan: planCt - planDesp, total: (realCt + planCt) - (realDesp + planDesp) }
    },
    monthlyBRL: months.map(m => ({
      mes: m.mes, label: m.label, tipo: m.tipo,
      resultado: m.resultado * mult,
      contrato: m.contrato * mult,
      despesa: m.despesa * mult
    }))
  };
}

export function renderDre() {
  const data = state.data;
  if (!data) return;
  const pfos = data.pfos_dados ? Object.values(data.pfos_dados) : data.pfos || [];
  const dre = calcDRE(pfos);
  renderDRETable(dre.table);
  renderBarChart(dre.monthlyBRL);
  renderSCurve(dre.monthlyBRL);
}

function renderDRETable(table) {
  const el = document.getElementById('dre-table-body');
  if (!el) return;
  const rows = [
    { label: 'Contrato (Receita Prevista)', data: table.contrato, cls: '' },
    { label: 'Custo Total (Custo + Cliente)', data: table.custo, cls: '' },
    { label: 'Resultado', data: table.resultado, cls: 'dre-row-resultado' }
  ];
  el.innerHTML = rows.map(r => {
    const isRes = r.cls === 'dre-row-resultado';
    const color = isRes ? (r.data.total >= 0 ? '#10b981' : '#f87171') : '';
    const st = color ? ' style="color:' + color + ';font-weight:600"' : '';
    return '<tr class="' + r.cls + '"><td class="dre-label">' + r.label + '</td>'
      + '<td class="dre-val"' + st + '>' + fmtBRL(r.data.real) + '</td>'
      + '<td class="dre-val"' + st + '>' + fmtBRL(r.data.plan) + '</td>'
      + '<td class="dre-val dre-total"' + st + '>' + fmtBRL(r.data.total) + '</td></tr>';
  }).join('');
  const mg = table.contrato.total > 0 ? ((table.resultado.total / table.contrato.total) * 100).toFixed(1) : '0.0';
  const mgR = table.contrato.real > 0 ? ((table.resultado.real / table.contrato.real) * 100).toFixed(1) : '0.0';
  const mgP = table.contrato.plan > 0 ? ((table.resultado.plan / table.contrato.plan) * 100).toFixed(1) : '0.0';
  const mc = parseFloat(mg) >= 15 ? '#10b981' : parseFloat(mg) >= 5 ? '#f59e0b' : '#f87171';
  el.innerHTML += '<tr class="dre-row-margem"><td class="dre-label">Margem</td>'
    + '<td class="dre-val" style="color:' + mc + ';font-weight:600">' + mgR + '%</td>'
    + '<td class="dre-val" style="color:' + mc + ';font-weight:600">' + mgP + '%</td>'
    + '<td class="dre-val dre-total" style="color:' + mc + ';font-weight:600">' + mg + '%</td></tr>';
}

function renderBarChart(monthly) {
  const el = document.getElementById('dre-bar-chart');
  if (!el) return;
  const W = el.offsetWidth || 700;
  const H = 280;
  const PL = 65, PR = 15, PT = 20, PB = 45;
  const gW = W - PL - PR;
  const gH = H - PT - PB;
  const n = monthly.length;
  if (!n) { el.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Sem dados</div>'; return; }
  const vals = monthly.map(m => m.resultado);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const barW = Math.max(Math.floor(gW / n) - 6, 8);
  const gap = (gW - barW * n) / (n + 1);
  const zeroY = PT + gH / 2;
  function bx(i) { return PL + gap + i * (barW + gap); }
  function bh(v) { return Math.abs(v) / maxAbs * (gH / 2); }
  const bars = monthly.map((m, i) => {
    const x = bx(i); const h = bh(m.resultado);
    const pos = m.resultado >= 0; const y = pos ? zeroY - h : zeroY;
    const c = pos ? '#10b981' : '#f87171';
    const op = m.tipo === 'PLAN' ? '0.55' : '1';
    return '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + Math.max(h,1)
      + '" fill="' + c + '" opacity="' + op + '" rx="2"/>'
      + '<text x="' + (x+barW/2) + '" y="' + (pos ? y-4 : y+h+12)
      + '" fill="#9ca3af" font-size="8" text-anchor="middle">' + fmtK(m.resultado) + '</text>';
  }).join('');
  const xL = monthly.map((m,i) => '<text x="'+(bx(i)+barW/2)+'" y="'+(H-8)+'" fill="#6b7280" font-size="9" text-anchor="middle">'+m.label+'</text>').join('');
  const yS = [-maxAbs,-maxAbs/2,0,maxAbs/2,maxAbs];
  const yL = yS.map(v => {
    const y = zeroY - (v/maxAbs)*(gH/2);
    return '<text x="'+(PL-8)+'" y="'+(y+3)+'" fill="#6b7280" font-size="9" text-anchor="end">'+fmtK(v)+'</text><line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#1e2530" stroke-width="1"/>';
  }).join('');
  const zL = '<line x1="'+PL+'" y1="'+zeroY+'" x2="'+(W-PR)+'" y2="'+zeroY+'" stroke="#4b5563" stroke-width="1.5"/>';
  const fp = monthly.findIndex(m => m.tipo === 'PLAN');
  const dv = fp > 0 ? '<line x1="'+(bx(fp)-gap/2)+'" y1="'+PT+'" x2="'+(bx(fp)-gap/2)+'" y2="'+(PT+gH)+'" stroke="#4b5563" stroke-width="1" stroke-dasharray="4,2"/>' : '';
  el.innerHTML = '<svg width="100%" height="'+H+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="display:block">'+yL+zL+bars+dv+xL+'</svg>'
    + '<div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:11px;color:var(--muted)">'
    + '<span style="color:#10b981">■ Positivo</span><span style="color:#f87171">■ Negativo</span>'
    + '<span style="color:#4b5563">Opaco=Real · Translúcido=Planejado</span></div>';
}

function renderSCurve(monthly) {
  const el = document.getElementById('dre-scurve');
  if (!el) return;
  const W = el.offsetWidth || 700;
  const H = 260;
  const PL = 65, PR = 20, PT = 25, PB = 45;
  const gW = W - PL - PR;
  const gH = H - PT - PB;
  const n = monthly.length;
  if (!n) { el.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Sem dados</div>'; return; }
  let aR = 0, aC = 0, aD = 0;
  const pts = monthly.map(m => {
    aR += m.resultado; aC += m.contrato; aD += m.despesa;
    return { label: m.label, tipo: m.tipo, resultado: aR, contrato: aC, despesa: aD };
  });
  const all = pts.flatMap(p => [p.resultado, p.contrato, p.despesa]);
  const mx = Math.max(...all.map(Math.abs), 1);
  const mn = Math.min(...all, 0);
  const hasNeg = mn < 0;
  const rMax = Math.max(mx, Math.abs(mn));
  const top = hasNeg ? rMax : mx;
  const bot = hasNeg ? -rMax : 0;
  const rng = top - bot || 1;
  function px(i) { return PL + (n > 1 ? i * gW / (n - 1) : gW / 2); }
  function py(v) { return PT + gH - ((v - bot) / rng) * gH; }
  function mkP(key, color, dash) {
    const d = pts.map((p,i) => (i===0?'M':'L')+px(i).toFixed(1)+','+py(p[key]).toFixed(1)).join(' ');
    return '<path d="'+d+'" stroke="'+color+'" stroke-width="2.5" fill="none"'+(dash?' stroke-dasharray="6,3"':'')+'/>';
  }
  function mkA(key, color) {
    const by = py(0);
    const d = pts.map((p,i) => (i===0?'M':'L')+px(i).toFixed(1)+','+py(p[key]).toFixed(1)).join(' ');
    return '<path d="'+d+' L'+px(n-1).toFixed(1)+','+by+' L'+px(0).toFixed(1)+','+by+' Z" fill="'+color+'" opacity="0.07"/>';
  }
  const yN = 5;
  const yLines = Array.from({length:yN+1},(_,i) => {
    const v = bot + (rng * i) / yN; const y = py(v);
    return '<text x="'+(PL-8)+'" y="'+(y+3)+'" fill="#6b7280" font-size="9" text-anchor="end">'+fmtK(v)+'</text><line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#1e2530" stroke-width="1"/>';
  }).join('');
  const xL = pts.map((p,i) => '<text x="'+px(i).toFixed(1)+'" y="'+(H-8)+'" fill="#6b7280" font-size="9" text-anchor="middle">'+p.label+'</text>').join('');
  const zL = hasNeg ? '<line x1="'+PL+'" y1="'+py(0)+'" x2="'+(W-PR)+'" y2="'+py(0)+'" stroke="#4b5563" stroke-width="1"/>' : '';
  const fp = pts.findIndex(p => p.tipo === 'PLAN');
  const dv = fp > 0 ? '<line x1="'+px(fp).toFixed(1)+'" y1="'+PT+'" x2="'+px(fp).toFixed(1)+'" y2="'+(PT+gH)+'" stroke="#4b5563" stroke-width="1" stroke-dasharray="3,2"/>' : '';
  const dots = pts.map((p,i) => '<circle cx="'+px(i).toFixed(1)+'" cy="'+py(p.resultado).toFixed(1)+'" r="3.5" fill="#10b981" stroke="#0d1117" stroke-width="1"/>').join('');
  el.innerHTML = '<svg width="100%" height="'+H+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="display:block">'
    +yLines+zL+mkA('contrato','#8b5cf6')+mkA('resultado','#10b981')
    +mkP('contrato','#8b5cf6',false)+mkP('despesa','#f87171',true)+mkP('resultado','#10b981',false)
    +dv+dots+xL+'</svg>'
    +'<div style="display:flex;gap:16px;justify-content:center;margin-top:8px;flex-wrap:wrap;font-size:11px;color:var(--muted)">'
    +'<span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#8b5cf6" stroke-width="2"/></svg> Contrato Acum.</span>'
    +'<span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#f87171" stroke-width="2" stroke-dasharray="4,2"/></svg> Despesa Acum.</span>'
    +'<span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#10b981" stroke-width="2"/></svg> Resultado Acum.</span>'
    +(fp > 0 ? '<span style="color:#4b5563">| Planejado</span>' : '')+'</div>';
}
