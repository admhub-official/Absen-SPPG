const CANONICAL_ORIGIN = 'https://hadirly.org';
const LEGACY_HOSTS = new Set(['absen-sppg.pages.dev']);
if (LEGACY_HOSTS.has(window.location.hostname.toLowerCase())) {
  const target = new URL(window.location.pathname + window.location.search + window.location.hash, CANONICAL_ORIGIN);
  window.location.replace(target.href);
  throw new Error('Redirecting to canonical domain');
}

import { createRouter } from './router.js';
import { createAppStore } from '../stores/app-store.js';
import { createFeatureRegistry } from './feature-registry.js';
import { renderAttendanceProgress, showAttendanceReceipt, renderCorrectionWorkspace, openCorrectionForm } from '../pages/attendance/attendance-experience.js';
import { renderReleaseOperationsPage } from '../pages/release/release-operations-page.js';
import { renderWorkforceOperationsPage } from '../pages/workforce/workforce-operations-page.js';
import { renderPlatformOperationsPage } from '../pages/platform/platform-operations-page.js';

const VERSION = globalThis.HADIRLY_RELEASE?.version;
const ASSETS = globalThis.HADIRLY_PWA_ASSETS;
if (!VERSION) throw new Error('Release version Hadirly belum dimuat.');
if (!ASSETS?.styles?.length || !ASSETS?.scripts?.length) throw new Error('PWA asset manifest Hadirly belum dimuat.');

const loadedAssets = new Map();
function canonicalPath(value) { return new URL(value, document.baseURI).pathname; }
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

  await Promise.all(ASSETS.styles.map((path) => loadStyle(`${path}?v=${VERSION}`)));

  const store = createAppStore({ route: window.location.hash.replace(/^#\/?/, '') || 'dashboard' });
  const router = createRouter({ onRoute: (route) => store.setState({ route }) });
  const features = createFeatureRegistry();
  const attendanceExperience = Object.freeze({ renderProgress: renderAttendanceProgress, showReceipt: showAttendanceReceipt, renderCorrections: renderCorrectionWorkspace, openCorrectionForm });
  const releaseOperations = Object.freeze({ render: renderReleaseOperationsPage });
  const workforceOperations = Object.freeze({ render: renderWorkforceOperationsPage });
  const platformOperations = Object.freeze({ render: renderPlatformOperationsPage });
  const app = Object.freeze({ store, router, features, attendanceExperience, releaseOperations, workforceOperations, platformOperations, version: VERSION });

  Object.assign(window, {
    AbsenApp: app,
    AbsenFeatures: features,
    AttendanceExperience: attendanceExperience,
    ReleaseOperations: releaseOperations,
    WorkforceOperations: workforceOperations,
    PlatformOperations: platformOperations
  });

  for (const path of ASSETS.scripts) await loadScript(`${path}?v=${VERSION}`);
  window.dispatchEvent(new CustomEvent('absen:app-ready', { detail: { version: VERSION, features: features.names() } }));
  return app;
}

bootstrapApp().catch((error) => {
  if (error?.message !== 'Redirecting to canonical domain') console.warn('Frontend modular gagal dimuat; aplikasi utama tetap aktif.', error);
});
