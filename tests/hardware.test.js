// hardware.js unit tests: spec 6.2, 11.1, 11.2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformById, bandById, cardPrice, ramCost, systemPrice, ramStepsFor, platformsForSearch, bandsForSearch } from '../src/engine/hardware.js';
import { loadConfig } from './helpers.js';

const config = loadConfig();

test('hardware: card price is VRAM times band AUD/GB plus add-on', () => {
  const band = bandById(config, 'large_modern');
  const size = band.sizes[0];
  assert.equal(size.vram_gb, 24);
  assert.ok(Math.abs(cardPrice(config, band, size) - 24 * 46) < 1e-9);
});

test('hardware: legacy server add-on is applied', () => {
  const band = bandById(config, 'legacy_server');
  const size = band.sizes.find(s => s.vram_gb === 24);
  const price = cardPrice(config, band, size);
  assert.ok(Math.abs(price - (24 * 18 + 40)) < 1e-9);
});

test('hardware: datacentre sizes carry their own AUD/GB', () => {
  const band = bandById(config, 'datacentre');
  const gb80 = band.sizes.find(s => s.vram_gb === 80);
  assert.ok(Math.abs(cardPrice(config, band, gb80) - 80 * 625) < 1e-9);
});

test('hardware: RAM cost charged only above included RAM', () => {
  const tower = platformById(config, 'tower_desktop');
  assert.equal(ramCost(config, tower, 32), 0);
  assert.ok(Math.abs(ramCost(config, tower, 64) - 32 * 3) < 1e-9);
  const unified = platformById(config, 'unified_mini');
  assert.equal(ramCost(config, unified, 128), 0);
});

test('hardware: system price includes extra GPU beyond the first', () => {
  const tower = platformById(config, 'tower_desktop');
  const band = bandById(config, 'large_modern');
  const card = cardPrice(config, band, band.sizes[0]);
  const one = systemPrice(config, tower, card, 1, 32);
  const two = systemPrice(config, tower, card, 2, 32);
  assert.ok(Math.abs(one.total_aud - (900 + card)) < 1e-9);
  assert.ok(Math.abs(two.total_aud - (900 + 2 * card + 150)) < 1e-9);
});

test('hardware: RAM steps respect platform caps and included RAM', () => {
  const sff = platformById(config, 'office_sff');
  assert.deepEqual(ramStepsFor(config, sff), [16, 32, 64]);
  const server = platformById(config, 'server_8gpu');
  // Steps run 16 to 512 GB (config), capped by the platform: the 8-GPU server
  // includes 512 GB, so only that step remains.
  assert.deepEqual(ramStepsFor(config, server), [512]);
});

test('hardware: must-be-new filters secondhand platforms and bands', () => {
  const platforms = platformsForSearch(config, { must_be_new: true, allow_server: false });
  assert.ok(platforms.every(p => p.market === 'new' && !p.server));
  const bands = bandsForSearch(config, { must_be_new: true });
  assert.ok(bands.every(b => b.market === 'new'));
  const allPlatforms = platformsForSearch(config, { must_be_new: false, allow_server: false });
  assert.ok(allPlatforms.some(p => p.market === 'secondhand'));
  assert.ok(!allPlatforms.some(p => p.server));
  const withServers = platformsForSearch(config, { must_be_new: false, allow_server: true });
  assert.ok(withServers.some(p => p.server));
});
