/*
 * REFERENCE ONLY. Do not copy this file into src/ or import it.
 *
 * Source: the single-user "AI plan picker" prototype (Claude, 26 September 2026),
 * which introduced the task layer adopted in spec v0.4 section 2.8 and CR-001.
 *
 * Use it to understand the concepts and to sanity-check results, then port
 * the ideas into the existing engine modules, following CLAUDE.md conventions
 * (parameter records with provenance, no numeric literals outside units.js,
 * pure functions, existing demand conventions such as D2).
 *
 * Where this file and spec v0.4 disagree, the spec wins. Known differences:
 *  - Task types and defaults here are the prototype's own (six tasks, weekly
 *    counts). Spec 11.11 defines the task types for the real build.
 *  - Local hardware here is eight fixed builds; the real build keeps its
 *    full configuration search.
 *  - Capacity here is cut back proportionally across task types; spec 2.8
 *    requires filling smallest tasks first.
 *  - Quality levels are numbers 1 to 4 (Basic, Good, High, Frontier).
 *  - MoE speed here adds moeEff and moeOverheadMs; these are NOT part of
 *    CR-001. Do not port them without a separate change request.
 *
 * Concepts to port (function names below):
 *  - successP: success rate by quality gap
 *  - taskOn: the gates (context, agent tools, quality, privacy, window and
 *    request-limit fit) and per-task requests, allowance units, API cost,
 *    time, and Slow reasons
 *  - evalOption: weekly limits, own share by work size, top-up with the
 *    cheapest qualifying API option, hand-off time
 */
/* ENGINE START */
const WEEKS_PER_MONTH = 52 / 12;
function clone(o){return JSON.parse(JSON.stringify(o));}

