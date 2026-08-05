(()=>{
  if(window.AbsenComplaintsActivity)return;

  const COMPLAINT_ROOTS=[
    '#view-complaint','#view-complaints','#view-pengaduan','#view-my-complaints',
    '#view-admin-complaints','#view-complaint-inbox','#view-inbox-pengaduan',
    '[data-complaints-page]','[data-complaint-inbox]'
  ];
  const ACTIVITY_ROOTS=[
    '#view-activity','#view-activities','#view-aktivitas','#view-my-activity',
    '[data-activity-page]'
  ];

  const normalize=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();

  function complaintState(text){
    const value=normalize(text);
    if(value.includes('mendesak')||value.includes('urgent'))return'urgent';
    if(value.includes('ditutup')||value.includes('selesai'))return'closed';
    if(value.includes('ditanggapi')||value.includes('dibalas')||value.includes('tanggapan'))return'responded';
    if(value.includes('dibaca')||value.includes('sudah baca'))return'read';
    return'new';
  }

  function enhanceComplaintPage(page){
    page.classList.add('complaints-refresh-active');

    page.querySelectorAll('.complaint-card,.complaint-item,[data-complaint-id]').forEach(card=>{
      card.classList.add('complaint-card');
      const text=normalize(card.textContent);
      const unread=card.matches('.unread,[data-read="false"],[data-unread="true"]')||text.includes('belum dibaca');
      card.dataset.unread=String(unread);
      if(!card.getAttribute('tabindex')&&card.matches('[data-complaint-id]'))card.setAttribute('tabindex','0');
    });

    page.querySelectorAll('.badge,.status-badge,[data-complaint-status]').forEach(node=>{
      const text=node.textContent?.trim();
      if(!text||node.classList.contains('complaint-status-chip'))return;
      node.classList.add('complaint-status-chip');
      node.dataset.state=complaintState(text);
    });

    page.querySelectorAll('[data-anonymous],.anonymous-badge,.identity-badge,.complaint-identity').forEach(node=>{
      node.classList.add('identity-shield');
      const anonymous=node.matches('[data-anonymous="true"],.anonymous-badge')||normalize(node.textContent).includes('anonim');
      node.dataset.anonymous=String(anonymous);
      if(anonymous&&!node.getAttribute('aria-label'))node.setAttribute('aria-label','Identitas pelapor disembunyikan sesuai hak akses');
    });

    page.querySelectorAll('.complaint-modal,.complaint-detail-modal').forEach(modal=>{
      modal.setAttribute('role','dialog');
      modal.setAttribute('aria-modal','true');
    });

    page.querySelectorAll('.response-item,.complaint-response,.reply-item').forEach(item=>{
      item.classList.add('response-item');
      const fromAdmin=item.matches('.admin-response,[data-role="ADMIN"],[data-role="SUPER ADMIN"],[data-from="admin"]');
      if(fromAdmin)item.dataset.from='admin';
    });

    page.querySelectorAll('textarea').forEach(control=>{
      const context=normalize(control.getAttribute('placeholder')||control.name||control.id);
      if(context.includes('tanggap')||context.includes('balas')||context.includes('komentar')){
        const compose=control.closest('form,.form-group,.response-compose')||control.parentElement;
        compose?.classList.add('response-compose');
        if(!control.getAttribute('aria-label'))control.setAttribute('aria-label','Tanggapan pengaduan');
      }
    });
  }

  function enhanceActivityPage(page){
    page.classList.add('activity-refresh-active');
    const list=page.querySelector('.activity-list,.timeline,.activity-timeline,[data-activity-list]');
    list?.classList.add('activity-timeline');

    page.querySelectorAll('.activity-item,.timeline-item,[data-activity-id]').forEach(item=>{
      item.classList.add('activity-item');
      if(!item.querySelector('.activity-marker')){
        const marker=document.createElement('span');
        marker.className='activity-marker';
        marker.setAttribute('aria-hidden','true');
        marker.textContent='•';
        item.prepend(marker);
      }
    });
  }

  function enhance(root=document){
    COMPLAINT_ROOTS.flatMap(selector=>[...root.querySelectorAll(selector)]).forEach(enhanceComplaintPage);
    ACTIVITY_ROOTS.flatMap(selector=>[...root.querySelectorAll(selector)]).forEach(enhanceActivityPage);
  }

  let timer;
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>enhance(document),70);
  };

  function init(){
    enhance(document);
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',schedule);
    window.addEventListener('absen:app-ready',schedule);
  }

  window.AbsenComplaintsActivity=Object.freeze({init,refresh:()=>enhance(document)});
  document.readyState==='loading'
    ?document.addEventListener('DOMContentLoaded',init,{once:true})
    :init();
})();
