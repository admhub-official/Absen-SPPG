(()=>{
  if(window.AbsenResponsiveTables)return;

  const MOBILE_QUERY='(max-width: 767px)';
  const TABLE_SELECTORS=[
    '.data-table-wrap',
    '.table-wrap',
    '.responsive-data-list',
    '[data-responsive-table]'
  ];
  const SCROLL_HINTS=['audit','log','rekap-global','comparison','security','import-preview'];
  const ACTION_HINTS=['aksi','action','tindakan','opsi'];
  const SELECT_HINTS=['pilih','select','checkbox'];
  const PRIMARY_HINTS=['nama','karyawan','pegawai','user','periode','pengaduan','kode'];
  const WIDE_HINTS=['catatan','keterangan','deskripsi','alamat','tanggapan'];
  const HIDDEN_HINTS=['id','uuid'];

  const normalize=value=>String(value||'').trim().toLowerCase();
  const isMobile=()=>window.matchMedia(MOBILE_QUERY).matches;

  function getWrapperTable(wrapper){
    if(wrapper.tagName==='TABLE')return wrapper;
    return wrapper.querySelector('table');
  }

  function headerText(cell){
    return normalize(cell?.textContent).replace(/\s+/g,' ');
  }

  function matchesAny(value,hints){
    return hints.some(hint=>value===hint||value.includes(hint));
  }

  function shouldStayScrollable(wrapper,table){
    if(wrapper.dataset.tableMode==='scroll'||wrapper.classList.contains('table-scroll-only'))return true;
    const source=normalize(`${wrapper.id} ${wrapper.className} ${table.id} ${table.className}`);
    return SCROLL_HINTS.some(hint=>source.includes(hint));
  }

  function markActions(cell){
    cell.dataset.cardActions='true';
    const actions=cell.querySelector('.table-row-actions')||cell;
    actions.classList.add('table-row-actions');
    const buttons=[...actions.querySelectorAll('button,a')].filter(node=>!node.hidden);
    if(buttons.length<=1)return;
    let trigger=actions.querySelector('.table-overflow-trigger');
    if(!trigger){
      trigger=document.createElement('button');
      trigger.type='button';
      trigger.className='table-overflow-trigger';
      trigger.setAttribute('aria-label','Buka pilihan tindakan');
      trigger.setAttribute('title','Pilihan tindakan');
      trigger.textContent='⋮';
      trigger.addEventListener('click',event=>{
        event.stopPropagation();
        const firstVisible=buttons.find(button=>button.offsetParent!==null&&!button.disabled);
        firstVisible?.focus();
      });
      const holder=document.createElement('span');
      holder.className='table-overflow-menu';
      holder.append(trigger);
      actions.append(holder);
    }
  }

  function classifyColumn(label,index,total){
    if(matchesAny(label,ACTION_HINTS)||index===total-1)return 'actions';
    if(matchesAny(label,SELECT_HINTS))return 'select';
    if(matchesAny(label,WIDE_HINTS))return 'wide';
    if(matchesAny(label,HIDDEN_HINTS))return 'hidden';
    if(matchesAny(label,PRIMARY_HINTS)||index===0)return 'primary';
    return 'normal';
  }

  function enhanceTable(wrapper){
    if(!wrapper||wrapper.dataset.responsiveEnhanced==='true')return;
    const table=getWrapperTable(wrapper);
    if(!table)return;

    wrapper.dataset.responsiveEnhanced='true';
    if(shouldStayScrollable(wrapper,table)){
      wrapper.dataset.tableMode='scroll';
      wrapper.classList.add('table-scroll-only');
      return;
    }

    wrapper.classList.add('mobile-card-table');
    const headers=[...table.querySelectorAll('thead th')];
    const labels=headers.map(headerText);
    const columnTypes=labels.map((label,index)=>classifyColumn(label,index,labels.length));

    table.querySelectorAll('tbody tr').forEach(row=>{
      [...row.children].forEach((cell,index)=>{
        const label=labels[index]||cell.dataset.label||'';
        if(!cell.dataset.label)cell.dataset.label=label;
        const type=columnTypes[index]||'normal';
        if(type==='primary')cell.dataset.cardPrimary='true';
        if(type==='wide')cell.dataset.cardWide='true';
        if(type==='hidden')cell.dataset.cardHidden='true';
        if(type==='select')cell.dataset.cardSelect='true';
        if(type==='actions')markActions(cell);
      });
    });
  }

  function apply(root=document){
    const wrappers=new Set();
    TABLE_SELECTORS.forEach(selector=>{
      root.querySelectorAll?.(selector).forEach(node=>wrappers.add(node));
      if(root.matches?.(selector))wrappers.add(root);
    });
    wrappers.forEach(enhanceTable);
  }

  let observer;
  let timer;
  function schedule(root=document){
    clearTimeout(timer);
    timer=setTimeout(()=>apply(root),70);
  }

  function init(){
    apply(document);
    observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        if(mutation.addedNodes.length){schedule(document);break;}
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',()=>schedule(document));
    window.addEventListener('absen:app-ready',()=>schedule(document));
    window.matchMedia(MOBILE_QUERY).addEventListener?.('change',()=>schedule(document));
  }

  window.AbsenResponsiveTables=Object.freeze({init,refresh:()=>apply(document),isMobile});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
