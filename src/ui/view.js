// view.js: renderers for the Single user tab. No calculations here: every
// number comes from compute(config, inputs). Australian English, no em
// dashes, every estimate labelled as an estimate.

function $(id) { return document.getElementById(id); }

function optionRow(o, result) {
  const tr = document.createElement('tr');
  if (o.sensitivity.vetoed) tr.className = 'vetoed';
  else if (result.recommendation.winner && o.id === result.recommendation.winner.id) tr.className = 'winner';

  const beText = o.break_even_vs_local == null
    ? 'not within 5 years'
    : o.break_even_vs_local === 0 ? 'cheaper from the start' : 'month ' + o.break_even_vs_local;

  const ctx = o.context_check
    ? (o.context_check.pass ? 'pass' : 'fail (' + o.context_check.required_k.toFixed(1) + 'k needed)')
    : '-';

  const flags = [];
  if (o.sensitivity.vetoed) flags.push('sensitivity veto');
  else if (o.sensitivity.flagged) flags.push('flagged');
  if ((o.flags || []).includes('allowance_assumed')) flags.push('allowance is an estimate');

  const cells = [
    o.label + (o.sub_label ? ' <span class="tag">' + o.sub_label + '</span>' : ''),
    o.upfront_aud ? audStr(o.upfront_aud) : '-',
    audStr(o.monthly_avg_aud, 2) + '/mo',
    ...o.tco_at_years.map(v => audStr(v, 0)),
    perUserPerMonth(o, result),
    beText,
    o.capacity_sq_per_day == null ? 'unlimited' : Math.round(o.capacity_sq_per_day).toLocaleString('en-AU') + ' SQ/day',
    Math.round((o.own_share != null ? o.own_share : o.coverage) * 100) + '%',
    o.topup_monthly_aud ? '$' + o.topup_monthly_aud.toFixed(2) : '-',
    o.per_user_tps_mid == null ? '-' : Math.round(o.per_user_tps_mid) + ' tok/s',
    o.lockout_h_per_day ? o.lockout_h_per_day.toFixed(1) + ' h/day' : '0',
    Math.round(o.wait_hours_per_user_year) + ' h/yr',
    o.utilisation == null ? '-' : Math.round(o.utilisation * 100) + '%',
    o.cost_per_task_aud == null ? '-' : '$' + o.cost_per_task_aud.toFixed(4),
    o.cost_per_completed_task_aud == null ? '-' : '$' + o.cost_per_completed_task_aud.toFixed(4),
    gridVerdict(o),
    ctx,
    o.data_location,
    flags.join(', ') || '-'
  ];
  for (const c of cells) {
    const td = document.createElement('td');
    td.innerHTML = c;
    tr.appendChild(td);
  }
  return tr;
}

function audStr(v, dp) {
  const n = Number(v);
  return '$' + (Number.isFinite(n) ? n.toLocaleString('en-AU', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 }) : '-');
}

function perUserPerMonth(o, result) {
  if (o.upfront_aud === 0 && o.family !== 'local') {
    return audStr(o.tco_at_horizon / (result.inputs_used.horizon_years * 12), 2) + '/user/mo';
  }
  return audStr(o.tco_at_horizon / (result.inputs_used.horizon_years * 12), 2) + '/user/mo';
}

function renderTable(result) {
  const tbody = $('compare-body');
  tbody.innerHTML = '';
  for (const o of result.options) tbody.appendChild(optionRow(o, result));
}

function renderHardwareCard(result) {
  const box = $('hardware-card');
  const hw = result.hardware_card;
  if (!hw) {
    box.innerHTML = '<p>No local build meets this scenario. See the recommendation for alternatives.</p>';
    return;
  }
  const breakdown = hw.price_breakdown;
  box.innerHTML = '';
  const title = document.createElement('h2');
  title.textContent = 'Local hardware card: ' + hw.platform;
  box.appendChild(title);
  const dl = document.createElement('dl');
  dl.className = 'hw-grid';
  const add = (t, d) => {
    const dt = document.createElement('dt'); dt.textContent = t;
    const dd = document.createElement('dd'); dd.textContent = d;
    dl.appendChild(dt); dl.appendChild(dd);
  };
  add('GPU', hw.gpu + ' (' + hw.band + ')');
  add('RAM', hw.ram_gb + ' GB ' + hw.ram_type.toUpperCase());
  add('Placement', hw.placement + ', GPU share ' + Math.round(hw.gpu_share * 100) + '%');
  add('Memory', reqGb(hw) + ' GB required of ' + Math.round(hw.memory.capacity_gb) + ' GB (estimate)');
  add('Decode speed', spd(hw.decode_tps) + ' (estimate, read the band)');
  add('Prefill speed', spd(hw.prefill_tps) + ' (estimate)');
  add('Batched at ' + hw.batching.concurrency + ' streams', Math.round(hw.batching.aggregate_tps_mid) + ' tok/s aggregate');
  add('Capability', hw.capability + ' quality target, efficiency factor ' + hw.efficiency_factor);
  add('Power', Math.round(hw.load_w) + ' W load, ' + Math.round(hw.idle_w) + ' W idle (estimated)');
  add('Market', hw.market + (hw.market === 'secondhand' ? ': no warranty, supply varies' : ', warranted'));
  add('Cost breakdown', 'platform ' + audStr(breakdown.platform_aud) + ' + cards ' + audStr(breakdown.gpus_aud) +
    (breakdown.extra_gpu_aud ? ' + extra GPU fit ' + audStr(breakdown.extra_gpu_aud) : '') +
    (breakdown.ram_aud ? ' + RAM ' + audStr(breakdown.ram_aud) : '') +
    ' = ' + audStr(breakdown.total_aud));
  box.appendChild(dl);
}

