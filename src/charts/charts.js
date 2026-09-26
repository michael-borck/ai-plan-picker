// charts.js: the remaining Single user tab charts (spec 7): 24-hour delivery
// profile (chart 4), waiting time (chart 7), capacity vs demand (chart 5) and
// the Hardware explorer budget frontier (chart 9).

function profileChartRender(canvasId, result) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  destroyChart(canvasId);

  const sel = $('profile-option');
  const wantedId = sel && sel.value ? sel.value : (result.recommendation.winner && result.recommendation.winner.id);
  const option = result.options.find(o => o.id === wantedId) || result.recommendation.winner || result.options[0];
  if (sel && option && sel.value !== option.id) sel.value = option.id;

  const inp = result.inputs_used;
  const d = result.demand;

  const cloudTokens = d.tokens_cloud_per_day;
  const totalPerDay = d.sq_in_per_day + d.sq_out_per_day || 1;
  const peak = CONFIG.parameters['demand.peak_hour_share'].value;
  const profile = profile24(CONFIG,
    {
      tokens_interactive: cloudTokens * (d.sq_in_interactive_per_day + d.sq_out_interactive_per_day) / totalPerDay,
      tokens_agent: cloudTokens * (d.sq_in_agent_per_day + d.sq_out_agent_per_day) / totalPerDay,
      span_h: d.preset.interactive_h,
      unattended_h: d.preset.unattended_h,
      peak_share: peak
    },
    profile24ArgsFor(option, result)
  );

  const labels = [];
  for (let i = 0; i < profile.demand.length; i++) labels.push(i * profile.step_minutes);

  const lockoutPlugin = {
    id: 'lockoutShade',
    beforeDraw(chart) {
      const locked = profile.locked;
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      ctx.save();
      ctx.fillStyle = 'rgba(139, 31, 43, 0.12)';
      for (let i = 0; i < locked.length; i++) {
        if (!locked[i]) continue;
        const x0 = xScale.getPixelForValue(labels[i]);
        const x1 = xScale.getPixelForValue(labels[i] + profile.step_minutes);
        ctx.fillRect(x0, chart.chartArea.top, x1 - x0, chart.chartArea.bottom - chart.chartArea.top);
      }
      ctx.restore();
    }
  };

  destroyChart(canvasId);
  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Cumulative demand', data: profile.demand, borderColor: '#4a4a4a', borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 },
        { label: 'Delivered: ' + option.label, data: profile.delivered, borderColor: '#0b6b58', pointRadius: 0, borderWidth: 2.5, fill: false }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: '24-hour delivery profile: cumulative tokens (estimate)' },
        tooltip: { callbacks: { title: items => timeLabel(items[0].label), label: item => item.dataset.label + ': ' + Math.round(item.parsed.y).toLocaleString('en-AU') + ' tokens' } },
        legend: { labels: { boxWidth: 14, font: { size: 10 } } }
      },
      scales: {
        x: { title: { display: true, text: 'Hour of day' }, ticks: { maxTicksLimit: 13, callback: v => timeLabel(v) }, grid: { display: false } },
        y: { title: { display: true, text: 'Tokens, cumulative' }, ticks: { callback: v => (v / 1000) + 'k' } }
      }
    },
    plugins: [lockoutPlugin]
  });

  const note = $('profile-note');
  if (note) {
    const lockedH = profile.locked.filter(Boolean).length * profile.step_minutes / 60;
    note.textContent = 'Shaded strips are lockout: the option wanted to deliver but could not (about ' + lockedH.toFixed(1) + ' h on this day). ' +
      (option.family === 'local' && profile.backlog_tokens > 0
        ? 'The local box finishes its backlog after hours: ' + Math.round(profile.backlog_tokens).toLocaleString('en-AU') + ' tokens still queued at midnight.'
        : 'All figures are estimates.');
  }
}

function profile24ArgsFor(option, result) {
  if (option.family === 'local') {
    return { kind: 'local', rate_tps: option.speed.decode_tps.mid };
  }
  if (option.family === 'subscription') {
    const tier = option.tier;
    return {
      kind: 'subscription',
      allowance: CONFIG.parameters['subscriptions.base_allowance_tokens'].value * tier.allowance_multiplier *
        CONFIG.parameters['subscriptions.multiplier_' + option.cloud_class].value,
      window_h: CONFIG.parameters['subscriptions.window_h'].value,
      burst_tps: option.per_user_tps_mid
    };
  }
  if (option.id.startsWith('rental_hourly')) {
    return { kind: 'rental_hourly', burst_tps: option.per_user_tps_mid, rented_h: option.rented_h };
  }
  return { kind: 'api', burst_tps: option.per_user_tps_mid };
}

function timeLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function waitChartRender(canvasId, result) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  destroyChart(canvasId);

  const options = result.options.slice().sort((a, b) => a.wait_hours_per_user_year - b.wait_hours_per_user_year);
  const vot = result.value_of_time_aud_h;
  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: options.map(o => o.label),
      datasets: [{
        label: 'Hours per user per year waiting',
        data: options.map(o => Math.round(o.wait_hours_per_user_year)),
        backgroundColor: options.map(o => o.id === (result.recommendation.winner && result.recommendation.winner.id) ? '#0b6b58' : '#9db8b1')
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Waiting time per user per year (estimate)' + (vot > 0 ? ', costed at AUD ' + vot + ' per hour' : '') },
        tooltip: {
          callbacks: {
            label: item => {
              const h = item.parsed.x;
              return h.toLocaleString('en-AU') + ' h/yr' + (vot > 0 ? ' = about AUD ' + Math.round(h * vot).toLocaleString('en-AU') + '/yr' : '');
            }
          }
        },
        legend: { display: false }
      },
      scales: { x: { title: { display: true, text: 'Hours per year' } } }
    }
  });
}

