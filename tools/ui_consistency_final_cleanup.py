from pathlib import Path
import re

root = Path('.')
index_path = root / 'index.html'
app_path = root / 'src/legacy/index-app.js'
components_path = root / 'src/styles/foundation/components.css'
release_path = root / 'src/app/release-version.js'
test_path = root / 'tests/ui_consistency_contract_test.ts'

index = index_path.read_text(encoding='utf-8')
app = app_path.read_text(encoding='utf-8')
components = components_path.read_text(encoding='utf-8')
release = release_path.read_text(encoding='utf-8')
test = test_path.read_text(encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    return text.replace(old, new, 1)

# Sidebar section label: remove visual inline style and treat role visibility as state.
index = replace_once(
    index,
    '<div class="app-nav-item admin-only-nav" style="padding:0.5rem 0.9rem 0.25rem;font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:rgba(255,255,255,.3);cursor:default;display:none">Admin</div>',
    '<div class="app-nav-item app-nav-section-label admin-only-nav nav-role-hidden">Admin</div>',
    'admin nav section label',
)

# Role-gated navigation uses a reusable state class instead of inline display styles.
role_pattern = re.compile(r'<(?P<tag>button|div)(?P<prefix>[^>]*class="(?P<classes>[^"]*(?:admin-only-nav|super-admin-only-nav|non-super-admin-only-nav)[^"]*)"[^>]*) style="display:none"(?P<suffix>[^>]*)>')

def role_repl(match):
    classes = match.group('classes')
    if 'nav-role-hidden' not in classes.split():
        classes = f'{classes} nav-role-hidden'
    prefix = match.group('prefix').replace(f'class="{match.group("classes")}"', f'class="{classes}"', 1)
    return f'<{match.group("tag")}{prefix}{match.group("suffix")}>'

index, role_count = role_pattern.subn(role_repl, index)
if role_count < 10:
    raise SystemExit(f'role visibility cleanup: expected >=10 replacements, found {role_count}')

# State-only hidden UI uses the hidden attribute instead of inline display declarations.
index, pagination_count = re.subn(r'(<div class="pagination" id="[^"]+") style="display:none">', r'\1 hidden>', index)
if pagination_count != 3:
    raise SystemExit(f'pagination hidden cleanup: expected 3, found {pagination_count}')
index, badge_count = re.subn(r'(<span class="badge-count"[^>]*) style="display:none">', r'\1 hidden>', index)
if badge_count != 3:
    raise SystemExit(f'complaint badge hidden cleanup: expected 3, found {badge_count}')

# Keep exactly one reusable mobile scan action. Admin ordering is handled by nav mode CSS.
user_scan_pattern = re.compile(r'<button class="app-bottomnav-item app-bottomnav-item-scan user-only-nav" data-view="absen-scan" aria-label="Absen dengan wajah">.*?</button>')
user_scan = user_scan_pattern.search(index)
if not user_scan:
    raise SystemExit('user mobile scan button not found')
common_scan = user_scan.group(0).replace(' app-bottomnav-item-scan user-only-nav"', ' app-bottomnav-item-scan"', 1).replace(' data-view="absen-scan"', ' type="button" data-view="absen-scan"', 1)
index = index[:user_scan.start()] + common_scan + index[user_scan.end():]
admin_scan_pattern = re.compile(r'\s*<button class="app-bottomnav-item app-bottomnav-item-scan admin-only-nav nav-role-hidden" data-view="absen-scan" aria-label="Absen dengan wajah">.*?</button>')
index, admin_scan_count = admin_scan_pattern.subn('', index, count=1)
if admin_scan_count != 1:
    raise SystemExit(f'admin duplicate scan button cleanup: expected 1, found {admin_scan_count}')
index = replace_once(index, '<nav class="app-bottomnav">', '<nav class="app-bottomnav" data-nav-role="user">', 'bottomnav role mode')

# Cropper controls: move the remaining reusable visual styles into CSS classes.
index = replace_once(index, '<div style="display:flex;align-items:center;gap:0.75rem;margin-top:1.25rem">', '<div class="crop-zoom-row">', 'crop zoom row')
index = replace_once(index, 'style="flex-shrink:0;color:var(--text-muted)"', 'class="crop-zoom-icon"', 'crop zoom icon')
index = replace_once(index, '<input type="range" id="crop-zoom" min="100" max="300" value="100" style="flex:1">', '<input type="range" id="crop-zoom" class="crop-zoom-range" min="100" max="300" value="100">', 'crop zoom range')
index = replace_once(index, '<p style="text-align:center;color:var(--text-muted);font-size:0.8125rem;margin-top:0.5rem">Geser gambar dan atur zoom untuk memposisikan foto</p>', '<p class="crop-zoom-hint">Geser gambar dan atur zoom untuk memposisikan foto</p>', 'crop zoom hint')
index = replace_once(index, '<button type="button" class="btn btn-secondary" id="btn-pilih-foto-baru" style="width:100%;margin-top:0.75rem;font-size:0.8125rem;display:inline-flex;align-items:center;justify-content:center;gap:0.4rem">', '<button type="button" class="btn btn-secondary btn-block btn-sm crop-photo-picker" id="btn-pilih-foto-baru">', 'crop photo picker')

# Navigation visibility is class-driven. The common scan button stays visible for every authenticated role.
old_nav = '''function showAdminNav(){
  document.querySelectorAll('.admin-only-nav').forEach(el => el.style.display = '');
  document.querySelectorAll('.user-only-nav').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.super-admin-only-nav').forEach(el => el.style.display = isSuperAdminUser() ? '' : 'none');
  document.querySelectorAll('.non-super-admin-only-nav').forEach(el => el.style.display = isSuperAdminUser() ? 'none' : '');
  closeNavigationMenus();
}

function showUserNav(){
  document.querySelectorAll('.admin-only-nav').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.super-admin-only-nav').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.user-only-nav').forEach(el => el.style.display = '');
  closeNavigationMenus();
}'''
new_nav = '''function setNavVisibility(selector,visible){
  document.querySelectorAll(selector).forEach(el=>el.classList.toggle('nav-role-hidden',!visible));
}
function setBottomNavRole(role){
  const nav=document.querySelector('.app-bottomnav');
  if(nav)nav.dataset.navRole=role;
}
function showAdminNav(){
  setNavVisibility('.admin-only-nav',true);
  setNavVisibility('.user-only-nav',false);
  setNavVisibility('.super-admin-only-nav',isSuperAdminUser());
  setNavVisibility('.non-super-admin-only-nav',!isSuperAdminUser());
  setBottomNavRole('admin');
  closeNavigationMenus();
}

function showUserNav(){
  setNavVisibility('.admin-only-nav',false);
  setNavVisibility('.super-admin-only-nav',false);
  setNavVisibility('.user-only-nav',true);
  setBottomNavRole('user');
  closeNavigationMenus();
}'''
app = replace_once(app, old_nav, new_nav, 'navigation visibility functions')
app = app.replace("pg.style.display = 'flex';", 'pg.hidden = false;')
app = app.replace("pagination.style.display='flex';", 'pagination.hidden=false;')
if "style.display = 'flex'" in app or "pagination.style.display='flex'" in app:
    raise SystemExit('pagination inline display mutation remains')
old_badge = "$$('[data-complaint-count],#complaint-nav-count').forEach(badge=>{badge.textContent=count>99?'99+':String(count);badge.style.display=count?'inline-flex':'none';});"
new_badge = "$$('[data-complaint-count],#complaint-nav-count').forEach(badge=>{badge.textContent=count>99?'99+':String(count);badge.hidden=!count;});"
app = replace_once(app, old_badge, new_badge, 'complaint badge visibility')

# Shared UI classes and role-specific bottomnav ordering.
append_css = '''

/* Final legacy UI consistency cleanup: state, cropper controls, and shared scan action. */
.nav-role-hidden{display:none!important}
.app-nav-section-label{padding:.5rem .9rem .25rem;font-size:var(--ui-text-xs);font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgb(255 255 255/.3);cursor:default}
.crop-zoom-row{display:flex;align-items:center;gap:var(--ui-space-3);margin-top:var(--ui-space-5)}
.crop-zoom-icon{flex-shrink:0;color:var(--ui-text-muted)}
.crop-zoom-range{flex:1;min-width:0}
.crop-zoom-hint{text-align:center;color:var(--ui-text-muted);font-size:var(--ui-text-sm);margin-top:var(--ui-space-2)}
.crop-photo-picker{margin-top:var(--ui-space-3)}
.app-bottomnav[data-nav-role="admin"] [data-view="super-dashboard"],
.app-bottomnav[data-nav-role="admin"] [data-view="admin-dashboard"]{order:1}
.app-bottomnav[data-nav-role="admin"] [data-view="admin-users"]{order:2}
.app-bottomnav[data-nav-role="admin"] .app-bottomnav-item-scan{order:3}
.app-bottomnav[data-nav-role="admin"] [data-view="admin-payroll"]{order:4}
.app-bottomnav[data-nav-role="admin"] .app-bottomnav-more{order:5}
'''
if '/* Final legacy UI consistency cleanup:' not in components:
    components += append_css

# Extend the existing contract to cover the final cleanup.
test = test.replace('assertEquals(scanButtons.length, 2);', 'assertEquals(scanButtons.length, 1);')
test = test.replace('assertEquals(scanLabels.length, 2);', 'assertEquals(scanLabels.length, 1);')
anchor = '  assertEquals(scanLabels.length, 1);\n'
extra = '''  assert(index.includes('data-nav-role="user"'));
  assert(!/admin-only-nav[^\"]*\"[^>]*style=\"display:none\"/.test(index));
  assert(!index.includes('id="absen-pagination" style="display:none"'));
  assert(!index.includes('id="users-pagination" style="display:none"'));
  assert(!index.includes('id="log-pagination" style="display:none"'));
  assert(!index.includes('id="crop-zoom" min="100" max="300" value="100" style='));
  assert(index.includes('class="crop-zoom-row"'));
  assert(index.includes('class="crop-zoom-hint"'));
'''
if extra.strip() not in test:
    test = test.replace(anchor, anchor + extra)

release = replace_once(release, "const version = '26.11.70';", "const version = '26.11.71';", 'release version')
release = replace_once(release, "const cacheName = 'absen-sppg-hadirly-v111';", "const cacheName = 'absen-sppg-hadirly-v112';", 'release cache')

index_path.write_text(index, encoding='utf-8')
app_path.write_text(app, encoding='utf-8')
components_path.write_text(components, encoding='utf-8')
release_path.write_text(release, encoding='utf-8')
test_path.write_text(test, encoding='utf-8')
