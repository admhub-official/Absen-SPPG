from pathlib import Path
import re

R = Path('.')

def read(path): return (R / path).read_text(encoding='utf-8')
def write(path, text): (R / path).write_text(text, encoding='utf-8')
def one(text, old, new, label):
    n = text.count(old)
    if n != 1: raise SystemExit(f'{label}: expected 1, found {n}')
    return text.replace(old, new, 1)
def some(text, old, new, minimum, label):
    n = text.count(old)
    if n < minimum: raise SystemExit(f'{label}: expected >= {minimum}, found {n}')
    return text.replace(old, new)

index = read('index.html')
shell = read('src/legacy/index-shell.css')
tokens = read('src/styles/foundation/tokens.css')
components = read('src/styles/foundation/components.css')
mobile = read('src/styles/mobile-ui-refresh.css')
responsive = read('src/styles/responsive-overrides.css')
release = read('src/app/release-version.js')
deno = read('deno.json')

# Topbar + repeated inline layout styles.
index = one(index, '      <div style="flex:1"></div>\n', '', 'topbar spacer')
index, n = re.subn(r'(<div class="app-topbar-brand">\s*<img[^>]*>)\s*Presence SPPG\s*</div>', r'\1\n        <span>Presence SPPG</span>\n      </div>', index, count=1)
if n != 1: raise SystemExit('topbar brand text')
for old, new, label in [
    ('<div class="app-topbar-profile-wrap" style="position:relative">','<div class="app-topbar-profile-wrap">','topbar profile'),
    ('<div class="dash-card" id="dashboard-notification-card" style="margin-bottom:1.5rem">','<div class="dash-card section-card-gap" id="dashboard-notification-card">','notification spacing'),
    ('<div class="page-header" style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:0.75rem">','<div class="page-header page-header--split">','split header'),
    ('<div class="validation-tabs" role="tablist" aria-label="Pusat validasi absensi" style="margin-bottom:.85rem">','<div class="validation-tabs validation-tabs--spaced" role="tablist" aria-label="Pusat validasi absensi">','validation spacing'),
    ('<tr><td colspan="7" style="padding:0">','<tr><td colspan="7" class="table-cell-flush">','flush table cell'),
    ('<div class="user-filter-toolbar" style="padding:0 1rem 1rem">','<div class="user-filter-toolbar">','user filter padding'),
    ('<div style="margin-left:auto;display:flex;gap:.35rem"><button class="view-toggle active"','<div class="view-toggle-group"><button class="view-toggle active"','view toggle group'),
    ('<div style="padding:0 1rem">\n            <div class="payroll-selection-bar">','<div class="payroll-selection-shell">\n            <div class="payroll-selection-bar">','payroll selection shell'),
    ('<div class="feature-card"><div class="feature-toolbar" style="margin:0">','<div class="feature-card"><div class="feature-toolbar feature-toolbar--flush">','feature toolbar'),
    ('<div class="page-header" style="margin-bottom:1rem">','<div class="page-header page-header--compact">','compact page header'),
    ('<button class="btn" id="btn-admin-delete-user" style="background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5">','<button class="btn btn-danger-soft" id="btn-admin-delete-user">','delete user button'),
    ('<button class="btn btn-sm" style="background:var(--danger);color:#fff" type="button" data-attendance-action="DITOLAK">','<button class="btn btn-sm btn-danger" type="button" data-attendance-action="DITOLAK">','attendance reject'),
    ('<button class="btn" id="btn-risk-confirm" type="button" style="display:none;background:var(--danger);color:#fff">','<button class="btn btn-danger" id="btn-risk-confirm" type="button" style="display:none">','risk confirm'),
    ('<div style="display:flex;flex-direction:column;align-items:center;gap:0.75rem;margin-bottom:1.5rem">','<div class="profile-photo-editor">','photo editor'),
    ('<div class="profile-avatar" id="edit-profil-avatar" style="width:96px;height:96px;font-size:1.875rem;position:static">','<div class="profile-avatar profile-avatar--editor" id="edit-profil-avatar">','photo avatar'),
    ('<button type="button" class="btn btn-secondary" id="btn-ubah-foto-profil" style="font-size:0.8125rem;padding:0.5rem 1rem;display:inline-flex;align-items:center;gap:0.4rem">','<button type="button" class="btn btn-secondary btn-sm profile-photo-button" id="btn-ubah-foto-profil">','photo button'),
    ('<input type="file" id="input-foto-profil" accept="image/*" style="display:none">','<input type="file" id="input-foto-profil" class="profile-photo-input" accept="image/*">','photo input'),
]: index = one(index, old, new, label)
index = some(index, '<div class="dash-card" style="margin-bottom:1.5rem">', '<div class="dash-card section-card-gap">', 1, 'dashboard spacing')
index = some(index, 'class="form-group" style="margin:0"', 'class="form-group form-group--flush"', 2, 'flush form groups')
index = one(index, '<div style="display:flex;gap:.45rem;flex-wrap:wrap">\n              <button class="btn btn-sm btn-primary" type="button" data-attendance-action="VALID">', '<div class="attendance-selection-actions">\n              <button class="btn btn-sm btn-primary" type="button" data-attendance-action="VALID">', 'attendance actions')
for px, cls in [('620','modal-card--wide'),('520','modal-card--medium'),('500','modal-card--narrow'),('420','modal-card--compact'),('400','modal-card--face')]:
    index = index.replace(f'<div class="modal-card" style="max-width:{px}px">', f'<div class="modal-card {cls}">')
