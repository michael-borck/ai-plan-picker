// compute.js: compute(config, inputs) -> results for the Single user tab
// (spec 9). One pure engine for every tab; a tab is only defaults, visible
// inputs and chart order. Business tabs (Phase 4) will pass their own inputs
// into the same function.

import { pval } from './params.js';
import { demandPerDay, thinkingMultiplier, effectiveSizeB, localEfficiencyFactor, cloudEfficiencyFactor, tokensPerDay, busySecondsPerSq } from './demand.js';
import { searchConfigs } from './configSearch.js';
import { modelCandidatesForTarget, explorerModel, chooseByObjective } from './select.js';
import { modelMemory } from './memory.js';
import { tariffById, energyAudPerDay, reserveAudPerYear, lifeMonthsFor, adminAudPerMonth, utilisation } from './localCost.js';
import { smallestRentalClass, rentalSpeed, hourlyAudPerDay, monthlyAudPerMonth } from './rental.js';
import { tierById, capacityPerDay, burstTps, ttftSeconds, simulateSubscriptionDay, allowancePerWindow } from './subscription.js';
import { taskTypesForInputs, evaluateTask, fillWeekly, weeklyLimitsFor } from './taskLayer.js';
import { cheapestQualifyingApiForTask } from './api.js';
import { addMeteredTopup, addFlatMonthly } from './timeSeries.js';
import { apiClassInfo, cachedShareForMode, apiDailyCostAud } from './api.js';
import { cumulativeTco, tcoAtYear, breakEvenMonth, tasksServed } from './timeSeries.js';
import { requiredContextTokens, contextCheck } from './fitChecks.js';
import { applySensitivityRules, rankOptions, sensitivityAnalysis, formatRecommendation } from './recommend.js';
import { batchGain } from './speed.js';
import { HORIZON_MONTHS_MAX, HORIZON_YEARS_MAX, MONTHS_PER_YEAR, SECONDS_PER_HOUR, SECONDS_PER_MINUTE, DAYS_PER_YEAR, HUNDRED, WEEKS_PER_MONTH, WEEKS_PER_YEAR, ZERO, ONE, TWO, SUM_EPSILON } from './units.js';

// Parameters included in the robustness sweep (spec 6.15). Curated for the
// single-user path: every banded parameter this path actually consumes.
const SENSITIVITY_PARAMS = [
  'power.inference_factor',
  'fx.usd_aud',
  'subscriptions.base_allowance_tokens',
  'subscriptions.window_h',
  'demand.growth_per_year',
  'api.previous_ratio',
  'price_change.api_per_year',
  'speed.eta_cpu',
  'tasks.success_gap1',
  'tasks.success_gap2',
  'tasks.p_min',
  'subscriptions.cache_weight'
];

const SUB_TIERS_CONSUMER = ['free', 'base', 'pro', 'max'];
const API_CLASSES_CORE = ['best', 'previous', 'cheap'];
const API_CLASSES_OPTIONAL = ['premium', 'budget_offshore'];

function gstMultiplierFor(config, display) {
  return display === 'incl' ? ONE + pval(config, 'gst.rate') : ONE;
}

function reserveSplit(cand) {
  const secondhand = (cand.platform.market === 'secondhand' ? cand.price.platform_aud + cand.price.ram_aud : 0)
    + (cand.band_market === 'secondhand' ? cand.price.gpus_aud + cand.price.extra_gpu_aud : 0);
  const fresh = cand.price.total_aud - secondhand;
  return { secondhand_aud: secondhand, new_aud: fresh };
}

function optionShell(partial) {
  return {
    upfront_aud: ZERO,
    monthly_avg_aud: ZERO,
    tco_at_horizon: ZERO,
    tco_at_years: [],
    capacity_sq_per_day: null,
    coverage: ONE,
    per_user_tps_mid: null,
    lockout_h_per_day: ZERO,
    wait_hours_per_user_year: ZERO,
    utilisation: null,
    cost_per_task_aud: null,
    context_check: null,
    break_even_vs_local: null,
    break_even_vs_runner_up: null,
    roi_at_horizon: null,
    sensitivity_tags: [],
    sensitivity: { vetoed: false, flagged: false, reasons: [] },
    passes_filters: false,
    flags: [],
    ...partial
  };
}

