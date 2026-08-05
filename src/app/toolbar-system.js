(()=>{
  if(window.AbsenToolbarSystem)return;

  const TOOLBAR_SELECTORS=['.feature-toolbar','.page-toolbar','.admin-card-header','.action-bar'];
  const ACTION_HINTS=['tambah','buat','simpan','terbitkan','kirim','approve','setujui'];
  const FILTER_HINTS=['filter','cari','search','bulan','tanggal','status','role','sppg','periode'];
  const ICON_LABELS=[
    ['download','Unduh data'],['export','Ekspor data'],['print','Cetak data'],['search','Cari'],
    ['filter','Buka filter'],['refresh','Muat ulang'],['add','Tambah data'],['plus','Tambah data'],
    ['more','Tindakan lainnya'],['menu','Buka menu'],['close','Tutup'],['delete','Hapus'],['edit','Edit']
  ];

  const textOf=node=>String(node?.textContent||node?.getAttribute?.('title')||'').trim().toLowerCase();

  function inferLabel(button){
    const current=button.getAttribute('aria-label')||button.getAttribute('title');
    if(current)return current;
    const haystack=[button.id,button.className,button.dataset?.action,button.dataset?.tooltip,textOf(button)].filter(Boolean).join(' ').toLowerCase();
    const match=ICON_LABELS.find(([needle])=>haystack.includes(needle));
    return match?.[1]||'Tindakan';
  }

  function enhanceButton(button){
    if(!(button instanceof HTMLElement))return;
    if(!button.getAttribute('aria-label')&&!textOf(button))button.setAttribute('aria-label',inferLabel(button));
    if(button.querySelector('svg')&&!textOf(button))button.classList.add('icon-button','toolbar-icon-only');
    if(button.classList.contains('btn-primary'))button.dataset.toolbarPrimary='true';
  }

  function categorize(toolbar){
    if(toolbar.dataset.toolbarEnhanced==='true')return;
    toolbar.dataset.toolbarEnhanced='true';
    toolbar.classList.add('toolbar-system');

    const direct=[...toolbar.children];
    const heading=direct.find(node=>node.querySelector?.('.page-title,.admin-card-title,h1,h2,h3'));
    if(heading)heading.classList.add('toolbar-heading');

    const controls=direct.filter(node=>node!==heading);
    const filterNodes=[];
    const actionNodes=[];
    controls.forEach(node=>{
      const text=textOf(node);
      const isForm=node.matches?.('input,select,.form-input,.admin-search')||node.querySelector?.('input,select,.admin-search');
      const isFilter=isForm||FILTER_HINTS.some(hint=>text.includes(hint));
      const isAction=node.matches?.('button,.btn,a')||node.querySelector?.('button,.btn,a');
      if(isFilter&&!ACTION_HINTS.some(hint=>text.includes(hint)))filterNodes.push(node);
      else if(isAction)actionNodes.push(node);
    });

    if(filterNodes.length){
      const wrapper=document.createElement('div');
      wrapper.className='toolbar-filters';
      filterNodes[0].before(wrapper);
      filterNodes.forEach(node=>wrapper.append(node));
    }
    if(actionNodes.length){
      const wrapper=document.createElement('div');
      wrapper.className='toolbar-actions';
      actionNodes[0].before(wrapper);
      actionNodes.forEach(node=>wrapper.append(node));
    }
    toolbar.querySelectorAll('button,.btn,[role="button"]').forEach(enhanceButton);
  }

  function apply(root=document){
    root.querySelectorAll(TOOLBAR_SELECTORS.join(',')).forEach(categorize);
  }

  let timer;
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>apply(document),40)};

  function init(){
    apply(document);
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{subtree:true,childList:true});
    window.addEventListener('hashchange',schedule);
    window.addEventListener('absen:app-ready',schedule);
  }

  window.AbsenToolbarSystem=Object.freeze({init,refresh:()=>apply(document)});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
