/* 월산리 토지 매각 프로젝트 v2 */
const STORAGE_KEY = 'wolsan_sale_v2';
const SYNC_KEY = 'wolsan_sale_sync_v2';
const FILE_NAME = '월산리_매각_데이터.json';
const GIST_FILENAME = 'wolsan_sale_v2.json';
const PULL_INTERVAL_MS = 30000;
const PUSH_DEBOUNCE_MS = 2000;

function deepClone(o){return JSON.parse(JSON.stringify(o))}
let DATA = (()=>{
  try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const p=JSON.parse(raw);if(p&&p.parcels&&p.parcels[0]&&p.parcels[0].group)return p}}catch{}
  return deepClone(window.INITIAL_DATA);
})();

let SCENARIO = 'B';

function escape(s){if(s==null)return'';return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtKRW(n){if(!n)return'0';return Math.round(n).toLocaleString('ko-KR')}
function fmtShort(n){n=Math.round(n||0);const a=Math.abs(n);if(a>=1e8)return(n/1e8).toFixed(2)+'억';if(a>=1e4)return(n/1e4).toFixed(0)+'만';return n.toLocaleString()}
function fmtArea(n){return(Math.round((n||0)*100)/100).toLocaleString('ko-KR')}
function toPyeong(m){return(m||0)*0.3025}

function saveData(silent,opts){
  opts=opts||{};
  if(!opts.fromRemote)DATA.updatedAt=new Date().toISOString();
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(DATA));if(!silent)flashSync('saved')}catch{toast('저장 실패','err')}
  if(!opts.fromRemote){const c=getSyncConfig();if(c.enabled&&c.token&&c.gistId)schedulePush()}
}
function flashSync(s){const d=document.getElementById('syncDot'),t=document.getElementById('syncText');if(!d)return;if(s==='dirty'){d.classList.add('dirty');t.textContent='저장 중…'}else if(s==='syncing'){d.classList.add('dirty');t.textContent='동기화 중…'}else if(s==='cloud'){d.classList.remove('dirty');t.textContent='☁ 클라우드 동기화'}else{d.classList.remove('dirty');t.textContent='자동 저장됨'}}

