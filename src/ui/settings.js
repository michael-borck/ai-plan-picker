// settings.js: the Settings slide-over (spec 10). Every parameter with
// value, low, high, unit, status, source, date and note. Editing a sourced,
// estimated or assumed value marks it user-supplied and keeps the original.
// Presets, JSON export/import, and restore-to-defaults live here too.

const SETTINGS_GROUPS = [
  { id: 'hardware', label: 'Hardware', prefixes: ['hardware', 'quant'] },
  { id: 'speed', label: 'Speed model', prefixes: ['speed', 'memory'] },
  { id: 'power', label: 'Power and electricity', prefixes: ['power', 'electricity'] },
  { id: 'ownership', label: 'Ownership and admin', prefixes: ['ownership', 'admin'] },
  { id: 'organisation', label: 'Organisation and tasks', prefixes: ['demand', 'agentic', 'tasks', 'verbosity', 'efficiency'] },
  { id: 'rental', label: 'Rental', prefixes: ['rental'] },
  { id: 'subscriptions', label: 'Subscriptions', prefixes: ['subscriptions'] },
  { id: 'api', label: 'API', prefixes: ['api'] },
  { id: 'fit', label: 'Fit checks and explorer', prefixes: ['fit', 'explorer'] },
  { id: 'time', label: 'Time effects and general', prefixes: ['price_change', 'discount', 'thinking', 'fx', 'gst', 'value_of_time'] }
];

const STATUS_CLASSES = {
  sourced: 'st-sourced',
  estimated: 'st-estimated',
  assumed: 'st-assumed',
  'user-supplied': 'st-user'
};

let settingsTab = 'hardware';

function groupParams(config) {
  const groups = {};
  for (const g of SETTINGS_GROUPS) groups[g.id] = [];
  for (const [id, rec] of Object.entries(config.parameters)) {
    const prefix = id.split('.')[0];
    const g = SETTINGS_GROUPS.find(g => g.prefixes.includes(prefix));
    (g ? groups[g.id] : groups.time).push([id, rec]);
  }
  return groups;
}

function buildSettingsPanel(config) {
  const nav = $('settings-tabs');
  nav.innerHTML = '';
  for (const g of SETTINGS_GROUPS) {
    const btn = document.createElement('button');
    btn.textContent = g.label;
    btn.dataset.tab = g.id;
    btn.addEventListener('click', () => { settingsTab = g.id; renderSettingsTab(CONFIG); });
    nav.appendChild(btn);
  }
  const presetSel = $('preset-select');
  presetSel.innerHTML = '';
  for (const p of config.presets || []) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    presetSel.appendChild(opt);
  }
  for (const name of listSavedPresets()) {
    const opt = document.createElement('option');
    opt.value = 'user:' + name;
    opt.textContent = name + ' (saved)';
    presetSel.appendChild(opt);
  }
}

function renderSettingsTab(config) {
  for (const btn of $('settings-tabs').querySelectorAll('button')) {
    btn.setAttribute('aria-selected', btn.dataset.tab === settingsTab ? 'true' : 'false');
  }
  const groups = groupParams(config);
  const group = SETTINGS_GROUPS.find(g => g.id === settingsTab) || SETTINGS_GROUPS[0];
  const body = $('settings-body');
  body.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'settings-table';
  table.innerHTML = '<thead><tr><th>Parameter</th><th>Value</th><th>Low</th><th>High</th><th>Unit</th><th>Status</th><th>Source</th><th>Date</th><th>Note</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const [id, rec] of groups[group.id]) {
    tbody.appendChild(paramRow(config, id, rec));
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

function paramRow(config, id, rec) {
  const tr = document.createElement('tr');
  if (rec.status === 'user-supplied') tr.className = 'edited';

  const nameTd = document.createElement('td');
  nameTd.innerHTML = '<code>' + id + '</code><br><span class="chart-note">' + (rec.label || '') + '</span>';
  tr.appendChild(nameTd);

  const valueTd = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = rec.value;
  input.setAttribute('aria-label', 'Value of ' + id);
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (!Number.isFinite(v)) { input.value = rec.value; return; }
    CONFIG = setParam(CONFIG, id, v);
    saveParams();
    renderSettingsTab(CONFIG);
    recalculate();
  });
  valueTd.appendChild(input);
  tr.appendChild(valueTd);

  const lowTd = document.createElement('td'); lowTd.textContent = rec.low ?? '-';
  const highTd = document.createElement('td'); highTd.textContent = rec.high ?? '-';
  const unitTd = document.createElement('td'); unitTd.textContent = rec.unit || '';
  tr.appendChild(lowTd); tr.appendChild(highTd); tr.appendChild(unitTd);

  const statusTd = document.createElement('td');
  const chip = document.createElement('span');
  chip.className = 'status-chip ' + (STATUS_CLASSES[rec.status] || '');
  chip.textContent = rec.status;
  chip.title = provenanceText(config, id);
  statusTd.appendChild(chip);
  tr.appendChild(statusTd);

  const srcTd = document.createElement('td');
  srcTd.className = 'chart-note';
  srcTd.textContent = (rec.source || '') + (rec.original ? ' (was ' + rec.original.value + ' [' + rec.original.status + '])' : '');
  tr.appendChild(srcTd);

  const dateTd = document.createElement('td'); dateTd.className = 'chart-note'; dateTd.textContent = rec.source_date || '';
  tr.appendChild(dateTd);

  const noteTd = document.createElement('td'); noteTd.className = 'chart-note'; noteTd.textContent = rec.note || '';
  tr.appendChild(noteTd);

  const undoTd = document.createElement('td');
  if (rec.original) {
    const undo = document.createElement('button');
    undo.textContent = 'Undo';
    undo.title = provenanceText(config, id);
    undo.addEventListener('click', () => {
      CONFIG = resetParam(CONFIG, id);
      saveParams();
      renderSettingsTab(CONFIG);
      recalculate();
    });
    undoTd.appendChild(undo);
  }
  tr.appendChild(undoTd);
  return tr;
}

