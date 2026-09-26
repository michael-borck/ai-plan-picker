// Settings panel engine tests: presets, export/import, reset (spec 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportConfig, importConfig, applyPreset, resetAllParams, editedParams, applyEdits, hasEdits } from '../src/engine/config-io.js';
import { setParam, getParam } from '../src/engine/params.js';
import { compute } from '../src/engine/compute.js';
import { loadConfig } from './helpers.js';

test('presets: the four spec presets exist', () => {
  const config = loadConfig();
  const ids = (config.presets || []).map(p => p.id);
  for (const id of ['locolabo_defaults', 'picker_snapshot', 'pessimistic_local', 'optimistic_local']) {
    assert.ok(ids.includes(id), id);
  }
});

test('presets: applying one marks edited params user-supplied and keeps originals', () => {
  const config = loadConfig();
  const before = getParam(config, 'power.inference_factor');
  const next = applyPreset(config, 'pessimistic_local');
  const rec = getParam(next, 'power.inference_factor');
  assert.equal(rec.value, 0.75);
  assert.equal(rec.status, 'user-supplied');
  assert.equal(rec.original.value, before.value);
  assert.equal(rec.original.status, before.status);
});

test('presets: optimistic makes the local box cheaper than pessimistic', () => {
  const config = loadConfig();
  const scenario = { persona: 'power', quality_target: 'high', horizon_years: 3 };
  const pess = compute(applyPreset(config, 'pessimistic_local'), scenario);
  const opt = compute(applyPreset(config, 'optimistic_local'), scenario);
  const localPess = pess.options.filter(o => o.family === 'local').sort((a, b) => a.tco_at_horizon - b.tco_at_horizon)[0];
  const localOpt = opt.options.filter(o => o.family === 'local').sort((a, b) => a.tco_at_horizon - b.tco_at_horizon)[0];
  assert.ok(localPess.tco_at_horizon > localOpt.tco_at_horizon,
    'pessimistic ' + Math.round(localPess.tco_at_horizon) + ' should exceed optimistic ' + Math.round(localOpt.tco_at_horizon));
});

test('presets: picker snapshot changes flagship band price to the snapshot value', () => {
  const config = loadConfig();
  const next = applyPreset(config, 'picker_snapshot');
  assert.ok(Math.abs(getParam(next, 'hardware.band_price_flagship_aud_per_gb').value - 59.74) < 0.01);
});

test('reset: restoring all defaults returns values and statuses', () => {
  const config = loadConfig();
  const edited = applyPreset(setParam(config, 'fx.usd_aud', 1.6), 'pessimistic_local');
  const restored = resetAllParams(edited);
  for (const [id, rec] of Object.entries(restored.parameters)) {
    const fresh = config.parameters[id];
    assert.equal(rec.value, fresh.value, id + ' value restored');
    assert.equal(rec.status, fresh.status, id + ' status restored');
    assert.equal(rec.original, undefined, id + ' original cleared');
  }
});

test('export/import round-trip preserves results and provenance', () => {
  const config = loadConfig();
  const edited = applyPreset(setParam(config, 'fx.usd_aud', 1.6), 'optimistic_local');
  const exported = exportConfig(edited);
  const { config: imported, report } = importConfig(loadConfig(), JSON.parse(JSON.stringify(exported)));
  assert.equal(report.applied, Object.keys(exported.parameters).length);
  assert.deepEqual(report.skipped, []);
  assert.equal(getParam(imported, 'fx.usd_aud').status, 'user-supplied');
  assert.equal(getParam(imported, 'fx.usd_aud').original.value, 1.54);

  const scenario = { persona: 'power', quality_target: 'high', horizon_years: 3 };
  const a = compute(edited, scenario);
  const b = compute(imported, scenario);
  assert.deepEqual(
    a.options.map(o => [o.id, Math.round(o.tco_at_horizon)]),
    b.options.map(o => [o.id, Math.round(o.tco_at_horizon)])
  );
});

test('import skips unknown ids instead of failing', () => {
  const config = loadConfig();
  const { config: next, report } = importConfig(config, {
    kind: 'ai-delivery-comparator-config',
    version: 1,
    parameters: {
      'fx.usd_aud': { value: 1.6 },
      'not.a.parameter': { value: 42 }
    }
  });
  assert.equal(report.skipped[0], 'not.a.parameter');
  assert.equal(getParam(next, 'fx.usd_aud').value, 1.6);
});

test('import rejects files that are not comparator configs', () => {
  const config = loadConfig();
  assert.throws(() => importConfig(config, { hello: true }));
});

test('edited params round-trip through the compact edit form', () => {
  const config = loadConfig();
  const edited = applyPreset(config, 'pessimistic_local');
  const edits = editedParams(edited);
  assert.ok(Object.keys(edits).length >= 12, 'the pessimistic preset touches a dozen parameters');
  const revived = applyEdits(loadConfig(), JSON.parse(JSON.stringify(edits)));
  for (const id of Object.keys(edits)) {
    assert.equal(getParam(revived, id).value, getParam(edited, id).value, id);
  }
  assert.ok(hasEdits(revived));
  assert.ok(!hasEdits(loadConfig()));
});