index = some(index, '<span style="color:var(--danger)">*</span>', '<span class="form-required">*</span>', 3, 'required markers')
index = some(index, '<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-top:.55rem">', '<div class="signature-panel-actions">', 3, 'signature actions')
index = index.replace('<div class="signature-legal" style="margin-top:1rem">','<div class="signature-legal signature-legal--spaced">').replace('<p class="helper-text" style="margin-top:.8rem">','<p class="helper-text helper-text--spaced">').replace('<div class="form-group" style="grid-column:1/-1">','<div class="form-group modal-grid-full">')
if index.count(' style="margin-right:0.35rem;vertical-align:-2px"') < 2: raise SystemExit('profile button icons')
index = index.replace(' style="margin-right:0.35rem;vertical-align:-2px"','')

# Foundation tokens and mobile shell geometry.
if '--ui-bottomnav-height:' not in tokens:
    tokens = one(tokens, '  --ui-danger-600: #dc2626;\n', '  --ui-danger-200: #fecaca;\n  --ui-danger-600: #dc2626;\n  --ui-danger-800: #991b1b;\n', 'danger tokens')
    tokens = one(tokens, '  --ui-content-max: 90rem;\n', '  --ui-content-max: 90rem;\n  --ui-bottomnav-height: 4.25rem;\n  --ui-bottomnav-clearance: 5.125rem;\n  --ui-bottomnav-scan-size: 3.25rem;\n  --ui-bottomnav-scan-lift: 1.625rem;\n', 'bottomnav tokens')

shell, n = re.subn(r'^:root\{[^\n]*\}', ':root{--primary:#4f46e5;--primary-dark:#4338ca;--primary-light:#eef2ff;--primary-ring:rgba(79,70,229,.18);--success:#059669;--danger:#dc2626;--warning:#f59e0b;--bg:#f8fafc;--surface:#fff;--text:#0f172a;--text-secondary:#475569;--text-muted:#64748b;--border:#e2e8f0;--radius:.625rem;--radius-lg:1rem;--shadow:0 1px 2px rgb(15 23 42/0.05);--shadow-lg:0 20px 45px rgb(15 23 42/0.16);--ui-bottomnav-height:4.25rem;--ui-bottomnav-clearance:5.125rem;--ui-bottomnav-scan-size:3.25rem;--ui-bottomnav-scan-lift:1.625rem}', shell, count=1, flags=re.M)
if n != 1: raise SystemExit('legacy root')
for old, new, label in [
    ('.app-topbar-brand{display:none}', '.app-topbar-brand{display:none;min-width:0}', 'topbar brand base'),
    ('.app-topbar-profile{display:flex;', '.app-topbar-profile-wrap{position:relative;flex-shrink:0}\n    .app-topbar-profile{display:flex;', 'profile wrap css'),
    ('.notification-wrap{position:relative;margin-left:auto;margin-right:.55rem}', '.notification-wrap{position:relative;margin-left:auto;margin-right:.55rem;flex-shrink:0}', 'notification css'),
    ('.app-topbar-brand{display:flex;align-items:center;gap:0.55rem;font-weight:700;font-size:0.9375rem;color:var(--text)}', '.app-topbar-brand{display:flex;align-items:center;gap:0.55rem;font-weight:700;font-size:0.9375rem;color:var(--text);max-width:calc(100vw - 124px)}\n      .app-topbar-brand span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}', 'mobile brand css'),
    ('.app-content{padding:1.25rem 1rem 5.5rem}', '.app-content{padding:1.25rem 1rem var(--ui-bottomnav-clearance)}', 'content clearance'),
    ('.app-bottomnav{display:flex;position:fixed;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--border);z-index:80;padding:0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom));overflow:visible}', '.app-bottomnav{display:flex;position:fixed;bottom:0;left:0;right:0;min-height:var(--ui-bottomnav-height);background:var(--surface);border-top:1px solid var(--border);z-index:80;padding:0.4rem 0.5rem calc(0.4rem + env(safe-area-inset-bottom));overflow:visible}', 'bottomnav css'),
    ('.app-bottomnav-item-scan svg{background:var(--primary);color:#fff;padding:12px;border-radius:50%;width:52px;height:52px;box-shadow:0 6px 16px -3px rgba(79,70,229,.6);margin-top:-26px;box-sizing:border-box;border:4px solid var(--surface)}', '.app-bottomnav-item-scan svg{background:var(--primary);color:#fff;padding:12px;border-radius:50%;width:var(--ui-bottomnav-scan-size);height:var(--ui-bottomnav-scan-size);box-shadow:0 6px 16px -3px rgba(79,70,229,.6);margin-top:calc(-1 * var(--ui-bottomnav-scan-lift));box-sizing:border-box;border:4px solid var(--surface)}', 'scan css'),
    ('.mobile-more-menu{position:fixed;right:0.75rem;bottom:calc(76px + env(safe-area-inset-bottom));', '.mobile-more-menu{position:fixed;right:0.75rem;bottom:calc(var(--ui-bottomnav-height) + .5rem + env(safe-area-inset-bottom));', 'more menu css'),
]: shell = one(shell, old, new, label)

