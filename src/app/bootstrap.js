import { createRouter } from './router.js?v=26.1.2';
import { createAppStore } from '../stores/app-store.js?v=26.1.2';
import { createFeatureRegistry } from './feature-registry.js?v=26.1.2';
import {
  renderAttendanceProgress,
  showAttendanceReceipt,
  renderCorrectionWorkspace,
  openCorrectionForm
} from '../pages/attendance/attendance-experience.js?v=26.1.2';
import { renderReleaseOperationsPage } from '../pages/release/release-operations-page.js?v=26.1.2';
import { renderWorkforceOperationsPage } from '../pages/workforce/workforce-operations-page.js?v=26.1.2';
import { renderPlatformOperationsPage } from '../pages/platform/platform-operations-page.js?v=26.1.2';

const VERSION = '26.1.2';
const loadedAssets = new Map();

function canonicalPath(value) {
  return new URL(value, document.baseURI).pathname;
}

function loadStyle(path) {
  const key = `style:${canonicalPath(path)}`;
  if (loadedAssets.has(key)) return loadedAssets.get(key);
  const existing = [...document.querySelectorAll('link[rel="stylesheet"][href]')]
    .find((node) => canonicalPath(node.href) === canonicalPath(path));
  if (existing) {
    const ready = Promise.resolve(existing);
    loadedAssets.set(key, ready);
    return ready;
  }
  const ready = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = path;
    link.onload = () => resolve(link);
    link.onerror = () => reject(new Error(`Gagal memuat stylesheet: ${path}`));
    document.head.appendChild(link);
  });
  loadedAssets.set(key, ready);
  return ready;
}

function loadScript(path) {
  const key = `script:${canonicalPath(path)}`;
  if (loadedAssets.has(key)) return loadedAssets.get(key);
  const existing = [...document.querySelectorAll('script[src]')]
    .find((node) => canonicalPath(node.src) === canonicalPath(path));
  if (existing) {
    const ready = Promise.resolve(existing);
    loadedAssets.set(key, ready);
    return ready;
  }
  const ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = path;
    script.defer = true;
    script.onload = () => resolve(script);
    script.onerror = () => reject(new Error(`Gagal memuat script: ${path}`));
    document.head.appendChild(script);
  });
  loadedAssets.set(key, ready);
  return ready;
}

export async function bootstrapApp() {
  if (window.AbsenApp) return window.AbsenApp;
  await Promise.all([
    loadStyle(`./src/styles/app-system.css?v=${VERSION}`),
    loadStyle(`./src/styles/feature-pages.css?v=${VERSION}`),
    loadStyle(`./src/styles/device-trust-policy.css?v=${VERSION}`),
    loadStyle(`./src/styles/attendance-experience.css?v=${VERSION}`),
    loadStyle(`./src/styles/attendance-import.css?v=${VERSION}`),
    loadStyle(`./src/styles/config-center.css?v=${VERSION}`),
    loadStyle(`./security-operations-ui.css?v=${VERSION}`),
    loadStyle(`./src/styles/responsive-overrides.css?v=${VERSION}`),
    loadStyle(`./src/styles/mobile-ui-refresh.css?v=${VERSION}`)
  ]);
  const store = createAppStore({ route: window.location.hash.replace(/^#\/?/, '') || 'dashboard' });
  const router = createRouter({ onRoute: (route) => store.setState({ route }) });
  const features = createFeatureRegistry();
  const attendanceExperience = Object.freeze({
    renderProgress: renderAttendanceProgress,
    showReceipt: showAttendanceReceipt,
    renderCorrections: renderCorrectionWorkspace,
    openCorrectionForm
  });
  const releaseOperations = Object.freeze({ render: renderReleaseOperationsPage });
  const workforceOperations = Object.freeze({ render: renderWorkforceOperationsPage });
  const platformOperations = Object.freeze({ render: renderPlatformOperationsPage });
  const app = Object.freeze({ store, router, features, attendanceExperience, releaseOperations, workforceOperations, platformOperations, version: VERSION });
  window.AbsenApp = app;
  window.AbsenFeatures = features;
  window.AttendanceExperience = attendanceExperience;
  window.ReleaseOperations = releaseOperations;
  window.WorkforceOperations = workforceOperations;
  window.PlatformOperations = platformOperations;
  await loadScript(`./pwa-runtime.js?v=${VERSION}`);
  await loadScript(`./src/app/layout-enhancements.js?v=${VERSION}`);
  await loadScript(`./src/app/mobile-ui-refresh.js?v=${VERSION}`);
  await loadScript(`./security-ops-client.js?v=${VERSION}`);
  await loadScript(`./security-operations-ui.js?v=${VERSION}`);
  await loadScript(`./src/app/attendance-import.js?v=${VERSION}`);
  await loadScript(`./src/app/attendance-import-search-fix.js?v=${VERSION}`);
  await loadScript(`./src/app/config-center.js?v=${VERSION}`);
  await loadScript(`./src/features/payroll/legacy-payroll-pagination.js?v=${VERSION}`);
  window.dispatchEvent(new CustomEvent('absen:app-ready', { detail: { version: VERSION, features: features.names() } }));
  return app;
}

bootstrapApp().catch((error) => {
  console.warn('Frontend modular gagal dimuat; aplikasi utama tetap aktif.', error);
});