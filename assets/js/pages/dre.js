/**
 * DRE Consolidado — Plataforma PFO GSE
 * Demonstrativo de Resultado do Exercicio 2026
 * Self-contained: injeta nav-item e page section no DOM.
 */
import { state } from '../state.js';
import { safeNumber } from '../utils/format.js';

const YEAR = 2026;

function ensureDom() {
  if (!document.querySelector('.nav-item[data-page="dre"]')) {
    const ref = document.querySelector('.nav-item[data-page="dashboard"]');
    if (ref) {
      const n = document.createElement('div');
      n.className = 'nav-item';
      n.dataset.page = 'dre';
      n.innerHTML = '<span class="nav-icon">$</span> DRE';
      ref.insertAdjacentElement('afterend', n);
      n.addEventListener('click', () => { window.location.hash = 'dre'; document.querySelector('.sidebar')?.classList.remove('open'); });
    }
  }
  if (!document.getElementById('page-dre')) {
    const m = document.querySelector('.main');
    const c = document.getElementById('page-ciclos');
    if (m) {
      const s = document.createElement('section');
      s.id = 'page-dre';
      s.className = 'page fade-in';
      s.innerHTML = '<div class="section-header"><h2>DRE Consolidado 2026</h2><span class="section-sub">Demonstrativo de Resultado do Exercicio</span></div>'
        + '<div class="card" style="margin-bottom:20px;overflow-x:auto"><table class="table" style="min-width:500px"><thead><tr><th style="text-align:left;min-width:220px">LINHA</th><th style="text-align:right">REALIZADO</th><th style="text-align:right">PLANEJADO</th><th style="text-align:right">TOTAL 2026</th></tr></thead><tbody id="dre-table-body"></tbody></table></div>'
        + '<div class="card" style="margin-bottom:20px"><h3 style="margin:0 0 12px;font-size:14px;color:var(--muted)">Resultado Mensal 2026</h3><div id="dre-bar-chart" style="width:100%;min-height:280px"></div></div>'
        + '<div class="card"><h3 style="margin:0 0 12px;font-size:14px;color:var(--muted)">Curva S — Acumulado 2026</h3><div id="dre-scurve" style="width:100%;min-height:260px"></div></div>';
      if (c) m.insertBefore(s, c); else m.appendChild(s);
    }
  }
}

// Run on import so router can find #page-dre
ensureDom();

function fmtBRL(v) {
  const a = Math.abs(v), sg = v < 0 ? '-' : '';
  return sg + 'R$ ' + a.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtK(v) {
  const a = Math.abs(v), sg = v < 0 ? '-' : '';
  if (a >= 1e6) return sg + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return sg + (a / 1e3).toFixed(0) + 'k';
  return sg + a.toFixed(0);
}

function calcDRE(pfos) {
  const monthly = {};
  for (let m = 1; m <= 12; m++) {
    const lb = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m-1]+'/26';
    monthly[m] = { mes:m, label:lb, contrato:0, custo:0, cliente:0, tipo:'' };
  }
  pfos.forEach(pfo => {
    const d = pfo.dist || {};
    ['contrato','custo','cliente'].forEach(k => {
      (d[k]||[]).forEach(e => {
        if (e.ano===YEAR && e.mes>=1 && e.mes<=12) { monthly[e.mes][k]+=safeNumber(e.valor); if(!monthly[e.mes].tipo) monthly[e.mes].tipo=e.tipo; }
      });
    });
  });
  Object.values(monthly).forEach(m => { if(!m.tipo) m.tipo = m.mes<3?'REAL':'PLAN'; });
  const ms = Object.values(monthly).sort((a,b)=>a.mes-b.mes);
  let rC=0,pC=0,rK=0,pK=0,rL=0,pL=0;
  ms.forEach(m => {
    m.despesa = m.custo+m.cliente; m.resultado = m.contrato-m.despesa;
    if(m.tipo==='REAL'){rC+=m.contrato;rK+=m.custo;rL+=m.cliente;}else{pC+=m.contrato;pK+=m.custo;pL+=m.cliente;}
  });
  const X=1000, rD=(rK+rL)*X, pD=(pK+pL)*X, rT=rC*X, pT=pC*X;
  return {
    table:{contrato:{real:rT,plan:pT,total:rT+pT},custo:{real:rD,plan:pD,total:rD+pD},resultado:{real:rT-rD,plan:pT-pD,total:(rT+pT)-(rD+pD)}},
    monthly:ms.map(m=>({mes:m.mes,label:m.label,tipo:m.tipo,resultado:m.resultado*X,contrato:m.contrato*X,despesa:m.despesa*X}))
  };
}