# Reusable component variants in the design-system layer.
components = components.replace('.feature-card,\n.dash-card,\n.stat-card,\n.info-section,\n.modal-card,\n.complaint-card,\n.operational-card {', '.feature-card,\n.dash-card,\n.stat-card,\n.info-section,\n.modal-card,\n.complaint-card,\n.operational-card,\n.admin-card,\n.profile-card,\n.user-card,\n.config-stat,\n.facecam-page-card {')
components = components.replace('.badge,\n.badge-neutral,\n.badge-primary,\n.badge-count,\n.punch-chip {\n  line-height: 1;\n}', '.badge,\n.badge-neutral,\n.badge-primary,\n.badge-count,\n.punch-chip,\n.profile-role,\n.face-status-badge {\n  border-radius: var(--ui-radius-pill);\n  line-height: 1;\n}')
if '.btn-danger {' not in components:
    components += '''\n\n/* Shared semantic variants and layout utilities used by the legacy shell. */\n.btn-danger{background:var(--ui-danger-600);color:#fff;border:1px solid var(--ui-danger-600)}\n.btn-danger:hover{background:#b91c1c}\n.btn-danger-soft{background:var(--ui-danger-50);color:var(--ui-danger-800);border:1px solid var(--ui-danger-200)}\n.btn-danger-soft:hover{background:#fee2e2}\n.form-required{color:var(--ui-danger-600)}\n.section-card-gap{margin-bottom:var(--ui-space-6)}\n.page-header--split{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:var(--ui-space-3)}\n.page-header--compact{margin-bottom:var(--ui-space-4)}\n.validation-tabs--spaced{margin-bottom:var(--ui-space-3)}\n.table-cell-flush{padding:0!important}\n.attendance-selection-actions{display:flex;gap:var(--ui-space-2);flex-wrap:wrap}\n.user-filter-toolbar{padding:0 var(--ui-space-4) var(--ui-space-4)}\n.view-toggle-group{margin-left:auto;display:flex;gap:var(--ui-space-1)}\n.form-group--flush{margin:0}\n.payroll-selection-shell{padding-inline:var(--ui-space-4)}\n.feature-toolbar--flush{margin:0}\n.modal-card--face{max-width:25rem}.modal-card--compact{max-width:26.25rem}.modal-card--narrow{max-width:31.25rem}.modal-card--medium{max-width:32.5rem}.modal-card--wide{max-width:38.75rem}\n.modal-grid-full{grid-column:1/-1}\n.signature-panel-actions{display:flex;align-items:center;justify-content:space-between;gap:var(--ui-space-3);flex-wrap:wrap;margin-top:.55rem}\n.signature-legal--spaced{margin-top:var(--ui-space-4)}.helper-text--spaced{margin-top:.8rem}\n.profile-photo-editor{display:flex;flex-direction:column;align-items:center;gap:var(--ui-space-3);margin-bottom:var(--ui-space-6)}\n.profile-avatar--editor{width:6rem;height:6rem;font-size:1.875rem;position:static}.profile-photo-button{display:inline-flex;align-items:center}.profile-photo-input{display:none}\n'''