function reqGb(hw) { return hw.memory.required_gb.toFixed(1); }
function spd(t) { return Math.round(t.low) + ' / ' + Math.round(t.mid) + ' / ' + Math.round(t.high) + ' tok/s (low/mid/high)'; }

function renderRecommendation(result) {
  const box = $('recommendation');
  box.innerHTML = '';
  const p = document.createElement('p');
  p.textContent = result.recommendation.text;
  box.appendChild(p);
  if (result.recommendation.robustness && !result.recommendation.robustness.robust) {
    const list = document.createElement('p');
    list.className = 'chart-note';
    const rows = result.recommendation.robustness.flips.map(f => f.param_id + ' at its ' + f.at + ' value picks ' + f.winner_id);
    list.textContent = 'The answer changes when: ' + rows.join('; ') + '.';
    box.appendChild(list);
  }
}

function renderTeaching(result) {
  const box = $('teaching');
  const d = result.demand;
  const w = result.recommendation.winner;
  const lines = [
    'Standard Query (spec 2.2): input ' + Math.round(d.sq_in_per_day) + ' tokens/day, output ' +
      Math.round(d.sq_out_per_day) + ' tokens/day at ' + Math.round(d.sq_per_day) + ' SQ/day.',
    'Thinking multiplier (spec 2.6): ' + d.thinking_multiplier + ' x output tokens.',
    'Cloud token demand (spec 2.5): ' + Math.round(d.tokens_cloud_per_day).toLocaleString('en-AU') + ' tokens/day.',
    'Local token demand adds the verbosity factor of the chosen model size (spec 2.5).',
    'Generation time per SQ (spec 2.3): input over prefill rate plus output over decode rate.',
    'Task layer (spec 2.8): attempts = 1 / (success rate x reliability); a task is Slow when it spans windows, retries or overruns the session tolerance.'
  ];
  if (w) {
    lines.push('Winner own share (spec 2.8): ' + Math.round((w.own_share || 0) * 100) + '% of the week on its own' +
      (w.topup_monthly_aud ? ', top-up $' + w.topup_monthly_aud.toFixed(2) + '/month' : '') + '.');
  }
  lines.push('All figures are estimates.');
  box.textContent = lines.join('\n');
}

function renderVetoNote(result) {
  const box = $('veto-note');
  const vetoed = result.options.filter(o => o.sensitivity.vetoed);
  if (!vetoed.length) { box.textContent = ''; return; }
  box.textContent = 'Vetoed by the ' + result.inputs_used.data_sensitivity +
    ' data rule, still shown for comparison: ' + vetoed.map(o => o.label).join('; ') + '.';
}

