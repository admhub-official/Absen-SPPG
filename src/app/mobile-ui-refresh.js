(()=>{
  if(window.AbsenMobileUI)return;

  const MOBILE_QUERY='(max-width: 767px)';
  const FILTER_IDS=['users-filter-grid','audit-filter-grid','absen-filter-grid'];
  const KPI_SELECTORS=['.kpi-grid','.dashboard-kpi-grid','[data-mobile-kpi-strip]'];
  const TABLE_SELECTORS=['.responsive-data-list[data-mobile-card-list]','[data-mobile-card-list]'];
  const TAB_SELECTORS=['.feature-tabs','.app-tabs','[data-mobile-tab-strip]'];

  const isMobile=()=>window.matchMedia(MOBILE_QUERY).matches;
  const unique=(items)=>[...new Set(items.filter(Boolean))];

  function activeFilterCount(container){
    return [...container.querySelectorAll('input,select')].reduce((count,control)=>{
      if(control.disabled||control.type==='hidden')return count;
      if(control.type==='checkbox'||control.type==='radio')return count+(control.checked?1:0);
      const value=String(control.value||'').trim().toLowerCase();
      return count+(['','all','semua'].includes(value)?0:1);
    },0);
  }

  function enhanceKnownFilter(container){
    if(!container||container.dataset.mobileFilterEnhanced==='true')return;
    if(container.closest('details.feature-filter,details.mobile-filter-panel'))return;
    if(!container.querySelector('input,select'))return;

    const panel=document.createElement('details');
    panel.className='mobile-filter-panel';
    panel.dataset.mobileFilterGenerated='true';

    const summary=document.createElement('summary');
    const label=document.createElement('span');
    label.textContent=container.getAttribute('aria-label')||'Filter';
    const count=document.createElement('span');
    count.className='mobile-filter-panel__count';
    summary.append(label,count);

    const body=document.createElement('div');
    body.className='mobile-filter-panel__body';
    container.parentNode?.insertBefore(panel,container);
    panel.append(summary,body);
    body.append(container);
    container.dataset.mobileFilterEnhanced='true';

    const refresh=()=>{
      const total=activeFilterCount(container);
      count.textContent=String(total);
      count.hidden=total===0;
    };
    container.addEventListener('input',refresh);
    container.addEventListener('change',refresh);
    refresh();
  }

  function labelVerifiedTables(root=document){
    root.querySelectorAll(TABLE_SELECTORS.join(',')).forEach(wrapper=>{
      wrapper.classList.add('mobile-card-list');
      wrapper.querySelectorAll('table').forEach(table=>{
        const labels=[...table.querySelectorAll('thead th')].map(cell=>cell.textContent?.trim()||'');
        table.querySelectorAll('tbody tr').forEach(row=>{
          [...row.children].forEach((cell,index)=>{
            if(!cell.dataset.label)cell.dataset.label=labels[index]||'';
          });
        });
      });
    });
  }

  function apply(root=document){
    document.documentElement.classList.toggle('mobile-ui-active',isMobile());
    if(!isMobile())return;

    FILTER_IDS.map(id=>document.getElementById(id)).filter(Boolean).forEach(enhanceKnownFilter);
    unique(KPI_SELECTORS.flatMap(selector=>[...root.querySelectorAll(selector)]))
      .forEach(node=>node.classList.add('mobile-kpi-strip'));
    unique(TAB_SELECTORS.flatMap(selector=>[...root.querySelectorAll(selector)]))
      .forEach(node=>node.classList.add('mobile-tab-strip'));
    labelVerifiedTables(root);
  }

  let resizeTimer;
  function schedule(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(()=>apply(document),80);
  }

  function init(){
    apply(document);
    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('orientationchange',schedule,{passive:true});
    window.addEventListener('absen:app-ready',()=>apply(document));
    window.addEventListener('hashchange',()=>setTimeout(()=>apply(document),0));
    [120,400,1000].forEach(delay=>setTimeout(()=>apply(document),delay));
  }

  window.AbsenMobileUI=Object.freeze({init,refresh:()=>apply(document)});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