mobile = mobile.replace('padding-bottom:82px!important','padding-bottom:var(--ui-bottomnav-clearance)!important').replace('min-height:62px!important','min-height:var(--ui-bottomnav-height)!important').replace('html.mobile-ui-active .app-topbar-brand{gap:8px!important;min-width:0!important}','html.mobile-ui-active .app-topbar-brand{gap:8px!important;min-width:0!important;max-width:calc(100vw - 124px)!important}')
responsive = responsive.replace('@media(max-width:720px){body{padding-bottom:70px}','@media(max-width:720px){body{padding-bottom:var(--ui-bottomnav-height)}').replace('.card,.panel{scroll-margin-bottom:82px}','.card,.panel{scroll-margin-bottom:var(--ui-bottomnav-clearance)}')

# Regression contract.
test = '''import { assert, assertEquals } from "jsr:@std/assert@1";\nconst read=(p:string)=>Deno.readTextFile(p);\nDeno.test("UI shell uses aligned tokens and reusable variants",async()=>{const[index,shell,tokens,components]=await Promise.all([read("index.html"),read("src/legacy/index-shell.css"),read("src/styles/foundation/tokens.css"),read("src/styles/foundation/components.css")]);for(const m of ["--success:#059669","--danger:#dc2626","--radius:.625rem","--radius-lg:1rem"])assert(shell.includes(m));for(const m of ["--ui-danger-200","--ui-danger-800","--ui-bottomnav-height","--ui-bottomnav-clearance","--ui-bottomnav-scan-size"])assert(tokens.includes(m));for(const m of [".btn-danger{",".btn-danger-soft{",".modal-card--compact",".signature-panel-actions",".profile-photo-editor"])assert(components.includes(m));assert(index.includes("<span>Presence SPPG</span>"));assert(!index.includes("<div style=\\\"flex:1\\\"></div>"));assert(!index.includes("app-topbar-profile-wrap\\\" style="));assert(!/<div class="modal-card" style="max-width:(?:400|420|500|520|620)px"/.test(index));assert(!index.includes("<span style=\\\"color:var(--danger)\\\">*</span>"));});\nDeno.test("mobile topbar and bottomnav share responsive geometry",async()=>{const[index,shell,mobile,responsive]=await Promise.all([read("index.html"),read("src/legacy/index-shell.css"),read("src/styles/mobile-ui-refresh.css"),read("src/styles/responsive-overrides.css")]);assert(shell.includes("width:var(--ui-bottomnav-scan-size);height:var(--ui-bottomnav-scan-size)"));assert(shell.includes("margin-top:calc(-1 * var(--ui-bottomnav-scan-lift))"));assert(mobile.includes("padding-bottom:var(--ui-bottomnav-clearance)!important"));assert(mobile.includes("min-height:var(--ui-bottomnav-height)!important"));assert(responsive.includes("body{padding-bottom:var(--ui-bottomnav-height)"));assertEquals((index.match(/class="app-bottomnav-item app-bottomnav-item-scan/g)??[]).length,2);});\n'''
write('tests/ui_consistency_contract_test.ts', test)
if 'tests/ui_consistency_contract_test.ts' not in deno:
    if deno.count('tests/frontend_performance_structure_test.ts') < 2: raise SystemExit('deno test marker')
    deno = deno.replace('tests/frontend_performance_structure_test.ts','tests/frontend_performance_structure_test.ts tests/ui_consistency_contract_test.ts')
release = one(release, "const version = '26.11.69';", "const version = '26.11.70';", 'release').replace("const cacheName = 'absen-sppg-hadirly-v110';","const cacheName = 'absen-sppg-hadirly-v111';")

for path,text in [('index.html',index),('src/legacy/index-shell.css',shell),('src/styles/foundation/tokens.css',tokens),('src/styles/foundation/components.css',components),('src/styles/mobile-ui-refresh.css',mobile),('src/styles/responsive-overrides.css',responsive),('src/app/release-version.js',release),('deno.json',deno)]: write(path,text)