function capacityChartRender(canvasId, result) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  destroyChart(canvasId);

  const options = result.options;
  const demandSq = result.demand.sq_per_day;
  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: options.map(o => o.label),
      datasets: [
        {
          label: 'Capacity (SQ per day)',
          data: options.map(o => o.capacity_sq_per_day == null ? null : Math.round(o.capacity_sq_per_day)),
          backgroundColor: options.map(o => o.id === (result.recommendation.winner && result.recommendation.winner.id) ? '#0b6b58' : '#9db8b1')
        },
        {
          label: 'Demand (SQ per day)',
          data: options.map(() => Math.round(demandSq)),
          type: 'line',
          borderColor: '#8b1f2b',
          borderDash: [6, 4],
          pointRadius: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Capacity versus demand, Standard Queries per day (estimate)' },
        legend: { labels: { boxWidth: 14 } }
      },
      scales: { y: { type: 'logarithmic', title: { display: true, text: 'SQ per day (log scale)' } } }
    }
  });
}

function frontierChartRender(canvasId, frontier) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !frontier) return;
  destroyChart(canvasId);

  const labels = frontier.frontier.map(p => Math.round(p.budget_aud));
  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Largest model runnable at the minimum speed',
          data: frontier.frontier.map(p => p.effective_b),
          borderColor: '#0b6b58',
          backgroundColor: 'transparent',
          stepped: true,
          pointRadius: 2
        },
        {
          label: 'Decode speed of the picked build (tok/s)',
          data: frontier.frontier.map(p => p.tps_mid),
          borderColor: '#b6541f',
          backgroundColor: 'transparent',
          pointRadius: 2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Budget frontier: biggest model and speed you can buy (estimate)' },
        tooltip: {
          callbacks: {
            title: items => 'Budget AUD ' + Number(items[0].label).toLocaleString('en-AU'),
            label: item => item.dataset.label + ': ' + (item.parsed.y ? Math.round(item.parsed.y * 10) / 10 : '-')
          }
        },
        legend: { labels: { boxWidth: 14 } }
      },
      scales: {
        x: { title: { display: true, text: 'Budget AUD (at each step)' } },
        y: { title: { display: true, text: 'Billion parameters (effective)' }, beginAtZero: true },
        y1: { position: 'right', title: { display: true, text: 'tok/s' }, beginAtZero: true, grid: { display: false } }
      }
    }
  });
}

// Sensitivity tornado (spec 7 chart 8): how each banded parameter moves the
// TCO gap between the winner and the runner-up. Floating bars from the low
// end to the base gap and from the base gap to the high end.
function tornadoChartRender(canvasId, rows, baseGap) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !rows || !rows.length) return;
  destroyChart(canvasId);

  const labels = rows.map(r => r.label);
  const hasBase = baseGap != null;
  const lowData = rows.map(r => r.low_gap == null || !hasBase ? [r.low_gap, r.low_gap] : [Math.min(r.low_gap, r.base_gap), Math.max(r.low_gap, r.base_gap)]);
  const highData = rows.map(r => r.high_gap == null || !hasBase ? [r.high_gap, r.high_gap] : [Math.min(r.high_gap, r.base_gap), Math.max(r.high_gap, r.base_gap)]);

  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: hasBase ? 'Parameter at its low value (gap moves to)' : 'Gap at low value',
          data: lowData, backgroundColor: 'rgba(139, 31, 43, 0.55)', barPercentage: 0.9 },
        { label: hasBase ? 'Parameter at its high value (gap moves to)' : 'Gap at high value',
          data: highData, backgroundColor: 'rgba(11, 107, 88, 0.55)', barPercentage: 0.9 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Winner minus runner-up TCO gap (AUD, estimate)' },
        tooltip: {
          callbacks: {
            label: item => item.dataset.label + ': AUD ' + Math.round(item.parsed._custom ? item.raw[0] : item.raw[0]).toLocaleString('en-AU') +
              ' to AUD ' + Math.round(item.raw[1]).toLocaleString('en-AU')
          }
        },
        legend: { labels: { boxWidth: 14, font: { size: 10 } } }
      },
      scales: {
        x: { title: { display: true, text: 'AUD gap at the horizon' } }
      }
    }
  });

  const note = $('tornado-note');
  if (note) {
    const top = rows[0];
    note.textContent = hasBase
      ? 'Bars show where the winner-vs-runner-up gap lands when ' + top.param_id + ' and the rest swing across their bands. The longest bar is the assumption that matters most: ' + top.label.toLowerCase() + ' (' + top.param_id + ').'
      : 'Swing each parameter to see which assumption matters most.';
  }
}

// Cost per completed task, log toggle optional (spec 7 chart 6).
function costPerTaskChartRender(canvasId, result) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  destroyChart(canvasId);
  const options = result.options.filter(o => o.cost_per_completed_task_aud != null)
    .sort((a, b) => a.cost_per_completed_task_aud - b.cost_per_completed_task_aud);
  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: options.map(o => o.label),
      datasets: [{
        label: 'Cost per completed task (AUD)',
        data: options.map(o => Number(o.cost_per_completed_task_aud.toFixed(4))),
        backgroundColor: options.map(o => o.id === (result.recommendation.winner && result.recommendation.winner.id) ? '#0b6b58' : '#9db8b1')
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Cost per completed task, TCO over the week actually delivered (AUD, estimate)' },
        legend: { display: false }
      },
      scales: { x: { type: 'logarithmic', title: { display: true, text: 'AUD per task (log scale)' } } }
    }
  });
}
