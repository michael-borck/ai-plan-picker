// memory.js: model memory need (spec 6.1).
// weights_GB  = total_params_B x bits_per_weight / 8
// kv_GB       = context_k x (kv_base + kv_per_b x total_params_B)   per stream
// runtime_GB  = config
// required_GB = weights_GB + kv_GB x streams + runtime_GB
// One billion parameter-bytes is exactly one GB, so no further scaling
// (see units.js GB_PER_BILLION_PARAM_BYTES). All coefficients come from config.

import { pval } from './params.js';
import { BITS_PER_BYTE } from './units.js';

export function modelMemory(config, { total_params_b, bits_per_weight, context_k, streams }) {
  const weightsGB = total_params_b * bits_per_weight / BITS_PER_BYTE;
  const kvPerStreamGB = context_k *
    (pval(config, 'memory.kv_base_gb_per_ktoken') + pval(config, 'memory.kv_per_b_gb_per_ktoken') * total_params_b);
  const kvGB = kvPerStreamGB * streams;
  const runtimeGB = pval(config, 'memory.runtime_gb');
  const requiredGB = weightsGB + kvGB + runtimeGB;
  return {
    weights_gb: weightsGB,
    kv_gb_per_stream: kvPerStreamGB,
    kv_gb: kvGB,
    runtime_gb: runtimeGB,
    required_gb: requiredGB
  };
}