export function compute(config, inputs) {
  const inp = {
    ...config.defaults_inputs.single_user,
    growth_per_year: pval(config, 'demand.growth_per_year'),
    discount_rate: pval(config, 'discount.single_user'),
    context_k: pval(config, 'fit.context_default_k'),
    bits_per_weight: pval(config, 'quant.q4_k_m_bits_per_weight'),
    ...inputs
  };

  const months = HORIZON_MONTHS_MAX;
  const horizonMonths = inp.horizon_years * MONTHS_PER_YEAR;
  const thinking = thinkingMultiplier(config, inp.thinking);
  const dm = demandPerDay(config, inp);
  const preset = dm.preset;
  const fx = pval(config, 'fx.usd_aud');
  const tariff = tariffById(config, inp.tariff_id);
  const pue = pval(config, 'power.pue_single_user');
  const minSpeed = pval(config, 'fit.min_speed_tps');
  const poweredH = inp.powered_h_per_day;
  const peakShare = pval(config, 'demand.peak_hour_share');
  const gst = gstMultiplierFor(config, inp.gst_display);
  const growth = inp.growth_per_year;
  const discount = inp.discount_rate;
  const target = config.quality_targets.find(t => t.id === inp.quality_target);
  if (!target) throw new Error('Unknown quality target: ' + inp.quality_target);

  const busySeconds = (mix, sqPerDay, speed, efficiency) =>
    sqPerDay * busySecondsPerSq(mix.sq_in, mix.sq_out, {
      prefill_tps: speed.prefill_tps.mid,
      decode_tps: speed.decode_tps.mid,
      thinking_mult: thinking,
      efficiency
    });

  const waitHours = (sqPerDay, mix, ttftS, tpsMid) =>
    sqPerDay * (ttftS + mix.sq_out * thinking / tpsMid) * DAYS_PER_YEAR / SECONDS_PER_HOUR;

  const concurrency = Math.max(ONE, inp.parallel_agents);
  const vot = Number(inp.value_of_time_aud_h) > ZERO ? Number(inp.value_of_time_aud_h) : ZERO;
  // Waiting time costed at the value of time (spec 2.7). Zero keeps it off.
  const waitCostMonthly = waitHYr => vot > ZERO ? waitHYr * vot / MONTHS_PER_YEAR : ZERO;

  // ---- Local options (spec 6.3, 6.4, 6.8; explorer override per 4.2) ----
  const explorer = inp.explorer && inp.explorer.active ? inp.explorer : null;
  let explorerNote = null;
  let localMeta = [];
  let explorerPick = null;

  if (explorer) {
    const resolved = explorerModel(config, {
      mode: explorer.mode,
      budget_aud: explorer.budget_aud,
      total_b: Number(explorer.total_b),
      active_b: Number(explorer.active_b),
      moe: !!explorer.moe,
      bits: inp.bits_per_weight,
      context_k: inp.context_k,
      min_speed_tps: minSpeed,
      must_be_new: explorer.market === 'new',
      streams: concurrency
    });
    if (resolved.model) {
      const autoBudget = explorer.budget_aud === 'auto' || explorer.mode === 'budget_only';
      const budget = autoBudget ? null : Number(explorer.budget_aud);
      // Auto budget means the cheapest build that meets demand (spec 4.1),
      // regardless of the objective dial.
      const objective = autoBudget ? 'cheapest' : explorer.objective;
      const search = searchConfigs(config, {
        model: resolved.model, bits: inp.bits_per_weight, context_k: inp.context_k,
        must_be_new: explorer.market === 'new', allow_server: false,
        budget_aud: budget, min_speed_tps: minSpeed
      });
      const chosen = chooseByObjective(config, search.qualifying, objective, minSpeed);
      if (chosen) {
        localMeta.push({
          model: resolved.model,
          cand: chosen,
          efficiency: localEfficiencyFactor(config, effectiveSizeB(resolved.model))
        });
        explorerPick = { model: resolved.model, cand: chosen, via_ladder: resolved.via_ladder };
      }
    }
    if (!localMeta.length) {
      explorerNote = 'No hardware explorer build fits this scenario. Showing the quality-target search instead.';
    }
  }

  if (!localMeta.length) {
    const candidates = modelCandidatesForTarget(config, inp.quality_target);
    for (const model of candidates) {
      const search = searchConfigs(config, {
        model, bits: inp.bits_per_weight, context_k: inp.context_k,
        must_be_new: inp.must_be_new, allow_server: false,
        budget_aud: null, min_speed_tps: minSpeed
      });
      const efficiency = localEfficiencyFactor(config, effectiveSizeB(model));
      for (const cand of search.qualifying) {
        localMeta.push({ model, cand, efficiency });
      }
    }
  }

  const localOptions = [];
  for (const { model, cand, efficiency } of localMeta) {
    const busySInteractive = busySeconds(dm.interactive, dm.interactive_sq_per_day, cand.speed, efficiency);
    const busySAgent = busySeconds(dm.agent, dm.agent_sq_per_day, cand.speed, efficiency);
    const busyHPeak = busySInteractive / SECONDS_PER_HOUR;
    const busyHOffpeak = busySAgent / SECONDS_PER_HOUR;
    const busyHTotal = busyHPeak + busyHOffpeak;

    const energy = energyAudPerDay(config, {
      load_w: cand.watts.load_w, idle_w: cand.watts.idle_w,
      busy_h_peak: busyHPeak, busy_h_offpeak: busyHOffpeak,
      powered_h: poweredH, pue, tariff
    });

    const setup = inp.paid_help ? pval(config, 'ownership.hardware_setup_aud') : ZERO;
    const reserve = reserveAudPerYear(config, reserveSplit(cand)) / MONTHS_PER_YEAR;
    const admin = adminAudPerMonth(config, { hours_per_month: pval(config, 'admin.hours_single_user_per_month'), rate_aud_per_hour: ZERO });

    const ttftLocalS = dm.interactive.sq_in / cand.speed.prefill_tps.mid;
    const waitH = waitHours(dm.interactive_sq_per_day, dm.interactive, ttftLocalS, cand.speed.decode_tps.mid);

    const series = cumulativeTco(config, {
      kind: 'local',
      capex_aud: cand.price_aud,
      setup_aud: setup,
      idle_energy_aud_day: energy.aud_per_day_idle,
      busy_energy_aud_day: energy.aud_per_day_busy,
      reserve_aud_month: reserve,
      admin_aud_month: admin,
      demand_charge_aud_month: ZERO,
      life_months: lifeMonthsFor(config, cand.platform),
      residual_on: false,
      growth
    }, { months, discount_rate: discount, gst_multiplier: ONE });

    const capacitySqPerDay = busySInteractive + busySAgent > ZERO
      ? poweredH * SECONDS_PER_HOUR / ((busySInteractive + busySAgent) / dm.sq_per_day)
      : Infinity;
    const coverage = Math.min(ONE, capacitySqPerDay / dm.sq_per_day);

    const requiredCtx = requiredContextTokens(
      dm.agent_tasks_per_day > ZERO ? dm.interactive.tasks.concat(dm.agent.tasks) : dm.interactive.tasks,
      thinking
    );
    const ctx = contextCheck(inp.context_k, requiredCtx);

    const tcoHorizon = series.nominal[horizonMonths];
    const tasks = tasksServed(dm.sq_per_day, growth, horizonMonths, efficiency);

    localOptions.push(optionShell({
      id: 'local_' + cand.signature,
      family: 'local',
      label: 'Local: ' + cand.platform_label + ', ' + (cand.card_ref ? cand.card_ref + (cand.n_gpu > ONE ? ' x ' + cand.n_gpu : '') : 'CPU only') + ', ' + cand.ram_gb + ' GB RAM',
      sub_label: cand.placement + ' placement, ' + cand.band_label,
      data_location: 'premises',
      market: cand.market,
      upfront_aud: cand.price_aud + setup,
      monthly_avg_aud: (tcoHorizon - cand.price_aud - setup) / horizonMonths,
      tco_at_horizon: tcoHorizon,
      tco_at_years: yearSeries(series),
      tco_series: series,
      capacity_sq_per_day: capacitySqPerDay,
      coverage,
      per_user_tps_mid: cand.speed.decode_tps.mid,
      wait_hours_per_user_year: waitH,
      utilisation: utilisation(busyHTotal, poweredH),
      cost_per_task_aud: tcoHorizon / tasks,
      context_check: ctx,
      roi_at_horizon: ZERO,
      price_breakdown: cand.price,
      memory: cand.memory,
      speed: cand.speed,
      watts: cand.watts,
      model,
      efficiency_factor: efficiency,
      candidate: cand,
      passes_filters: coverage >= ONE && ctx.pass && cand.speed.decode_tps.mid >= minSpeed,
      quality_target: inp.quality_target
    }));
  }

  localOptions.sort((a, b) => a.tco_at_horizon - b.tco_at_horizon);
  const localBest = localOptions[ZERO] || null;
  // Best config plus 2 alternates (spec 5): three options in total.
  const localShortlist = localOptions.slice(ZERO, localOptions.length ? ONE + TWO : ZERO);

  const canonicalModel = localBest ? localBest.model : candidates[candidates.length - 1];
  const canonicalEfficiency = localBest ? localBest.efficiency_factor : localEfficiencyFactor(config, effectiveSizeB(canonicalModel));

  // ---- Rental (spec 6.9) ----
  const rentalOptions = [];
  const memForRental = searchMemory(config, canonicalModel, inp);
  const cls = memForRental ? smallestRentalClass(config, memForRental.required_gb) : null;

  if (cls) {
    const speed = rentalSpeed(config, cls, { active_b: canonicalModel.active_b, bits_per_weight: inp.bits_per_weight, moe: canonicalModel.moe });
    const agentBusyS = busySeconds(dm.agent, dm.agent_sq_per_day, speed, canonicalEfficiency);
    const rentedH = preset.interactive_h + agentBusyS / SECONDS_PER_HOUR;
    const sessions = pval(config, 'rental.sessions_per_day');
    const daily = hourlyAudPerDay(config, cls, { hours: rentedH, sessions, fx });

    const busySInteractive = busySeconds(dm.interactive, dm.interactive_sq_per_day, speed, canonicalEfficiency);
    const busySTotal = busySInteractive + agentBusyS;
    const capacitySqPerDay = busySTotal > ZERO ? rentedH * SECONDS_PER_HOUR / (busySTotal / dm.sq_per_day) : Infinity;
    const coverage = Math.min(ONE, capacitySqPerDay / dm.sq_per_day);

    const requiredCtx = requiredContextTokens(
      dm.agent_tasks_per_day > ZERO ? dm.interactive.tasks.concat(dm.agent.tasks) : dm.interactive.tasks,
      thinking
    );
    const ctx = contextCheck(apiWindowK(config, target.cloud_class), requiredCtx);

    const waitH = waitHours(dm.interactive_sq_per_day, dm.interactive, ttftSeconds(config), burstTps(config, 'best'));

    const series = cumulativeTco(config, {
      kind: 'hours', daily_aud: daily, price_change: pval(config, 'price_change.rental_per_year')
    }, { months, discount_rate: discount, gst_multiplier: gst });

    const tcoHorizon = series.nominal[horizonMonths];
    const tasks = tasksServed(dm.sq_per_day, growth, horizonMonths, canonicalEfficiency);

    rentalOptions.push(optionShell({
      id: 'rental_hourly_' + cls.id,
      family: 'rental',
      label: 'Rent GPU hourly: ' + cls.label,
      sub_label: 'About ' + rentedH.toFixed(1) + ' rented hours per day',
      data_location: 'provider rack',
      sensitivity_tags: ['rental_hourly'],
      monthly_avg_aud: tcoHorizon / horizonMonths,
      tco_at_horizon: tcoHorizon,
      tco_at_years: yearSeries(series),
      tco_series: series,
      capacity_sq_per_day: capacitySqPerDay,
      coverage,
      per_user_tps_mid: speed.decode_tps.mid,
      wait_hours_per_user_year: waitH,
      cost_per_task_aud: tcoHorizon / tasks,
      context_check: ctx,
      speed,
      rental_class: cls,
      model: canonicalModel,
      rented_h: rentedH,
      efficiency_factor: canonicalEfficiency,
      passes_filters: coverage >= ONE && ctx.pass && speed.decode_tps.mid >= minSpeed
    }));
  }

  for (const mode of ['reserved', 'vps']) {
    if (!cls) break;
    const monthly = monthlyAudPerMonth(config, cls, mode, fx);
    if (monthly == null) continue;
    const speed = rentalSpeed(config, cls, { active_b: canonicalModel.active_b, bits_per_weight: inp.bits_per_weight, moe: canonicalModel.moe });
    const busySInteractive = busySeconds(dm.interactive, dm.interactive_sq_per_day, speed, canonicalEfficiency);
    const agentBusyS = busySeconds(dm.agent, dm.agent_sq_per_day, speed, canonicalEfficiency);
    const capacitySqPerDay = busySInteractive + agentBusyS > ZERO
      ? poweredH * SECONDS_PER_HOUR / ((busySInteractive + agentBusyS) / dm.sq_per_day)
      : Infinity;
    const coverage = Math.min(ONE, capacitySqPerDay / dm.sq_per_day);

    const requiredCtx = requiredContextTokens(
      dm.agent_tasks_per_day > ZERO ? dm.interactive.tasks.concat(dm.agent.tasks) : dm.interactive.tasks,
      thinking
    );
    const ctx = contextCheck(apiWindowK(config, target.cloud_class), requiredCtx);

    const waitH = waitHours(dm.interactive_sq_per_day, dm.interactive, ttftSeconds(config), burstTps(config, 'best'));

    const series = cumulativeTco(config, {
      kind: 'flat', monthly_aud: monthly, price_change: pval(config, 'price_change.rental_per_year')
    }, { months, discount_rate: discount, gst_multiplier: gst });

    const tcoHorizon = series.nominal[horizonMonths];
    const tasks = tasksServed(dm.sq_per_day, growth, horizonMonths, canonicalEfficiency);

    rentalOptions.push(optionShell({
      id: 'rental_' + mode + '_' + cls.id,
      family: 'rental',
      label: mode === 'reserved' ? 'Rent GPU monthly: ' + cls.label : 'GPU VPS: ' + cls.label,
      sub_label: 'Dedicated card, you run the stack',
      data_location: 'provider rack',
      sensitivity_tags: mode === 'reserved' ? ['rental_monthly'] : ['rental_monthly'],
      monthly_avg_aud: monthly,
      tco_at_horizon: tcoHorizon,
      tco_at_years: yearSeries(series),
      tco_series: series,
      capacity_sq_per_day: capacitySqPerDay,
      coverage,
      per_user_tps_mid: speed.decode_tps.mid,
      wait_hours_per_user_year: waitH,
      cost_per_task_aud: tcoHorizon / tasks,
      context_check: ctx,
      speed,
      rental_class: cls,
      model: canonicalModel,
      efficiency_factor: canonicalEfficiency,
      passes_filters: coverage >= ONE && ctx.pass && speed.decode_tps.mid >= minSpeed
    }));
  }

  // ---- Subscriptions (spec 6.10) ----
  const verbosity = pval(config, 'verbosity.cloud');
  const cloudTokens = tokensPerDay(dm.sq_in_per_day, dm.sq_out_per_day, thinking, verbosity * cloudEfficiencyFactor(config, target.cloud_class));
  const subOptions = [];
  for (const tierId of SUB_TIERS_CONSUMER) {
    const tier = tierById(config, tierId);
    const capacity = capacityPerDay(config, tierId, target.cloud_class, {
      interactive_h: preset.interactive_h, unattended_h: preset.unattended_h, days_per_week: preset.days_per_week
    });
    const sim = simulateSubscriptionDay(config, {
      allowance: capacity.allowance_per_window,
      span_h: preset.interactive_h,
      tokens_per_day: cloudTokens.tokens_per_day,
      peak_share: peakShare
    });
    const coverage = Math.min(sim.coverage, cloudTokens.tokens_per_day > ZERO ? capacity.capacity_tokens_per_day / cloudTokens.tokens_per_day : ONE);

    const requiredCtx = requiredContextTokens(
      dm.agent_tasks_per_day > ZERO ? dm.interactive.tasks.concat(dm.agent.tasks) : dm.interactive.tasks,
      thinking
    );
    const ctx = contextCheck(apiWindowK(config, target.cloud_class), requiredCtx);

    const waitH = waitHours(dm.interactive_sq_per_day, dm.interactive, ttftSeconds(config), burstTps(config, target.cloud_class));

    const series = cumulativeTco(config, {
      kind: 'flat', monthly_aud: tier.seat_aud_month, price_change: pval(config, 'price_change.subscription_per_year')
    }, { months, discount_rate: discount, gst_multiplier: gst });

    const tcoHorizon = series.nominal[horizonMonths];
    const tasks = tasksServed(dm.sq_per_day, growth, horizonMonths, cloudEfficiencyFactor(config, target.cloud_class));

    subOptions.push(optionShell({
      id: 'sub_' + tierId,
      family: 'subscription',
      label: 'Subscription: ' + tier.label,
      sub_label: 'Cloud class: ' + target.cloud_class + ', allowance not published',
      data_location: 'provider multi-tenant',
      sensitivity_tags: ['subscription_consumer'],
      monthly_avg_aud: tier.seat_aud_month,
      tco_at_horizon: tcoHorizon,
      tco_at_years: yearSeries(series),
      tco_series: series,
      capacity_sq_per_day: cloudTokens.tokens_per_day > ZERO ? capacity.capacity_tokens_per_day / ((dm.sq_in_per_day + dm.sq_out_per_day) / dm.sq_per_day) : null,
      coverage,
      per_user_tps_mid: burstTps(config, target.cloud_class),
      lockout_h_per_day: sim.lockout_h_per_day,
      wait_hours_per_user_year: waitH,
      cost_per_task_aud: tcoHorizon / tasks,
      context_check: ctx,
      cloud_class: target.cloud_class,
      cloud_class_quality: config.api_classes.find(c => c.id === target.cloud_class).quality_level,
      efficiency_factor: cloudEfficiencyFactor(config, target.cloud_class),
      flags: ['allowance_assumed'],
      passes_filters: coverage >= ONE && ctx.pass,
      tier
    }));
  }

  // ---- API (spec 6.11) ----
  const apiOptions = [];
  const apiClasses = inp.show_optional_api ? API_CLASSES_CORE.concat(API_CLASSES_OPTIONAL) : API_CLASSES_CORE;
  const cachedShare = cachedShareForMode(config, inp.usage_mode);
  for (const classId of apiClasses) {
    const info = apiClassInfo(config, classId);
    const cloudEff = cloudEfficiencyFactor(config, classId === 'previous' ? 'previous' : classId === 'cheap' || classId === 'budget_offshore' ? 'cheap' : 'best');
    const tokens = tokensPerDay(dm.sq_in_per_day, dm.sq_out_per_day, thinking, verbosity * cloudEff);
    const daily = apiDailyCostAud(config, {
      class_id: classId,
      tokens_in: tokens.tokens_in_per_day,
      tokens_out: tokens.tokens_out_per_day,
      cached_share: cachedShare
    });

    const requiredCtx = requiredContextTokens(
      dm.agent_tasks_per_day > ZERO ? dm.interactive.tasks.concat(dm.agent.tasks) : dm.interactive.tasks,
      thinking
    );
    const ctx = contextCheck(info.context_k, requiredCtx);

    const waitH = waitHours(dm.interactive_sq_per_day, dm.interactive, ttftSeconds(config), burstTps(config, classId === 'best' || classId === 'premium' ? 'best' : classId === 'previous' ? 'previous' : 'cheap'));

    const series = cumulativeTco(config, {
      kind: 'metered', daily_aud: daily, growth, price_change: pval(config, 'price_change.api_per_year')
    }, { months, discount_rate: discount, gst_multiplier: gst });

    const tcoHorizon = series.nominal[horizonMonths];
    const tasks = tasksServed(dm.sq_per_day, growth, horizonMonths, cloudEff);

    apiOptions.push(optionShell({
      id: 'api_' + classId,
      family: 'api',
      label: 'API: ' + info.label,
      sub_label: 'Pay per token, cached input at ' + Math.round(cachedShare * HUNDRED) + ' percent',
      data_location: 'provider multi-tenant',
      sensitivity_tags: classId === 'budget_offshore' ? ['api_non_enterprise', 'api_budget_offshore'] : ['api_non_enterprise'],
      monthly_avg_aud: tcoHorizon / horizonMonths,
      tco_at_horizon: tcoHorizon,
      tco_at_years: yearSeries(series),
      tco_series: series,
      capacity_sq_per_day: null,
      coverage: ONE,
      per_user_tps_mid: burstTps(config, classId === 'best' || classId === 'premium' ? 'best' : classId === 'previous' ? 'previous' : 'cheap'),
      wait_hours_per_user_year: waitH,
      cost_per_task_aud: tcoHorizon / tasks,
      context_check: ctx,
      api_class: info,
      efficiency_factor: cloudEff,
      passes_filters: ctx.pass
    }));
  }

  // ---- Request-limited plans (spec 6.10a, CR-001 item 4) ----
  const brokerOptions = [];
  for (const plan of config.request_plans || []) {
    const upfrontAud = plan.upfront_usd * fx;
    const requiredCtx = requiredContextTokens(
      dm.agent_tasks_per_day > ZERO ? dm.interactive.tasks.concat(dm.agent.tasks) : dm.interactive.tasks,
      thinking
    );
    const ctx = contextCheck(plan.context_k, requiredCtx);
    const brokerWait = waitHours(dm.interactive_sq_per_day, dm.interactive, plan.ttft_s, plan.gen_tps);
    const series = cumulativeTco(config, {
      kind: 'flat', monthly_aud: ZERO, price_change: ZERO, upfront_aud: upfrontAud
    }, { months, discount_rate: discount, gst_multiplier: gst });
    const tcoHorizon = series.nominal[horizonMonths];
    brokerOptions.push(optionShell({
      id: 'broker_' + plan.id,
      family: 'broker',
      label: plan.label,
      sub_label: plan.requests_per_day + ' requests a day, reliability ' + Math.round(plan.reliability * HUNDRED) + '%',
      data_location: 'provider multi-tenant',
      upfront_aud: upfrontAud,
      monthly_avg_aud: ZERO,
      tco_at_horizon: tcoHorizon,
      tco_at_years: yearSeries(series),
      tco_series: series,
      per_user_tps_mid: plan.gen_tps,
      wait_hours_per_user_year: brokerWait,
      context_check: ctx,
      request_plan: plan,
      flags: ['may_train'],
      passes_filters: ctx.pass
    }));
  }

  // ---- Combine, sensitivity, break-evens, ranking (spec 6.14, 6.15) ----
  const options = [...localShortlist, ...rentalOptions, ...subOptions, ...apiOptions, ...brokerOptions];

  for (const o of options) {
    o.sensitivity = applySensitivityRules(config, inp.data_sensitivity, o);
  }

  // ---- Task layer and top-up (spec 2.8, 6.11a; CR-001 items 2, 3, 5) ----
  const rules = { top_up: true, exclude_may_train: false, ...(inp.rules || {}) };
  const tasks = taskTypesForInputs(config, inp);
  const taskAttrs = options.map(o => taskAttributesFor(config, o, inp));
  const apiAttrs = options
    .map((o, i) => (o.family === 'api' ? taskAttrs[i] : null))
    .filter(Boolean);

  for (let i = ZERO; i < options.length; i++) {
    const o = options[i];
    const cells = tasks.map(t => evaluateTask(config, t, taskAttrs[i], inp));
    const limits = weeklyLimitsFor(config, taskAttrs[i], inp);
    const fill = fillWeekly(config, tasks, cells, limits);
    o.own_share = fill.own_share;
    o.monthly_own_aud = o.monthly_avg_aud;
    o.task_cells = [];
    let topupMonthly = ZERO;
    let topupTasks = ZERO;
    let topupHoursWeek = ZERO;
    let completedTasks = ZERO;
    const topupClasses = new Set();
    for (let j = ZERO; j < tasks.length; j++) {
      const t = tasks[j];
      const leftover = Math.max(ZERO, t.count_per_week - fill.done[j]);
      completedTasks += fill.done[j];
      let topupClass = null;
      if (leftover > ZERO && rules.top_up) {
        const fallback = cheapestQualifyingApiForTask(config, t, apiAttrs, { ...inp, rules });
        if (fallback) {
          completedTasks += leftover;
          topupClass = fallback.opt.label;
          topupClasses.add(fallback.opt.label);
          topupMonthly += leftover * fallback.cell.api_aud * WEEKS_PER_MONTH;
          topupTasks += leftover;
          topupHoursWeek += leftover * (fallback.cell.wall_s + pval(config, 'tasks.handoff_min') * SECONDS_PER_MINUTE) / SECONDS_PER_HOUR;
        }
      }
      o.task_cells.push({
        task_id: t.id,
        label: t.label,
        count: t.count_per_week,
        status: cells[j].status,
        reasons: cells[j].reasons,
        wall_s: cells[j].wall_s,
        spans: cells[j].spans,
        done: fill.done[j],
        leftover,
        topup_class: topupClass
      });
    }
    o.topup_tasks = topupTasks;
    o.topup_hours_week = topupHoursWeek;
    o.topup_monthly_aud = topupMonthly;
    o.completed_fraction = tasks.reduce((a, t) => a + t.count_per_week, ZERO) > ZERO
      ? completedTasks / tasks.reduce((a, t) => a + t.count_per_week, ZERO)
      : ONE;
    if (topupMonthly > ZERO) {
      addMeteredTopup(o.tco_series, {
        monthly_aud: topupMonthly,
        growth,
        price_change: pval(config, 'price_change.api_per_year'),
        discount_rate: discount,
        gst_multiplier: gst
      });
      o.tco_at_horizon = o.tco_series.nominal[horizonMonths];
      o.tco_at_years = yearSeries(o.tco_series);
      o.monthly_avg_aud = (o.tco_at_horizon - o.upfront_aud) / horizonMonths;
    }
    o.wait_hours_per_user_year += topupHoursWeek * WEEKS_PER_YEAR;
    // Costed waiting (spec 2.7) uses the final wait hours: interactive plus
    // top-up processing and hand-off (spec 6.11a).
    if (vot > ZERO) {
      addFlatMonthly(o.tco_series, o.wait_hours_per_user_year * vot / MONTHS_PER_YEAR, { discount_rate: discount, gst_multiplier: gst });
    }
    o.tco_at_horizon = o.tco_series.nominal[horizonMonths];
    o.tco_at_years = yearSeries(o.tco_series);
    o.monthly_avg_aud = (o.tco_at_horizon - o.upfront_aud) / horizonMonths;
    // Eligibility (spec 6.15, v0.4): a completed week (own share 100 percent,
    // or 100 percent after top-up), the local speed floor, sensitivity rules,
    // and the may-train exclusion. The old biggest-task veto (D19) is gone:
    // slow tasks limit, they do not exclude.
    const weekComplete = rules.top_up
      ? o.completed_fraction >= ONE - SUM_EPSILON
      : o.own_share >= ONE - SUM_EPSILON;
    const speedOk = o.family !== 'local' || o.speed.decode_tps.mid >= minSpeed;
    const mayTrainOk = !(rules.exclude_may_train && o.may_train);
    o.passes_filters = weekComplete && speedOk && mayTrainOk;
    // Cost per completed task (spec 6.14, v0.4): TCO including top-up over
    // tasks actually completed. With top-up on and a fallback available,
    // every task completes, so options compare on the same week.
    o.cost_per_completed_task_aud = o.tco_at_horizon > ZERO
      ? o.tco_at_horizon / (tasksServed(dm.sq_per_day, growth, horizonMonths, o.efficiency_factor || ONE) * o.completed_fraction)
      : ZERO;
  }

  if (localBest) {
    for (const o of options) {
      if (o === localBest) continue;
      o.break_even_vs_local = breakEvenMonth(o.tco_series, localBest.tco_series);
      if (o.family === 'local') {
        o.roi_at_horizon = roiAgainstLocal(o, localBest);
      }
    }
  }

  const ranked = rankOptions(options);
  ranked.passing = options.filter(o => o.passes_filters && !o.sensitivity.vetoed);
  const winner = ranked.winner;
  const runnerUp = ranked.runner_up;
  if (winner && runnerUp) {
    winner.break_even_vs_runner_up = breakEvenMonth(winner.tco_series, runnerUp.tco_series);
  }

  // Pay-off multiple (CR-001 item 12): the smallest workload multiple at
  // which the best local option's TCO at the horizon reaches the best paid
  // non-local option's, at today's prices. Indicative only.
  let payoffMultiple = null;
  if (winner) {
    const eligible = options.filter(o => o.passes_filters && !o.sensitivity.vetoed);
    const bestLocal = eligible.filter(o => o.family === 'local').sort((a, b) => a.tco_at_horizon - b.tco_at_horizon)[ZERO] || null;
    const bestPaidNonLocal = eligible
      .filter(o => o.family !== 'local' && !(o.upfront_aud === ZERO && o.monthly_own_aud === ZERO && o.topup_monthly_aud === ZERO) && o.family !== 'broker' && o.id !== 'sub_free')
      .sort((a, b) => a.tco_at_horizon - b.tco_at_horizon)[ZERO] || null;
    if (bestLocal && bestPaidNonLocal) {
      const tcoAt = (o, m) => o.upfront_aud + (o.family === 'api'
        ? (o.monthly_own_aud + o.topup_monthly_aud) * m
        : o.monthly_own_aud + o.topup_monthly_aud * m) * horizonMonths;
      if (tcoAt(bestLocal, ONE) <= tcoAt(bestPaidNonLocal, ONE)) payoffMultiple = ONE;
      else {
        for (const m of config.payoff_multiples) {
          if (tcoAt(bestLocal, m) <= tcoAt(bestPaidNonLocal, m)) { payoffMultiple = m; break; }
        }
      }
    }
  }

  const sensitivity = (winner && !inp._skip_robustness)
    ? sensitivityAnalysis(config, {
        ...inp,
        _base_winner_id: winner.id,
        _base_gap: runnerUp ? winner.tco_at_horizon - runnerUp.tco_at_horizon : null
      }, SENSITIVITY_PARAMS, compute)
    : { robust: true, flips: [], rows: [] };

  let text = formatRecommendation(config, inp, { winner, runner_up: runnerUp, robustness: { robust: sensitivity.robust, flips: sensitivity.flips } });
  if (winner && winner.task_cells) {
    const worst = winner.task_cells
      .filter(c => c.count > ZERO)
      .slice()
      .sort((a, b) => (a.status === 'no' ? ZERO : a.status === 'slow' ? ONE : 2) - (b.status === 'no' ? ZERO : b.status === 'slow' ? ONE : 2))[0];
    const topupNames = Array.from(new Set(winner.task_cells.filter(c => c.topup_class).map(c => c.topup_class)));
    if (worst && worst.status === 'no') {
      text += ' On its own it does ' + Math.round(winner.own_share * HUNDRED) + '% of your work; ' + worst.label + ' and any other gaps go to ' + (topupNames.join(' and ') || 'nothing') + ', included in the price.';
    } else if (winner.own_share < ONE) {
      text += ' On its own it does ' + Math.round(winner.own_share * HUNDRED) + '% of your work; the rest goes to ' + (topupNames.join(' and ') || 'nothing') + ', included in the price.';
    } else {
      text += ' It runs your whole week on its own.';
    }
    if (winner.family === 'broker' || winner.id === 'sub_free') {
      const paid = ranked.passing && ranked.passing.length ? ranked.passing.filter(o => !(o.upfront_aud === ZERO && o.monthly_own_aud === ZERO && o.topup_monthly_aud === ZERO) && o.family !== 'broker' && o.id !== 'sub_free' && o.tco_at_horizon > ZERO)[0] : null;
      if (paid) {
        text += ' The cheapest route that is not free is ' + paid.label + ' at about AUD ' + Math.round(paid.tco_at_horizon).toLocaleString('en-AU') + ' over ' + inputs.horizon_years + ' years.';
      }
      if (winner.family === 'broker') {
        text += ' The free route means request limits (' + winner.request_plan.requests_per_day + ' a day), slower and less reliable replies (about ' + Math.round(winner.request_plan.reliability * HUNDRED) + '%), and data terms that may allow training on your prompts.';
      }
    }
    if (winner.may_train) {
      text += ' Note: this service may train on your data.';
    }
    if (payoffMultiple != null) {
      if (payoffMultiple === ONE) text += ' A local box already pays for itself at this workload.';
      else text += ' A local box pays off at about ' + payoffMultiple + 'x this workload.';
    } else {
      text += ' A local box does not pay off even at 100x this workload.';
    }
  }

  return {
    inputs_used: inp,
    demand: {
      ...dm,
      thinking_multiplier: thinking,
      tokens_cloud_per_day: cloudTokens.tokens_per_day,
      busy_hours_per_day: localBest ? (localBest.utilisation * poweredH) : null
    },
    options,
    recommendation: {
      winner,
      runner_up: runnerUp,
      passing_count: ranked.passing_count,
      robustness: { robust: sensitivity.robust, flips: sensitivity.flips },
      text
    },
    tornado: sensitivity.rows,
    hardware_card: localBest ? hardwareCard(localBest, config, inp) : null,
    explorer: explorerPick,
    explorer_note: explorerNote,
    value_of_time_aud_h: vot,
    meta: { months, horizon_months: horizonMonths, fx, pue, tariff_id: tariff.id, gst_multiplier: gst }
  };
}

