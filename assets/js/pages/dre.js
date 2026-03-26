/**
 * DRE Consolidado — Plataforma PFO GSE
 * Demonstrativo de Resultado do Exercicio 2026
 *
 * Self-contained: injeta nav-item e page section no DOM.
 */
import { state } from '../state.js';
import { safeNumber } from '../utils/format.js';

const YEAR = 2026;

/* ── Inject DOM (nav + page) ─────────────────────────────────────── */

function ensureDom() {
  // Nav item
  if (!document.querySelector('.nav-item[data-page="dre"]')) {
    const dashNav = document.querySelector('.nav-item[data-page="dashboard"]');
    if (dashNav) {
      const nav = document.createElement('div');
      nav.className = 'nav-item';
      nav.dataset.page = 'dre';
      nav.innerHTML = '<span class="nav-icon">$</span> DRE';
      dashNav.insertAdjacentElement('afterend', nav);
      nav.addEventListener('click', () => {
        window.location.hash = 'dre';
        document.querySelector('.sidebar')?.classList.remove('open');
      });
    }
  }
  // Page section
  if (!document.getElementById('page-dre')) {
    const dashPage = document.getElementById('page-dashboard');
    if (dashPage) {
      const sec = document.createElement('section');
      sec.id = 'page-dre';
      sec.className = 'page fade-in';
      sec.innerHTML = '<div class="section-header">'
        + '<h2>DRE Consolidado 2026</h2>'
        + '<span class="section-sub">Demonstrativo de Resultado do Exercicio</span>'
        + '</div>'
        + '<div class="card" style="margin-bottom:20px;overflow-x:auto">'
        + '<table class="table" style="min-width:500px"><thead><tr>'
        + '<th style="text-align:left;min-width:220px">LINHA</th>'
        + '<th style="text-align:right">REALIZADO</th>'
        + '<th style="text-align:right">PLANEJADO</th>'
        + '<th style="text-align:right">TOTAL 2026</th>'
        + '</tr></thead><tbody id="dre-table-body"></tbody></table></div>'
        + '<div class="card" style="margin-bottom:20px">'
        + '<h3 style="margin:0 0 12px;font-size:14px;color:var(--muted)">Resultado Mensal 2026</h3>'
        + '<div id="dre-bar-chart" style="width:100%;min-height:280px"></div></div>'
        + '<div class="card">'
        + '<h3 style="margin:0 0 12px;font-size:14px;color:var(--muted)">Curva S — Acumulado 2026</h3>'
        + '<div id="dre-scurve" style="width:100%;min-height:260px"></div></div>';
      dashPage.parentElement.insertBefore(sec, dashPage.nextSibling);
    }
  }
}

/* ── helpers ──────────────────────────────────────────────────────── */

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

/* ── calculos ─────────────────────────────────────────────────────── */

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
  let rC = 0, pC = 0, rK = 0, pK = 0, rCl = 0, pCl = 0;
  months.forEach(m => {
    m.despesa = m.custo + m.cliente;
    m.resultado = m.contrato - m.despesa;
    if (m.tipo === 'REAL') { rC += m.contrato; rK += m.custo; rCl += m.cliente; }
    else { pC += m.contrato; pK += m.custo; pCl += m.cliente; }
  });
  const mult = 1000;
  const rD = (rK + rCl) * mult, pD = (pK + pCl) * mult;
  const rCt = rC * mult, pCt = pC * mult;
  return {
    table: {
      contrato: { real: rCt, plan: pCt, total: rCt + pCt },
      custo: { real: rD, plan: pD, total: rD + pD },
      resultado: { real: rCt - rD, plan: pCt - pD, total: (rCt + pCt) - (rD + pD) }
    },
    monthly: months.map(m => ({
      mes: m.mes, label: m.label, tipo: m.tipo,
      resultado: m.resultado * mult, contrato: m.contrato * mult, despesa: m.despesa * mult
    }))
  };
}

/* ── render ───────────────────────────────────────────────────────── */

export function renderDre() {
  const data = state.data;
  if (!data) return;
  ensureDom();
  const pfos = data.pfos_dados ? Object.values(data.pfos_dados) : data.pfos || [];
  const dre = calcDRE(pfos);
  renderTable(dre.table);
  renderBars(dre.monthly);
  renderCurve(dre.monthly);
}

