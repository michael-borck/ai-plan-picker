// Shared test helpers.
import { readFileSync } from 'node:fs';

export function loadConfig() {
  return JSON.parse(readFileSync(new URL('../src/defaults.json', import.meta.url)));
}

export function approx(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance;
}