function renderPlanCards(result) {
  const wrap = $('plan-cards');
  if (!wrap) return;
  wrap.innerHTML = '';
  const wanted = ['sub_free', 'sub_base', 'sub_pro', 'api_cheap', 'api_best'];
  const picks = [];
  for (const id of wanted) {
    const o = result.options.find(x => x.id === id);
    if (o) picks.push(o);
  }
  // Two local cards: the cheapest build, and the cheapest build with an
  // actual GPU card, because "local AI machine" usually means a GPU.
  const locals = result.options.filter(o => o.family === 'local');
  const cheapestLocal = locals[0];
  const gpuLocal = locals.find(o => o.candidate && o.candidate.n_gpu >= 1);
  const shownLocalIds = new Set();
  if (cheapestLocal) { picks.unshift(cheapestLocal); shownLocalIds.add(cheapestLocal.id); }
  const winnerId = result.recommendation.winner && result.recommendation.winner.id;

  if (gpuLocal && !shownLocalIds.has(gpuLocal.id)) {
    picks.splice(cheapestLocal ? 1 : 0, 0, gpuLocal);
    shownLocalIds.add(gpuLocal.id);
  }

  for (const o of picks) {
    const card = document.createElement('div');
    card.className = 'plan-card' + (o.id === winnerId ? ' winner' : '') + (o.sensitivity.vetoed ? ' vetoed' : '');
    const name = document.createElement('h3');
    name.textContent = planFamilyName(o);
    card.appendChild(name);
    if (o.id === winnerId) {
      const badge = document.createElement('span');
      badge.className = 'tag winner-tag';
      badge.textContent = 'recommended';
      name.appendChild(badge);
    }
    const build = document.createElement('p');
    build.className = 'chart-note';
    build.textContent = planBuildLine(o);
    card.appendChild(build);
    const price = document.createElement('p');
    price.className = 'plan-price';
    price.textContent = (o.upfront_aud ? 'AUD ' + Math.round(o.upfront_aud).toLocaleString('en-AU') + ' upfront, then ' : '') +
      '$' + o.monthly_avg_aud.toFixed(2) + '/month';
    card.appendChild(price);
    const speed = document.createElement('p');
    const tps = o.per_user_tps_mid;
    speed.textContent = 'Speed: about ' + Math.round(tps) + ' tok/s (' + speedFeel(tps) + ').';
    card.appendChild(speed);
    const task = document.createElement('p');
    task.textContent = gridVerdict(o);
    card.appendChild(task);
    const day = document.createElement('p');
    day.textContent = o.coverage >= 1
      ? 'Covers the day described above.'
      : 'Runs dry at about ' + Math.round(o.coverage * 100) + '% of that day.';
    card.appendChild(day);
    const meta = document.createElement('p');
    meta.className = 'chart-note';
    meta.textContent = (o.sensitivity.vetoed ? 'Blocked by your data rule. ' : '') +
      'Data: ' + o.data_location + '.';
    card.appendChild(meta);
    wrap.appendChild(card);
  }
}

function planFamilyName(o) {
  if (o.family === 'local') {
    return o.candidate && o.candidate.n_gpu >= 1 ? 'Local box with GPU' : 'Local box, CPU only';
  }
  const map = { sub_free: 'Free tier', sub_base: 'Base seat', sub_pro: 'Pro seat', sub_max: 'Max seat',
    api_cheap: 'API, cheap models', api_best: 'API, best models', api_previous: 'API, previous models' };
  return map[o.id] || o.label;
}

function planBuildLine(o) {
  if (o.family === 'local') {
    const gpu = o.candidate && o.candidate.n_gpu >= 1
      ? o.candidate.card_ref + (o.candidate.n_gpu > 1 ? ' x ' + o.candidate.n_gpu : '')
      : 'no GPU card, runs on the processor';
    return o.candidate.platform_label + ', ' + gpu + ', ' + o.candidate.ram_gb + ' GB RAM';
  }
  if (o.family === 'subscription') {
    return 'Seat on the ' + o.cloud_class + ' cloud class, ' + Math.round(20000 * o.tier.allowance_multiplier / 1000) + 'k tokens per ' +
      CONFIG.parameters['subscriptions.window_h'].value + ' h window';
  }
  if (o.family === 'api') {
    return 'AUD ' + o.api_class.price_aud_per_1m_input.toFixed(2) + ' per million in, ' +
      o.api_class.price_aud_per_1m_output.toFixed(2) + ' per million out';
  }
  return o.sub_label || '';
}

function renderUsageSummary(result) {
  const box = $('usage-summary');
  if (!box) return;
  const d = result.demand;
  const mode = CONFIG.usage_modes.find(m => m.id === result.inputs_used.usage_mode);
  const preset = d.preset;
  box.textContent = 'Your usage: ' + Math.round(d.sq_per_day) + ' tasks a day (about ' +
    Math.round(d.tokens_cloud_per_day / 1000) + 'k tokens of cloud work), ' +
    mode.label + ' mode, ' + preset.label + ' (' + preset.interactive_h + ' h a day), thinking ' +
    result.inputs_used.thinking + '. Change it below and the cards follow.';
}

function crossoverStatements(result) {
  const local = result.options.find(o => o.family === 'local');
  if (!local) return [];
  const statements = [];
  for (const id of ['sub_pro', 'sub_base', 'api_cheap', 'api_best']) {
    const other = result.options.find(o => o.id === id);
    if (!other) continue;
    let be = null;
    for (let m = 0; m <= other.tco_series.months; m++) {
      if (local.tco_series.nominal[m] <= other.tco_series.nominal[m]) { be = m; break; }
    }
    statements.push(be == null
      ? 'The local box never pays for itself against ' + other.label + ' within 5 years.'
      : 'The local box pays for itself against ' + other.label + ' at month ' + be + '.');
  }
  return statements;
}