function renderTable(t) {
  const el = document.getElementById('dre-table-body');
  if (!el) return;
  const rows = [
    { l: 'Contrato (Receita Prevista)', d: t.contrato, res: false },
    { l: 'Custo Total (Custo + Cliente)', d: t.custo, res: false },
    { l: 'Resultado', d: t.resultado, res: true }
  ];
  el.innerHTML = rows.map(r => {
    const c = r.res ? (r.d.total >= 0 ? '#10b981' : '#f87171') : '';
    const s = c ? ' style="color:' + c + ';font-weight:600"' : '';
    return '<tr><td style="text-align:left;font-weight:500">' + r.l + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);font-size:13px"' + s + '>' + fmtBRL(r.d.real) + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);font-size:13px"' + s + '>' + fmtBRL(r.d.plan) + '</td>'
      + '<td style="text-align:right;font-family:var(--mono);font-size:13px;font-weight:600;border-left:2px solid var(--border)"' + s + '>' + fmtBRL(r.d.total) + '</td></tr>';
  }).join('');
  const mg = t.contrato.total > 0 ? ((t.resultado.total / t.contrato.total) * 100).toFixed(1) : '0.0';
  const mR = t.contrato.real > 0 ? ((t.resultado.real / t.contrato.real) * 100).toFixed(1) : '0.0';
  const mP = t.contrato.plan > 0 ? ((t.resultado.plan / t.contrato.plan) * 100).toFixed(1) : '0.0';
  const mc = parseFloat(mg) >= 15 ? '#10b981' : parseFloat(mg) >= 5 ? '#f59e0b' : '#f87171';
  el.innerHTML += '<tr style="border-top:2px solid var(--border)"><td style="text-align:left;font-weight:500">Margem</td>'
    + '<td style="text-align:right;font-family:var(--mono);color:' + mc + ';font-weight:600">' + mR + '%</td>'
    + '<td style="text-align:right;font-family:var(--mono);color:' + mc + ';font-weight:600">' + mP + '%</td>'
    + '<td style="text-align:right;font-family:var(--mono);color:' + mc + ';font-weight:600;border-left:2px solid var(--border)">' + mg + '%</td></tr>';
}

function renderBars(monthly) {
  const el = document.getElementById('dre-bar-chart');
  if (!el) return;
  const W = el.offsetWidth || 700;
  const H = 280; const PL = 65; const PR = 15; const PT = 20; const PB = 45;
  const gW = W - PL - PR; const gH = H - PT - PB;
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
    return '<rect x="'+x+'" y="'+y+'" width="'+barW+'" height="'+Math.max(h,1)+'" fill="'+c+'" opacity="'+op+'" rx="2"/>'
      +'<text x="'+(x+barW/2)+'" y="'+(pos?y-4:y+h+12)+'" fill="#9ca3af" font-size="8" text-anchor="middle">'+fmtK(m.resultado)+'</text>';
  }).join('');
  const xL = monthly.map((m,i)=>'<text x="'+(bx(i)+barW/2)+'" y="'+(H-8)+'" fill="#6b7280" font-size="9" text-anchor="middle">'+m.label+'</text>').join('');
  const yS = [-maxAbs,-maxAbs/2,0,maxAbs/2,maxAbs];
  const yL = yS.map(v=>{const y=zeroY-(v/maxAbs)*(gH/2);return '<text x="'+(PL-8)+'" y="'+(y+3)+'" fill="#6b7280" font-size="9" text-anchor="end">'+fmtK(v)+'</text><line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#1e2530" stroke-width="1"/>';}).join('');
  const zL = '<line x1="'+PL+'" y1="'+zeroY+'" x2="'+(W-PR)+'" y2="'+zeroY+'" stroke="#4b5563" stroke-width="1.5"/>';
  const fp = monthly.findIndex(m=>m.tipo==='PLAN');
  const dv = fp>0?'<line x1="'+(bx(fp)-gap/2)+'" y1="'+PT+'" x2="'+(bx(fp)-gap/2)+'" y2="'+(PT+gH)+'" stroke="#4b5563" stroke-width="1" stroke-dasharray="4,2"/>':'';
  el.innerHTML = '<svg width="100%" height="'+H+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="display:block">'+yL+zL+bars+dv+xL+'</svg>'
    +'<div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:11px;color:var(--muted)">'
    +'<span style="color:#10b981">&#9632; Positivo</span> <span style="color:#f87171">&#9632; Negativo</span> '
    +'<span style="color:#4b5563">Opaco=Real | Translucido=Planejado</span></div>';
}

