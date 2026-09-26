// params.js: parameter access and provenance-safe editing (spec 10).
// A parameter record: {id, label, value, low, high, unit, status, source,
// source_date, note}. Status: sourced | estimated | assumed | user-supplied.

export function getParam(config, id) {
  const rec = config.parameters[id];
  if (!rec) throw new Error('Unknown parameter: ' + id);
  return rec;
}

export function pval(config, id) {
  return getParam(config, id).value;
}

export function plow(config, id) {
  return getParam(config, id).low;
}

export function phigh(config, id) {
  return getParam(config, id).high;
}

export function isBanded(config, id) {
  const rec = getParam(config, id);
  return typeof rec.low === 'number' && typeof rec.high === 'number' && rec.low !== rec.high;
}

// Edit a parameter: status becomes user-supplied and the original record is
// kept under .original (spec 10, test T10). Returns a new config; the input
// config is never mutated.
export function setParam(config, id, value) {
  const rec = getParam(config, id);
  const next = { ...rec, value, status: 'user-supplied' };
  if (!rec.original) next.original = { value: rec.value, status: rec.status, source: rec.source, source_date: rec.source_date };
  else next.original = rec.original;
  return withParameter(config, id, next);
}

// Restore the original value and status of an edited parameter.
export function resetParam(config, id) {
  const rec = getParam(config, id);
  if (!rec.original) return config;
  const restored = { ...rec };
  restored.value = rec.original.value;
  restored.status = rec.original.status;
  restored.source = rec.original.source;
  restored.source_date = rec.original.source_date;
  delete restored.original;
  return withParameter(config, id, restored);
}

export function withParameter(config, id, record) {
  return { ...config, parameters: { ...config.parameters, [id]: record } };
}

// Provenance text for tooltips: shows the original when edited (T10).
export function provenanceText(config, id) {
  const rec = getParam(config, id);
  const base = rec.value + ' ' + (rec.unit || '') + ' [' + rec.status + '] ' + (rec.source || '') + ' ' + (rec.source_date || '');
  if (rec.original) {
    return base + ' (original: ' + rec.original.value + ' [' + rec.original.status + '] ' + (rec.original.source || '') + ')';
  }
  return base;
}
