// speed.js: single-stream token rate and batched throughput (spec 6.4, 6.5).
//
// bytes_per_token = active_params_B x bits_per_weight / 8    (in GB, see units.js)
// gpu_share       = clamp((VRAM_usable - kv - runtime) / weights, 0, 1)
// if MoE and gpu_share < 1: gpu_share = min(1, gpu_share + bonus)
// t_token   = gpu_share x bytes / (eta_gpu x BW_gpu)
//           + (1 - gpu_share) x bytes / (eta_cpu x BW_ram)
// decode_tps  = layer_split_factor / t_token        (1.00 one card, 0.90 split)
// prefill_tps = decode_tps x prefill_multiplier
//
// Bytes-per-token is in GB and bandwidth in GB/s, so the GB scale cancels and
// t_token is in seconds with no conversion constant. Low/mid/high come from
// the efficiency band around each size point's eta mid.

import { pval } from './params.js';
import { BITS_PER_BYTE, GB_PER_BILLION_PARAM_BYTES, ZERO, ONE } from './units.js';

function clamp01(x) {
  if (x < ZERO) return ZERO;
  if (x > ONE) return ONE;
  return x;
}

// Placement prefill multiplier parameter key (spec 6.4).
export function prefillMultiplierKey(placement, generation) {
  if (placement === 'gpu_only') return generation === 'legacy' ? 'speed.prefill_multiplier_gpu_legacy' : 'speed.prefill_multiplier_gpu_modern';
  if (placement === 'hybrid') return 'speed.prefill_multiplier_hybrid';
  if (placement === 'cpu_only') return 'speed.prefill_multiplier_cpu';
  return 'speed.prefill_multiplier_unified';
}

// placement: 'gpu_only' | 'hybrid' | 'cpu_only' | 'unified'
// bw_gpu_gbs / bw_ram_gbs: effective bandwidths in GB/s.
// eta_mid: the size point's mid efficiency for the GPU path; the unified and
// CPU-only paths use speed.eta_cpu (docs/decisions.md D4).
export function singleStreamSpeed(config, opts) {
  const {
    placement, generation, vram_usable_gb, bw_gpu_gbs, eta_mid,
    bw_ram_gbs, n_gpu, weights_gb, kv_gb, runtime_gb,
    active_params_b, bits_per_weight, moe
  } = opts;

  const bytesPerTokenGB = active_params_b * bits_per_weight / BITS_PER_BYTE * GB_PER_BILLION_PARAM_BYTES;

  let gpuShare = clamp01((vram_usable_gb - kv_gb - runtime_gb) / weights_gb);
  // MoE bonus (spec 6.4): attention and shared layers stay on the GPU when
  // weights spill. Meaningless when there is no GPU path (CPU-only).
  const gpuPathExists = placement === 'gpu_only' || placement === 'hybrid';
  if (moe && gpuPathExists && gpuShare < ONE) {
    gpuShare = Math.min(ONE, gpuShare + pval(config, 'speed.moe_gpu_bonus'));
  }

  const unifiedLike = placement === 'unified' || placement === 'cpu_only';
  const gpuPathActive = gpuShare > ZERO && gpuPathExists;
  const ramPathActive = gpuShare < ONE;

  const etaCpu = pval(config, 'speed.eta_cpu');
  const etaGpuMid = eta_mid != null ? eta_mid : etaCpu;
  const etaGpuLow = etaGpuMid * pval(config, 'speed.eta_low_factor');
  const etaGpuHigh = etaGpuMid * pval(config, 'speed.eta_high_factor');
  // The band applies to the memory path generally, CPU side included.
  const etaRamLow = etaCpu * pval(config, 'speed.eta_low_factor');
  const etaRamMid = etaCpu;
  const etaRamHigh = etaCpu * pval(config, 'speed.eta_high_factor');

  // Time per token for a given pair of path efficiencies.
  function tToken(etaGpu, etaRam) {
    let t = ZERO;
    if (gpuPathActive) t += gpuShare * bytesPerTokenGB / (etaGpu * bw_gpu_gbs);
    if (ramPathActive) t += (ONE - gpuShare) * bytesPerTokenGB / (etaRam * bw_ram_gbs);
    return t;
  }

  const layerFactor = n_gpu > ONE ? pval(config, 'speed.layer_split_factor') : ONE;

  function tpsFor(etaGpu, etaRam) {
    if (!gpuPathActive && !ramPathActive) return ZERO;
    const t = tToken(etaGpu, etaRam);
    if (t <= ZERO) return ZERO;
    return layerFactor / t;
  }

  const decode = {
    low: tpsFor(etaGpuLow, etaRamLow),
    mid: tpsFor(etaGpuMid, etaRamMid),
    high: tpsFor(etaGpuHigh, etaRamHigh)
  };

  const prefillKey = prefillMultiplierKey(placement, generation);
  const prefillMult = pval(config, prefillKey);
  const prefill = {
    low: decode.low * prefillMult,
    mid: decode.mid * prefillMult,
    high: decode.high * prefillMult
  };

  return {
    bytes_per_token_gb: bytesPerTokenGB,
    gpu_share: gpuShare,
    unified_like: unifiedLike,
    decode_tps: decode,
    prefill_tps: prefill,
    prefill_multiplier_key: prefillKey
  };
}

// Batched throughput (spec 6.5): G(c) = c / (1 + (c - 1) x beta).
// Concurrency defaults to 1 so the single-user path is unaffected.
export function batchGain(config, concurrency) {
  const c = Math.max(ONE, concurrency);
  const beta = pval(config, 'speed.batching_beta');
  return c / (ONE + (c - ONE) * beta);
}

export function batchedSpeeds(config, singleStream, concurrency) {
  const g = batchGain(config, concurrency);
  const c = Math.max(ONE, concurrency);
  const agg = {
    low: singleStream.decode_tps.low * g,
    mid: singleStream.decode_tps.mid * g,
    high: singleStream.decode_tps.high * g
  };
  return {
    gain: g,
    aggregate_tps: agg,
    // Prefill gains little from batching: aggregate prefill = single-stream prefill.
    aggregate_prefill_tps: singleStream.prefill_tps,
    per_user_tps: {
      low: agg.low / c,
      mid: agg.mid / c,
      high: agg.high / c
    }
  };
}

// Max concurrent streams by KV memory and by the minimum-speed floor (spec 6.5).
export function maxStreams(config, { vram_usable_gb, weights_gb, runtime_gb, kv_gb_per_stream, decode_mid_tps, min_speed_tps }) {
  const roomGB = vram_usable_gb - weights_gb - runtime_gb;
  const byMemory = roomGB > ZERO && kv_gb_per_stream > ZERO
    ? Math.max(ONE, Math.floor(roomGB / kv_gb_per_stream))
    : ONE;
  const bySpeed = min_speed_tps > ZERO && decode_mid_tps > ZERO
    ? Math.max(ONE, Math.floor(decode_mid_tps / min_speed_tps))
    : ONE;
  return {
    by_memory: byMemory,
    by_speed: bySpeed,
    max: Math.min(byMemory, bySpeed)
  };
}
