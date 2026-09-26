// explorer.js: Hardware explorer sub-view for the Single user tab (spec 4.2).
// Fixed model or Budget-only mode; objectives; budget frontier chart (chart 9).
// The chosen build becomes the primary local option in the comparison below
// the hardware card, driven by the same Pick a plan usage inputs.

const EXPLORER_DEFS = [
  { key: 'mode', id: 'ex-mode', type: 'select', options: [
    ['fixed', 'Fixed model'], ['budget_only', 'Budget only (largest rung that fits)']
  ] },
  { key: 'budget_aud', id: 'ex-budget', type: 'budget', label: 'Budget (AUD, or auto)' },
  { key: 'total_b', id: 'ex-total', type: 'number', min: 1, max: 500, step: 1 },
  { key: 'moe', id: 'ex-kind', type: 'select', options: [['false', 'Dense'], ['true', 'MoE (mixture of experts)']] },
  { key: 'active_b', id: 'ex-active', type: 'number', min: 1, max: 100, step: 1 },
  { key: 'min_speed_tps', id: 'ex-minspeed', type: 'number', min: 1, max: 100, step: 1 },
  { key: 'market', id: 'ex-market', type: 'select', options: [
    ['either', 'Either market'], ['new', 'New and warranted only'], ['secondhand', 'Secondhand preferred']
  ] },
  { key: 'objective', id: 'ex-objective', type: 'select', options: [
    ['cheapest', 'Cheapest that meets the minimum'], ['fastest', 'Fastest within budget'], ['best_value', 'Best value']
  ] }
];

function buildExplorer(config) {
  const grid = $('explorer-grid');
  grid.innerHTML = '';
  for (const def of EXPLORER_DEFS) {
    const label = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = def.label || def.key.replace(/_/g, ' ').charAt(0).toUpperCase() + def.key.replace(/_/g, ' ').slice(1);
    let input;
    if (def.type === 'select') {
      input = document.createElement('select');
      for (const [value, text] of def.options) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      }
    } else if (def.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.min = def.min; input.max = def.max; input.step = def.step;
    } else if (def.type === 'budget') {
      input = document.createElement('select');
      for (const [value, text] of [['auto', 'Auto: cheapest build that meets demand'], ['1500', 'AUD 1,500'], ['2000', 'AUD 2,000'], ['3000', 'AUD 3,000'], ['5000', 'AUD 5,000']]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        input.appendChild(opt);
      }
    }
    input.id = def.id;
    input.addEventListener('change', onExplorerChanged);
    label.appendChild(name);
    label.appendChild(input);
    grid.appendChild(label);
  }
  // Quantisation and context live with the explorer inputs (spec 4.2).
  const quant = $('ex-quant');
  for (const [value, text] of [
    [3.9, 'Q3 (3.9 bits)'], [4.85, 'Q4_K_M (4.85 bits)'], [5.7, 'Q5 (5.7 bits)'],
    [6.6, 'Q6 (6.6 bits)'], [8.5, 'Q8 (8.5 bits)'], [16, 'FP16 (16 bits)']
  ]) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = text;
    quant.appendChild(opt);
  }
  quant.addEventListener('change', onExplorerChanged);
  const ctx = $('ex-context');
  for (const [value, text] of [
    [4, '4k tokens'], [8, '8k tokens'], [16, '16k tokens'], [32, '32k tokens'], [64, '64k tokens'], [128, '128k tokens']
  ]) {
    const opt = document.createElement('option');
    opt.value = value; opt.textContent = text;
    ctx.appendChild(opt);
  }
  ctx.addEventListener('change', onExplorerChanged);
}

