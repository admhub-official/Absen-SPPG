import { createRouter } from './router.js?v=23.1.0';
import { createAppStore } from '../stores/app-store.js?v=23.1.0';
import { createFeatureRegistry } from './feature-registry.js?v=23.1.0';
import { renderAttendanceProgress, showAttendanceReceipt, renderCorrectionWorkspace, openCorrectionForm } from '../pages/attendance/attendance-experience.js?v=23.1.0';
import { renderReleaseOperationsPage } from '../pages/release/release-operations-page.js?v=23.1.0';
import { renderWorkforceOperationsPage } from '../pages/workforce/workforce-operations-page.js?v=23.1.0';
import { renderPlatformOperationsPage } from '../pages/platform/platform-operations-page.js?v=23.1.0';

const VERSION='23.1.0';
const loadStyle=(href)=>{if(document.querySelector(`link[href="${href}"]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);};
const loadScript=(src)=>new Promise((resolve,reject)=>{if(document.querySelector(`script[src="${src}"]`)){resolve();return;}const script=document.createElement('script');script.src=src;script.defer=true;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});

export async function bootstrapApp(){
  loadStyle(`./src/styles/app-system.css?v=${VERSION}`);
  loadStyle(`./src/styles/feature-pages.css?v=${VERSION}`);
  loadStyle(`./src/styles/attendance-experience.css?v=${VERSION}`);
  loadStyle(`./security-operations-ui.css?v=${VERSION}`);
  loadStyle(`./src/styles/mobile-compact-hotfix.css?v=${VERSION}`);
  const store=createAppStore({route:window.location.hash.replace(/^#\/?/,'')||'dashboard'});
  const router=createRouter({onRoute:(route)=>store.setState({route})});
  const features=createFeatureRegistry();
  const attendanceExperience=Object.freeze({renderProgress:renderAttendanceProgress,showReceipt:showAttendanceReceipt,renderCorrections:renderCorrectionWorkspace,openCorrectionForm});
  const releaseOperations=Object.freeze({render:renderReleaseOperationsPage});
  const workforceOperations=Object.freeze({render:renderWorkforceOperationsPage});
  const platformOperations=Object.freeze({render:renderPlatformOperationsPage});
  window.AbsenApp=Object.freeze({store,router,features,attendanceExperience,releaseOperations,workforceOperations,platformOperations,version:VERSION});
  window.AbsenFeatures=features;
  window.AttendanceExperience=attendanceExperience;
  window.ReleaseOperations=releaseOperations;
  window.WorkforceOperations=workforceOperations;
  window.PlatformOperations=platformOperations;
  await loadScript(`./pwa-runtime.js?v=${VERSION}`);
  await loadScript(`./src/app/mobile-compact-hotfix.js?v=${VERSION}`);
  await loadScript(`./security-ops-client.js?v=${VERSION}`);
  await loadScript(`./security-operations-ui.js?v=${VERSION}`);
  window.dispatchEvent(new CustomEvent('absen:app-ready',{detail:{version:VERSION,features:features.names()}}));
}

bootstrapApp().catch((error)=>console.warn('Modular frontend gagal dimuat; aplikasi utama tetap aktif.',error));
