// state.js: per-tab inputs, URL hash sharing and guarded localStorage
// (spec 9, 10). The engine never sees this file; tabs are bundles of
// defaults, visible inputs and chart order.

const COMPARE_TABS = ['single_user', 'small_business', 'enterprise', 'compare_sizes'];

const state = {
  activeTab: 'single_user',
  globals: { horizon_years: 3, gst_display: 'ex', teaching: false },
  view: 'plan',            // Pick a plan | Hardware explorer (spec 4.2)
  simpleView: true,        // phone-plan cards by default; untick for the full workbench (D20, D22)
  chartMode: 'tco',        // cumulative TCO | payback (spec 7 chart 1)
  paybackRef: null,        // reference option id for the payback view
  inputs: {},              // per-tab saved inputs
  charts: {}               // chart instances by canvas id
};

function baseInputsFor(tab, config) {
  const d = config.defaults_inputs[tab];
  if (!d) return { tab };
  const base = {};
  for (const [k, v] of Object.entries(d)) {
    if (k !== 'note' && k !== 'persona_mix') base[k] = v;
  }
  if (d.persona_mix) base.persona_mix = { ...d.persona_mix };
  return base;
}

function inputsFor(tab, config) {
  if (!state.inputs[tab]) state.inputs[tab] = baseInputsFor(tab, config);
  return state.inputs[tab];
}

function engineInputs(tab, config) {
  const inp = { ...inputsFor(tab, config), ...state.globals };
  delete inp.note;
  return inp;
}

// ---- persistence: URL hash first, localStorage best effort ----

function encodeState() {
  return encodeURIComponent(JSON.stringify({
    t: state.activeTab, g: state.globals, i: state.inputs,
    v: state.view, m: state.chartMode, r: state.paybackRef, s: state.simpleView
  }));
}

function writeHash() {
  try { history.replaceState(null, '', '#' + encodeState()); } catch (e) { /* file:// or sandboxed */ }
}

function readHash() {
  try {
    if (location.hash.length > 1) {
      const parsed = JSON.parse(decodeURIComponent(location.hash.slice(1)));
      if (parsed && parsed.t && COMPARE_TABS.includes(parsed.t)) {
        state.activeTab = parsed.t;
        if (parsed.g) state.globals = { ...state.globals, ...parsed.g };
        if (parsed.i) state.inputs = parsed.i;
        if (parsed.v) state.view = parsed.v;
        if (parsed.m) state.chartMode = parsed.m;
        if (parsed.r) state.paybackRef = parsed.r;
        if (parsed.s !== undefined) state.simpleView = parsed.s;
        return true;
      }
    }
  } catch (e) { /* malformed hash: ignore */ }
  return false;
}

const STORAGE_KEY = 'ai-delivery-comparator-v0';

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ g: state.globals, i: state.inputs }));
  } catch (e) { /* unavailable: JSON export remains the reliable path */ }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed.g) state.globals = { ...state.globals, ...parsed.g };
    if (parsed.i) state.inputs = parsed.i;
    return true;
  } catch (e) { return false; }
}