const DEFAULTS = {
  general: {
    fx: {v:1.54, s:'estimated', note:'USD to AUD, from data pack'},
    tariff: {v:0.32, s:'estimated', note:'AUD per kWh, WA residential A1 mid (data pack, verify with Synergy)'},
    lifeYears: {v:4, s:'assumed', note:'Useful life of a secondhand build'},
    reservePct: {v:5, s:'assumed', note:'Repairs and failures, % of hardware cost per year'},
    adminMonthly: {v:0, s:'assumed', note:'Paid help per month (0 = you do it yourself)'},
    alwaysOn: {v:false, s:'assumed', note:'Leave the local machine on 24/7'},
    bitsPerWeight: {v:4.85, s:'assumed', note:'Q4_K_M quantisation'},
    localContextK: {v:32, s:'assumed', note:'Context the local model is set up for (k tokens)'},
    kvBits: {v:8, s:'assumed', note:'KV cache precision (8 or 16 bit)'},
    minTps: {v:10, s:'assumed', note:'Slowest local speed you would accept (tok/s)'},
    etaCpu: {v:0.5, s:'assumed', note:'Share of RAM bandwidth achieved when generating on CPU'},
    moeBonus: {v:0.2, s:'assumed', note:'Extra share of active MoE weights kept on GPU'},
    moeEff: {v:0.7, s:'assumed', note:'MoE models reach a lower share of bandwidth (routing overhead)'},
    moeOverheadMs: {v:3, s:'assumed', note:'Fixed extra time per token for MoE models (ms)'},
    localTtft: {v:0.5, s:'assumed', note:'Local time to first token (s)'},
    cloudTtft: {v:1.5, s:'assumed', note:'Cloud time to first token (s)'},
    cloudPrefill: {v:5000, s:'assumed', note:'Cloud input processing speed (tok/s)'},
    pSame: {v:0.95, s:'assumed', note:'Success rate when the model meets the task quality'},
    pOneBelow: {v:0.6, s:'assumed', note:'Success rate one quality level below'},
    pTwoBelow: {v:0.25, s:'assumed', note:'Success rate two levels below'},
    pMin: {v:0.3, s:'assumed', note:'Below this success rate the task counts as not possible'},
    cacheDiscount: {v:0.9, s:'estimated', note:'API discount on cached input'},
    subCacheWeight: {v:0.1, s:'assumed', note:'How much cached input counts against a subscription allowance'},
    rentOverheadH: {v:0.25, s:'assumed', note:'Start-up and model loading per day of rental (h)'},
    rentStorageUSD: {v:10, s:'assumed', note:'Keeping the model on rented storage (USD/month)'},
    valueOfTime: {v:0, s:'assumed', note:'What an hour of your waiting is worth (AUD, 0 = ignore)'},
    agentWaitShare: {v:0.25, s:'assumed', note:'Share of agent run time you spend waiting'},
    handoffMin: {v:2, s:'assumed', note:'Minutes to move a task to the top-up service'},
  },
  thinking: {Off:1, Low:1.5, Medium:3, High:6},
  tiers: ['','Basic','Good','High','Frontier'],
  models: [
    {id:'small', name:'Small model (8B)', total:8, active:8, tier:1},
    {id:'mid_moe', name:'Medium MoE (30B, 3B active)', total:30, active:3, tier:2},
    {id:'mid_dense', name:'Medium dense (32B)', total:32, active:32, tier:2},
    {id:'large_moe', name:'Large MoE (120B, 5B active)', total:117, active:5.1, tier:3},
    {id:'large_dense', name:'Large dense (70B)', total:70, active:70, tier:3},
  ],
  builds: [
    {id:'cpu64', name:'Used desktop, no GPU, 64 GB RAM', cost:600, nGpu:0, vram:0, ram:64, gpuBw:0, ramBw:50, eta:0, gpuW:0, cardIdleW:0, baseW:55, s:'assumed'},
    {id:'g8', name:'Used desktop + 8 GB GPU, 16 GB RAM', cost:600, nGpu:1, vram:8, ram:16, gpuBw:448, ramBw:40, eta:0.65, gpuW:175, cardIdleW:15, baseW:35, s:'assumed'},
    {id:'g12r32', name:'Used tower + 12 GB GPU, 32 GB RAM', cost:1240, nGpu:1, vram:12, ram:32, gpuBw:360, ramBw:50, eta:0.60, gpuW:170, cardIdleW:18, baseW:55, s:'assumed'},
    {id:'g12r64', name:'Used tower + 12 GB GPU, 64 GB RAM', cost:1340, nGpu:1, vram:12, ram:64, gpuBw:360, ramBw:50, eta:0.60, gpuW:170, cardIdleW:18, baseW:55, s:'assumed'},
    {id:'g24', name:'Used tower + 24 GB GPU, 64 GB RAM', cost:2100, nGpu:1, vram:24, ram:64, gpuBw:936, ramBw:50, eta:0.70, gpuW:350, cardIdleW:18, baseW:55, s:'assumed'},
    {id:'uni128', name:'Mini PC, 128 GB unified memory', cost:3500, unified:true, pool:128, poolShare:0.75, gpuBw:256, eta:0.60, loadW:140, idleW:20, s:'assumed'},
    {id:'g2x24', name:'Used workstation + 2 × 24 GB GPU, 128 GB RAM', cost:3550, nGpu:2, vram:24, ram:128, gpuBw:936, ramBw:70, eta:0.70, gpuW:350, cardIdleW:18, baseW:120, s:'assumed'},
    {id:'g32', name:'New desktop + 32 GB GPU, 64 GB RAM', cost:6900, nGpu:1, vram:32, ram:64, gpuBw:1792, ramBw:80, eta:0.65, gpuW:575, cardIdleW:22, baseW:60, s:'assumed'},
  ],
  rentals: [
    {id:'r24', name:'24 GB cloud GPU', vram:24, nGpu:1, bw:1008, usdHr:0.53, s:'estimated'},
    {id:'r48', name:'2 × 24 GB cloud GPU', vram:24, nGpu:2, bw:1008, usdHr:1.05, s:'assumed'},
    {id:'r80', name:'80 GB cloud GPU', vram:80, nGpu:1, bw:2039, usdHr:1.50, s:'estimated'},
    {id:'r160', name:'2 × 80 GB cloud GPU', vram:80, nGpu:2, bw:2039, usdHr:3.00, s:'assumed'},
  ],
  rentEta: 0.70,
  tasks: [
    {id:'quick', name:'Quick question', perWeek:40, requests:1, inTok:800, outTok:400, cache:0, ctxK:2, tier:1, agent:false},
    {id:'doc', name:'Summarise a document', perWeek:8, requests:1, inTok:8000, outTok:800, cache:0, ctxK:10, tier:2, agent:false},
    {id:'draft', name:'Drafting session (6 turns)', perWeek:5, requests:6, inTok:4000, outTok:700, cache:0.5, ctxK:8, tier:2, agent:false},
    {id:'report', name:'Analyse a long report', perWeek:2, requests:3, inTok:40000, outTok:1500, cache:0.3, ctxK:45, tier:3, agent:false},
    {id:'code', name:'Coding or agent task', perWeek:3, requests:25, inTok:15000, outTok:700, cache:0.7, ctxK:32, tier:3, agent:true},
    {id:'hard', name:'Hard problem (needs the best model)', perWeek:1, requests:10, inTok:20000, outTok:2000, cache:0.5, ctxK:40, tier:4, agent:false},
  ],
  plans: [
    {id:'free', name:'Free chat tier', kind:'window', family:'Free', aud:0, tier:3, allowance:20000, windowH:5, weeklyCap:0, ctxK:32, agent:false, tps:60, privacy:'provider', s:'assumed', note:'Allowances are not published; 0.1 × Base'},
    {id:'freeapi', name:'Free models via a broker', kind:'requests', family:'Free', aud:0, tier:3, rpd:50, ctxK:128, agent:true, tps:40, ttft:4, reliability:0.7, privacy:'training', s:'sourced', note:'Limit sourced: OpenRouter :free models, 50 requests/day (1,000/day after buying USD 10 of credit), 20/min (openrouter.ai/docs, checked 26 Sep 2026). Reliability 70% and quality assumed'},
    {id:'base', name:'Subscription Base', kind:'window', family:'Plan', aud:30.80, tier:4, allowance:200000, windowH:5, weeklyCap:12, ctxK:200, agent:true, tps:60, privacy:'provider', s:'assumed', note:'Price estimated (pack); allowance assumed'},
    {id:'pro', name:'Subscription Pro (5×)', kind:'window', family:'Plan', aud:154, tier:4, allowance:1000000, windowH:5, weeklyCap:12, ctxK:200, agent:true, tps:60, privacy:'provider', s:'assumed', note:'5 × Base allowance'},
    {id:'max', name:'Subscription Max (20×)', kind:'window', family:'Plan', aud:308, tier:4, allowance:4000000, windowH:5, weeklyCap:12, ctxK:200, agent:true, tps:60, privacy:'provider', s:'assumed', note:'20 × Base allowance'},
    {id:'apibest', name:'Pay as you go, best model', kind:'api', family:'Pay as you go', tier:4, pin:2.83, pout:17.97, ctxK:200, agent:true, tps:60, privacy:'provider', s:'estimated', note:'Mean of frontier rows, data pack'},
    {id:'apicheap', name:'Pay as you go, cheap model', kind:'api', family:'Pay as you go', tier:2, pin:0.69, pout:4.36, ctxK:128, agent:true, tps:150, privacy:'provider', s:'estimated', note:'Mean of small-tier rows, data pack'},
    {id:'apiopen', name:'Pay as you go, open models via a broker', kind:'api', family:'Pay as you go', tier:3, pin:0.85, pout:3.39, ctxK:128, agent:true, tps:40, privacy:'training', s:'estimated', note:'Budget row, data pack. Some hosts may keep prompts'},
  ],
};