export function renderDre() {
  const data = state.data; if(!data) return;
  ensureDom();
  const pfos = data.pfos_dados ? Object.values(data.pfos_dados) : data.pfos||[];
  const dre = calcDRE(pfos);
  renderTable(dre.table); renderBars(dre.monthly); renderCurve(dre.monthly);
}

function renderTable(t) {
  const el = document.getElementById('dre-table-body'); if(!el) return;
  const rows = [{l:'Contrato (Receita Prevista)',d:t.contrato,r:false},{l:'Custo Total (Custo + Cliente)',d:t.custo,r:false},{l:'Resultado',d:t.resultado,r:true}];
  el.innerHTML = rows.map(r=>{const c=r.r?(r.d.total>=0?'#10b981':'#f87171'):'';const s=c?' style="color:'+c+';font-weight:600"':'';return '<tr><td style="text-align:left;font-weight:500">'+r.l+'</td><td style="text-align:right;font-family:var(--mono);font-size:13px"'+s+'>'+fmtBRL(r.d.real)+'</td><td style="text-align:right;font-family:var(--mono);font-size:13px"'+s+'>'+fmtBRL(r.d.plan)+'</td><td style="text-align:right;font-family:var(--mono);font-size:13px;font-weight:600;border-left:2px solid var(--border)"'+s+'>'+fmtBRL(r.d.total)+'</td></tr>';}).join('');
  const mg=t.contrato.total>0?((t.resultado.total/t.contrato.total)*100).toFixed(1):'0.0';
  const mR=t.contrato.real>0?((t.resultado.real/t.contrato.real)*100).toFixed(1):'0.0';
  const mP=t.contrato.plan>0?((t.resultado.plan/t.contrato.plan)*100).toFixed(1):'0.0';
  const mc=parseFloat(mg)>=15?'#10b981':parseFloat(mg)>=5?'#f59e0b':'#f87171';
  el.innerHTML+='<tr style="border-top:2px solid var(--border)"><td style="text-align:left;font-weight:500">Margem</td><td style="text-align:right;font-family:var(--mono);color:'+mc+';font-weight:600">'+mR+'%</td><td style="text-align:right;font-family:var(--mono);color:'+mc+';font-weight:600">'+mP+'%</td><td style="text-align:right;font-family:var(--mono);color:'+mc+';font-weight:600;border-left:2px solid var(--border)">'+mg+'%</td></tr>';
}

function renderBars(monthly) {
  const el=document.getElementById('dre-bar-chart');if(!el)return;const W=el.offsetWidth||700,H=280,PL=65,PR=15,PT=20,PB=45,gW=W-PL-PR,gH=H-PT-PB,n=monthly.length;if(!n){el.innerHTML='<div style="padding:20px;color:var(--muted);text-align:center">Sem dados</div>';return;}
  const vals=monthly.map(m=>m.resultado),maxA=Math.max(...vals.map(Math.abs),1),bW=Math.max(Math.floor(gW/n)-6,8),gap=(gW-bW*n)/(n+1),zY=PT+gH/2;
  function bx(i){return PL+gap+i*(bW+gap);}
  const bars=monthly.map((m,i)=>{const x=bx(i),h=Math.abs(m.resultado)/maxA*(gH/2),p=m.resultado>=0,y=p?zY-h:zY,c=p?'#10b981':'#f87171',o=m.tipo==='PLAN'?'0.55':'1';return '<rect x="'+x+'" y="'+y+'" width="'+bW+'" height="'+Math.max(h,1)+'" fill="'+c+'" opacity="'+o+'" rx="2"/><text x="'+(x+bW/2)+'" y="'+(p?y-4:y+h+12)+'" fill="#9ca3af" font-size="8" text-anchor="middle">'+fmtK(m.resultado)+'</text>';}).join('');
  const xL=monthly.map((m,i)=>'<text x="'+(bx(i)+bW/2)+'" y="'+(H-8)+'" fill="#6b7280" font-size="9" text-anchor="middle">'+m.label+'</text>').join('');
  const yL=[-maxA,-maxA/2,0,maxA/2,maxA].map(v=>{const y=zY-(v/maxA)*(gH/2);return '<text x="'+(PL-8)+'" y="'+(y+3)+'" fill="#6b7280" font-size="9" text-anchor="end">'+fmtK(v)+'</text><line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#1e2530" stroke-width="1"/>';}).join('');
  const zL='<line x1="'+PL+'" y1="'+zY+'" x2="'+(W-PR)+'" y2="'+zY+'" stroke="#4b5563" stroke-width="1.5"/>';
  const fp=monthly.findIndex(m=>m.tipo==='PLAN'),dv=fp>0?'<line x1="'+(bx(fp)-gap/2)+'" y1="'+PT+'" x2="'+(bx(fp)-gap/2)+'" y2="'+(PT+gH)+'" stroke="#4b5563" stroke-width="1" stroke-dasharray="4,2"/>':'';
  el.innerHTML='<svg width="100%" height="'+H+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="display:block">'+yL+zL+bars+dv+xL+'</svg><div style="display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:11px;color:var(--muted)"><span style="color:#10b981">&#9632; Positivo</span> <span style="color:#f87171">&#9632; Negativo</span> <span style="color:#4b5563">Opaco=Real | Translucido=Plan</span></div>';
}

