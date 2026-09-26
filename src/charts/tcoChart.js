// tcoChart.js: Chart.js wrapper for the hero chart (spec 7 chart 1, 6.14).
// Two modes: cumulative TCO for every option, or the payback view:
// cumulative net saving of each option against a reference option, crossing
// zero at break-even. Cloud Best (API Best) is dashed. Horizon is marked.

function destroyChart(id) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
}

function horizonMarkPlugin(globals) {
  const horizonMonth = globals.horizon_years * 12;
  return {
    id: 'horizonMark',
    afterDraw(chart) {
      const x = chart.scales.x.getPixelForValue(horizonMonth);
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = '#8a5a00';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chart.chartArea.top);
      ctx.lineTo(x, chart.chartArea.bottom);
      ctx.stroke();
      ctx.fillStyle = '#8a5a00';
      ctx.font = '10px sans-serif';
      ctx.fillText('horizon ' + globals.horizon_years + 'y', x + 4, chart.chartArea.top + 10);
      ctx.restore();
    }
  };
}

function tcoChartRender(canvasId, result, globals) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  destroyChart(canvasId);

  const months = [];
  for (let m = 0; m <= result.meta.months; m++) months.push(m);

  const mode = state.chartMode || 'tco';
  const logScale = !!state.tcoLog;
  const refId = state.paybackRef;
  const ref = result.options.find(o => o.id === refId) || result.recommendation.winner || result.options[0];
  const palette = ['#0b6b58', '#b6541f', '#3f6fb5', '#7a4fa3', '#a3a83b', '#8b1f2b', '#4a4a4a', '#26648b'];
  const datasets = [];
  let colour = 0;
  const winnerId = result.recommendation.winner ? result.recommendation.winner.id : null;

  const band = mode !== 'payback' && result.band ? result.band.options : null;

  for (const o of result.options) {
    if (mode === 'payback' && ref && o.id === ref.id) continue;
    const data = mode === 'payback' && ref
      ? o.tco_series.nominal.map((v, i) => v - ref.tco_series.nominal[i])
      : o.tco_series.nominal;
    const lineColour = palette[colour % palette.length];
    datasets.push({
      label: o.label + (o.sensitivity.vetoed ? ' (vetoed)' : '') + (o.id === winnerId ? ' (winner)' : ''),
      data,
      borderColor: lineColour,
      backgroundColor: 'transparent',
      borderDash: o.id === 'api_best' ? [6, 4] : [],
      borderWidth: o.id === winnerId ? 3 : 1.4,
      pointRadius: 0,
      pointHitRadius: 6,
      hidden: o.sensitivity.vetoed,
      _option: o
    });
    colour++;
    // Shaded band (spec 7 chart 1): low/high envelope from the sensitivity
    // swings, drawn for the winner and the runner-up in cumulative view.
    const runnerId = result.recommendation.runner_up ? result.recommendation.runner_up.id : null;
    const env = mode !== 'payback' && band && (o.id === winnerId || o.id === runnerId) ? band[o.id] : null;
    if (env) {
      datasets.push({
        label: 'band low: ' + o.label,
        data: env.low,
        borderColor: 'transparent',
        backgroundColor: lineColour + '22',
        borderWidth: 0,
        pointRadius: 0,
        fill: '+1',
        hidden: o.sensitivity.vetoed,
        _band: true
      });
      datasets.push({
        label: 'band high: ' + o.label,
        data: env.high,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 0,
        pointRadius: 0,
        hidden: o.sensitivity.vetoed,
        _band: true
      });
    }
  }

  const isPayback = mode === 'payback';
  const crossings = [];
  if (isPayback) {
    for (const ds of datasets) {
      for (let i = 1; i < ds.data.length; i++) {
        if (ds.data[i - 1] < 0 && ds.data[i] >= 0) { crossings.push({ ds, month: i }); break; }
      }
    }
  } else {
    // Cumulative view: mark where a cloud option's line overtakes the local
    // line, the month the local box has paid for itself against it.
    const localOption = result.options.find(o => o.family === 'local');
    if (localOption) {
      const localSeries = localOption.tco_series.nominal;
      for (const ds of datasets) {
        const o = ds._option;
        if (!o || o.family === 'local' || o.sensitivity.vetoed) continue;
        for (let i = 1; i < ds.data.length; i++) {
          if (ds.data[i - 1] < localSeries[i - 1] && ds.data[i] >= localSeries[i]) {
            crossings.push({ ds, month: i, label: o.label });
            break;
          }
        }
      }
    }
  }

  const breakEvenPlugin = {
    id: 'breakEvenMarks',
    afterDatasetsDraw(chart) {
      if (!crossings.length) return;
      const ctx = chart.ctx;
      ctx.save();
      for (const c of crossings) {
        const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(c.ds));
        if (!meta.data[c.month]) continue;
        const pt = meta.data[c.month];
        ctx.fillStyle = c.ds.borderColor;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1a1d21';
        ctx.font = '10px sans-serif';
        const text = (c.label ? 'local pays off vs ' + c.label.split(',')[0] + ', ' : '') + 'month ' + c.month;
        ctx.fillText(text, pt.x + 6, pt.y - 6);
      }
      ctx.restore();
    }
  };

  state.charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: months, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        title: {
          display: true,
          text: isPayback
            ? 'Payback view: cumulative net saving of each option versus ' + ref.label + ' (AUD, estimate)'
            : 'Cumulative TCO by month (AUD, estimate)'
        },
        tooltip: {
          callbacks: {
            title: items => 'Month ' + items[0].label,
            label: item => item.dataset.label + ': ' +
              (isPayback && item.parsed.y > 0 ? 'saving ' : '') + 'AUD ' + Math.round(Math.abs(item.parsed.y)).toLocaleString('en-AU')
          }
        },
        legend: { labels: { boxWidth: 14, font: { size: 10 } } }
      },
      scales: {
        x: { title: { display: true, text: 'Month' }, ticks: { maxTicksLimit: 13 }, grid: { display: false } },
        y: {
          type: logScale && !isPayback ? 'logarithmic' : 'linear',
          title: { display: true, text: isPayback ? 'AUD, net saving' : 'AUD, cumulative' },
          ticks: { callback: v => (v < 0 ? '-$' : '$') + Math.abs(v) >= 1000 ? ('$' + Math.round(Math.abs(v) / 1000) + 'k') : ('$' + Math.round(Math.abs(v))) }
        }
      }
    },
    plugins: isPayback ? [breakEvenPlugin, horizonMarkPlugin(globals)] : [horizonMarkPlugin(globals)]
  });

  const note = $('chart-mode-note');
  if (note) {
    note.textContent = isPayback
      ? 'Net saving is each option\'s cumulative TCO minus ' + ref.label + '\u2019s. Above zero means the option is ahead of the reference. Month 0 crossings mean cheaper from the start.'
      : 'Local options jump to their full purchase price at month 0, then add electricity, reserve and admin: that first vertical step IS the machine. Cloud Best (API: Best) is dashed. Switch to the payback view to see break-even points.';
  }
}