function G(cfg,k){return cfg.general[k].v;}

function modelMemory(model, cfg){
  const bpw = G(cfg,'bitsPerWeight');
  const weights = model.total * bpw / 8;
  const kv = G(cfg,'localContextK') * (0.08 + 0.0035*model.total) * (G(cfg,'kvBits')/16);
  const runtime = 0.8;
  return {weights, kv, runtime, required: weights + kv + runtime};
}

function evalBuild(build, model, cfg){
  const m = modelMemory(model, cfg);
  const bpw = G(cfg,'bitsPerWeight');
  const bytes = model.active * bpw / 8;
  const moe = model.active < model.total;
  let place, share, avail, t;
  if (build.unified){
    avail = build.pool * build.poolShare;
    if (m.required > avail) return {fits:false, reason:'not enough memory', mem:m, avail};
    place = 'unified'; share = 1;
    t = bytes / (build.eta * build.gpuBw);
  } else {
    const gpuAvail = build.nGpu * build.vram * 0.95;
    const ramAvail = Math.max(0, build.ram - 6);
    avail = gpuAvail + ramAvail;
    if (build.nGpu > 0 && m.required <= gpuAvail){ place='gpu'; share=1; }
    else if (build.nGpu > 0 && m.required <= gpuAvail + ramAvail){
      place='hybrid';
      share = Math.min(1, Math.max(0, (gpuAvail - m.kv - m.runtime) / m.weights));
      if (moe) share = Math.min(1, share + G(cfg,'moeBonus'));
    }
    else if (build.nGpu === 0 && m.required <= ramAvail){ place='cpu'; share=0; }
    else return {fits:false, reason:'not enough memory', mem:m, avail};
    const etaC = G(cfg,'etaCpu');
    t = (share>0 ? share*bytes/(build.eta*build.gpuBw) : 0) + (share<1 ? (1-share)*bytes/(etaC*build.ramBw) : 0);
  }
  if (moe) t = t / G(cfg,'moeEff') + G(cfg,'moeOverheadMs')/1000;
  const multi = (build.nGpu||0) > 1 ? 0.9 : 1;
  const tps = multi / t;
  const prefMult = {gpu:20, hybrid:6, cpu:4, unified:6}[place];
  const prefill = tps * prefMult;
  let loadW, idleW;
  if (build.unified){ loadW = build.loadW; idleW = build.idleW; }
  else {
    loadW = build.baseW + build.nGpu*build.gpuW*0.60 + (place==='gpu' ? 0 : 40);
    idleW = build.baseW + build.nGpu*build.cardIdleW;
  }
  return {fits:true, place, share, tps, prefill, loadW, idleW, mem:m, avail};
}