function writeExplorer(config) {
  const saved = inputsFor('single_user', config);
  const ex = saved.explorer || {};
  const defaults = {
    mode: 'fixed', budget_aud: 'auto', total_b: 14, moe: 'false',
    active_b: 3, min_speed_tps: CONFIG.parameters['fit.min_speed_tps'].value,
    market: 'either', objective: 'cheapest', active: false,
    bits_per_weight: CONFIG.parameters['quant.q4_k_m_bits_per_weight'].value,
    context_k: CONFIG.parameters['fit.context_default_k'].value
  };
  const merged = { ...defaults, ...ex };
  for (const def of EXPLORER_DEFS) {
    const el = $(def.id);
    if (el) el.value = String(merged[def.key]);
  }
  $('ex-quant').value = String(merged.bits_per_weight);
  $('ex-context').value = String(merged.context_k);
  $('ex-use').checked = !!merged.active;
  saved.explorer = merged;
}

function readExplorer(config) {
  const saved = inputsFor('single_user', config);
  const ex = saved.explorer || {};
  for (const def of EXPLORER_DEFS) {
    const el = $(def.id);
    if (!el) continue;
    ex[def.key] = (def.type === 'number') ? Number(el.value) : el.value;
  }
  ex.bits_per_weight = Number($('ex-quant').value);
  ex.context_k = Number($('ex-context').value);
  ex.active = $('ex-use').checked;
  if (ex.mode === 'fixed' && String(ex.moe) === 'true') {
    ex.moe = true;
    ex.total_b = Number(ex.total_b);
    ex.active_b = Number(ex.active_b);
  } else {
    ex.moe = false;
    ex.active_b = ex.total_b;
  }
  ex.total_b = Number(ex.total_b);
  ex.min_speed_tps = Number(ex.min_speed_tps);
  saved.explorer = ex;
  return ex;
}

let explorerDebounce = null;
function onExplorerChanged() {
  if (explorerDebounce) clearTimeout(explorerDebounce);
  explorerDebounce = setTimeout(recalculate, 150);
}

function renderExplorer(result) {
  const card = $('explorer-card');
  const box = $('explorer-result');
  box.innerHTML = '';
  const pick = result.explorer;

  if (!pick) {
    const p = document.createElement('p');
    p.textContent = result.explorer_note ||
      'Turn on "Use explorer choice in the comparison" to size a specific build and see its costs against the cloud options.';
    box.appendChild(p);
    return;
  }

  const cand = pick.cand;
  const h = document.createElement('h3');
  h.textContent = 'Your build: ' + cand.platform_label + ', ' +
    (cand.card_ref ? cand.card_ref + (cand.n_gpu > 1 ? ' x ' + cand.n_gpu : '') : 'CPU only') + ', ' + cand.ram_gb + ' GB RAM';
  box.appendChild(h);
  const dl = document.createElement('dl');
  dl.className = 'hw-grid';
  const add = (t, d) => {
    const dt = document.createElement('dt'); dt.textContent = t;
    const dd = document.createElement('dd'); dd.textContent = d;
    dl.appendChild(dt); dl.appendChild(dd);
  };
  add('Model', pick.model.label + (pick.via_ladder ? ' (ladder rung)' : ''));
  add('Placement', cand.placement + ', GPU share ' + Math.round(cand.speed.gpu_share * 100) + '%');
  add('Price', 'AUD ' + Math.round(cand.price_aud).toLocaleString('en-AU') + ' (estimate)');
  add('Memory', cand.memory.required_gb.toFixed(1) + ' GB of ' + cand.memory.capacity_gb.toFixed(1) + ' GB');
  add('Decode speed', Math.round(cand.speed.decode_tps.low) + ' / ' + Math.round(cand.speed.decode_tps.mid) + ' / ' +
    Math.round(cand.speed.decode_tps.high) + ' tok/s (low/mid/high, estimate)');
  add('Prefill speed', Math.round(cand.speed.prefill_tps.mid) + ' tok/s (estimate)');
  add('Power', Math.round(cand.watts.load_w) + ' W load, ' + Math.round(cand.watts.idle_w) + ' W idle (estimated)');
  box.appendChild(dl);

  if (result.explorer_note) {
    const p = document.createElement('p');
    p.className = 'chart-note';
    p.textContent = result.explorer_note;
    box.appendChild(p);
  }
}
