#!/usr/bin/env node
// Build src/defaults.json from the LocoLabo TCO data pack + assumptions.json.
// Spec: sections 10, 11; kickoff prompt "Defaults pipeline".
// The parser tolerates BOM, CRLF, quoted fields with embedded commas,
// footer note rows and second tables inside a CSV.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PACK = path.join(ROOT, 'tco-data-pack');
const OUT = path.join(ROOT, 'src', 'defaults.json');

// ---------- CSV parsing ----------

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function parseTable(text) {
  const rows = parseCSV(text);
  const header = rows[0].map(h => h.trim().toLowerCase());
  return rows.slice(1).map(r => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function num(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).replace(/[$,\s]/g, '');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function round(v, dp) {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
}

function readCSV(name) {
  return parseTable(fs.readFileSync(path.join(PACK, name), 'utf8'));
}

// ---------- Load assumptions ----------

const assumptions = JSON.parse(fs.readFileSync(path.join(PACK, 'assumptions.json'), 'utf8'));

// ---------- Cards: picker snapshot + power estimates ----------

function buildCards() {
  const picker = readCSV('hardware_picker_snapshot.csv');
  const power = readCSV('power_estimates.csv');
  const byName = new Map();
  for (const p of power) {
    byName.set(p.card, {
      idle_w: num(p.est_idle_w),
      inference_w_low: num(p.est_inference_w_low),
      inference_w_mid: num(p.est_inference_w_mid),
      inference_w_high: num(p.est_inference_w_high),
      wh_per_1000_tokens_mid: num(p.wh_per_1000_tokens_mid),
      status_power: p.status,
      source_power: p.source,
      source_date_power: p.source_date
    });
  }
  const cards = [];
  for (const row of picker) {
    const vram = num(row.vram_gb);
    if (vram === null) continue; // skips footer rows
    const pw = byName.get(row.card) || {};
    cards.push({
      card: row.card,
      vendor: row.vendor,
      class: row.class,
      architecture: row.architecture,
      release_year: num(row.release_year),
      vram_gb: vram,
      bw_gbs: num(row.memory_bandwidth_gb_s),
      nameplate_w: num(row.power_draw_w_nameplate),
      cost_usd_low: num(row.cost_usd_low),
      cost_usd_mid: num(row.cost_usd_mid),
      cost_usd_high: num(row.cost_usd_high),
      cost_aud_low: num(row.cost_aud_low),
      cost_aud_mid: num(row.cost_aud_mid),
      cost_aud_high: num(row.cost_aud_high),
      llama_8b_q4_tps: num(row.llama_3_1_8b_q4_tps),
      mmlu_q4: num(row.mmlu_score_best_fit_q4),
      availability: row.availability_status,
      idle_w: pw.idle_w ?? null,
      inference_w_mid: pw.inference_w_mid ?? null,
      status: row.status,
      source: row.source,
      source_date: row.source_date,
      power_status: pw.status_power || null,
      power_source: pw.source_power || null,
      power_source_date: pw.source_date_power || null
    });
  }
  return cards;
}

// ---------- Tariffs ----------

function buildTariffs() {
  const rows = readCSV('electricity_tariffs_wa.csv');
  const idByClass = {
    'residential (swis a1)': 'residential',
    'small business standard (swis)': 'small_business_standard',
    'small business time-of-use': 'small_business_tou',
    'contestable / negotiated': 'contestable'
  };
  return rows.filter(r => idByClass[r.tariff_class.toLowerCase()]).map(r => {
    const demandRaw = r.demand_charge || '';
    const demandMatch = demandRaw.match(/(\d+)\D+(\d+)/);
    return {
      id: idByClass[r.tariff_class.toLowerCase()],
      label: r.tariff_class,
      consumer_size: r.consumer_size,
      ckwh_low: num(r['c/kwh_low']),
      ckwh_mid: num(r['c/kwh_mid']),
      ckwh_high: num(r['c/kwh_high']),
      supply_aud_day: num(r.supply_charge_aud_per_day),
      tou_available: r.time_of_use_available === 'yes',
      tou_peak_ckwh: num(r['peak_c/kwh']),
      tou_offpeak_ckwh: num(r['off_peak_c/kwh']),
      demand_charge_aud_kw_low: demandMatch ? Number(demandMatch[1]) : null,
      demand_charge_aud_kw_high: demandMatch ? Number(demandMatch[2]) : null,
      status: r.status.startsWith('estimated') ? 'estimated' : 'sourced',
      source: r.source,
      source_date: r.source_date,
      note: r.demand_notes || ''
    };
  });
}

// ---------- Workload: tasks and personas ----------

function buildWorkload() {
  const rows = readCSV('workload_profiles.csv');
  const tasks = [];
  const personas = [];
  let inPersonas = false;
  for (const r of rows) {
    if (r.task_type.toLowerCase() === 'persona') { inPersonas = true; continue; }
    if (r.task_type.toLowerCase().includes('note')) continue;
    if (!inPersonas) {
      const inTok = num(r.input_tokens_est);
      const outTok = num(r.output_tokens_est);
      if (inTok === null) continue;
      tasks.push({
        id: r.task_type.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''),
        label: r.task_type,
        description: r.description,
        input_tokens: inTok,
        output_tokens: outTok,
        share_power: num(r.power_user_share),
        share_typical: num(r.typical_user_share),
        share_light: num(r.light_user_share),
        status: r.status,
        source: r.source,
        source_date: r.source_date,
        note: r.notes
      });
    } else {
      // The persona table reuses the first table's columns:
      // task_type = name, description = queries/day, input_tokens_est = est tokens/day.
      const qpd = num(r.description);
      if (qpd === null) continue;
      const name = r.task_type.toLowerCase();
      const id = name.includes('power') ? 'power' : name.includes('typical') ? 'typical' : name.includes('light') ? 'light' : null;
      if (!id) continue;
      personas.push({
        id,
        label: r.task_type,
        queries_per_day: qpd,
        est_tokens_per_day_pack: num(r.input_tokens_est),
        status: r.status,
        source: r.source,
        source_date: r.source_date,
        note: r.notes
      });
    }
  }
  return { tasks, personas, note: 'Persona est_tokens_per_day is the pack column; the comparator uses mix x queries (spec 15 item 1).' };
}

// ---------- API classes computed from rows ----------

function buildApi(rowsRaw) {
  const rows = rowsRaw.filter(r => num(r.price_usd_per_1m_input) !== null);
  const mean = (list, field) => round(list.reduce((a, r) => a + num(r[field]), 0) / list.length, 2);
  const frontier = rows.filter(r => r.tier === 'frontier');
  const small = rows.filter(r => r.tier === 'small');
  const premium = rows.filter(r => r.tier === 'premium');
  const offshore = rows.filter(r => r.tier === 'frontier-budget');
  const byId = Object.fromEntries(assumptions.api_classes.map(c => [c.id, c]));
  const out = {};
  const mk = (id, inAud, outAud, ctxK) => ({
    id,
    label: byId[id].label,
    price_aud_per_1m_input: inAud,
    price_aud_per_1m_output: outAud,
    context_k: ctxK,
    status: byId[id].status,
    source: byId[id].source,
    source_date: byId[id].source_date,
    note: byId[id].note
  });
  out.best = mk('best', mean(frontier, 'price_aud_per_1m_input'), mean(frontier, 'price_aud_per_1m_output'), null);
  out.previous = mk('previous', null, null, null); // derived in engine from api.previous_ratio
  out.cheap = mk('cheap', mean(small, 'price_aud_per_1m_input'), mean(small, 'price_aud_per_1m_output'), null);
  out.premium = mk('premium', num(premium[0].price_aud_per_1m_input), num(premium[0].price_aud_per_1m_output), null);
  out.budget_offshore = mk('budget_offshore', num(offshore[0].price_aud_per_1m_input), num(offshore[0].price_aud_per_1m_output), null);
  out.rows = rows.map(r => ({
    provider: r.provider,
    model: r.model,
    tier: r.tier,
    price_usd_per_1m_input: num(r.price_usd_per_1m_input),
    price_usd_per_1m_output: num(r.price_usd_per_1m_output),
    price_aud_per_1m_input: num(r.price_aud_per_1m_input),
    price_aud_per_1m_output: num(r.price_aud_per_1m_output),
    context_window_tokens: num(r.context_window_tokens),
    status: r.status.startsWith('estimate') ? 'estimated' : r.status,
    source: r.source,
    source_date: r.source_date
  }));
  return out;
}

// ---------- Simple provence-preserving table dumps ----------

function provenanceRows(rowsRaw, mapFn, skipFn) {
  return rowsRaw.filter(skipFn || (() => true)).map(mapFn);
}

const rentalRows = () => provenanceRows(
  readCSV('cloud_gpu_rental_pricing.csv'),
  r => ({
    option: r.option, provider: r.provider, gpu_class: r.gpu_class,
    price_low: num(r.price_low), price_high: num(r.price_high), unit: r.unit,
    commitment: r.commitment, data_residency: r.data_residency,
    status: r.status.startsWith('estimate') ? 'estimated' : r.status,
    source: r.source, source_date: r.source_date, note: r.notes
  }),
  r => num(r.price_low) !== null
);

const subscriptionRows = () => provenanceRows(
  readCSV('cloud_subscription_pricing.csv'),
  r => ({
    provider: r.provider, plan: r.plan,
    price_usd_per_user_month: num(r.price_usd_per_user_month),
    price_aud_per_user_month: num(r.price_aud_per_user_month),
    usage_model: r.usage_model,
    status: r.status.startsWith('estimate') ? 'estimated' : (r.status || 'derived'),
    source: r.source || 'LocoLabo worked example', source_date: r.source_date || '2026-08-31',
    note: r.notes
  }),
  r => num(r.price_usd_per_user_month) !== null && r.provider.toLowerCase() !== 'note'
);

const efficiencyRows = () => provenanceRows(
  readCSV('token_efficiency_factors.csv'),
  r => ({
    model_class: r.model_class, example: r.example,
    equivalent_output_token_factor: num(r.equivalent_output_token_factor),
    retry_or_rerun_factor: num(r.retry_or_rerun_factor),
    combined_efficiency_factor: num(r.combined_efficiency_factor),
    capability_ceiling_mmlu_q4: r.capability_ceiling_mmlu_q4,
    status: r.status, source: r.source, source_date: r.source_date, note: r.notes
  }),
  r => num(r.combined_efficiency_factor) !== null
);

const labMachines = () => provenanceRows(
  readCSV('lab_fleet_machines.csv'),
  r => ({
    machine: r.machine, machine_role: r.machine_role, tco_scenario_mapped: r.tco_scenario_mapped,
    base_system_w_est: num(r.base_system_w_est), card_assignment: r.card_assignment,
    card_count: r.card_count, hosting_notes: r.hosting_notes,
    status: r.status, source: r.source, source_date: r.source_date
  }),
  r => num(r.base_system_w_est) !== null
);

const hidraCurve = () => provenanceRows(
  readCSV('hidra_scaling_curve.csv'),
  r => ({
    card_count: num(r.card_count),
    idle_w_machine_total: num(r.idle_w_machine_total),
    load_w_machine_total: num(r.load_w_machine_total),
    total_tokens_per_sec: num(r.total_tokens_per_sec),
    wh_per_1000_tokens_marginal: num(r.wh_per_1000_tokens_marginal),
    wh_per_1000_tokens_total: num(r.wh_per_1000_tokens_total),
    status: r.status, source: r.source, source_date: r.source_date
  }),
  r => num(r.card_count) !== null
);

// ---------- Assemble ----------

const defaults = {
  meta: {
    ...assumptions.meta,
    generated_by: 'scripts/build-defaults.js',
    generated_at: new Date().toISOString().slice(0, 10)
  },
  parameters: assumptions.parameters,
  platforms: assumptions.platforms,
  ram_steps_gb: assumptions.ram_steps_gb,
  gpu_bands: assumptions.gpu_bands,
  tariff_defaults: assumptions.tariff_defaults,
  rental_classes: assumptions.rental_classes,
  subscription_tiers: assumptions.subscription_tiers,
  api_classes: assumptions.api_classes,
  quality_targets: assumptions.quality_targets,
  model_ladder: assumptions.model_ladder,
  usage_presets: assumptions.usage_presets,
  usage_modes: assumptions.usage_modes,
  efficiency_size_bands: assumptions.efficiency_size_bands,
  cloud_efficiency_factors: assumptions.cloud_efficiency_factors,
  sensitivity_rules: assumptions.sensitivity_rules,
  presets: assumptions.presets,
  task_types: assumptions.task_types,
  payoff_multiples: assumptions.payoff_multiples,
  request_plans: assumptions.request_plans,
  rules: assumptions.rules,
  features: assumptions.features,
  defaults_inputs: assumptions.defaults_inputs,
  disclaimer: assumptions.disclaimer,
  tables: {
    cards: buildCards(),
    tariffs: buildTariffs(),
    workload: buildWorkload(),
    api: buildApi(readCSV('cloud_api_pricing.csv')),
    rental_rows: rentalRows(),
    subscription_rows: subscriptionRows(),
    efficiency_rows: efficiencyRows(),
    lab_machines: labMachines(),
    hidra_curve: hidraCurve()
  }
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(defaults, null, 1) + '\n');

const counts = [
  `parameters: ${Object.keys(defaults.parameters).length}`,
  `cards: ${defaults.tables.cards.length}`,
  `tariffs: ${defaults.tables.tariffs.length}`,
  `tasks: ${defaults.tables.workload.tasks.length}`,
  `personas: ${defaults.tables.workload.personas.length}`,
  `api rows: ${defaults.tables.api.rows.length}`,
  `rental rows: ${defaults.tables.rental_rows.length}`,
  `subscription rows: ${defaults.tables.subscription_rows.length}`,
  `efficiency rows: ${defaults.tables.efficiency_rows.length}`,
  `lab machines: ${defaults.tables.lab_machines.length}`,
  `hidra points: ${defaults.tables.hidra_curve.length}`
];
console.log('Wrote ' + path.relative(ROOT, OUT));
console.log(counts.join('\n'));
