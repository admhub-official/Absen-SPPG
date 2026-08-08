from pathlib import Path

root = Path('.')
index_path = root / 'index.html'
app_path = root / 'src/legacy/index-app.js'
components_path = root / 'src/styles/foundation/components.css'
tokens_path = root / 'src/styles/foundation/tokens.css'
release_path = root / 'src/app/release-version.js'
test_path = root / 'tests/ui_consistency_contract_test.ts'

index = index_path.read_text(encoding='utf-8')
app = app_path.read_text(encoding='utf-8')
components = components_path.read_text(encoding='utf-8')
tokens = tokens_path.read_text(encoding='utf-8')
release = release_path.read_text(encoding='utf-8')
test = test_path.read_text(encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 occurrence, found {count}')
    return text.replace(old, new, 1)

index = replace_once(index, '<span class="trend-legend-dot" style="background:var(--primary)"></span>', '<span class="trend-legend-dot trend-legend-dot--datang"></span>', 'trend datang dot')
index = replace_once(index, '<span class="trend-legend-dot" style="background:#a5b4fc"></span>', '<span class="trend-legend-dot trend-legend-dot--pulang"></span>', 'trend pulang dot')
index = replace_once(index, '<button class="btn btn-danger" id="btn-risk-confirm" type="button" style="display:none">', '<button class="btn btn-danger" id="btn-risk-confirm" type="button" hidden>', 'risk confirm initial state')

app = replace_once(app, "$('#btn-risk-next').style.display='';\n  $('#btn-risk-confirm').style.display='none';", "$('#btn-risk-next').hidden=false;\n  $('#btn-risk-confirm').hidden=true;", 'risk modal initial state')
app = replace_once(app, "$('#btn-risk-next').style.display='none';\n  $('#btn-risk-confirm').style.display='';", "$('#btn-risk-next').hidden=true;\n  $('#btn-risk-confirm').hidden=false;", 'risk modal advanced state')

if '--ui-primary-300:' not in tokens:
    tokens = replace_once(tokens, '  --ui-primary-100: #e0e7ff;\n', '  --ui-primary-100: #e0e7ff;\n  --ui-primary-300: #a5b4fc;\n', 'primary 300 token')

if '.trend-legend-dot--datang{' not in components:
    components += '\n.trend-legend-dot--datang{background:var(--ui-primary-600)}\n.trend-legend-dot--pulang{background:var(--ui-primary-300)}\n'

remaining = [(i + 1, line.strip()) for i, line in enumerate(index.splitlines()) if ' style="' in line]
if remaining:
    raise SystemExit('static inline styles remain: ' + repr(remaining))

marker = '  assert(!index.includes(\'style="background:#fee2e2;color:#991b1b;border:1.5px solid #fca5a5"\'));\n'
extra = '  assert(!index.includes(\' style="\'));\n  assert(index.includes("trend-legend-dot trend-legend-dot--datang"));\n  assert(index.includes("trend-legend-dot trend-legend-dot--pulang"));\n'
if extra.strip() not in test:
    test = replace_once(test, marker, marker + extra, 'static inline style contract')
marker2 = '    "badge.hidden=!count",\n'
extra2 = '    "$(\'#btn-risk-confirm\').hidden=true",\n    "$(\'#btn-risk-confirm\').hidden=false",\n'
if extra2.strip() not in test:
    test = replace_once(test, marker2, marker2 + extra2, 'risk hidden state contract')

release = replace_once(release, "const version = '26.11.71';", "const version = '26.11.72';", 'release version')
release = replace_once(release, "const cacheName = 'absen-sppg-hadirly-v112';", "const cacheName = 'absen-sppg-hadirly-v113';", 'release cache')

index_path.write_text(index, encoding='utf-8')
app_path.write_text(app, encoding='utf-8')
components_path.write_text(components, encoding='utf-8')
tokens_path.write_text(tokens, encoding='utf-8')
release_path.write_text(release, encoding='utf-8')
test_path.write_text(test, encoding='utf-8')
