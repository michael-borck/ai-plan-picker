// main.js: wiring for the Single user tab. Live recalculation with a 150 ms
// debounce (spec 9). One engine for every tab; tabs differ only in defaults,
// visible inputs and chart order. Sub-views: Pick a plan | Hardware explorer.

let CONFIG = null;

const INPUT_DEFS = [
  { key: 'persona', id: 'in-persona', type: 'select', options: [
    ['power', 'Power persona (40 SQ/day)'], ['typical', 'Typical persona (15 SQ/day)'], ['light', 'Light persona (5 SQ/day)']
  ] },
  { key: 'usage_preset', id: 'in-preset', type: 'select', fromConfig: 'usage_presets' },
  { key: 'usage_mode', id: 'in-mode', type: 'select', fromConfig: 'usage_modes' },
  { key: 'parallel_agents', id: 'in-agents', type: 'number', min: 1, max: 8, step: 1 },
  { key: 'thinking', id: 'in-thinking', type: 'select', options: [
    ['off', 'Thinking off'], ['low', 'Thinking low (1.5x)'], ['medium', 'Thinking medium (3x)'], ['high', 'Thinking high (6x)']
  ] },
  { key: 'quality_target', id: 'in-quality', type: 'select', fromConfig: 'quality_targets', skipId: 'frontier' },
  { key: 'data_sensitivity', id: 'in-sensitivity', type: 'select', options: [
    ['public', 'Public'], ['internal', 'Internal'], ['sensitive', 'Sensitive']
  ] },
  { key: 'tariff_id', id: 'in-tariff', type: 'select', fromTables: 'tariffs' },
  { key: 'powered_h_per_day', id: 'in-powered', type: 'number', min: 1, max: 24, step: 0.5 },
  { key: 'value_of_time_aud_h', id: 'in-vot', type: 'number', min: 0, max: 200, step: 5 },
  { key: 'paid_help', id: 'in-paidhelp', type: 'checkbox' },
  { key: 'must_be_new', id: 'in-new', type: 'checkbox' }
];

function labelled(labelText, input) {
  const label = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = labelText;
  label.appendChild(name);
  label.appendChild(input);
  return label;
}

function buildInputs(config) {
  const grid = $('inputs-grid');
  grid.innerHTML = '';
  for (const def of INPUT_DEFS) {
    let input;
    if (def.type === 'select') {
      input = document.createElement('select');
      let opts = null;
      if (def.options) opts = def.options;
      else if (def.fromConfig) opts = config[def.fromConfig].map(o => [o.id, o.label]);
      else if (def.fromTables) opts = config.tables[def.fromTables].map(o => [o.id, o.label]);
      for (const [value, text] of opts) {
        if (def.skipId && value === def.skipId) continue;
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      }
    } else if (def.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.min = def.min;
      input.max = def.max;
      input.step = def.step;
    }
    input.id = def.id;
    input.addEventListener('change', onInputChanged);
    const text = def.key === 'value_of_time_aud_h'
      ? 'Value of your time (AUD/h, 0 = off)'
      : def.key.replace(/_/g, ' ').charAt(0).toUpperCase() + def.key.replace(/_/g, ' ').slice(1);
    if (def.type === 'checkbox') {
      const label = labelled(text, input);
      label.className = 'checkbox-line';
      grid.appendChild(label);
    } else {
      grid.appendChild(labelled(text, input));
    }
  }
}

function writeInputs(config) {
  const saved = inputsFor('single_user', config);
  for (const def of INPUT_DEFS) {
    const el = $(def.id);
    if (!el) continue;
    if (def.type === 'checkbox') el.checked = !!saved[def.key];
    else if (saved[def.key] !== undefined) el.value = saved[def.key];
  }
  $('g-horizon').value = state.globals.horizon_years;
  $('g-gst').value = state.globals.gst_display;
  $('g-teaching').checked = !!state.globals.teaching;
  document.body.classList.toggle('teaching', !!state.globals.teaching);
  setView(state.view || 'plan');
}

function readInputs(config) {
  const saved = inputsFor('single_user', config);
  for (const def of INPUT_DEFS) {
    const el = $(def.id);
    if (!el) continue;
    if (def.type === 'checkbox') saved[def.key] = el.checked;
    else if (def.type === 'number') saved[def.key] = el.value === '' ? undefined : Number(el.value);
    else saved[def.key] = el.value;
    if (saved[def.key] === '' || saved[def.key] === undefined) delete saved[def.key];
  }
  state.globals.horizon_years = Number($('g-horizon').value);
  state.globals.gst_display = $('g-gst').value;
  state.globals.teaching = $('g-teaching').checked;
  document.body.classList.toggle('teaching', !!state.globals.teaching);
}

