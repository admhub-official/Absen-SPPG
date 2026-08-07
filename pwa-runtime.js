(()=>{
  if(window.AbsenPWA)return;
  const VERSION=globalThis.HADIRLY_RELEASE?.version;
  if(!VERSION){console.warn('PWA release version belum dimuat.');return;}

  let pendingWorker=null;
  let deferredNoticeShown=false;

  function hasUnsavedChanges(){
    try{return Boolean(window.HadirlyUpdateSafety?.isDirty?.());}
    catch{return false;}
  }

  function announceUpdate(deferred=false){
    window.dispatchEvent(new CustomEvent('absen:pwa-update-available',{detail:{version:VERSION,deferred}}));
    if(deferred&&!deferredNoticeShown){
      deferredNoticeShown=true;
      window.showAlert?.('Versi baru Hadirly tersedia. Simpan atau selesaikan perubahan yang sedang dikerjakan; pembaruan akan diterapkan setelah aman.','info');
    }
  }

  function activateWhenSafe(worker){
    if(!worker)return false;
    pendingWorker=worker;
    if(hasUnsavedChanges()){
      announceUpdate(true);
      return false;
    }
    deferredNoticeShown=false;
    pendingWorker=null;
    worker.postMessage('SKIP_WAITING');
    return true;
  }

  const api=Object.freeze({
    version:VERSION,
    online:()=>navigator.onLine,
    hasPendingUpdate:()=>Boolean(pendingWorker),
    applyUpdate(){
      if(!pendingWorker)return false;
      return activateWhenSafe(pendingWorker);
    },
    async register(){
      if(!('serviceWorker' in navigator))return{supported:false};
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});
      await registration.update().catch(()=>{});
      if(registration.waiting)activateWhenSafe(registration.waiting);
      return{supported:true,registration};
    },
    notifyUpdate(registration){
      registration?.addEventListener?.('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener?.('statechange',()=>{
          if(worker.state==='installed')activateWhenSafe(worker);
        });
      });
      navigator.serviceWorker?.addEventListener?.('controllerchange',()=>{
        if(hasUnsavedChanges()){
          announceUpdate(true);
          window.dispatchEvent(new CustomEvent('absen:pwa-update-ready',{detail:{version:VERSION,deferred:true}}));
          return;
        }
        const key=`absen-sw-reloaded:${VERSION}`;
        if(sessionStorage.getItem(key)==='1')return;
        sessionStorage.setItem(key,'1');
        location.reload();
      });
    }
  });

  window.AbsenPWA=api;
  window.addEventListener('absen:pwa-safe-point',()=>{
    if(pendingWorker&&!hasUnsavedChanges())activateWhenSafe(pendingWorker);
  });
  window.addEventListener('absen:pwa-apply-update',()=>api.applyUpdate());
  window.addEventListener('load',()=>{
    api.register().then(({registration})=>api.notifyUpdate(registration)).catch((error)=>console.warn('PWA registration failed',error));
  },{once:true});
})();
