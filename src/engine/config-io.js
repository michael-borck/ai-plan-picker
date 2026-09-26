// config-io.js: whole-configuration export and import, preset application
// and full reset (spec 10). Pure functions over the config object.

import { setParam, resetParam, getParam } from './params.js';
import { ZERO, ONE } from './units.js';

const CONFIG_KIND = 'ai-delivery-comparator-config';
const CONFIG_VERSION = ONE;

// Export every parameter record with full provenance, so the file can be
// re-imported on another machine and is readable on its own.
export function exportConfig(config) {
  return {
    kind: CONFIG_KIND,
    version: CONFIG_VERSION,
    exported: new Date().toISOString().split('T')[ZERO],
    parameters: Object.fromEntries(
      Object.entries(config.parameters).map(([id, rec]) => {
        const out = {
          value: rec.value,
          low: rec.low,
          high: rec.high,
          unit: rec.unit,
          status: rec.status,
          source: rec.source,
          source_date: rec.source_date,
          note: rec.note || ''
        };
        if (rec.original) out.original = rec.original;
        return [id, out];
      })
    )
  };
}

// Merge an exported configuration into the current defaults. Unknown ids are
// skipped and reported, not silently dropped. Edited (user-supplied) records
// keep their status and original.
export function importConfig(config, imported) {
  if (!imported || imported.kind !== CONFIG_KIND || !imported.parameters) {
    throw new Error('Not an AI Delivery Comparator configuration file.');
  }
  let applied = ZERO;
  const skipped = [];
  let next = config;
  for (const [id, rec] of Object.entries(imported.parameters)) {
    if (!next.parameters[id] || typeof rec.value !== 'number') {
      skipped.push(id);
      continue;
    }
    const merged = {
      ...next.parameters[id],
      value: rec.value,
      status: rec.status || next.parameters[id].status
    };
    if (rec.original) merged.original = rec.original;
    else delete merged.original;
    next = { ...next, parameters: { ...next.parameters, [id]: merged } };
    applied += ONE;
  }
  return { config: next, report: { applied, skipped } };
}

// Apply a named preset from config.presets. Each edit goes through setParam,
// so provenance is preserved: the pre-preset value is kept as the original.
export function applyPreset(config, preset_id) {
  const preset = (config.presets || []).find(p => p.id === preset_id);
  if (!preset) throw new Error('Unknown preset: ' + preset_id);
  let next = config;
  for (const [id, value] of Object.entries(preset.edits)) {
    next = setParam(next, id, value);
  }
  return next;
}

// Restore every parameter to its default value and status (spec 10:
// "LocoLabo defaults (this spec)").
export function resetAllParams(config) {
  let next = config;
  for (const id of Object.keys(next.parameters)) {
    next = resetParam(next, id);
  }
  return next;
}

// Params the user has touched (status user-supplied), for persistence.
export function editedParams(config) {
  const out = {};
  for (const [id, rec] of Object.entries(config.parameters)) {
    if (rec.status === 'user-supplied') {
      out[id] = { value: rec.value, status: rec.status, original: rec.original };
    }
  }
  return out;
}

export function hasEdits(config) {
  return Object.keys(editedParams(config)).length > ZERO;
}

// Apply saved edits (from localStorage or a user-saved preset) to defaults.
export function applyEdits(config, edits) {
  let next = config;
  for (const [id, rec] of Object.entries(edits || {})) {
    if (!next.parameters[id] || typeof rec.value !== 'number') continue;
    next = setParam(next, id, rec.value);
    if (rec.original) {
      const withOriginal = { ...getParam(next, id), original: rec.original };
      next = { ...next, parameters: { ...next.parameters, [id]: withOriginal } };
    }
  }
  return next;
}