function renderCurve(monthly) {
  const el=document.getElementById('dre-scurve');if(!el)return;const W=el.offsetWidth||700,H=260,PL=65,PR=20,PT=25,PB=45,gW=W-PL-PR,gH=H-PT-PB,n=monthly.length;if(!n){el.innerHTML='<div style="padding:20px;color:var(--muted);text-align:center">Sem dados</div>';return;}
  let aR=0,aC=0,aD=0;const pts=monthly.map(m=>{aR+=m.resultado;aC+=m.contrato;aD+=m.despesa;return{label:m.label,tipo:m.tipo,resultado:aR,contrato:aC,despesa:aD};});
  const all=pts.flatMap(p=>[p.resultado,p.contrato,p.despesa]),mx=Math.max(...all.map(Math.abs),1),mn=Math.min(...all,0),neg=mn<0,rM=Math.max(mx,Math.abs(mn)),tp=neg?rM:mx,bt=neg?-rM:0,rg=tp-bt||1;
  function px(i){return PL+(n>1?i*gW/(n-1):gW/2);}function py(v){return PT+gH-((v-bt)/rg)*gH;}
  function mkP(k,cl,da){const d=pts.map((p,i)=>(i===0?'M':'L')+px(i).toFixed(1)+','+py(p[k]).toFixed(1)).join(' ');return '<path d="'+d+'" stroke="'+cl+'" stroke-width="2.5" fill="none"'+(da?' stroke-dasharray="6,3"':'')+'/>';}
  function mkA(k,cl){const by=py(0),d=pts.map((p,i)=>(i===0?'M':'L')+px(i).toFixed(1)+','+py(p[k]).toFixed(1)).join(' ');return '<path d="'+d+' L'+px(n-1).toFixed(1)+','+by+' L'+px(0).toFixed(1)+','+by+' Z" fill="'+cl+'" opacity="0.07"/>';}
  const yLn=Array.from({length:6},(_,i)=>{const v=bt+(rg*i)/5,y=py(v);return '<text x="'+(PL-8)+'" y="'+(y+3)+'" fill="#6b7280" font-size="9" text-anchor="end">'+fmtK(v)+'</text><line x1="'+PL+'" y1="'+y+'" x2="'+(W-PR)+'" y2="'+y+'" stroke="#1e2530" stroke-width="1"/>';}).join('');
  const xL=pts.map((p,i)=>'<text x="'+px(i).toFixed(1)+'" y="'+(H-8)+'" fill="#6b7280" font-size="9" text-anchor="middle">'+p.label+'</text>').join('');
  const zL=neg?'<line x1="'+PL+'" y1="'+py(0)+'" x2="'+(W-PR)+'" y2="'+py(0)+'" stroke="#4b5563" stroke-width="1"/>':'';
  const fp=pts.findIndex(p=>p.tipo==='PLAN'),dv=fp>0?'<line x1="'+px(fp).toFixed(1)+'" y1="'+PT+'" x2="'+px(fp).toFixed(1)+'" y2="'+(PT+gH)+'" stroke="#4b5563" stroke-width="1" stroke-dasharray="3,2"/>':'';
  const dots=pts.map((p,i)=>'<circle cx="'+px(i).toFixed(1)+'" cy="'+py(p.resultado).toFixed(1)+'" r="3.5" fill="#10b981" stroke="#0d1117" stroke-width="1"/>').join('');
  el.innerHTML='<svg width="100%" height="'+H+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet" style="display:block">'+yLn+zL+mkA('contrato','#8b5cf6')+mkA('resultado','#10b981')+mkP('contrato','#8b5cf6',false)+mkP('despesa','#f87171',true)+mkP('resultado','#10b981',false)+dv+dots+xL+'</svg><div style="display:flex;gap:16px;justify-content:center;margin-top:8px;flex-wrap:wrap;font-size:11px;color:var(--muted)"><span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#8b5cf6" stroke-width="2"/></svg> Contrato Acum.</span><span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#f87171" stroke-width="2" stroke-dasharray="4,2"/></svg> Despesa Acum.</span><span><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#10b981" stroke-width="2"/></svg> Resultado Acum.</span>'+(fp>0?'<span style="color:#4b5563">| Planejado</span>':'')+'</div>';
}