// Local quality level from the capability targets (spec 2.4): the target
// whose range the model reaches, checked frontier down to basic.
function qualityLevelForModel(config, model) {
  for (const target of [...config.quality_targets].reverse()) {
    if (model.moe) {
      if (target.moe_total_b != null && model.total_b >= target.moe_total_b) return target.id;
    } else if (target.dense_b && model.total_b >= target.dense_b[0]) {
      return target.id;
    }
  }
  return 'basic';
}

// Option attributes for the task layer (spec 2.8).
function taskAttributesFor(config, o, inp) {
  const base = {
    id: o.id,
    label: o.label,
    reliability: ONE,
    may_train: !!o.may_train,
    vetoed: o.sensitivity.vetoed,
    veto_reason: o.sensitivity.reasons[ZERO],
    agent_tools: true,
    verbosity: pval(config, 'verbosity.cloud')
  };
  if (o.family === 'local' || o.family === 'rental') {
    return {
      ...base,
      kind: o.family,
      quality_level: qualityLevelForModel(config, o.model),
      context_k: inp.context_k,
      verbosity: o.efficiency_factor,
      gen_tps: o.speed.decode_tps.mid,
      prefill_tps: o.speed.prefill_tps.mid,
      ttft_s: pval(config, 'tasks.local_ttft_s')
    };
  }
  if (o.family === 'subscription') {
    const prefill = burstTps(config, o.cloud_class) * pval(config, 'speed.prefill_multiplier_gpu_modern');
    if (o.tier.id === 'free') {
      const free = tierById(config, 'free');
      return {
        ...base,
        kind: 'window',
        quality_level: free.quality_level,
        context_k: free.context_k,
        agent_tools: free.agent_tools,
        gen_tps: burstTps(config, o.cloud_class),
        prefill_tps: prefill,
        ttft_s: ttftSeconds(config),
        allowance_per_window: allowancePerWindow(config, 'free', o.cloud_class),
        window_h: pval(config, 'subscriptions.window_h')
      };
    }
    return {
      ...base,
      kind: 'window',
      quality_level: o.cloud_class_quality,
      context_k: apiWindowK(config, o.cloud_class),
      gen_tps: burstTps(config, o.cloud_class),
      prefill_tps: prefill,
      ttft_s: ttftSeconds(config),
      allowance_per_window: allowancePerWindow(config, o.tier.id, o.cloud_class),
      window_h: pval(config, 'subscriptions.window_h')
    };
  }
  if (o.family === 'api') {
    return {
      ...base,
      kind: 'api',
      quality_level: o.api_class.quality_level,
      context_k: o.api_class.context_k,
      verbosity: pval(config, 'verbosity.cloud') * o.efficiency_factor,
      gen_tps: o.per_user_tps_mid,
      prefill_tps: o.per_user_tps_mid * pval(config, 'speed.prefill_multiplier_gpu_modern'),
      ttft_s: ttftSeconds(config),
      price_in_aud: o.api_class.price_aud_per_1m_input,
      price_out_aud: o.api_class.price_aud_per_1m_output
    };
  }
  const plan = o.request_plan;
  return {
    ...base,
    kind: 'requests',
    quality_level: plan.quality_level,
    context_k: plan.context_k,
    agent_tools: plan.agent_tools,
    reliability: plan.reliability,
    may_train: plan.may_train,
    gen_tps: plan.gen_tps,
    prefill_tps: plan.prefill_tps,
    ttft_s: plan.ttft_s,
    requests_per_day: plan.requests_per_day,
    requests_per_min: plan.requests_per_min
  };
}