function renderCurve(monthly) {
  const el = document.getElementById('dre-scurve');
  if (!el) return;
  const W = el.offsetWidth || 700;
  const H = 260; const PL = 65; const PR = 20; const PT = 25; const PB = 45;
  const gW = W - PL - PR; const gH = H - PT - PB;
  const n = monthly.length;
  if (!n) { el.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">Sem dados</div>'; return; }
  let aR=0,aC=0,aD=0;
  const pts = monthly.map(m=>{aR+=m.resultado;aC+=m.contrato;aD+=m.despesa;return{label:m.label,tipo:m.tipo,resultado:aR,contrato:aC,despesa:aD};});
  const all = pts.flatMap(p=>[p.resultado,p.contrato,p.despesa]);
  const mx = Math.max(...all.map(Math.abs),1);
  const mn = Math.min(...all,0);
  const hasNeg = mn < 0;
  const rMax = Math.max(mx, Math.abs(mn));
  const top = hasNeg ? rMax : mx;
  const bot = hasNeg ? -rMax : 0;
  const rng = top - bot || 1;
  function px(i){return PL+(n>1?i*gW/(n-1):gW/2);}
  function py(v){return PT+gH-((v-bot)/rng)*gH;}
  function mkP(key,color,dash){const d=pts.map((p,i)=>(i===0?'M':'L')+px(i).toFixed(1)+','+py(p[key]).toFixed(1)).join(' ');return '<path d="'+d+'" stroke="'+color+'" stroke-width="2.5" fill="none"'+(dash?' stroke-dasharray="6,3"':'')+'/>';}
  function mkA(key,color){const by=py(0);const d=pts.map((p,i)=>(i===0?'M':'L')+px(i).toFixed(1)+','+py(p[key]).toFixed(1)).join(' ');return '<path d="'+d+' L'+px(n-1).toFixed(1)+','+by+' L'+px(0).toFixed(1)+','+by+' Z" fill="'+color+'" opacity="0.07"/>';}
  const yN=5;
  const yLines=Array.from({length:yN+1},(_,i)=>{const v=bot+(rng*i)/yN;const y=py(v);return '<text x="'+(PL-8)+'" y="'+(y+3)+'" fill="#6b7280" font-size="9" text-anchor="end">'+fmtK(v)+'</text><line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#1e2530" stroke-width="1"/>';}).join('');
  const xL=pts.map((p,i)=>'<text x="'+px(i).toFixed(1)+'" y="'+(H-8)+'" fill="#6b7280" font-size="9" text-anchor="middle">'+p.label+'</text>').join('');
  const zL=hasNeg?'<line x1="'+PL+'" y1="'+py(0)+'" x2="'+(W-PR)+'" y2="'+py(0)+'" stroke="#4b5563" stroke-width="1"/>':'';
  const fp=pts.findIndex(p=>p.tipo==='PLAN');
  const dv=fp>0?'<line x1="'+px(fp).toFixed(1)+'" y1="'+PT+'" x2="'+px(fp).toFixed(1)+'" y2="'+(PT+gH)+'" stroke="#4b5563" stroke-width="1" stroke-dasharray="3,2"/>':'';
  const dots=pts.map((p,i)=>'<circle cx="'+px(i).toFixed(1)+'" cy="'+py(p.resultado).toFixed(1)+'" r="3.5" fill="#10b981" stroke="#0d1117" stroke-width="1"/>').join('');
  el.innerHTML='<svg width="100%" height="'+H+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="display:block">'
    +yLines+zL+mkA('contrato','#8b5cf6')+mkA('resultado','#10b981')
    +mkP('contrato','#8b5cf6',false)+mkP('despesa','#f87171',true)+mkP('resultado','#10b981',false)
    +dv+dots+xL+'</svg>'
    +'<div style="display:flex;gap:16px;justify-content:center;margin-top:8px;flex-wrap:wrap;font-size:11px;color:var(--muted)">'
    +'<span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#8b5cf6" stroke-width="2"/></svg> Contrato Acum.</span>'
    +'<span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#f87171" stroke-width="2" stroke-dasharray="4,2"/></svg> Despesa Acum.</span>'
    +'<span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#10b981" stroke-width="2"/></svg> Resultado Acum.</span>'
    +(fp>0?'<span style="color:#4b5563">| Planejado</span>':'')+'</div>';
}