function renderCrossoverNotes(result) {
  const detailed = $('crossover-note');
  if (detailed) detailed.textContent = crossoverStatements(result).join(' ');
  const simple = $('simple-crossovers');
  if (simple) simple.textContent = crossoverStatements(result).join(' ');
}

function gridVerdict(o) {
  if (!o.task_cells) return '';
  const counted = o.task_cells.filter(c => c.count > ZERO_CELL);
  const bad = counted.filter(c => c.status === 'no');
  if (bad.length) return bad[0].label + ': ' + bad[0].reasons[0] + ', topped up by ' + (bad[0].topup_class || 'nothing') + '.';
  const slow = counted.filter(c => c.status === 'slow');
  if (slow.length) return slow[0].label + ': ' + slow[0].reasons.join('; ') + '.';
  return 'Runs your whole week' + (o.own_share < 1 ? ' with pay-as-you-go top-up.' : ' on its own.');
}

const ZERO_CELL = 0;

function speedFeel(tps) {
  if (tps >= 100) return 'instant feel';
  if (tps >= 30) return 'fast';
  if (tps >= 10) return 'typing pace';
  return 'painfully slow';
}

function weekGrid(result, containerId) {
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  const tasks = result.options[0] && result.options[0].task_cells ? result.options[0].task_cells : [];
  const table = document.createElement('table');
  table.className = 'compare week-grid';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const heads = ['Option', 'On its own'].concat(tasks.map(t => t.label + ' (' + Math.round(t.count) + '/wk)'));
  for (const h of heads) {
    const th = document.createElement('th');
    th.innerHTML = h;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const o of result.options) {
    const tr = document.createElement('tr');
    if (o.sensitivity.vetoed) tr.className = 'vetoed';
    else if (result.recommendation.winner && o.id === result.recommendation.winner.id) tr.className = 'winner';
    const name = document.createElement('td');
    name.innerHTML = o.label + ' <span class="chart-note">' + Math.round((o.own_share != null ? o.own_share : 0) * 100) + '% on its own</span>';
    tr.appendChild(name);
    for (const c of o.task_cells) {
      const td = document.createElement('td');
      if (c.count === 0) {
        td.innerHTML = '<span class="chart-note">not in your week</span>';
      } else if (c.status === 'no') {
        td.innerHTML = '<strong>No.</strong> ' + c.reasons[0] + (c.topup_class ? ' Top-up: ' + c.topup_class + '.' : ' Left undone.');
      } else if (c.status === 'slow') {
        const mins = c.wall_s > 0 ? Math.round(c.wall_s / 60) + ' min' : '';
        td.innerHTML = '<strong>Slow.</strong> ' + c.reasons.join(' ') + (mins ? ' About ' + mins + ' per task.' : '') + (c.leftover > 0 && c.topup_class ? ' Top-up: ' + c.topup_class + '.' : '');
      } else {
        td.innerHTML = '<strong>Yes.</strong>' + (c.leftover > 0 && c.topup_class ? ' Partly, top-up: ' + c.topup_class + '.' : '');
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function renderChecklist(config) {
  const wrap = $('features-checklist');
  if (!wrap || !config.features_checklist) return;
  wrap.innerHTML = '';
  const rows = ['Web search', 'File upload', 'Code execution', 'Image input', 'Voice', 'Admin console', 'SSO', 'Audit logs', 'No-training commitment'];
  const table = document.createElement('table');
  table.className = 'compare';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  hr.appendChild(document.createElement('th'));
  for (const col of config.features_checklist.columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const feat of rows) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = feat;
    tr.appendChild(td);
    for (const col of config.features_checklist.columns) {
      const td = document.createElement('td');
      td.textContent = col.yes.includes(feat) ? 'yes' : 'no';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function renderAll(config, result) {
  weekGrid(result, 'week-grid');
  weekGrid(result, 'week-grid-simple');
  renderChecklist(config);
  costPerTaskChartRender('cost-chart', result);
  renderRecommendation(result);
  renderTable(result);
  renderHardwareCard(result);
  renderVetoNote(result);
  renderTeaching(result);
  renderPlanCards(result);
  renderUsageSummary(result);
  renderCrossoverNotes(result);
  renderProfileControls(result);
  tornadoChartRender('tornado-chart', result.tornado,
    result.recommendation.winner && result.recommendation.runner_up
      ? result.recommendation.winner.tco_at_horizon - result.recommendation.runner_up.tco_at_horizon
      : null);
  tcoChartRender('tco-chart', result, state.globals);
  profileChartRender('profile-chart', result);
  waitChartRender('wait-chart', result);
  capacityChartRender('capacity-chart', result);
}

function renderProfileControls(result) {
  const sel = $('profile-option');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '';
  for (const o of result.options) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
}