function pickLocal(cfg, inp){
  const minTps = G(cfg,'minTps');
  const qualifying = (model) => cfg.builds.map(b => ({b, e: evalBuild(b, model, cfg)}))
    .filter(x => x.e.fits && x.e.tps >= minTps);
  const choose = (list) => {
    const inBudget = list.filter(x => x.b.cost <= inp.budget);
    if (!inBudget.length) return null;
    inBudget.sort(inp.objective === 'cheapest'
      ? (a,b) => a.b.cost - b.b.cost || b.e.tps - a.e.tps
      : (a,b) => b.e.tps - a.e.tps || a.b.cost - b.b.cost);
    return inBudget[0];
  };
  let model, pick;
  if (inp.localModel === 'auto'){
    let best = null;
    for (const mdl of cfg.models){
      const p = choose(qualifying(mdl));
      if (p && (!best || mdl.tier > best.model.tier || (mdl.tier === best.model.tier && p.e.tps > best.pick.e.tps))) best = {model:mdl, pick:p};
    }
    if (best){ model = best.model; pick = best.pick; }
    else model = cfg.models[0];
  } else {
    model = cfg.models.find(m => m.id === inp.localModel) || cfg.models[0];
    pick = choose(qualifying(model));
  }
  if (pick) return {ok:true, model, build:pick.b, e:pick.e};
  // no fit: compute suggestions
  const q = qualifying(model);
  const cheapest = q.length ? Math.min(...q.map(x => x.b.cost)) : null;
  let largest = null;
  for (const mdl of cfg.models){ const p = choose(qualifying(mdl)); if (p && (!largest || mdl.tier > largest.tier)) largest = mdl; }
  let bestTps = 0;
  for (const b of cfg.builds){ if (b.cost > inp.budget) continue; const e = evalBuild(b, model, cfg); if (e.fits) bestTps = Math.max(bestTps, e.tps); }
  return {ok:false, model, cheapest, largest, bestTps};
}