// ---- presets ----

function applySelectedPreset() {
  const sel = $('preset-select');
  const v = sel.value;
  if (v.startsWith('user:')) {
    const saved = listSavedPresets().find(p => p.name === v.slice(5));
    if (saved) {
      CONFIG = applyEdits(loadDefaultsConfig(), saved.edits);
      afterConfigChange('Preset "' + saved.name + '" applied.');
    }
    return;
  }
  CONFIG = v === 'locolabo_defaults' ? resetAllParams(CONFIG) : applyPreset(CONFIG, v);
  const preset = (CONFIG.presets || []).find(p => p.id === v);
  afterConfigChange(preset ? preset.label + ' applied.' : 'Preset applied.');
}

function saveCurrentPreset() {
  const name = $('preset-name').value.trim();
  if (!name) { settingsStatus('Give the preset a name first.'); return; }
  const list = listSavedPresets().filter(p => p.name !== name);
  list.push({ name, edits: editedParams(CONFIG), saved: new Date().toISOString().slice(0, 10) });
  try {
    localStorage.setItem(STORAGE_KEY + '-presets', JSON.stringify(list));
    settingsStatus('Saved preset "' + name + '".');
    buildSettingsPanel(CONFIG);
  } catch (e) {
    settingsStatus('Could not save: localStorage is unavailable. Use JSON export instead.');
  }
}

function deleteSavedPreset() {
  const sel = $('preset-select').value;
  if (!sel.startsWith('user:')) return;
  const name = sel.slice(5);
  const list = listSavedPresets().filter(p => p.name !== name);
  try { localStorage.setItem(STORAGE_KEY + '-presets', JSON.stringify(list)); } catch (e) {}
  settingsStatus('Deleted preset "' + name + '".');
  buildSettingsPanel(CONFIG);
}

function listSavedPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY + '-presets') || '[]');
  } catch (e) { return []; }
}

// ---- export / import ----

function exportConfigFile() {
  const data = JSON.stringify(exportConfig(CONFIG), null, 1);
  try {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'comparator-config-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) { /* fallback below */ }
  const box = $('import-export');
  box.value = data;
  settingsStatus('Configuration exported below: copy it or check the downloaded file.');
}

function importConfigFile() {
  const box = $('import-export');
  const fileInput = $('import-file');
  const readText = text => {
    try {
      const parsed = JSON.parse(text);
      const { config, report } = importConfig(loadDefaultsConfig(), parsed);
      CONFIG = config;
      saveParams();
      afterConfigChange('Imported ' + report.applied + ' parameters' +
        (report.skipped.length ? '; skipped unknown: ' + report.skipped.join(', ') : '') + '.');
    } catch (e) {
      settingsStatus('Import failed: ' + e.message);
    }
  };
  if (fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = () => readText(reader.result);
    reader.readAsText(fileInput.files[0]);
  } else if (box.value.trim()) {
    readText(box.value);
  } else {
    settingsStatus('Choose a file or paste the JSON below first.');
  }
}

function resetAllToDefaults() {
  CONFIG = resetAllParams(CONFIG);
  saveParams();
  afterConfigChange('All parameters restored to LocoLabo defaults.');
}

function afterConfigChange(message) {
  saveParams();
  buildSettingsPanel(CONFIG);
  renderSettingsTab(CONFIG);
  recalculate();
  settingsStatus(message);
}

function settingsStatus(message) {
  const el = $('settings-status');
  if (el) el.textContent = message;
}

// ---- persistence of edited parameters (spec 9, 10) ----

function saveParams() {
  try {
    localStorage.setItem(STORAGE_KEY + '-params', JSON.stringify(editedParams(CONFIG)));
  } catch (e) { /* unavailable: JSON export remains the reliable path */ }
}

function loadParams() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '-params');
    if (!raw) return CONFIG;
    return applyEdits(loadDefaultsConfig(), JSON.parse(raw));
  } catch (e) { return CONFIG; }
}

function openSettings(open) {
  document.body.classList.toggle('settings-open', open);
  $('settings-panel').setAttribute('aria-hidden', open ? 'false' : 'true');
}

function initSettings() {
  $('settings-btn').addEventListener('click', () => openSettings(true));
  $('settings-close').addEventListener('click', () => openSettings(false));
  $('settings-backdrop').addEventListener('click', () => openSettings(false));
  $('preset-apply').addEventListener('click', applySelectedPreset);
  $('preset-save').addEventListener('click', saveCurrentPreset);
  $('preset-delete').addEventListener('click', deleteSavedPreset);
  $('export-config').addEventListener('click', exportConfigFile);
  $('import-config').addEventListener('click', importConfigFile);
  $('reset-config').addEventListener('click', resetAllToDefaults);
}
