// api.js: token pricing, caching, markup (spec 6.11, 11.8).
// daily = [in x (1 - cached) x p_in + in x cached x p_in x (1 - discount)
//          + out x p_out] / 1e6 x (1 + markup)

import { pval } from './params.js';
import { TOKENS_PER_MILLION, ONE, ZERO } from './units.js';

const CLASS_CONTEXT_PARAMS = {
  best: 'fit.context_best_k',
  previous: 'fit.context_previous_k',
  cheap: 'fit.context_cheap_k'
};

const OPTIONAL_CONTEXT_PARAMS = {
  premium: 'fit.context_best_k',
  budget_offshore: 'fit.context_cheap_k'
};

// Price record for an API class in AUD per million tokens. Best, Cheap,
// Premium and Budget offshore come from the pack mean rows; Previous is
// derived from Best by api.previous_ratio (spec 11.8).
export function apiClassInfo(config, class_id) {
  const table = config.tables.api;
  const meta = config.api_classes.find(c => c.id === class_id);
  if (!meta) throw new Error('Unknown API class: ' + class_id);

  if (class_id === 'previous') {
    const ratio = pval(config, 'api.previous_ratio');
    const best = table.best;
    return {
      id: class_id,
      label: meta.label,
      price_aud_per_1m_input: Math.round(best.price_aud_per_1m_input * ratio * 100) / 100,
      price_aud_per_1m_output: Math.round(best.price_aud_per_1m_output * ratio * 100) / 100,
      context_k: pval(config, CLASS_CONTEXT_PARAMS.previous),
      status: meta.status,
      source: meta.source,
      source_date: meta.source_date,
      note: meta.note
    };
  }

  const row = table[class_id];
  const contextParam = CLASS_CONTEXT_PARAMS[class_id] || OPTIONAL_CONTEXT_PARAMS[class_id];
  return {
    id: class_id,
    label: meta.label,
    price_aud_per_1m_input: row.price_aud_per_1m_input,
    price_aud_per_1m_output: row.price_aud_per_1m_output,
    context_k: pval(config, contextParam),
    status: meta.status,
    source: meta.source,
    source_date: meta.source_date,
    note: meta.note
  };
}

export function cachedShareForMode(config, mode_id) {
  return pval(config, 'api.cached_share_' + mode_id);
}

// AUD per day for a given token volume (spec 6.11).
export function apiDailyCostAud(config, { class_id, tokens_in, tokens_out, cached_share }) {
  const info = apiClassInfo(config, class_id);
  const cached = cached_share != null ? cached_share : ZERO;
  const uncachedIn = tokens_in * (ONE - cached) * info.price_aud_per_1m_input;
  const cachedIn = tokens_in * cached * info.price_aud_per_1m_input * (ONE - pval(config, 'api.cache_discount'));
  const out = tokens_out * info.price_aud_per_1m_output;
  const markup = pval(config, 'api.intermediary_markup');
  return (uncachedIn + cachedIn + out) / TOKENS_PER_MILLION * (ONE + markup);
}
