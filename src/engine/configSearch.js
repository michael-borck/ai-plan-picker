// configSearch.js: single-box configuration search and placement classes
// (spec 6.3). Pure enumeration; no DOM, no globals.
//
//   for platform in platforms (market + warranty filter):
//     for band_row in gpu_rows + [none]:
//       for n_gpu in 0..platform.max_gpus:
//         for ram in ram_steps:
//           cost = platform + n_gpu x card + (n_gpu - 1)+ x extra_gpu + extra_ram
//           if cost > budget cap: skip
//           placement and speed (6.4)
//
// Placement classes: GPU-only (required <= n x VRAM x usable share), Hybrid
// (GPU + RAM - OS reserve), CPU-only, Unified (pool x addressable), No fit.

import { modelMemory } from './memory.js';
import { singleStreamSpeed } from './speed.js';
import { platformsForSearch, bandsForSearch, cardPrice, systemPrice, ramStepsFor } from './hardware.js';
import { pval } from './params.js';
import { ZERO, ONE } from './units.js';

// Resolve placement for one hardware combination against the memory need.
export function resolvePlacement(config, { platform, size, n_gpu, ram_gb, memory }) {
  const usableShare = pval(config, 'memory.gpu_usable_share');
  const osReserve = pval(config, 'memory.os_reserve_gb');

  if (platform.kind === 'unified') {
    const capacity = platform.incl_ram_gb * pval(config, 'memory.unified_addressable_share');
    if (memory.required_gb <= capacity) {
      return { placement: 'unified', vram_usable_gb: capacity, ram_path_gb: capacity, fits: true, capacity_gb: capacity };
    }
    return { placement: 'no_fit', fits: false, capacity_gb: capacity };
  }

  const vramUsable = size ? n_gpu * size.vram_gb * usableShare : ZERO;
  const ramUsable = Math.max(ZERO, ram_gb - osReserve);

  if (n_gpu >= ONE && memory.required_gb <= vramUsable) {
    return { placement: 'gpu_only', vram_usable_gb: vramUsable, ram_path_gb: ZERO, fits: true, capacity_gb: vramUsable };
  }
  if (n_gpu >= ONE && memory.required_gb <= vramUsable + ramUsable) {
    return { placement: 'hybrid', vram_usable_gb: vramUsable, ram_path_gb: ramUsable, fits: true, capacity_gb: vramUsable + ramUsable };
  }
  if (memory.required_gb <= ramUsable) {
    return { placement: 'cpu_only', vram_usable_gb: ZERO, ram_path_gb: ramUsable, fits: true, capacity_gb: ramUsable };
  }
  return { placement: 'no_fit', fits: false, capacity_gb: vramUsable + ramUsable };
}

function wattsFor(config, { platform, size, n_gpu, placement }) {
  const factor = pval(config, 'power.inference_factor');
  const cpuOffloadW = (placement === 'hybrid' || placement === 'cpu_only') ? pval(config, 'power.cpu_offload_w') : ZERO;
  const cardLoad = size ? n_gpu * size.nameplate_w * factor : ZERO;
  const cardIdle = size ? n_gpu * size.idle_w : ZERO;
  return {
    load_w: platform.base_w + cardLoad + cpuOffloadW,
    idle_w: platform.base_idle_w + cardIdle
  };
}

// Enumerate configurations. opts:
//   model: { total_b, active_b, moe }
//   bits, context_k, streams
//   must_be_new, allow_server, budget_aud (null = auto), min_speed_tps (null = no filter)
// Returns qualifying candidates sorted by price, cheapest first, plus rejected
// near-misses when nothing fits (for no-fit messages, spec test T5).
export function searchConfigs(config, opts) {
  const o = { must_be_new: false, allow_server: false, budget_aud: null, min_speed_tps: null, streams: ONE, ...opts };
  const { model, bits, context_k, must_be_new, allow_server, budget_aud, min_speed_tps } = o;
  const streams = o.streams != null ? o.streams : ONE;

  const memory = modelMemory(config, {
    total_params_b: model.total_b,
    bits_per_weight: bits,
    context_k,
    streams
  });

  const qualifying = [];
  const nearMisses = [];

  for (const platform of platformsForSearch(config, { must_be_new, allow_server })) {
    const bandRows = [...bandsForSearch(config, { must_be_new }).flatMap(b => b.sizes.map(size => ({ band: b, size }))), null];
    for (const row of bandRows) {
      const maxGpus = row ? platform.max_gpus : ZERO;
      for (let nGpu = row ? ONE : ZERO; nGpu <= maxGpus; nGpu++) {
        const cardAud = row ? cardPrice(config, row.band, row.size) : ZERO;
        for (const ramGb of ramStepsFor(config, platform)) {
          const price = systemPrice(config, platform, cardAud, nGpu, ramGb);
          if (budget_aud != null && price.total_aud > budget_aud) continue;

          const place = resolvePlacement(config, { platform, size: row ? row.size : null, n_gpu: nGpu, ram_gb: ramGb, memory });
          if (!place.fits) {
            nearMisses.push({ platform, row, n_gpu: nGpu, ram_gb: ramGb, price, memory, placement: place });
            continue;
          }

          const speed = singleStreamSpeed(config, {
            placement: place.placement,
            generation: row ? row.band.generation : 'legacy',
            vram_usable_gb: place.vram_usable_gb,
            bw_gpu_gbs: row ? row.size.bw_gbs : ZERO,
            eta_mid: row && place.placement !== 'cpu_only' ? row.size.eta_mid : null,
            bw_ram_gbs: platform.ram_bw_gbs,
            n_gpu: nGpu,
            weights_gb: memory.weights_gb,
            kv_gb: memory.kv_gb,
            runtime_gb: memory.runtime_gb,
            active_params_b: model.active_b,
            bits_per_weight: bits,
            moe: model.moe
          });

          const cand = {
            platform_id: platform.id,
            platform_label: platform.label,
            platform,
            band_id: row ? row.band.id : null,
            band_label: row ? row.band.label : null,
            band_generation: row ? row.band.generation : null,
            band_market: row ? row.band.market : platform.market,
            size: row ? row.size : null,
            card_ref: row ? row.size.card_ref : null,
            n_gpu: nGpu,
            ram_gb: ramGb,
            ram_type: platform.ram_type,
            placement: place.placement,
            price,
            price_aud: price.total_aud,
            memory: { ...memory, capacity_gb: place.capacity_gb },
            speed,
            watts: wattsFor(config, { platform, size: row ? row.size : null, n_gpu: nGpu, placement: place.placement }),
            market: platform.market,
            warranty: platform.warranty,
            signature: [platform.id, row ? row.band.id : 'none', row ? row.size.vram_gb : 'na', nGpu, ramGb].join('/')
          };

          if (min_speed_tps != null && speed.decode_tps.mid < min_speed_tps) {
            nearMisses.push({ ...cand, rejected: 'slow' });
            continue;
          }
          qualifying.push(cand);
        }
      }
    }
  }

  qualifying.sort((a, b) => a.price_aud - b.price_aud);
  return { memory, qualifying, near_misses: nearMisses };
}

// Cheapest configuration that fits at all (ignoring speed and budget), for
// no-fit messages (spec test T5: "No-fit message with computed alternatives").
export function cheapestFit(config, opts) {
  const full = searchConfigs(config, { ...opts, budget_aud: null, min_speed_tps: null });
  return full.qualifying.length ? full.qualifying[0] : null;
}
