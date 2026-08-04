(()=>{
  if(window.AbsenMobileUI)return;

  const SELECTORS={
    filters:['#users-filter-grid','#audit-filter-grid','#system-quality-grid','.filter-grid','.filters','.toolbar-filters','[data-filter-panel]'],
    kpis:['.kpi-grid','.stats-grid','.dashboard-kpi-grid','.summary-grid','[data-kpi-grid]'],
    tables:['.responsive-data-list','.data-table-wrap','.table-wrap','.responsive-table'],
    tabs:['.feature-tabs','.app-tabs','[role="tablist"]'],
    dialogs:['.modal','.dialog','[role="dialog"]']
  };

  const unique=(items)=>[...new Set(items.filter(Boolean))];
  const queryAll=(selectors,root=document)=>unique(selectors.flatMap(selector=>[...root.querySelectorAll(selector)]));
  const visible=(node)=>Boolean(node&&node.isConnected&&node.getClientRects().length);

  function activeFilterCount(container){
    return [...container.querySelectorAll('input,select')].reduce((count,control)=>{
      if(control.disabled||control.type==='hidden')return count;
      if(control.type==='checkbox'||control.type==='radio')return count+(control.checked?1:0);
      const value=String(control.value||'').trim();
      const ignored=['','all','semua','ALL','SEMUA'];
      return count+(ignored.includes(value)?0:1);
    },0);
  }

  function enhanceFilter(container){
    if(!container||container.dataset.mobileFilterEnhanced==='true'||container.closest('.mobile-filter-panel'))return;
    const controls=[...container.querySelectorAll('input,select,button')].filter(visible);
    if(controls.length<2)return;
    const panel=document.createElement('details');
    panel.className='mobile-filter-panel';
    panel.dataset.mobileFilterGenerated='true';
    const summary=document.createElement('summary');
    const title=document.createElement('span');
    title.textContent=container.getAttribute('aria-label')||'Filter';
    const count=document.createElement('span');
    count.className='mobile-filter-panel__count';
    const refresh=()=>{const total=activeFilterCount(container);count.textContent=String(total);count.hidden=total===0;};
    summary.append(title,count);
    const body=document.createElement('div');
    body.className='mobile-filter-panel__body';
    container.parentNode?.insertBefore(panel,container);
    panel.append(summary,body);
    body.append(container);
    container.dataset.mobileFilterEnhanced='true';
    container.addEventListener('input',refresh);
    container.addEventListener('change',refresh);
    refresh();
  }

  function labelTableCells(root){
    root.querySelectorAll('table').forEach(table=>{
      const labels=[...table.querySelectorAll('thead th')].map(cell=>cell.textContent?.trim()||'');
      table.querySelectorAll('tbody tr').forEach(row=>{
        [...row.children].forEach((cell,index)=>{if(!cell.dataset.label)cell.dataset.label=labels[index]||`Kolom ${index+1}`;});
      });
    });
  }

  function enhanceLayout(root=document){
    if(matchMedia('(max-width: 767px)').matches){
      queryAll(SELECTORS.filters,root).forEach(enhanceFilter);
      queryAll(SELECTORS.kpis,root).forEach(node=>node.classList.add('mobile-kpi-strip'));
      queryAll(SELECTORS.tables,root).forEach(node=>{node.classList.add('mobile-card-list');labelTableCells(node);});
      queryAll(SELECTORS.tabs,root).forEach(node=>node.classList.add('mobile-tab-strip'));
      queryAll(SELECTORS.dialogs,root).forEach(node=>node.classList.add('mobile-bottom-sheet'));
    }
  }

  let scheduled=false;
  function schedule(root=document){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;enhanceLayout(root);});
  }

  const observer=new MutationObserver(records=>{
    const roots=records.flatMap(record=>[...record.addedNodes]).filter(node=>node.nodeType===Node.ELEMENT_NODE);
    if(roots.length)schedule(document);
  });

  function init(){
    enhanceLayout();
    observer.observe(document.body,{childList:true,subtree:true});
    addEventListener('resize',()=>schedule(),{passive:true});
    addEventListener('orientationchange',()=>schedule(),{passive:true});
  }

  window.AbsenMobileUI=Object.freeze({init,refresh:()=>enhanceLayout()});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
