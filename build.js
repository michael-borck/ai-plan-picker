#!/usr/bin/env node
// build.js: bundle src/ into dist/comparator.html, one self-contained file
// that opens offline by double-clicking (CLAUDE.md deliverable; spec 14).
// The engine modules are plain ES modules; this script strips import/export
// syntax and concatenates them in dependency order. No transform beyond that.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname; // build.js sits in the project root
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'comparator.html');

const ENGINE_ORDER = [
  'units.js', 'params.js', 'memory.js', 'hardware.js', 'speed.js', 'configSearch.js',
  'demand.js', 'localCost.js', 'rental.js', 'subscription.js', 'api.js', 'timeSeries.js',
  'fitChecks.js', 'taskLayer.js', 'profile24.js', 'select.js', 'recommend.js', 'config-io.js', 'compute.js'
];

function stripEsm(code) {
  return code
    // multi-line named imports first, then anything left on one line
    .replace(/import\s*\{[^}]*\}\s*from\s*'[^']*';?/g, '')
    .split('\n')
    .filter(line => !/^\s*import\s/.test(line))
    .filter(line => !/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line))
    .map(line => line
      .replace(/^(\s*)export\s+function\s/, '$1function ')
      .replace(/^(\s*)export\s+const\s/, '$1const ')
      .replace(/^(\s*)export\s+let\s/, '$1let '))
    .join('\n');
}

function read(p) {
  return fs.readFileSync(path.join(SRC, p), 'utf8');
}

const engineBundle = ENGINE_ORDER.map(f => {
  const code = stripEsm(read(path.join('engine', f)));
  return '// ---- engine/' + f + ' ----\n' + code;
}).join('\n\n');

const uiBundle = ['ui/state.js', 'ui/view.js', 'charts/tcoChart.js', 'charts/charts.js', 'ui/explorer.js', 'ui/settings.js', 'ui/main.js']
  .map(f => '// ---- ' + f + ' ----\n' + read(f))
  .join('\n\n');

const css = read('styles.css');
const chartJs = fs.readFileSync(path.join(SRC, 'vendor', 'chart.umd.js'), 'utf8');
const configJson = fs.readFileSync(path.join(SRC, 'defaults.json'), 'utf8').trim();