function rentalFor(model, cfg){
  const m = modelMemory(model, cfg);
  const bytes = model.active * G(cfg,'bitsPerWeight') / 8;
  const r = cfg.rentals.find(r => m.required <= r.vram * r.nGpu * 0.95);
  if (!r) return null;
  let t = bytes / (cfg.rentEta * r.bw);
  if (model.active < model.total) t = t / G(cfg,'moeEff') + G(cfg,'moeOverheadMs')/1000;
  const tps = (r.nGpu>1?0.9:1) / t;
  return {rental:r, tps, prefill: tps*20};
}

function successP(gap, cfg){
  if (gap <= 0) return G(cfg,'pSame');
  if (gap === 1) return G(cfg,'pOneBelow');
  if (gap === 2) return G(cfg,'pTwoBelow');
  return 0.05;
}

function buildOptions(cfg, inp){
  const opts = [];
  const local = pickLocal(cfg, inp);
  if (inp.enabled.local === false){}
  else if (local.ok){
    opts.push({id:'local', name:'Buy: ' + local.build.name, short:'Buy local', kind:'local', family:'Buy', tier:local.model.tier, ctxK:G(cfg,'localContextK'), agent:true,
      tps:local.e.tps, prefill:local.e.prefill, ttft:G(cfg,'localTtft'), capex:local.build.cost, loadW:local.e.loadW, idleW:local.e.idleW, privacy:'yours', s:'assumed'});
  } else {
    opts.push({id:'local', name:'Buy: no build fits', short:'Buy local', kind:'local', family:'Buy', unavailable:true, privacy:'yours'});
  }
  const rm = local.ok ? local.model : local.model;
  const rent = rentalFor(rm, cfg);
  if (rent && inp.enabled.rent !== false){
    opts.push({id:'rent', name:'Rent by the hour: ' + rent.rental.name, short:'Rent GPU', kind:'rent', family:'Rent', tier:rm.tier, ctxK:G(cfg,'localContextK'), agent:true,
      tps:rent.tps, prefill:rent.prefill, ttft:G(cfg,'localTtft'), usdHr:rent.rental.usdHr, privacy:'provider', s:rent.rental.s});
  }
  for (const p of cfg.plans){ if (inp.enabled[p.id] !== false) opts.push(Object.assign({short:p.name, ttft:p.ttft||G(cfg,'cloudTtft'), prefill:G(cfg,'cloudPrefill')}, p)); }
  return {opts, local, rentModel: rm};
}