let toastTimer;
function toast(m,k){const e=document.getElementById('toast');e.textContent=m;e.className='toast show '+(k||'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('show'),2400)}

function showView(v){document.querySelectorAll('.view').forEach(e=>e.classList.remove('active'));document.getElementById('view-'+v).classList.add('active');document.querySelectorAll('.nav-tab').forEach(t=>t.classList.toggle('active',t.dataset.view===v));window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('.nav-tab').forEach(t=>t.addEventListener('click',()=>showView(t.dataset.view)));
document.getElementById('settingsBtn').addEventListener('click',()=>showView('settings'));

// 시나리오 토글
function getUnit(p, scn){
  if(scn==='A') return p.bundleUnit || p.targetUnit || 0;
  if(scn==='B') return p.targetUnit || 0;
  if(scn==='C') return p.targetUnit || 0;
  return p.targetUnit || 0;
}
function parcelAmount(p, scn){return (p.area||0) * getUnit(p, scn||SCENARIO)}
function scenarioName(k){return {A:'A 전체일괄', B:'B 부분매각', C:'C 인별분리'}[k]||k}

function bindScenarioToggle(){
  const sel=document.getElementById('scenarioSelect');
  sel.value = SCENARIO;
  sel.addEventListener('change', e=>{
    SCENARIO = e.target.value;
    document.getElementById('heroScenario').textContent = scenarioName(SCENARIO);
    rerenderAll();
  });
  document.getElementById('heroScenario').textContent = scenarioName(SCENARIO);
}

// 집계
function totalArea(){return DATA.parcels.reduce((s,p)=>s+(+p.area||0),0)}
function totalAmount(scn){return DATA.parcels.reduce((s,p)=>s+parcelAmount(p,scn),0)}
function totalGongsi(){return DATA.parcels.reduce((s,p)=>s+(+p.area||0)*(+p.gongsiUnit||0),0)}
function statusCounts(){const c={};DATA.meta.saleStatuses.forEach(s=>c[s]=0);DATA.parcels.forEach(p=>{const s=p.saleStatus||'미진행';c[s]=(c[s]||0)+1});return c}

function ownerAgg(){
  const m={};
  DATA.meta.owners.forEach(o=>m[o]={count:0,area:0,gongsi:0,A:0,B:0,roads:0});
  DATA.parcels.forEach(p=>{
    if(!m[p.group]) m[p.group]={count:0,area:0,gongsi:0,A:0,B:0,roads:0};
    m[p.group].count++;
    m[p.group].area+=(+p.area||0);
    m[p.group].gongsi+=(+p.area||0)*(+p.gongsiUnit||0);
    m[p.group].A+=parcelAmount(p,'A');
    m[p.group].B+=parcelAmount(p,'B');
    if(p.isRoad) m[p.group].roads++;
  });
  return m;
}

// 대시보드
function renderDash(){
  document.getElementById('updatedDate').textContent=DATA.updated||'';
  document.getElementById('totalParcels').textContent=DATA.parcels.length;
  document.getElementById('totalRoads').textContent=DATA.parcels.filter(p=>p.isRoad).length;

  const area=totalArea();
  document.getElementById('kpiParcels').textContent=DATA.parcels.length+'개';
  document.getElementById('kpiArea').textContent=fmtArea(area)+'㎡';
  document.getElementById('kpiPyeong').textContent=fmtArea(toPyeong(area));
  document.getElementById('kpiScenario').textContent=fmtShort(totalAmount(SCENARIO))+'원';
  const prem = totalAmount('A') - totalAmount('B');
  document.getElementById('kpiPremium').textContent=fmtShort(prem)+'원';

  // 시나리오 카드
  const sg = document.getElementById('dashScenarioGrid');
  sg.innerHTML = ['A','B','C'].map(k=>{
    const total = totalAmount(k);
    const info = DATA.meta.scenarios.find(s=>s.key===k);
    return `<div class="scn-card ${k===SCENARIO?'active':''}" data-scn="${k}">
      <div class="scn-key">${k}</div>
      <div class="scn-name">${escape(info?.name||'')}</div>
      <div class="scn-amt">${fmtShort(total)}원</div>
      <div class="scn-desc">${escape(info?.desc||'')}</div>
    </div>`;
  }).join('');
  sg.querySelectorAll('[data-scn]').forEach(el=>el.addEventListener('click',()=>{
    SCENARIO = el.dataset.scn;
    document.getElementById('scenarioSelect').value = SCENARIO;
    document.getElementById('heroScenario').textContent = scenarioName(SCENARIO);
    rerenderAll();
  }));

  // 상태바
  const sc=statusCounts();
  document.getElementById('dashStatusBar').innerHTML=DATA.meta.saleStatuses.map(s=>`<div class="status-cell" data-status="${escape(s)}"><div class="scnt">${sc[s]||0}</div><div class="slbl">${escape(s)}</div></div>`).join('');
  document.querySelectorAll('#dashStatusBar [data-status]').forEach(el=>el.addEventListener('click',()=>{document.getElementById('filterStatus').value=el.dataset.status;renderSummary();showView('summary')}));

  // 인별 요약 (대시보드용)
  const m = ownerAgg();
  document.getElementById('dashOwnerGrid').innerHTML = DATA.meta.owners.map(o=>{
    const a=m[o]||{count:0,area:0,gongsi:0,A:0,B:0,roads:0};
    return `<div class="owner-card" data-owner="${escape(o)}">
      <div class="owner-name">${escape(o)}</div>
      <div class="owner-meta">필지 ${a.count}개 · 도로 ${a.roads}개</div>
      <div class="owner-line"><span>총 면적</span><b>${fmtArea(a.area)}㎡</b></div>
      <div class="owner-line"><span>공시가격</span><b>${fmtShort(a.gongsi)}원</b></div>
      <div class="owner-line part"><span>B 부분매각</span><b>${fmtShort(a.B)}원</b></div>
      <div class="owner-line bundle total"><span>A 전체일괄</span><b>${fmtShort(a.A)}원</b></div>
    </div>`;
  }).join('');
  document.querySelectorAll('#dashOwnerGrid [data-owner]').forEach(el=>el.addEventListener('click',()=>{document.getElementById('filterOwner').value=el.dataset.owner;renderSummary();showView('summary')}));
}

// 전체 토지 총괄표
function buildFilterOptions(){
  const sf=document.getElementById('filterStatus');
  const of=document.getElementById('filterOwner');
  if(sf){const cur=sf.value;sf.innerHTML='<option value="all">전체 상태</option>'+DATA.meta.saleStatuses.map(s=>`<option value="${escape(s)}">${escape(s)}</option>`).join('');sf.value=cur||'all'}
  if(of){const cur=of.value;of.innerHTML='<option value="all">전체 소유자</option>'+DATA.meta.owners.map(o=>`<option value="${escape(o)}">${escape(o)}</option>`).join('');of.value=cur||'all'}
}
function renderSummary(){
  buildFilterOptions();
  const fo=document.getElementById('filterOwner').value;
  const fs=document.getElementById('filterStatus').value;
  const fr=document.getElementById('filterRoad').value;
  const ft=document.getElementById('filterText').value.trim().toLowerCase();

  // 그룹별 정렬 + 소계
  const byOwner = {};
  DATA.parcels.forEach(p=>{
    if(fo!=='all' && p.group!==fo) return;
    if(fs!=='all' && (p.saleStatus||'미진행')!==fs) return;
    if(fr==='road' && !p.isRoad) return;
    if(fr==='land' && p.isRoad) return;
    if(ft && !p.name.toLowerCase().includes(ft)) return;
    if(!byOwner[p.group]) byOwner[p.group]=[];
    byOwner[p.group].push(p);
  });

  let html='';let idx=0;let grandArea=0,grandGongsi=0,grandAmt=0;
  DATA.meta.owners.forEach(o=>{
    const list = byOwner[o]||[];
    if(!list.length) return;
    let sArea=0,sGongsi=0,sAmt=0;
    list.forEach(p=>{
      idx++;
      const amt = parcelAmount(p);
      const g = (+p.area||0)*(+p.gongsiUnit||0);
      sArea+=p.area; sGongsi+=g; sAmt+=amt;
      html += `<tr class="${p.isRoad?'road':''}" data-pid="${p.id}">
        <td data-label="#" class="c">${idx}</td>
        <td data-label="소유자">${escape(p.group)}</td>
        <td data-label="지번"><div class="pname">${escape(p.name)}${p.isRoad?' <span class="tag road">도로</span>':''}</div></td>
        <td data-label="용도">${escape(p.use)}</td>
        <td data-label="면적(㎡)" class="r">${fmtArea(p.area)}</td>
        <td data-label="평수" class="r">${fmtArea(toPyeong(p.area))}</td>
        <td data-label="공시(원/㎡)" class="r">${fmtKRW(p.gongsiUnit)}</td>
        <td data-label="${SCENARIO} 단가" class="r">${fmtKRW(getUnit(p))}</td>
        <td data-label="매각금액" class="r" style="color:var(--gold-deep);font-weight:700">${fmtKRW(amt)}</td>
        <td data-label="진행상태" class="c"><span class="tag st-${escape(p.saleStatus||'미진행')}">${escape(p.saleStatus||'미진행')}</span></td>
      </tr>`;
    });
    html += `<tr class="subtotal"><td></td><td>${escape(o)} 소계</td><td>(${list.length}개)</td><td>-</td><td class="r">${fmtArea(sArea)}</td><td class="r">${fmtArea(toPyeong(sArea))}</td><td class="r">${fmtKRW(sGongsi)}</td><td>-</td><td class="r">${fmtKRW(sAmt)}</td><td></td></tr>`;
    grandArea+=sArea; grandGongsi+=sGongsi; grandAmt+=sAmt;
  });
  if(idx>0){
    html += `<tr class="total"><td></td><td colspan="2">전체 총계 (${idx}개)</td><td>-</td><td class="r">${fmtArea(grandArea)}</td><td class="r">${fmtArea(toPyeong(grandArea))}</td><td class="r">${fmtKRW(grandGongsi)}</td><td>-</td><td class="r">${fmtKRW(grandAmt)}</td><td></td></tr>`;
  } else {
    html = '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted)">조건에 맞는 필지가 없습니다</td></tr>';
  }
  document.querySelector('#summaryTable tbody').innerHTML = html;
  document.querySelectorAll('#summaryTable [data-pid]').forEach(el=>el.addEventListener('click',()=>openParcelModal(parseInt(el.dataset.pid))));
}

// 시나리오 분석
function renderScenario(){
  const cards = document.getElementById('scenarioCards');
  cards.innerHTML = ['A','B','C'].map(k=>{
    const info = DATA.meta.scenarios.find(s=>s.key===k);
    const total = totalAmount(k);
    return `<div class="scn-card ${k===SCENARIO?'active':''}" data-scn="${k}">
      <div class="scn-key">${k}</div>
      <div class="scn-name">${escape(info?.name||'')}</div>
      <div class="scn-amt">${fmtKRW(total)}원</div>
      <div class="scn-desc">${escape(info?.desc||'')}</div>
    </div>`;
  }).join('');
  cards.querySelectorAll('[data-scn]').forEach(el=>el.addEventListener('click',()=>{
    SCENARIO=el.dataset.scn;
    document.getElementById('scenarioSelect').value=SCENARIO;
    document.getElementById('heroScenario').textContent=scenarioName(SCENARIO);
    rerenderAll();
  }));

  const m = ownerAgg();
  const tbody = document.querySelector('#scenarioCompareTable tbody');
  let totalA=0,totalB=0,totalDiff=0;
  tbody.innerHTML = DATA.meta.owners.map(o=>{
    const a=m[o]||{A:0,B:0};
    const diff=a.A-a.B;
    totalA+=a.A;totalB+=a.B;totalDiff+=diff;
    return `<tr>
      <td><b>${escape(o)}</b></td>
      <td class="r">${fmtKRW(a.A)}원</td>
      <td class="r">${fmtKRW(a.B)}원</td>
      <td class="r" style="color:${diff>0?'var(--inc)':'var(--text-muted)'};font-weight:700">${diff>0?'+':''}${fmtKRW(diff)}원</td>
    </tr>`;
  }).join('') + `<tr class="total">
    <td>전체 총계</td>
    <td class="r">${fmtKRW(totalA)}원</td>
    <td class="r">${fmtKRW(totalB)}원</td>
    <td class="r" style="color:var(--inc)">${fmtKRW(totalDiff)}원</td>
  </tr>`;
}

// 도로 분석
function renderRoad(){
  const roads = DATA.parcels.filter(p=>p.isRoad);
  const tbody = document.querySelector('#roadTable tbody');
  let tArea=0,tA=0,tB=0,tDiff=0;
  tbody.innerHTML = roads.map(p=>{
    const a=parcelAmount(p,'A'), b=parcelAmount(p,'B'), diff=a-b;
    tArea+=p.area;tA+=a;tB+=b;tDiff+=diff;
    return `<tr>
      <td>${escape(p.group)}</td>
      <td><b>${escape(p.name)}</b></td>
      <td>${p.area}</td>
      <td>${fmtKRW(p.bundleUnit)}</td>
      <td><b>${fmtKRW(a)}원</b></td>
      <td>${fmtKRW(p.baseUnit)}</td>
      <td>${fmtKRW(b)}원</td>
      <td style="color:var(--inc);font-weight:700">+${fmtKRW(diff)}원</td>
    </tr>`;
  }).join('') + `<tr class="total">
    <td colspan="2">도로 필지 합계 (${roads.length}개)</td>
    <td>${tArea}</td>
    <td>-</td>
    <td>${fmtKRW(tA)}원</td>
    <td>-</td>
    <td>${fmtKRW(tB)}원</td>
    <td>+${fmtKRW(tDiff)}원</td>
  </tr>`;
  document.getElementById('roadTotalText').textContent = `전체매각 +${fmtShort(tDiff)}원 프리미엄`;
}

// 인별 소유
function renderOwner(){
  const m = ownerAgg();
  document.getElementById('ownerFullGrid').innerHTML = DATA.meta.owners.map(o=>{
    const a=m[o]||{count:0,area:0,gongsi:0,A:0,B:0,roads:0};
    return `<div class="owner-card" data-owner="${escape(o)}">
      <div class="owner-name">${escape(o)}</div>
      <div class="owner-meta">필지 ${a.count}개 · 도로 ${a.roads}개</div>
      <div class="owner-line"><span>총 면적</span><b>${fmtArea(a.area)}㎡ (${fmtArea(toPyeong(a.area))}평)</b></div>
      <div class="owner-line"><span>공시가격</span><b>${fmtKRW(a.gongsi)}원</b></div>
      <div class="owner-line part"><span>B 부분매각</span><b>${fmtKRW(a.B)}원</b></div>
      <div class="owner-line bundle"><span>A 전체일괄</span><b>${fmtKRW(a.A)}원</b></div>
      <div class="owner-line total"><span>A-B 차액</span><b style="color:var(--exp)">+${fmtKRW(a.A-a.B)}원</b></div>
      ${a.roads>0?`<div class="owner-road">도로 ${a.roads}필지 보유 — 일괄매각 시 유리</div>`:'<div class="owner-road">도로 없음</div>'}
    </div>`;
  }).join('');
  document.querySelectorAll('#ownerFullGrid [data-owner]').forEach(el=>el.addEventListener('click',()=>{document.getElementById('filterOwner').value=el.dataset.owner;renderSummary();showView('summary')}));
}

// 세금 시뮬
function renderTaxInit(){
  const t = DATA.taxSim;
  document.getElementById('taxScenario').value = t.scenario==='전체 일괄매각'?'A':t.scenario==='부분매각 (도로제외)'?'B':'B';
  document.getElementById('tax-sale').value = (t.salePrice||0).toLocaleString();
  document.getElementById('tax-acq').value = (t.acquireCost||0).toLocaleString();
  document.getElementById('tax-exp').value = (t.expense||0).toLocaleString();
  document.getElementById('tax-hold').value = t.holdYears||0;
  document.getElementById('tax-deduct').value = ((t.longHoldDeduct||0)*100).toFixed(1);
  document.getElementById('tax-rate').value = ((t.taxRate||0)*100).toFixed(2);
  document.getElementById('tax-localrate').value = ((t.localTaxRate||0)*100).toFixed(2);
  calcTax();
  ['tax-sale','tax-acq','tax-exp','tax-hold','tax-deduct','tax-rate','tax-localrate'].forEach(id=>{
    const el=document.getElementById(id);
    el.addEventListener('input',()=>{
      if(['tax-sale','tax-acq','tax-exp'].includes(id)){const v=el.value.replace(/[^\d]/g,'');el.value=v?parseInt(v).toLocaleString():''}
      calcTax();
    });
  });
  document.getElementById('taxScenario').addEventListener('change',e=>{
    const k=e.target.value;
    document.getElementById('tax-sale').value=totalAmount(k).toLocaleString();
    DATA.taxSim.scenario = scenarioName(k);
    calcTax();
  });
}
function parseNum(id){return parseInt((document.getElementById(id)?.value||'').replace(/[^\d.]/g,''))||0}
function parseFloat2(id){return parseFloat(document.getElementById(id)?.value||0)||0}
function calcTax(){
  const sale=parseNum('tax-sale'), acq=parseNum('tax-acq'), exp=parseNum('tax-exp');
  const deductRate=parseFloat2('tax-deduct')/100;
  const taxRate=parseFloat2('tax-rate')/100;
  const localRate=parseFloat2('tax-localrate')/100;
  const gain=sale-acq-exp;
  const deductAmt=Math.max(0,gain*deductRate);
  const base=gain-deductAmt;
  const tax=Math.max(0,base*taxRate);
  const local=tax*localRate;
  const totalTax=tax+local;
  const after=sale-totalTax;
  document.getElementById('tax-gain').textContent=fmtKRW(gain)+'원';
  document.getElementById('tax-deductAmt').textContent=fmtKRW(deductAmt)+'원';
  document.getElementById('tax-base').textContent=fmtKRW(base)+'원';
  document.getElementById('tax-tax').textContent=fmtKRW(tax)+'원';
  document.getElementById('tax-localtax').textContent=fmtKRW(local)+'원';
  document.getElementById('tax-total').textContent=fmtKRW(totalTax)+'원';
  document.getElementById('tax-after').textContent=fmtKRW(after)+'원';
  // 저장
  DATA.taxSim.salePrice=sale;DATA.taxSim.acquireCost=acq;DATA.taxSim.expense=exp;
  DATA.taxSim.holdYears=parseNum('tax-hold');
  DATA.taxSim.longHoldDeduct=deductRate;DATA.taxSim.taxRate=taxRate;DATA.taxSim.localTaxRate=localRate;
}

// 체크리스트
function renderChecklist(){
  const groups = {};
  DATA.checklist.forEach(c=>{if(!groups[c.category])groups[c.category]=[];groups[c.category].push(c)});
  const cont=document.getElementById('checklistContainer');
  cont.innerHTML = Object.entries(groups).map(([cat,items])=>{
    const phase = items[0]?.phase || '';
    return `<div class="checklist-group">
      <h4>▶ ${escape(cat)} <span class="phase-tag">${escape(phase)}</span></h4>
      ${items.map(c=>`<div class="check-item ${c.done?'done':''}" data-cid="${c.id}">
        <div class="check-box">✓</div>
        <div class="check-text">${escape(c.item)}</div>
        <div class="check-phase">${escape(c.phase||'')}</div>
      </div>`).join('')}
    </div>`;
  }).join('');
  cont.querySelectorAll('[data-cid]').forEach(el=>el.addEventListener('click',()=>{
    const id=parseInt(el.dataset.cid);
    const c=DATA.checklist.find(x=>x.id===id);
    if(c){c.done=!c.done;flashSync('dirty');saveData();renderChecklist()}
  }));
}

// 진행상태별
function renderStatus(){
  const cont=document.getElementById('statusGroups');
  cont.innerHTML=DATA.meta.saleStatuses.map(s=>{
    const list=DATA.parcels.filter(p=>(p.saleStatus||'미진행')===s);
    if(!list.length)return '';
    return `<div class="panel">
      <div class="panel-head"><div class="panel-title"><span class="ic">${list.length}</span>${escape(s)}</div></div>
      <div class="parcel-grid">${list.map(p=>renderParcelCard(p)).join('')}</div>
    </div>`;
  }).join('') || '<div class="empty">필지 없음</div>';
  cont.querySelectorAll('[data-pid]').forEach(el=>el.addEventListener('click',()=>openParcelModal(parseInt(el.dataset.pid))));
}
function renderParcelCard(p){
  const cls=(p.saleStatus==='완료'?'completed':'')+(p.isRoad?' road':'');
  const amt = parcelAmount(p);
  return `<div class="parcel-card ${cls}" data-pid="${p.id}">
    <div class="parcel-card-top">
      <div class="parcel-name">${escape(p.name)}${p.isRoad?' <span class="tag road">도로</span>':''}</div>
      <div class="parcel-tags"><span class="tag pri-${p.priority||'중'}">${escape(p.priority||'중')}</span><span class="tag st-${escape(p.saleStatus||'미진행')}">${escape(p.saleStatus||'미진행')}</span></div>
    </div>
    <div class="parcel-row"><span>소유자</span><b>${escape(p.group)}</b></div>
    <div class="parcel-row"><span>용도·면적</span><b>${escape(p.use)} · ${fmtArea(p.area)}㎡ (${fmtArea(toPyeong(p.area))}평)</b></div>
    <div class="parcel-row"><span>${SCENARIO} 단가</span><b>${fmtKRW(getUnit(p))}원/㎡</b></div>
    <div class="parcel-row" style="color:var(--gold-deep)"><span>매각금액</span><b>${fmtKRW(amt)}원</b></div>
    ${p.buyer?`<div class="parcel-row"><span>매수자</span><b>${escape(p.buyer)}</b></div>`:''}
  </div>`;
}

// 편집 모달
let modalPid=null;
function openParcelModal(pid){
  const p = pid ? DATA.parcels.find(x=>x.id===pid) : null;
  modalPid = pid;
  const html=`
    <div class="modal-section-title">📍 기본 정보</div>
    <div class="field-row">
      <div class="field"><label>소유자 그룹</label><select id="f-group">${DATA.meta.owners.map(o=>`<option ${p?.group===o?'selected':''}>${o}</option>`).join('')}</select></div>
      <div class="field"><label>지번</label><input id="f-name" value="${escape(p?.name||'')}"></div>
    </div>
    <div class="field-row-3">
      <div class="field"><label>용도</label><select id="f-use">${DATA.meta.uses.map(u=>`<option ${p?.use===u?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="field"><label>면적 (㎡)</label><input id="f-area" type="text" inputmode="decimal" value="${p?.area||''}"></div>
      <div class="field"><label>도로 여부</label><select id="f-isRoad"><option value="false" ${!p?.isRoad?'selected':''}>일반</option><option value="true" ${p?.isRoad?'selected':''}>도로</option></select></div>
    </div>

    <div class="modal-section-title">💰 단가 정보 (원/㎡)</div>
    <div class="field-row-3">
      <div class="field"><label>공시지가</label><input id="f-gongsiUnit" type="text" inputmode="numeric" value="${p?.gongsiUnit||0}"></div>
      <div class="field"><label>기준가격 (부분)</label><input id="f-baseUnit" type="text" inputmode="numeric" value="${p?.baseUnit||0}"></div>
      <div class="field"><label>매도희망가 (B)</label><input id="f-targetUnit" type="text" inputmode="numeric" value="${p?.targetUnit||0}"></div>
    </div>
    <div class="field"><label>전체일괄 단가 (A)</label><input id="f-bundleUnit" type="text" inputmode="numeric" value="${p?.bundleUnit||0}"></div>

    <div class="modal-section-title">🎯 매각 정보</div>
    <div class="field-row">
      <div class="field"><label>진행 상태</label><select id="f-saleStatus">${DATA.meta.saleStatuses.map(s=>`<option ${p?.saleStatus===s?'selected':''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>우선순위</label><select id="f-priority">${DATA.meta.priorities.map(s=>`<option ${p?.priority===s?'selected':''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>계약가 (원)</label><input id="f-contractPrice" type="text" inputmode="numeric" value="${p?.contractPrice||''}"></div>

    <div class="modal-section-title">👥 매수자·중개인</div>
    <div class="field-row">
      <div class="field"><label>매수자</label><input id="f-buyer" value="${escape(p?.buyer||'')}"></div>
      <div class="field"><label>매수자 연락처</label><input id="f-buyerContact" value="${escape(p?.buyerContact||'')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>중개인</label><input id="f-broker" value="${escape(p?.broker||'')}"></div>
      <div class="field"><label>중개인 연락처</label><input id="f-brokerContact" value="${escape(p?.brokerContact||'')}"></div>
    </div>

    <div class="modal-section-title">📅 일정</div>
    <div class="field-row">
      <div class="field"><label>매물 등록일</label><input id="f-listingDate" type="date" value="${escape(p?.listingDate||'')}"></div>
      <div class="field"><label>계약일</label><input id="f-contractDate" type="date" value="${escape(p?.contractDate||'')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>잔금일</label><input id="f-paymentDate" type="date" value="${escape(p?.paymentDate||'')}"></div>
      <div class="field"><label>완료일</label><input id="f-completionDate" type="date" value="${escape(p?.completionDate||'')}"></div>
    </div>

    <div class="field"><label>비고</label><textarea id="f-note">${escape(p?.note||'')}</textarea></div>
  `;
  document.getElementById('modalTitle').textContent = pid ? '필지 매각 정보 수정' : '새 필지 추가';
  document.getElementById('modalSub').textContent = p ? escape(p.name)+' · '+escape(p.group) : '월산리 매각 대상 추가';
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBg').classList.add('active');
  document.getElementById('btnDelete').style.display = pid ? 'inline-flex' : 'none';
}
function closeModal(){document.getElementById('modalBg').classList.remove('active');modalPid=null}
document.getElementById('modalClose').addEventListener('click',closeModal);
document.getElementById('modalCancel').addEventListener('click',closeModal);
document.getElementById('modalBg').addEventListener('click',e=>{if(e.target.id==='modalBg')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});

document.getElementById('modalSave').addEventListener('click',()=>{
  const num=id=>parseInt((document.getElementById(id)?.value||'').replace(/[^\d.]/g,''))||null;
  const numD=id=>parseFloat(document.getElementById(id)?.value||0)||0;
  const str=id=>(document.getElementById(id)?.value||'').trim();
  const rec={
    group:str('f-group'),name:str('f-name'),use:str('f-use'),area:numD('f-area'),
    isRoad:str('f-isRoad')==='true',
    gongsiUnit:num('f-gongsiUnit')||0,
    baseUnit:num('f-baseUnit')||0,
    targetUnit:num('f-targetUnit')||0,
    bundleUnit:num('f-bundleUnit')||0,
    saleStatus:str('f-saleStatus'),priority:str('f-priority'),
    contractPrice:num('f-contractPrice'),
    buyer:str('f-buyer'),buyerContact:str('f-buyerContact'),
    broker:str('f-broker'),brokerContact:str('f-brokerContact'),
    listingDate:str('f-listingDate'),contractDate:str('f-contractDate'),
    paymentDate:str('f-paymentDate'),completionDate:str('f-completionDate'),
    note:str('f-note')
  };
  flashSync('dirty');
  if(modalPid){
    const i=DATA.parcels.findIndex(x=>x.id===modalPid);
    Object.assign(DATA.parcels[i],rec);
  } else {
    rec.id = DATA.nextParcelId++;
    DATA.parcels.push(rec);
  }
  saveData();
  rerenderAll();
  closeModal();
  toast('저장됨','ok');
});
document.getElementById('btnDelete').addEventListener('click',()=>{
  if(!modalPid)return;
  if(!confirm('이 필지를 매각 대상에서 삭제하시겠습니까?'))return;
  flashSync('dirty');
  DATA.parcels = DATA.parcels.filter(x=>x.id!==modalPid);
  saveData();rerenderAll();closeModal();toast('삭제됨','ok');
});

document.getElementById('fabAdd').addEventListener('click',()=>openParcelModal(null));
document.getElementById('imManual').addEventListener('click',()=>openParcelModal(null));
document.getElementById('imExcel').addEventListener('click',()=>document.getElementById('excelFile').click());
document.getElementById('imScan').addEventListener('click',()=>document.getElementById('scanFile').click());

// 엑셀
document.getElementById('excelFile').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const wb=XLSX.read(new Uint8Array(ev.target.result),{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
      if(!confirm(`엑셀 ${rows.length}개 행 발견. 지번 매칭으로 매각 정보 일괄 갱신합니다. 계속할까요?`))return;
      let updated=0;
      rows.forEach(r=>{
        const name=String(r['지번']||r['name']||'').trim();
        if(!name)return;
        const t=DATA.parcels.find(p=>p.name.replace(/ /g,'').includes(name.replace(/ /g,'')));
        if(!t)return;
        const set=(k,xls,isNum)=>{const v=String(r[xls]||'').trim();if(v){if(isNum)t[k]=parseInt(v.replace(/[^\d]/g,''))||null;else t[k]=v;updated++}};
        set('listingPrice','매도희망가',true);set('contractPrice','계약가',true);
        set('buyer','매수자');set('buyerContact','매수자 연락처');
        set('broker','중개인');set('brokerContact','중개인 연락처');
        set('saleStatus','진행상태');set('priority','우선순위');
        set('listingDate','매물등록일');set('contractDate','계약일');set('paymentDate','잔금일');set('completionDate','완료일');
        set('note','비고');
      });
      flashSync('dirty');saveData();rerenderAll();
      toast(`${updated}개 항목 갱신됨`,'ok');
    }catch(err){toast('엑셀 읽기 실패: '+err.message,'err')}
  };
  r.readAsArrayBuffer(f);e.target.value='';
});
document.getElementById('scanFile').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{document.getElementById('scanImg').src=ev.target.result;document.getElementById('scanSection').style.display='block';document.getElementById('scanSection').scrollIntoView({behavior:'smooth'})};
  r.readAsDataURL(f);e.target.value='';
});
document.getElementById('btnScanClose').addEventListener('click',()=>{document.getElementById('scanSection').style.display='none'});

function bindFilters(){
  ['filterStatus','filterOwner','filterRoad','filterText'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el)return;
    el.addEventListener(el.tagName==='SELECT'?'change':'input',renderSummary);
  });
}

function rerenderAll(){renderDash();renderSummary();renderScenario();renderRoad();renderOwner();renderStatus();renderChecklist();calcTax()}

// 백업/복원
document.getElementById('btnExport').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify(DATA,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=FILE_NAME;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  toast('다운로드 완료','ok');
});
document.getElementById('btnImport').addEventListener('click',()=>document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{const p=JSON.parse(ev.target.result);if(!p.parcels)throw new Error('형식 오류');
      if(!confirm('덮어쓰시겠습니까?'))return;
      DATA=p;saveData(true);rerenderAll();toast('가져오기 완료','ok');
    }catch(err){toast('실패: '+err.message,'err')}
  };r.readAsText(f,'utf-8');e.target.value='';
});
document.getElementById('btnReset').addEventListener('click',()=>{
  if(!confirm('초기 데이터(엑셀 v1)로 복원합니다. 계속할까요?'))return;
  DATA=deepClone(window.INITIAL_DATA);saveData(true);rerenderAll();renderTaxInit();toast('복원 완료','ok');
});

// ============ GitHub Gist ============
function getSyncConfig(){try{return JSON.parse(localStorage.getItem(SYNC_KEY)||'{}')}catch{return{}}}
function setSyncConfig(c){localStorage.setItem(SYNC_KEY,JSON.stringify(c))}
function encodeSyncCode(t,g){return'wolsanSync:'+btoa(unescape(encodeURIComponent(t+':'+g)))}
function decodeSyncCode(c){if(!c)return null;const m=String(c).trim().match(/^(?:wolsanSync|dkbiSync|ledgerSync|realestateSync):(.+)$/);if(!m)return null;try{const r=decodeURIComponent(escape(atob(m[1])));const i=r.indexOf(':');return i<0?null:{token:r.slice(0,i),gistId:r.slice(i+1)}}catch{return null}}
async function ghFetch(u,o,t){o=o||{};o.headers=Object.assign({'Accept':'application/vnd.github+json','Authorization':'token '+t},o.headers||{});const r=await fetch(u,o);if(!r.ok){let m=r.status+' '+r.statusText;try{const j=await r.json();if(j.message)m+=' — '+j.message}catch{};throw new Error(m)}return r.json()}
async function createGist(t,d){return ghFetch('https://api.github.com/gists',{method:'POST',body:JSON.stringify({description:'월산리 토지 매각 자동 동기화 v2 (private)',public:false,files:{[GIST_FILENAME]:{content:JSON.stringify(d,null,2)}}})},t)}
async function readGist(t,g){const j=await ghFetch('https://api.github.com/gists/'+encodeURIComponent(g),{},t);const f=j.files&&j.files[GIST_FILENAME];if(!f)throw new Error('파일 없음');let c=f.content;if(f.truncated&&f.raw_url){const r=await fetch(f.raw_url);c=await r.text()}return JSON.parse(c)}
async function updateGist(t,g,d){return ghFetch('https://api.github.com/gists/'+encodeURIComponent(g),{method:'PATCH',body:JSON.stringify({files:{[GIST_FILENAME]:{content:JSON.stringify(d,null,2)}}})},t)}
function setSyncBadge(s){const b=document.getElementById('syncStateBadge');if(!b)return;b.classList.remove('off','on','syncing');if(s==='on'){b.classList.add('on');b.textContent='ON'}else if(s==='syncing'){b.classList.add('syncing');b.textContent='SYNCING'}else{b.classList.add('off');b.textContent='OFF'}}
function setSyncStatusText(s){const e=document.getElementById('syncStatusText');if(e)e.textContent=s}
function setSyncLastTime(d){const e=document.getElementById('syncLastTime');if(!e)return;if(!d){e.textContent='-';return}const di=Date.now()-new Date(d).getTime();if(di<10000)e.textContent='방금 전';else if(di<60000)e.textContent=Math.floor(di/1000)+'초 전';else if(di<3600000)e.textContent=Math.floor(di/60000)+'분 전';else e.textContent=new Date(d).toLocaleString('ko-KR')}
function refreshSyncUI(){const c=getSyncConfig();const s1=document.getElementById('syncStep1'),s2=document.getElementById('syncStep2');if(c.enabled&&c.token&&c.gistId){s1.style.display='none';s2.style.display='block';document.getElementById('syncGistId').textContent=c.gistId.slice(0,8)+'...'+c.gistId.slice(-4);document.getElementById('syncCodeOut').value=encodeSyncCode(c.token,c.gistId);setSyncBadge('on');setSyncLastTime(c.lastSync);flashSync('cloud')}else{s1.style.display='block';s2.style.display='none';setSyncBadge('off')}}
let pushTimer=null,pushInflight=false;
function schedulePush(){setSyncBadge('syncing');setSyncStatusText('업로드 대기 중…');clearTimeout(pushTimer);pushTimer=setTimeout(doPush,PUSH_DEBOUNCE_MS)}
async function doPush(){const c=getSyncConfig();if(!c.enabled||!c.token||!c.gistId)return;if(pushInflight){schedulePush();return}pushInflight=true;try{setSyncBadge('syncing');setSyncStatusText('업로드 중…');flashSync('syncing');await updateGist(c.token,c.gistId,DATA);c.lastSync=new Date().toISOString();setSyncConfig(c);setSyncBadge('on');setSyncStatusText('연결됨');setSyncLastTime(c.lastSync);flashSync('cloud')}catch(e){setSyncBadge('on');setSyncStatusText('실패: '+e.message);toast('업로드 실패: '+e.message,'err')}finally{pushInflight=false}}
let pullTimer=null,pullInflight=false;
async function doPull(silent){const c=getSyncConfig();if(!c.enabled||!c.token||!c.gistId)return;if(pullInflight)return;pullInflight=true;try{if(!silent){setSyncBadge('syncing');setSyncStatusText('확인 중…');flashSync('syncing')}const rem=await readGist(c.token,c.gistId);if(rem&&rem.updatedAt&&rem.updatedAt>(DATA.updatedAt||'')){DATA=rem;saveData(true,{fromRemote:true});rerenderAll();renderTaxInit();if(!silent)toast('변경사항 받음','ok')}c.lastSync=new Date().toISOString();setSyncConfig(c);setSyncBadge('on');setSyncStatusText('연결됨');setSyncLastTime(c.lastSync);flashSync('cloud')}catch(e){setSyncBadge('on');setSyncStatusText('실패: '+e.message);if(!silent)toast('확인 실패: '+e.message,'err')}finally{pullInflight=false}}
function startPullLoop(){clearInterval(pullTimer);pullTimer=setInterval(()=>doPull(true),PULL_INTERVAL_MS)}
function stopPullLoop(){clearInterval(pullTimer);pullTimer=null}
window.addEventListener('focus',()=>{const c=getSyncConfig();if(c.enabled)doPull(true)});
document.getElementById('btnSyncStart').addEventListener('click',async()=>{
  const t=document.getElementById('ghToken').value.trim();const c=document.getElementById('ghSyncCode').value.trim();
  const btn=document.getElementById('btnSyncStart');btn.disabled=true;btn.textContent='연결 중…';
  try{let token,gistId;
    if(c){const d=decodeSyncCode(c);if(!d)throw new Error('형식 오류');token=d.token;gistId=d.gistId;const rem=await readGist(token,gistId);if(rem&&rem.updatedAt&&rem.updatedAt>(DATA.updatedAt||'')){DATA=rem;saveData(true,{fromRemote:true});rerenderAll();renderTaxInit()}}
    else if(t){if(!/^gh[ps]_/.test(t)&&!/^github_pat_/.test(t)){if(!confirm('토큰 형식 비일반. 계속?')){btn.disabled=false;btn.textContent='☁️ 동기화 시작';return}}token=t;const g=await createGist(token,DATA);gistId=g.id}
    else throw new Error('토큰 또는 코드 필요');
    setSyncConfig({enabled:true,token,gistId,lastSync:new Date().toISOString()});
    refreshSyncUI();startPullLoop();toast('동기화 시작됨','ok');
    document.getElementById('ghToken').value='';document.getElementById('ghSyncCode').value='';
  }catch(e){toast('실패: '+e.message,'err')}finally{btn.disabled=false;btn.textContent='☁️ 동기화 시작'}
});
document.getElementById('btnSyncStop').addEventListener('click',()=>{if(!confirm('끄시겠습니까?'))return;setSyncConfig({});stopPullLoop();clearTimeout(pushTimer);refreshSyncUI();flashSync('saved');toast('동기화 꺼짐')});
document.getElementById('btnSyncNow').addEventListener('click',async()=>{await doPush();await doPull()});
document.getElementById('btnCopyCode').addEventListener('click',async()=>{const c=document.getElementById('syncCodeOut').value;try{await navigator.clipboard.writeText(c);toast('복사 완료','ok')}catch{document.getElementById('syncCodeOut').select();document.execCommand('copy');toast('복사 완료','ok')}});
(function bootSync(){const c=getSyncConfig();refreshSyncUI();if(c.enabled&&c.token&&c.gistId){doPull(true);startPullLoop()};setInterval(()=>{const x=getSyncConfig();if(x.enabled&&x.lastSync)setSyncLastTime(x.lastSync)},5000)})();

// 초기 부트
bindScenarioToggle();
bindFilters();
renderTaxInit();
rerenderAll();
if(!getSyncConfig().enabled) flashSync('saved');
