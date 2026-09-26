#!/usr/bin/env node
// ai-plan-picker command line: recommendation and comparison reports from the
// same engine the HTML page uses (Phase C). No dependencies beyond Node 20+.
//
//   node bin/comparator.js --format one-line
//   node bin/comparator.js --persona power --usage_mode agentic --format table
//   node bin/comparator.js --config my-settings.json --format markdown
//   node bin/comparator.js --format json
//   node bin/comparator.js --sweep --out sweep.csv

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compute } from '../src/engine/compute.js';
import { importConfig } from '../src/engine/config-io.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function usage() {
  return `ai-plan-picker: AI delivery comparison (local vs rented GPU vs subscription vs API)

Usage:
  node bin/comparator.js [options]

Options:
  --config <file>        Configuration JSON (as exported from the Settings panel)
  --persona <id>         power | typical | light
  --usage_mode <id>      chat | documents | agentic
  --usage_preset <id>    occasional | part_day | workday | extended | workday_agents | always_on
  --thinking <level>     off | low | medium | high
  --quality_target <id>  basic | good | high
  --data_sensitivity <r> public | internal | sensitive
  --horizon <years>      1 to 5
  --own_week <file>      JSON of task counts per week (task id to number)
  --format <fmt>         one-line (default) | table | markdown | json
  --sweep                CSV across personas and usage modes
  --out <file>           Write the report to a file instead of stdout
  --help                 This text`;
}

function parseArgs(argv) {
  const args = {};
  const FLAGS = new Set(['help', 'sweep', 'rule_topup', 'rule_exclude_may_train']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (FLAGS.has(key)) args[key] = true;
    else { args[key] = argv[i + 1]; i++; }
  }
  return args;
}

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'defaults.json');

function loadConfig(configFile) {
  const base = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!configFile) return base;
  const imported = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const { config, report } = importConfig(base, imported);
  process.stderr.write(`config: applied ${report.applied} parameters` +
    (report.skipped.length ? `, skipped ${report.skipped.length}: ${report.skipped.join(', ')}` : '') + '\n');
  return config;
}

function engineInputs(args) {
  const inputs = {};
  if (args.persona) inputs.persona = args.persona;
  if (args.usage_mode) inputs.usage_mode = args.usage_mode;
  if (args.usage_preset) inputs.usage_preset = args.usage_preset;
  if (args.thinking) inputs.thinking = args.thinking;
  if (args.quality_target) inputs.quality_target = args.quality_target;
  if (args.data_sensitivity) inputs.data_sensitivity = args.data_sensitivity;
  if (args.horizon) inputs.horizon_years = Number(args.horizon);
  if (args.own_week) {
    const counts = JSON.parse(fs.readFileSync(args.own_week, 'utf8'));
    inputs.own_week = { enabled: true, counts };
  }
  if (args.rule_topup !== undefined || args.rule_exclude_may_train !== undefined) {
    inputs.rules = {
      top_up: args.rule_topup === undefined ? true : args.rule_topup !== 'false',
      exclude_may_train: args.rule_exclude_may_train === 'true'
    };
  }
  return inputs;
}

const aud = v => 'AUD ' + Math.round(v).toLocaleString('en-AU');

function oneLine(result) {
  const w = result.recommendation.winner;
  if (!w) return 'No option passes the filters for this scenario.';
  const own = Math.round((w.own_share != null ? w.own_share : 0) * 100);
  return `Choose ${w.label}: ${aud(w.tco_at_horizon)} over ${result.inputs_used.horizon_years} years, ` +
    `${own}% of the week on its own` +
    (w.topup_monthly_aud ? `, top-up $${w.topup_monthly_aud.toFixed(2)}/month included` : '') + '. ' +
    result.recommendation.text;
}

function tableFormat(result) {
  const lines = [];
  lines.push('option'.padEnd(34) + 'upfront'.padStart(8) + 'monthly'.padStart(9) +
    'TCO 3y'.padStart(9) + 'own%'.padStart(6) + 'topup/mo'.padStart(9) + 'tok/s'.padStart(6) + '  pass');
  for (const o of result.options) {
    lines.push(o.label.slice(0, 33).padEnd(34) +
      String(o.upfront_aud ? Math.round(o.upfront_aud) : '-').padStart(8) +
      Number(o.monthly_avg_aud).toFixed(2).padStart(9) +
      String(Math.round(o.tco_at_horizon)).padStart(9) +
      String(Math.round((o.own_share != null ? o.own_share : 0) * 100)).padStart(5) + '%' +
      Number(o.topup_monthly_aud || 0).toFixed(2).padStart(9) +
      String(o.per_user_tps_mid ? Math.round(o.per_user_tps_mid) : '-').padStart(6) +
      '  ' + (o.passes_filters && !o.sensitivity.vetoed ? 'yes' : o.sensitivity.vetoed ? 'vetoed' : 'no'));
  }
  lines.push('');
  lines.push(result.recommendation.text);
  return lines.join('\n');
}

function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|');
}

