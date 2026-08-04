const FILTER_TEXTS=['Semua kondisi','Semua role','Semua SPPG','Semua divisi','Semua akun'];

function textOf(node){return String(node?.textContent||'').trim();}
function isVisible(node){return !!(node&&node.getClientRects().length);}

function compactUserFilters(){
  const heading=[...document.querySelectorAll('h1,h2,h3')].find(node=>/Data Users/i.test(textOf(node))&&isVisible(node));
  if(!heading)return;
  const scope=heading.closest('section,.page,.view,main')||document;
  const selects=[...scope.querySelectorAll('select')].filter(select=>FILTER_TEXTS.some(label=>[...select.options].some(option=>textOf(option)===label)));
  if(selects.length<2||selects.some(select=>select.closest('.compact-filter-panel')))return;
  const first=selects[0];
  const common=first.parentElement?.parentElement;
  if(!common)return;
  const panel=document.createElement('div');panel.className='compact-filter-panel';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='compact-filter-toggle';toggle.setAttribute('aria-expanded','false');toggle.innerHTML='<span>Filter</span><span aria-hidden="true">⌄</span>';
  common.insertBefore(toggle,first.parentElement);
  common.insertBefore(panel,toggle.nextSibling);
  selects.forEach(select=>panel.appendChild(select.parentElement||select));
  toggle.addEventListener('click',()=>{const open=panel.classList.toggle('is-open');toggle.setAttribute('aria-expanded',String(open));toggle.lastElementChild.textContent=open?'⌃':'⌄';});
}

function compactGenericLayouts(){
  document.querySelectorAll('.kpi-grid,.stats-grid,.summary-grid,.dashboard-kpis').forEach(node=>node.classList.add('compact-dashboard-grid'));
  document.querySelectorAll('.toolbar,.filter-toolbar,.table-toolbar,.search-toolbar').forEach(node=>node.classList.add('compact-toolbar'));
  document.querySelectorAll('[data-tab-panel]').forEach(panel=>{if(!panel.classList.contains('active')&&!panel.hasAttribute('hidden'))panel.hidden=true;});
}

function apply(){compactUserFilters();compactGenericLayouts();}
let queued=false;
const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;apply();});};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
window.addEventListener('hashchange',schedule);
window.addEventListener('absen:app-ready',schedule);