function taskOn(task, opt, cfg, inp){
  const th = cfg.thinking[inp.thinking];
  const out = task.outTok * th;
  const inNew = task.inTok * (1 - task.cache), inCached = task.inTok * task.cache;
  const res = {task:task.id};
  if (opt.unavailable) return Object.assign(res, {ok:false, why:'No local build fits'});
  if (task.ctxK > opt.ctxK) return Object.assign(res, {ok:false, why:'Needs ' + task.ctxK + 'k context, has ' + opt.ctxK + 'k'});
  if (task.agent && !opt.agent) return Object.assign(res, {ok:false, why:'No agent or coding tools'});
  const p = successP(task.tier - opt.tier, cfg);
  if (p < G(cfg,'pMin')) return Object.assign(res, {ok:false, why:'Model too weak for this task'});
  if (inp.excludeTraining && opt.privacy === 'training') return Object.assign(res, {ok:false, why:'May train on your data (excluded)'});
  const a = 1 / (p * (opt.reliability || 1));
  const reqs = a * task.requests;
  const tReq = opt.ttft + inNew / opt.prefill + out / opt.tps;
  const hours = reqs * tReq / 3600;
  const units = reqs * (inNew + inCached * G(cfg,'subCacheWeight') + out);
  let aud = 0;
  if (opt.kind === 'api'){
    const disc = G(cfg,'cacheDiscount');
    aud = reqs * ((inNew + inCached*(1-disc)) * opt.pin + out * opt.pout) / 1e6;
  }
  let wallH = hours, spans = 1, slow = [];
  if (opt.kind === 'window'){
    spans = Math.ceil(units / opt.allowance);
    if (opt.weeklyCap > 0 && spans > opt.weeklyCap) return Object.assign(res, {ok:false, why:'One task is bigger than the weekly allowance'});
    if (spans > 1){ wallH = (spans-1)*opt.windowH + hours; slow.push('Spans ' + spans + ' reset windows'); }
  }
  if (opt.kind === 'requests'){
    spans = Math.ceil(reqs / opt.rpd);
    if (spans > 1){ wallH = (spans-1)*24 + hours; slow.push('Spans ' + spans + ' days of request limits'); }
  }
  if (p < G(cfg,'pSame')) slow.push('Often needs retries (' + Math.round(p*100) + '% success)');
  if ((opt.kind==='local'||opt.kind==='rent') && wallH > inp.hoursPerDay + (inp.overnight?inp.unattendedHours:0)) slow.push('Takes longer than a day');
  return Object.assign(res, {ok:true, p, reqs, hours, units, aud, wallH, spans, slow});
}

