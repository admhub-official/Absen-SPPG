import { createRouter } from './router.js';
import { createAppStore } from '../stores/app-store.js';
import { createFeatureRegistry } from './feature-registry.js';

const loadStyle=(href)=>{if(document.querySelector(`link[href="${href}"]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);};
const loadScript=(src)=>new Promise((resolve,reject)=>{if(document.querySelector(`script[src="${src}"]`)){resolve();return;}const script=document.createElement('script');script.src=src;script.defer=true;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});

export async function bootstrapApp(){
  loadStyle('./src/styles/app-system.css');
  loadStyle('./src/styles/feature-pages.css');
  loadStyle('./security-operations-ui.css');
  const store=createAppStore({route:window.location.hash.replace(/^#\/?/,'')||'dashboard'});
  const router=createRouter({onRoute:(route)=>store.setState({route})});
  const features=createFeatureRegistry();
  window.AbsenApp=Object.freeze({store,router,features,version:'9.0.0'});
  window.AbsenFeatures=features;
  await loadScript('./security-ops-client.js');
  await loadScript('./security-operations-ui.js');
  window.dispatchEvent(new CustomEvent('absen:app-ready',{detail:{version:'9.0.0',features:features.names()}}));
}

bootstrapApp().catch((error)=>console.warn('Modular frontend bootstrap gagal; legacy app tetap aktif.',error));