function renderChartModeControls(result) {
  const wrap = $('chart-mode');
  if (!wrap || wrap.dataset.built) { syncChartModeControls(result); return; }
  wrap.dataset.built = '1';
  wrap.innerHTML = '';
  const tcoBtn = document.createElement('button');
  tcoBtn.textContent = 'Cumulative TCO';
  tcoBtn.addEventListener('click', () => { state.chartMode = 'tco'; recalculate(); });
  const payBtn = document.createElement('button');
  payBtn.textContent = 'Payback view';
  payBtn.addEventListener('click', () => { state.chartMode = 'payback'; recalculate(); });
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Reference option for the payback view');
  for (const o of result.options) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = 'vs ' + o.label;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => { state.paybackRef = sel.value; recalculate(); });
  const logLabel = document.createElement('label');
  logLabel.className = 'checkbox-line';
  const logText = document.createElement('span');
  logText.textContent = 'Log scale';
  const logBox = document.createElement('input');
  logBox.type = 'checkbox';
  logBox.id = 'tco-log';
  logBox.checked = !!state.tcoLog;
  logBox.addEventListener('change', () => { state.tcoLog = logBox.checked; recalculate(); });
  logLabel.appendChild(logText);
  logLabel.appendChild(logBox);
  wrap.appendChild(tcoBtn); wrap.appendChild(payBtn); wrap.appendChild(sel); wrap.appendChild(logLabel);
  syncChartModeControls(result);
}

function syncChartModeControls(result) {
  const wrap = $('chart-mode');
  if (!wrap) return;
  const buttons = wrap.querySelectorAll('button');
  if (buttons.length < 2) return;
  const mode = state.chartMode || 'tco';
  buttons[0].style.fontWeight = mode === 'tco' ? '700' : '400';
  buttons[1].style.fontWeight = mode === 'payback' ? '700' : '400';
  const sel = wrap.querySelector('select');
  if (sel) {
    const refId = state.paybackRef || (result.recommendation.winner && result.recommendation.winner.id);
    if (refId) sel.value = refId;
    sel.style.display = mode === 'payback' ? '' : 'none';
  }
}
