const FILTER_TEXTS=['Semua kondisi','Semua role','Semua SPPG','Semua divisi','Semua akun'];
const textOf=(node)=>String(node?.textContent||'').replace(/\s+/g,' ').trim();
const visible=(node)=>!!(node&&node.getClientRects().length);
const findHeading=(pattern)=>[...document.querySelectorAll('h1,h2,h3,h4')].find((node)=>visible(node)&&pattern.test(textOf(node)));

function compactUserFilters(){
  const heading=findHeading(/Data Users/i);
  if(!heading)return;
  const scope=heading.closest('section,.page,.view,main')||document;
  const selects=[...scope.querySelectorAll('select')].filter((select)=>FILTER_TEXTS.some((label)=>[...select.options].some((option)=>textOf(option)===label)));
  if(selects.length<2||selects.some((select)=>select.closest('.compact-filter-panel')))return;
  const wrappers=selects.map((select)=>select.closest('.form-group,.filter-field,.input-group')||select.parentElement).filter(Boolean);
  const host=wrappers[0]?.parentElement;
  if(!host)return;
  const panel=document.createElement('div');
  panel.className='compact-filter-panel';
  panel.id='compact-user-filters';
  const toggle=document.createElement('button');
  toggle.type='button';
  toggle.className='compact-filter-toggle';
  toggle.setAttribute('aria-expanded','false');
  toggle.setAttribute('aria-controls',panel.id);
  toggle.innerHTML='<span>Filter pengguna</span><span aria-hidden="true">⌄</span>';
  host.insertBefore(toggle,wrappers[0]);
  host.insertBefore(panel,toggle.nextSibling);
  wrappers.forEach((wrapper)=>panel.appendChild(wrapper));
  toggle.addEventListener('click',()=>{
    const open=panel.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded',String(open));
    toggle.lastElementChild.textContent=open?'⌃':'⌄';
  });
}

function compactPayroll(){
  const heading=findHeading(/Payroll\s*&\s*Slip Gaji/i);
  if(!heading)return;
  const scope=heading.closest('section,.page,.view,main')||document;
  [...scope.querySelectorAll('div,section')].forEach((node)=>{
    const text=textOf(node);
    if(text.includes('Tentukan periode')&&text.includes('Pilih karyawan')&&text.includes('Finalisasi slip')&&node.children.length<=8)node.classList.add('compact-payroll-steps');
    if(text.includes('Karyawan Aktif')&&text.includes('Data Gaji Siap')&&text.includes('Data Belum Lengkap')&&node.children.length<=8)node.classList.add('compact-payroll-kpis');
  });
}

function compactSppgComparison(){
  const heading=findHeading(/Perbandingan SPPG/i);
  if(!heading)return;
  const card=heading.closest('.card,.panel,section')||heading.parentElement?.parentElement;
  card?.classList.add('compact-sppg-comparison');
}

function compactGenericLayouts(){
  document.querySelectorAll('.kpi-grid,.stats-grid,.summary-grid,.dashboard-kpis').forEach((node)=>node.classList.add('compact-dashboard-grid'));
  document.querySelectorAll('.toolbar,.filter-toolbar,.table-toolbar,.search-toolbar').forEach((node)=>node.classList.add('compact-toolbar'));
}

function apply(){compactUserFilters();compactPayroll();compactSppgComparison();compactGenericLayouts();}

let queued=false;
const schedule=()=>{
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{queued=false;apply();});
};

let observer=null;
function observeDynamicContent(){
  if(observer)return;
  const root=document.querySelector('#app-layout .app-content')||document.querySelector('#app-layout');
  if(!root)return;
  observer=new MutationObserver((mutations)=>{
    const hasAddedElements=mutations.some((mutation)=>[...mutation.addedNodes].some((node)=>node.nodeType===Node.ELEMENT_NODE));
    if(hasAddedElements)schedule();
  });
  observer.observe(root,{childList:true,subtree:true});
}

function init(){schedule();observeDynamicContent();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.addEventListener('hashchange',schedule);
window.addEventListener('absen:app-ready',()=>{observeDynamicContent();schedule();});
