// hardware.js: platforms, GPU bands priced per GB, RAM steps (spec 6.2, 11.1, 11.2).

import { pval } from './params.js';

export function platformById(config, id) {
  const p = config.platforms.find(x => x.id === id);
  if (!p) throw new Error('Unknown platform: ' + id);
  return p;
}

export function bandById(config, id) {
  const b = config.gpu_bands.find(x => x.id === id);
  if (!b) throw new Error('Unknown GPU band: ' + id);
  return b;
}

// Platforms allowed for a search: market filter ("must be new and warranted",
// spec 6.2) and server availability (server platforms are available in the
// small business 21+ band and enterprise; not in the single user tab).
export function platformsForSearch(config, { must_be_new, allow_server }) {
  return config.platforms.filter(p => {
    if (must_be_new && p.market !== 'new') return false;
    if (p.server && !allow_server) return false;
    return true;
  });
}

export function bandsForSearch(config, { must_be_new }) {
  return config.gpu_bands.filter(b => !(must_be_new && b.market !== 'new'));
}

export function cardPrice(config, band, size) {
  const perGb = size.aud_per_gb != null ? size.aud_per_gb : pval(config, band.price_param);
  const addon = band.addon_param != null ? pval(config, band.addon_param) : 0;
  return size.vram_gb * perGb + addon;
}

// Extra RAM cost above what the platform includes. Unified systems have fixed memory.
export function ramCost(config, platform, ramGb) {
  if (platform.ram_type === 'unified') return 0;
  if (ramGb == null || ramGb <= platform.incl_ram_gb) return 0;
  const pricePerGb = platform.ram_type === 'ddr5'
    ? pval(config, 'hardware.ram_price_ddr5_aud_per_gb')
    : pval(config, 'hardware.ram_price_ddr4_aud_per_gb');
  return (ramGb - platform.incl_ram_gb) * pricePerGb;
}

export function systemPrice(config, platform, cardAud, nGpu, ramGb) {
  const extraGpu = nGpu > 1 ? (nGpu - 1) * pval(config, 'hardware.extra_gpu_aud') : 0;
  return {
    platform_aud: platform.price_aud,
    gpus_aud: nGpu * cardAud,
    extra_gpu_aud: extraGpu,
    ram_aud: ramCost(config, platform, ramGb),
    total_aud: platform.price_aud + nGpu * cardAud + extraGpu + ramCost(config, platform, ramGb)
  };
}

// RAM steps available for a platform, as configured total RAM (spec 6.2:
// steps 16 to 512 GB, capped by platform, never below what is included).
export function ramStepsFor(config, platform) {
  return config.ram_steps_gb.filter(s => s >= platform.incl_ram_gb && s <= platform.max_ram_gb);
}
