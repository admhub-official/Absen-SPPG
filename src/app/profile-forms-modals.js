(()=>{
  if(window.AbsenProfileFormsModals)return;

  const PROFILE_ROOTS=['#view-profile','#view-profil','[data-profile-page]'];

  function enhanceProfiles(root=document){
    PROFILE_ROOTS.flatMap(selector=>[...root.querySelectorAll(selector)]).forEach(page=>{
      page.classList.add('profile-refresh-active');
      page.querySelectorAll('.profile-section').forEach((section,index)=>{
        const header=section.querySelector('.profile-section-header');
        const body=section.querySelector('.profile-section-body');
        if(!header||!body)return;
        section.dataset.collapsible='true';
        if(!section.dataset.open)section.dataset.open=index===0?'true':'false';
        if(header.dataset.profileToggleBound)return;
        header.dataset.profileToggleBound='true';
        header.setAttribute('role','button');
        header.setAttribute('tabindex','0');
        header.setAttribute('aria-expanded',section.dataset.open);
        const toggle=()=>{
          const open=section.dataset.open!=='true';
          section.dataset.open=String(open);
          header.setAttribute('aria-expanded',String(open));
        };
        header.addEventListener('click',toggle);
        header.addEventListener('keydown',event=>{
          if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle();}
        });
      });
    });
  }

  function centerControlInModal(control){
    const body=control.closest('.modal-body');
    if(!body)return;
    const bodyRect=body.getBoundingClientRect();
    const controlRect=control.getBoundingClientRect();
    if(controlRect.top>=bodyRect.top+12&&controlRect.bottom<=bodyRect.bottom-12)return;
    const target=body.scrollTop+(controlRect.top-bodyRect.top)-(body.clientHeight-controlRect.height)/2;
    body.scrollTo({top:Math.max(0,target),behavior:'smooth'});
  }

  function enhanceModals(root=document){
    root.querySelectorAll('.modal-overlay').forEach(overlay=>{
      overlay.dataset.modalViewport='true';
      const modal=overlay.querySelector(':scope > .modal-card,:scope > .app-modal-card');
      if(!modal)return;
      if(!modal.getAttribute('role'))modal.setAttribute('role','dialog');
      modal.setAttribute('aria-modal','true');
      modal.setAttribute('tabindex','-1');
      const title=modal.querySelector('.modal-header h1,.modal-header h2,.modal-header h3');
      if(title&&!title.id)title.id=`modal-title-${Math.random().toString(36).slice(2,9)}`;
      if(title)modal.setAttribute('aria-labelledby',title.id);
      const body=modal.querySelector('.modal-body');
      if(body){
        body.dataset.modalScrollBody='true';
        body.setAttribute('tabindex','0');
      }
      modal.querySelectorAll('.modal-close,.btn-close,[data-modal-close]').forEach(button=>{
        if(!button.getAttribute('aria-label'))button.setAttribute('aria-label','Tutup dialog');
      });
    });

    root.querySelectorAll('.modal-body input,.modal-body select,.modal-body textarea').forEach(control=>{
      if(control.dataset.viewportAssist)return;
      control.dataset.viewportAssist='true';
      control.addEventListener('focus',()=>setTimeout(()=>centerControlInModal(control),140));
    });
  }

  let timer;
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{enhanceProfiles(document);enhanceModals(document);},80);
  };

  function init(){
    schedule();
    new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',schedule);
    window.addEventListener('resize',schedule,{passive:true});
    window.visualViewport?.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('absen:app-ready',schedule);
  }

  window.AbsenProfileFormsModals=Object.freeze({init,refresh:schedule});
  document.readyState==='loading'
    ?document.addEventListener('DOMContentLoaded',init,{once:true})
    :init();
})();
