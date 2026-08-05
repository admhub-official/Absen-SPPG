(()=>{
  if(window.AbsenPWA)return;
  const VERSION='26.10.4';
  const api=Object.freeze({
    version:VERSION,
    online:()=>navigator.onLine,
    async register(){
      if(!('serviceWorker' in navigator))return{supported:false};
      const registration=await navigator.serviceWorker.register(`./sw.js?v=${VERSION}`,{
        scope:'./',
        updateViaCache:'none'
      });
      await registration.update().catch(()=>{});
      if(registration.waiting)registration.waiting.postMessage('SKIP_WAITING');
      return{supported:true,registration};
    },
    notifyUpdate(registration){
      registration?.addEventListener?.('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener?.('statechange',()=>{
          if(worker.state==='installed')worker.postMessage('SKIP_WAITING');
        });
        window.dispatchEvent(new CustomEvent('absen:pwa-update-available'));
      });
      navigator.serviceWorker?.addEventListener?.('controllerchange',()=>{
        const key=`absen-sw-reloaded:${VERSION}`;
        if(sessionStorage.getItem(key)==='1')return;
        sessionStorage.setItem(key,'1');
        location.reload();
      });
    }
  });
  window.AbsenPWA=api;
  window.addEventListener('load',()=>{
    api.register()
      .then(({registration})=>api.notifyUpdate(registration))
      .catch((error)=>console.warn('PWA registration failed',error));
  },{once:true});
})();