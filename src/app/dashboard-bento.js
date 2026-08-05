(()=>{
  if(window.AbsenDashboardBento)return;

  const PLACEHOLDER_PATTERNS=[
    /^memuat/i,
    /^tidak ada/i,
    /^belum ada/i,
    /^semua aman/i,
    /^tidak ditemukan/i
  ];

  function hasActionableContent(card){
    const list=card?.querySelector('#dashboard-notification-list');
    if(!list)return false;
    const actionable=list.querySelector('[data-notification-id],button,a,.notification-item,.announcement-item,.alert-item');
    if(actionable)return true;
    const text=(list.textContent||'').replace(/\s+/g,' ').trim();
    if(!text)return false;
    return !PLACEHOLDER_PATTERNS.some(pattern=>pattern.test(text));
  }

  function refresh(){
    const card=document.getElementById('dashboard-notification-card');
    if(!card)return;
    const empty=!hasActionableContent(card);
    card.classList.toggle('dashboard-card-empty',empty);
    card.setAttribute('aria-hidden',empty?'true':'false');
  }

  function observe(){
    const list=document.getElementById('dashboard-notification-list');
    if(!list)return;
    const observer=new MutationObserver(refresh);
    observer.observe(list,{childList:true,subtree:true,characterData:true,attributes:true});
    refresh();
  }

  function init(){
    observe();
    window.addEventListener('hashchange',()=>setTimeout(refresh,0));
    window.addEventListener('absen:app-ready',()=>setTimeout(refresh,0));
    [150,500,1200].forEach(delay=>setTimeout(refresh,delay));
  }

  window.AbsenDashboardBento=Object.freeze({init,refresh});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})();