function evalOption(opt, cfg, inp, apiOpts){
  const cells = cfg.tasks.map(t => taskOn(t, opt, cfg, inp));
  const days = inp.daysPerWeek;
  const availH = inp.hoursPerDay*days + (inp.overnight ? inp.unattendedHours*days : 0);
  let needH=0, needU=0, needR=0;
  cfg.tasks.forEach((t,i) => { const c = cells[i]; if (c.ok){ needH += c.hours*t.perWeek; needU += c.units*t.perWeek; needR += c.reqs*t.perWeek; } });
  let frac = 1, limit = '';
  const setF = (f, why) => { if (f < frac){ frac = f; limit = why; } };
  if (needH > 0) setF(availH/needH, 'hours in your week');
  if (opt.kind === 'window'){
    let win = days*Math.ceil(inp.hoursPerDay/opt.windowH) + (inp.overnight ? days*Math.floor(inp.unattendedHours/opt.windowH) : 0);
    if (opt.weeklyCap > 0) win = Math.min(win, opt.weeklyCap);
    if (needU > 0) setF(win*opt.allowance/needU, 'usage allowance');
  }
  if (opt.kind === 'requests' && needR > 0) setF(opt.rpd*days/needR, 'daily request limit');
  frac = Math.max(0, Math.min(1, frac));
  // top-up fallbacks
  const fallbacks = cfg.tasks.map(t => {
    let best = null;
    for (const ao of apiOpts){ const c = taskOn(t, ao, cfg, inp); if (c.ok && c.p >= G(cfg,'pSame') && (!best || c.aud < best.c.aud)) best = {o:ao, c}; }
    return best;
  });
  let doneW=0, allW=0, tasksDone=0, tasksAll=0, topAud=0, topH=0, topTasks=0, ownAud=0, ownH=0, waitH=0, notDone=0;
  const ws = inp.agentWaitShareOverride;
  cfg.tasks.forEach((t,i) => {
    const c = cells[i]; const w = t.requests*(t.inTok+t.outTok)*t.perWeek;
    allW += w; tasksAll += t.perWeek;
    const done = c.ok ? t.perWeek*frac : 0;
    const left = t.perWeek - done;
    doneW += c.ok ? w*frac : 0; tasksDone += done;
    const waitFactor = t.agent ? (inp.overnight ? 0 : G(cfg,'agentWaitShare')) : 1;
    if (c.ok){ ownAud += c.aud*done; ownH += c.hours*done; waitH += c.hours*done*waitFactor; }
    c.done = done; c.left = left;
    if (left > 1e-9){
      const fb = fallbacks[i];
      if (inp.topUp && fb){ topAud += fb.c.aud*left; topH += fb.c.hours*left; topTasks += left; waitH += fb.c.hours*left*waitFactor + left*G(cfg,'handoffMin')/60; c.topUp = fb.o.short; }
      else notDone += left;
    }
    if (c.ok){
      c.status = (c.slow.length || frac < 0.999) ? 'part' : 'yes';
      if (frac < 0.999) c.slow = c.slow.concat(['Only ' + Math.round(frac*100) + '% fit your ' + limit]);
    } else c.status = 'no';
  });
  const W = WEEKS_PER_MONTH;
  let fixed=0, usage=0, energy=0, reserve=0, admin=0, capex=0;
  if (opt.unavailable){ return {opt, cells, unavailable:true}; }
  if (opt.kind === 'local'){
    capex = opt.capex;
    const powered = G(cfg,'alwaysOn') ? 168 : availH;
    const busy = Math.min(ownH, powered);
    const kwh = (busy*opt.loadW + (powered-busy)*opt.idleW) / 1000;
    energy = kwh * G(cfg,'tariff') * W;
    reserve = capex * G(cfg,'reservePct')/100/12;
    admin = G(cfg,'adminMonthly');
  } else if (opt.kind === 'rent'){
    const hrs = ownH + G(cfg,'rentOverheadH')*days;
    usage = hrs * opt.usdHr * G(cfg,'fx') * W + G(cfg,'rentStorageUSD')*G(cfg,'fx');
    admin = G(cfg,'adminMonthly');
  } else if (opt.kind === 'window' || opt.kind === 'requests'){
    fixed = opt.aud;
  } else if (opt.kind === 'api'){
    usage = ownAud * W;
  }
  const topUp = topAud * W;
  const timeCost = G(cfg,'valueOfTime') * waitH * W;
  const monthly = fixed + usage + energy + reserve + admin + topUp;
  const lifeM = Math.round(G(cfg,'lifeYears')*12);
  const series = [];
  for (let m=0; m<=60; m++){
    const purchases = capex > 0 ? (m === 0 ? 1 : 1 + Math.floor((m-1)/lifeM)) : 0;
    series.push(purchases*capex + m*(monthly + timeCost));
  }
  const H = inp.horizonYears;
  const tco = series[H*12];
  const tasksH = tasksAll*52*H;
  return {opt, cells, frac, limit, ownShare: allW ? doneW/allW : 0, tasksDone, tasksAll, notDone, topTasks,
    ownH, topH, waitH, fixed, usage, energy, reserve, admin, capex, topUp, timeCost, monthly, series, tco,
    costPerTask: tco / tasksH, longestWallH: Math.max(0, ...cells.filter(c=>c.ok).map(c=>c.wallH))};
}

function compute(cfg, inp){
  const {opts, local, rentModel} = buildOptions(cfg, inp);
  const apiOpts = opts.filter(o => o.kind === 'api');
  const allApi = cfg.plans.filter(p => p.kind==='api').map(p => Object.assign({short:p.name, ttft:G(cfg,'cloudTtft'), prefill:G(cfg,'cloudPrefill')}, p));
  const results = opts.map(o => evalOption(o, cfg, inp, apiOpts.length ? apiOpts : allApi));
  const localRes = results.find(r => r.opt.id === 'local');
  results.forEach(r => {
    if (r.unavailable || !localRes || localRes.unavailable || r === localRes){ r.breakEven = null; return; }
    let be = null;
    for (let m=1; m<=60; m++){ if (localRes.series[m] <= r.series[m]){ be = m; break; } }
    r.breakEven = be;
  });
  const ranked = results.filter(r => !r.unavailable && (inp.topUp || r.notDone < 1e-9)).sort((a,b) => a.tco - b.tco);
  const dependable = ranked.filter(r => r.opt.family !== 'Free');
  return {results, local, rentModel, ranked, dependable};
}
/* ENGINE END */