function markdownFormat(result) {
  const lines = [];
  lines.push('# AI plan picker report');
  lines.push('');
  const inp = result.inputs_used;
  lines.push(`Scenario: single user, ${inp.persona} persona, ${inp.usage_preset} preset, ${inp.usage_mode} mode, ` +
    `${inp.quality_target} quality, ${inp.data_sensitivity} data, ${inp.horizon_years}-year horizon. All figures are estimates.`);
  lines.push('');
  lines.push('## Recommendation');
  lines.push('');
  lines.push(result.recommendation.text);
  lines.push('');
  lines.push('## Options compared');
  lines.push('');
  lines.push('| Option | Upfront | Monthly | TCO at horizon | On its own | Top-up/mo | Data |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const o of result.options) {
    lines.push(`| ${mdEscape(o.label)} | ${o.upfront_aud ? aud(o.upfront_aud) : '-'} | $${Number(o.monthly_avg_aud).toFixed(2)} | ${aud(o.tco_at_horizon)} | ${Math.round((o.own_share != null ? o.own_share : 0) * 100)}% | $${Number(o.topup_monthly_aud || 0).toFixed(2)} | ${o.data_location} |`);
  }
  lines.push('');
  lines.push('## Can it do your week?');
  lines.push('');
  const tasks = result.options[0].task_cells;
  lines.push('| Option | On its own | ' + tasks.map(t => `${mdEscape(t.label)} (${Math.round(t.count)}/wk)`).join(' | ') + ' |');
  lines.push('|---|---:|' + tasks.map(() => '---').join('|') + '|');
  for (const o of result.options) {
    const cells = o.task_cells.map(c => {
      if (c.count === 0) return '-';
      const tag = c.status === 'yes' ? 'Yes' : c.status === 'slow' ? 'Slow' : 'No';
      const top = c.topup_class ? ` (top-up: ${mdEscape(c.topup_class)})` : '';
      return `**${tag}**${top}`;
    });
    lines.push(`| ${mdEscape(o.label)} | ${Math.round((o.own_share != null ? o.own_share : 0) * 100)}% | ` + cells.join(' | ') + ' |');
  }
  lines.push('');
  lines.push('## Sensitivity');
  lines.push('');
  for (const row of result.tornado || []) {
    lines.push(`- ${row.label} (\`${row.param_id}\`): gap at low ${row.low_gap == null ? '-' : aud(row.low_gap)}, at high ${row.high_gap == null ? '-' : aud(row.high_gap)}`);
  }
  lines.push('');
  lines.push('Data: LocoLabo TCO Data Pack, 31 August 2026, plus dated assumptions. Not financial or tax advice.');
  return lines.join('\n');
}

function jsonFormat(result) {
  return JSON.stringify({
    scenario: result.inputs_used,
    recommendation: {
      winner: result.recommendation.winner && result.recommendation.winner.id,
      winner_label: result.recommendation.winner && result.recommendation.winner.label,
      runner_up: result.recommendation.runner_up && result.recommendation.runner_up.id,
      robustness: result.recommendation.robustness,
      text: result.recommendation.text
    },
    options: result.options.map(o => ({
      id: o.id, family: o.family, label: o.label,
      upfront_aud: o.upfront_aud, monthly_avg_aud: o.monthly_avg_aud,
      tco_at_horizon: o.tco_at_horizon, tco_at_years: o.tco_at_years,
      own_share: o.own_share, topup_monthly_aud: o.topup_monthly_aud,
      coverage: o.coverage, per_user_tps_mid: o.per_user_tps_mid,
      wait_hours_per_user_year: o.wait_hours_per_user_year,
      cost_per_completed_task_aud: o.cost_per_completed_task_aud,
      passes: o.passes_filters && !o.sensitivity.vetoed,
      vetoed: o.sensitivity.vetoed,
      task_cells: o.task_cells
    })),
    tornado: result.tornado
  }, null, 1);
}

function sweep(config) {
  const rows = ['persona,usage_mode,winner,winner_tco_aud,runner_up,runner_up_tco_aud,own_share_pct,topup_monthly_aud,payoff_multiple'];
  for (const persona of ['light', 'typical', 'power']) {
    for (const usage_mode of ['chat', 'documents', 'agentic']) {
      const r = compute(config, { persona, usage_mode, horizon_years: 3 });
      const w = r.recommendation.winner;
      const ru = r.recommendation.runner_up;
      const payoff = (r.recommendation.text.match(/pays off at about ([\d.]+)x/) || [])[1] || '';
      rows.push([
        persona, usage_mode,
        `"${w ? w.label : 'none'}"`, w ? Math.round(w.tco_at_horizon) : '',
        `"${ru ? ru.label : 'none'}"`, ru ? Math.round(ru.tco_at_horizon) : '',
        w ? Math.round((w.own_share != null ? w.own_share : 0) * 100) : 0,
        w ? Number(w.topup_monthly_aud || 0).toFixed(2) : '0.00',
        payoff
      ].join(','));
    }
  }
  return rows.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return 0; }
  const config = loadConfig(args.config);
  const inputs = engineInputs(args);

  let output;
  if (args.sweep) {
    output = sweep(config);
  } else {
    const result = compute(config, inputs);
    switch (args.format || 'one-line') {
      case 'one-line': output = oneLine(result); break;
      case 'table': output = tableFormat(result); break;
      case 'markdown': output = markdownFormat(result); break;
      case 'json': output = jsonFormat(result); break;
      default: process.stderr.write('Unknown format: ' + args.format + '\n'); return 2;
    }
  }
  if (args.out) {
    fs.writeFileSync(args.out, output + '\n');
    process.stderr.write('wrote ' + args.out + '\n');
  } else {
    console.log(output);
  }
  return 0;
}

process.exit(main());