function setView(view) {
  state.view = view;
  document.body.classList.toggle('explorer-view', view === 'explorer');
  const buttons = document.querySelectorAll('.subview button');
  for (const b of buttons) b.setAttribute('aria-selected', b.dataset.view === view ? 'true' : 'false');
}

function onViewChanged(evt) {
  setView(evt.target.dataset.view);
  recalculate();
}

let debounceTimer = null;
function onInputChanged() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(recalculate, 150);
}

function recalculate() {
  readInputs(CONFIG);
  readRules(CONFIG);
  readOwnWeek(CONFIG);
  readExplorer(CONFIG);

  const saved = inputsFor('single_user', CONFIG);
  const engineIn = engineInputs('single_user', CONFIG);
  engineIn.explorer = saved.explorer;
  // The ribbon reuses the sensitivity sweep, so it costs nothing extra, but
  // only the advanced view shows the hero chart, so only it asks.
  engineIn.with_bands = state.view !== 'simple';
  const result = compute(CONFIG, engineIn);
  renderAll(CONFIG, result);
  renderChartModeControls(result);
  renderExplorer(result);
  frontierChartRender('frontier-chart', budgetFrontier(CONFIG, {
    bits: saved.explorer.bits_per_weight,
    context_k: saved.explorer.context_k,
    min_speed_tps: saved.explorer.min_speed_tps,
    must_be_new: saved.explorer.market === 'new',
    streams: Math.max(1, saved.parallel_agents || 1)
  }));
  writeHash();
  saveLocal();
  $('status-line').textContent = 'Recalculated. Every figure is an estimate.';
}

const SIMPLE_INPUTS = [
  { key: 'usage_preset', id: 'sm-preset', fromConfig: 'usage_presets' },
  { key: 'usage_mode', id: 'sm-mode', fromConfig: 'usage_modes' },
  { key: 'persona', id: 'sm-persona', options: [['power', 'Power user (40 tasks/day)'], ['typical', 'Typical (15/day)'], ['light', 'Light (5/day)']] },
  { key: 'thinking', id: 'sm-thinking', options: [['off', 'Thinking off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] }
];

function buildSimpleInputs(config) {
  for (const def of SIMPLE_INPUTS) {
    const sel = $(def.id);
    const opts = def.options || config[def.fromConfig].map(o => [o.id, o.label]);
    for (const [value, text] of opts) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      const saved = inputsFor('single_user', CONFIG);
      saved[def.key] = sel.value;
      writeInputs(CONFIG);
      recalculate();
    });
  }
}

function writeSimpleInputs(config) {
  const saved = inputsFor('single_user', config);
  for (const def of SIMPLE_INPUTS) {
    const sel = $(def.id);
    if (saved[def.key] !== undefined) sel.value = saved[def.key];
  }
}

const OWN_WEEK_IDS = ['quick_question', 'document_summary', 'writing_drafting', 'code_data_assist', 'analysis_rag', 'agentic_task', 'hard_problem'];

function buildOwnWeek() {
  const grid = $('own-week-inputs');
  grid.innerHTML = '';
  for (const id of OWN_WEEK_IDS) {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = 0;
    input.step = 1;
    input.id = 'ow-' + id;
    input.addEventListener('change', onInputChanged);
    const label = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = id.replace(/_/g, ' ') + ' per week';
    label.appendChild(span);
    label.appendChild(input);
    grid.appendChild(label);
  }
}

function writeOwnWeek(config) {
  const saved = inputsFor('single_user', config);
  const ow = saved.own_week || { enabled: false, counts: {} };
  $('own-week-enabled').checked = !!ow.enabled;
  $('own-week-inputs').classList.toggle('visible', !!ow.enabled);
  for (const id of OWN_WEEK_IDS) {
    const el = $('ow-' + id);
    el.value = ow.counts && ow.counts[id] != null ? ow.counts[id] : 0;
  }
}

function readOwnWeek(config) {
  const saved = inputsFor('single_user', config);
  const ow = saved.own_week || { enabled: false, counts: {} };
  ow.enabled = $('own-week-enabled').checked;
  $('own-week-inputs').classList.toggle('visible', ow.enabled);
  ow.counts = ow.counts || {};
  for (const id of OWN_WEEK_IDS) {
    ow.counts[id] = Number($('ow-' + id).value) || 0;
  }
  saved.own_week = ow;
}

function writeRules(config) {
  const saved = inputsFor('single_user', config);
  const rules = saved.rules || { top_up: true, exclude_may_train: false };
  $('rule-topup').checked = !!rules.top_up;
  $('rule-maytrain').checked = !!rules.exclude_may_train;
  saved.rules = rules;
}

function readRules(config) {
  const saved = inputsFor('single_user', config);
  saved.rules = {
    top_up: $('rule-topup').checked,
    exclude_may_train: $('rule-maytrain').checked
  };
}

function initGlobals() {
  $('rule-topup').addEventListener('change', onInputChanged);
  $('rule-maytrain').addEventListener('change', onInputChanged);
  $('own-week-enabled').addEventListener('change', onInputChanged);
  $('view-simple').addEventListener('change', () => {
    state.simpleView = $('view-simple').checked;
    document.body.classList.toggle('simple-view', state.simpleView);
    writeHash();
  });
  $('g-horizon').addEventListener('change', onInputChanged);
  $('g-gst').addEventListener('change', onInputChanged);
  $('g-teaching').addEventListener('change', onInputChanged);
  const subButtons = document.querySelectorAll('.subview button');
  for (const b of subButtons) b.addEventListener('click', onViewChanged);
  $('profile-option').addEventListener('change', onInputChanged);
}

function initTabs() {
  const buttons = document.querySelectorAll('.tabs button');
  for (const b of buttons) {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      state.activeTab = b.dataset.tab;
      for (const x of buttons) x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      writeHash();
    });
  }
  for (const b of buttons) b.setAttribute('aria-selected', b.dataset.tab === state.activeTab ? 'true' : 'false');
}

