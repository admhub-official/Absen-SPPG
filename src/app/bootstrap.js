import { createRouter } from './router.js';
import { createAppStore } from '../stores/app-store.js';
import { createFeatureRegistry } from './feature-registry.js';
import { renderAttendanceProgress, showAttendanceReceipt, renderCorrectionWorkspace, openCorrectionForm } from '../pages/attendance/attendance-experience.js';
import { renderReleaseOperationsPage } from '../pages/release/release-operations-page.js';

const loadStyle=(href)=>{if(document.querySelector(`link[href="${href}"]`))return;const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);};
const loadScript=(src)=>new Promise((resolve,reject)=>{if(document.querySelector(`script[src="${src}"]`)){resolve();return;}const script=document.createElement('script');script.src=src;script.defer=true;script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});

export async function bootstrapApp(){
  loadStyle('./src/styles/app-system.css');
  loadStyle('./src/styles/feature-pages.css');
  loadStyle('./src/styles/attendance-experience.css');
  loadStyle('./security-operations-ui.css');
  const store=createAppStore({route:window.location.hash.replace(/^#\/?/,'')||'dashboard'});
  const router=createRouter({onRoute:(route)=>store.setState({route})});
  const features=createFeatureRegistry();
  const attendanceExperience=Object.freeze({renderProgress:renderAttendanceProgress,showReceipt:showAttendanceReceipt,renderCorrections:renderCorrectionWorkspace,openCorrectionForm});
  const releaseOperations=Object.freeze({render:renderReleaseOperationsPage});
  window.AbsenApp=Object.freeze({store,router,features,attendanceExperience,releaseOperations,version:'15.0.0'});
  window.AbsenFeatures=features;
  window.AttendanceExperience=attendanceExperience;
  window.ReleaseOperations=releaseOperations;
  await loadScript('./security-ops-client.js');
  await loadScript('./security-operations-ui.js');
  window.dispatchEvent(new CustomEvent('absen:app-ready',{detail:{version:'15.0.0',features:features.names()}}));
}

bootstrapApp().catch((error)=>console.warn('Modular frontend bootstrap gagal; legacy app tetap aktif.',error));
