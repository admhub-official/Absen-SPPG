(()=>{
  if(window.AbsenPWA)return;
  const VERSION='24.0.0';
  const api=Object.freeze({
    version:VERSION,
    online:()=>navigator.onLine,
    async register(){
      if(!('serviceWorker' in navigator))return{supported:false};
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
      return{supported:true,registration};
    },
    notifyUpdate(registration){
      registration?.addEventListener?.('updatefound',()=>{
        window.dispatchEvent(new CustomEvent('absen:pwa-update-available'));
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