function yearSeries(series) {
  const out = [];
  for (let y = ONE; y <= HORIZON_YEARS_MAX; y++) out.push(tcoAtYear(series, y));
  return out;
}

function roiAgainstLocal(localOption, localBest) {
  const saving = localBest.tco_series.nominal[localBest.tco_series.months] - localOption.tco_series.nominal[localOption.tco_series.months];
  if (!(localOption.upfront_aud > ZERO)) return null;
  return saving / localOption.upfront_aud * HUNDRED;
}

function searchMemory(config, model, inp) {
  return modelMemory(config, { total_params_b: model.total_b, bits_per_weight: inp.bits_per_weight, context_k: inp.context_k, streams: ONE });
}

function apiWindowK(config, cloud_class) {
  const info = apiClassInfo(config, cloud_class);
  return info.context_k;
}

export function hardwareCard(localOption, config, inp) {
  const cand = localOption.candidate;
  const concurrency = Math.max(ONE, inp.parallel_agents);
  const gain = batchGain(config, concurrency);
  return {
    platform: cand.platform_label,
    gpu: cand.card_ref ? cand.card_ref + (cand.n_gpu > ONE ? ' x ' + cand.n_gpu : '') : 'none',
    band: cand.band_label,
    placement: cand.placement,
    ram_gb: cand.ram_gb,
    ram_type: cand.ram_type,
    price_breakdown: cand.price,
    memory: cand.memory,
    decode_tps: cand.speed.decode_tps,
    prefill_tps: cand.speed.prefill_tps,
    gpu_share: cand.speed.gpu_share,
    batching: { concurrency, gain, aggregate_tps_mid: cand.speed.decode_tps.mid * gain },
    capability: localOption.quality_target,
    efficiency_factor: localOption.efficiency_factor,
    load_w: cand.watts.load_w,
    idle_w: cand.watts.idle_w,
    market: cand.market,
    boxes: ONE
  };
}