// ?test mode (spec 14): a compact in-page check of the headline numbers.
function runInPageTests() {
  const results = [];
  const check = (name, fn) => {
    try { fn(); results.push(['pass', name]); }
    catch (e) { results.push(['FAIL', name + ': ' + e.message]); }
  };
  const assertEq = (a, b, msg) => { if (a !== b) throw new Error(msg + ' (' + a + ' != ' + b + ')'); };
  const result = compute(CONFIG, { horizon_years: 3 });
  check('compute returns options', () => assertEq(result.options.length > 10, true, 'too few options'));
  check('winner exists', () => assertEq(!!result.recommendation.winner, true, 'no winner'));
  check('grid has seven task cells', () => assertEq(result.options[0].task_cells.length, 7, 'cells'));
  check('tornado rows present', () => assertEq(Array.isArray(result.tornado) && result.tornado.length > 0, true, 'tornado'));
  const api = result.options.find(o => o.id === 'api_best');
  check('API Best daily cost about 35 cents (T6)', () => {
    const daily = api.tco_at_horizon / (result.inputs_used.horizon_years * 12 * (365 / 12));
    if (Math.abs(daily - 0.35) / 0.35 > 0.10) throw new Error('daily ' + daily.toFixed(3));
  });
  check('every option has seven task cells (N-set)', () => {
    for (const o of result.options) assertEq(o.task_cells.length, 7, o.id);
  });
  return results;
}

function boot() {
  CONFIG = window.__COMPARE_CONFIG__;
  CONFIG = loadParams();
  buildInputs(CONFIG);
  buildExplorer(CONFIG);
  buildSimpleInputs(CONFIG);
  buildOwnWeek();
  const fromHash = readHash();
  if (!fromHash) loadLocal();
  initSettings();
  initTabs();
  initGlobals();
  writeInputs(CONFIG);
  writeExplorer(CONFIG);
  writeSimpleInputs(CONFIG);
  writeRules(CONFIG);
  writeOwnWeek(CONFIG);
  if (!CONFIG.features || !CONFIG.features.org_tabs) {
    const orgButtons = document.querySelectorAll('.tabs button[data-tab="small_business"], .tabs button[data-tab="enterprise"], .tabs button[data-tab="compare_sizes"]');
    for (const b of orgButtons) b.style.display = 'none';
  }
  document.body.classList.toggle('simple-view', !!state.simpleView);
  if ($('view-simple')) $('view-simple').checked = !!state.simpleView;
  recalculate();
  if ((location.search || '').includes('test')) {
    const results = runInPageTests();
    let card = document.getElementById('in-page-tests');
    if (!card) {
      card = document.createElement('section');
      card.id = 'in-page-tests';
      card.className = 'card';
      document.querySelector('main').prepend(card);
    }
    card.innerHTML = '<h2>In-page tests</h2><ol>' +
      results.map(([status, name]) => '<li>' + status + ': ' + name + '</li>').join('') + '</ol>';
  }
}

boot();