const html = `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Delivery Comparator</title>
<style>
${css}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-row">
    <div class="brand">AI Delivery Comparator
      <small>Local hardware vs rented GPU vs subscription vs API. All figures are estimates.</small>
    </div>
    <nav class="tabs" aria-label="Organisation size">
      <button data-tab="single_user" aria-selected="true">Single user</button>
      <button data-tab="small_business" disabled title="Deferred to v2">Small business</button>
      <button data-tab="enterprise" disabled title="Deferred to v2">Enterprise</button>
      <button data-tab="compare_sizes" disabled title="Deferred to v2">Compare sizes</button>
    </nav>
    <div class="globals">
      <label>Horizon
        <select id="g-horizon">
          <option value="1">1 year</option>
          <option value="2">2 years</option>
          <option value="3" selected>3 years</option>
          <option value="4">4 years</option>
          <option value="5">5 years</option>
        </select>
      </label>
      <label>GST
        <select id="g-gst">
          <option value="ex" selected>ex GST</option>
          <option value="incl">incl GST</option>
        </select>
      </label>
      <label><input type="checkbox" id="g-teaching"> Teaching</label>
      <button id="settings-btn" aria-haspopup="dialog">Settings</button>
    </div>
  </div>
</header>

<main>
  <section class="card">
    <h1>Single user</h1>
    <nav class="subview" aria-label="Sub-view">
      <button data-view="plan" aria-selected="true">Pick a plan</button>
      <button data-view="explorer" aria-selected="false">Hardware explorer</button>
      <label class="checkbox-line simple-toggle"><span>Simple view</span><input type="checkbox" id="view-simple"></label>
    </nav>
    <div class="grid-inputs detailed-only" id="inputs-grid"></div>
    <p class="chart-note" id="status-line"></p>
  </section>

  <section class="card explorer-only detailed-only">
    <h2>Hardware explorer</h2>
    <label class="checkbox-line"><span>Use explorer choice in the comparison</span><input type="checkbox" id="ex-use"></label>
    <div class="grid-inputs" id="explorer-grid"></div>
    <div class="grid-inputs">
      <label><span>Quantisation</span><select id="ex-quant"></select></label>
      <label><span>Context window</span><select id="ex-context"></select></label>
    </div>
    <div id="explorer-result"></div>
    <div class="chart-box"><canvas id="frontier-chart" role="img" aria-label="Budget frontier: largest model runnable per budget"></canvas></div>
    <p class="chart-note">Budget only mode returns a ladder rung, never an in-between size. Every figure here is an estimate from a bandwidth model, so read the low and high band.</p>
  </section>

  <section class="card simple-only">
    <h2>Rules</h2>
    <label class="checkbox-line"><span>Top up what a plan cannot finish, with pay-as-you-go (recommended)</span><input type="checkbox" id="rule-topup" checked></label>
    <label class="checkbox-line"><span>Leave out services that may train on my data</span><input type="checkbox" id="rule-maytrain"></label>
    <label class="checkbox-line"><span>Use my own week: type the counts yourself</span><input type="checkbox" id="own-week-enabled"></label>
    <div class="grid-inputs" id="own-week-inputs"></div>
  </section>

  <section class="card simple-only">
    <h2>Can it do your week?</h2>
    <div class="table-wrap" id="week-grid-simple"></div>
    <p class="chart-note">Yes means the plan finishes that task in a sitting. Slow means it works but with waiting: retries, reset windows or pace. No means it cannot, and the work goes to the top-up service named in the cell.</p>
  </section>

  <section class="card simple-only">
    <h2>The plans, side by side</h2>
    <p id="usage-summary"></p>
    <div class="grid-inputs" id="simple-inputs">
      <label><span>How much you use it</span><select id="sm-preset"></select></label>
      <label><span>What you do with it</span><select id="sm-mode"></select></label>
      <label><span>User type</span><select id="sm-persona"></select></label>
      <label><span>Thinking effort</span><select id="sm-thinking"></select></label>
    </div>
    <div class="plan-cards" id="plan-cards"></div>
    <p class="chart-note">Like a phone plan: seats meter seats, API meters tokens, rental meters hours, local meters ownership. The verdict uses your biggest kind of task, not just token totals. Try Power user plus Agentic: pay-as-you-go stops being cheap.</p>
    <p id="simple-crossovers" class="chart-note"></p>
  </section>

  <section class="card recommendation" id="recommendation-card">
    <h2>Plan advice</h2>
    <div id="recommendation"></div>
    <div class="teaching" id="teaching"></div>
  </section>

  <section class="card detailed-only">
    <h2>Can it do your week?</h2>
    <div class="table-wrap" id="week-grid"></div>
    <p class="chart-note">Rows are options, columns are your task types this week. Yes finishes in a sitting; Slow works but with waiting; No cannot, and tops up.</p>
  </section>

  <section class="card detailed-only">
    <h2>Cumulative TCO, months 0 to 60</h2>
    <div class="chart-mode" id="chart-mode"></div>
    <div class="chart-box"><canvas id="tco-chart" role="img" aria-label="Cumulative total cost of ownership by month for each option"></canvas></div>
    <p class="chart-note" id="chart-mode-note"></p>
    <p class="chart-note" id="crossover-note"></p>
    <p class="chart-note" id="veto-note"></p>
  </section>

  <section class="card detailed-only">
    <h2>24-hour delivery profile</h2>
    <label class="chart-note">Show delivered tokens for
      <select id="profile-option"></select>
    </label>
    <div class="chart-box"><canvas id="profile-chart" role="img" aria-label="Cumulative demand versus delivered tokens across one day"></canvas></div>
    <p class="chart-note" id="profile-note"></p>
  </section>

  <section class="card detailed-only">
    <h2>Cost per completed task</h2>
    <div class="chart-box"><canvas id="cost-chart" role="img" aria-label="Cost per completed task by option, log scale"></canvas></div>
    <p class="chart-note">TCO including top-up, divided by the tasks actually completed this week.</p>
  </section>

  <section class="card detailed-only">
    <h2>Sensitivity tornado</h2>
    <div class="chart-box"><canvas id="tornado-chart" role="img" aria-label="How each parameter swings the cost gap between the winner and the runner-up"></canvas></div>
    <p class="chart-note" id="tornado-note"></p>
  </section>

  <section class="card detailed-only">
    <h2>Waiting time</h2>
    <div class="chart-box"><canvas id="wait-chart" role="img" aria-label="Hours per user per year spent waiting, by option"></canvas></div>
    <p class="chart-note">Waiting uses each option's speed and time to first token. Slow local builds can cost days of your year: the value of time input prices it.</p>
  </section>

  <section class="card detailed-only">
    <h2>Comparison table</h2>
    <div class="table-wrap">
      <table class="compare">
        <thead>
          <tr>
            <th>Option</th><th>Upfront</th><th>Monthly avg</th>
            <th>TCO 1y</th><th>TCO 2y</th><th>TCO 3y</th><th>TCO 4y</th><th>TCO 5y</th>
            <th>Per user per month</th><th>Break-even vs local</th>
            <th>Capacity</th><th>On its own</th><th>Top-up/mo</th><th>Speed</th><th>Lockout</th>
            <th>Waiting</th><th>Utilisation</th><th>Cost per task</th>
            <th>Biggest task</th><th>Context</th><th>Data location</th><th>Flags</th>
          </tr>
        </thead>
        <tbody id="compare-body"></tbody>
      </table>
    </div>
  </section>

  <section class="card detailed-only" id="hardware-card"></section>

  <section class="card detailed-only">
    <h2>More charts</h2>
    <details class="more">
      <summary>Capacity versus demand, and remaining charts as they are built.</summary>
      <div class="chart-box"><canvas id="capacity-chart" role="img" aria-label="Capacity in Standard Queries per day versus demand"></canvas></div>
    </details>
    <details class="more">
      <summary>Deferred to v2: winner map, combinations routing, business and enterprise tabs.</summary>
    </details>
  </section>

  <section class="card detailed-only">
    <h2>Features checklist</h2>
    <div class="table-wrap" id="features-checklist"></div>
    <p class="chart-note">Indicative and editable; not scored in v1. Providers differ per product.</p>
  </section>

  <section class="card disclaimer">
    <h2>Disclaimer: estimates, not measurements</h2>
    <ol id="disclaimer-list"></ol>
  </section>
</main>

<footer>
  <p class="chart-note">Every parameter is editable with provenance in the Settings panel. Data: LocoLabo TCO Data Pack, 31 August 2026, plus assumptions marked in the specification. This page gives estimates, not financial or tax advice.</p>
</footer>

<aside id="settings-panel" role="dialog" aria-label="Settings" aria-hidden="true">
  <div class="settings-head">
    <h2>Settings: every parameter, with provenance</h2>
    <button id="settings-close" aria-label="Close settings">Close</button>
  </div>
  <nav class="settings-tabs" id="settings-tabs" aria-label="Settings sections"></nav>
  <div class="settings-scroll" id="settings-body"></div>
  <div class="settings-foot">
    <div class="preset-row">
      <select id="preset-select" aria-label="Preset"></select>
      <button id="preset-apply">Apply preset</button>
      <input type="text" id="preset-name" placeholder="Save current as...">
      <button id="preset-save">Save</button>
      <button id="preset-delete">Delete saved</button>
    </div>
    <div class="preset-row">
      <button id="export-config">Export JSON</button>
      <input type="file" id="import-file" accept="application/json">
      <button id="import-config">Import JSON</button>
      <button id="reset-config">Restore LocoLabo defaults</button>
    </div>
    <textarea id="import-export" rows="4" placeholder="Exported JSON appears here; or paste a configuration to import."></textarea>
    <p class="chart-note" id="settings-status"></p>
  </div>
</aside>
<div id="settings-backdrop"></div>

<script>${chartJs}</script>
<script>window.__COMPARE_CONFIG__ = ${configJson};</script>
<script>
${engineBundle}

${uiBundle}

// Disclaimer text from the configuration (spec 12), rendered verbatim.
(function () {
  const list = document.getElementById('disclaimer-list');
  for (const line of window.__COMPARE_CONFIG__.disclaimer.lines) {
    const li = document.createElement('li');
    li.textContent = line;
    list.appendChild(li);
  }
})();
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('Wrote dist/comparator.html (' + kb + ' KB)');
