(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.CarrowmontLoanCore;
  const L = window.CarrowmontLocale;
  if (!C || !L) return;

  let mode = 'payment';
  let lastResult = null;

  const IDENTITIES = Object.freeze({
    IN: { tool:'EMI Calculator', payment:'Monthly EMI', target:'Target monthly EMI', cta:'Generate EMI / Loan Report' },
    US: { tool:'Loan Calculator', payment:'Monthly payment', target:'Target monthly payment', cta:'Generate Loan Report' },
    CA: { tool:'Loan Calculator', payment:'Monthly payment', target:'Target monthly payment', cta:'Generate Loan Report' },
    GB: { tool:'Loan Repayment Calculator', payment:'Monthly repayment', target:'Target monthly repayment', cta:'Generate Loan Repayment Report' },
    AU: { tool:'Loan Repayment Calculator', payment:'Monthly repayment', target:'Target monthly repayment', cta:'Generate Loan Repayment Report' },
    NZ: { tool:'Loan Repayment Calculator', payment:'Monthly repayment', target:'Target monthly repayment', cta:'Generate Loan Repayment Report' },
    IE: { tool:'Loan Repayment Calculator', payment:'Monthly repayment', target:'Target monthly repayment', cta:'Generate Loan Repayment Report' },
    OTHER: { tool:'Loan / EMI Calculator', payment:'Monthly payment / EMI', target:'Target monthly payment / EMI', cta:'Generate Loan / EMI Report' }
  });

  const n = value => {
    const x = Number(value);
    return Number.isFinite(x) ? x : 0;
  };
  const money = value => L.formatMoney(value, { maximumFractionDigits: 0 });
  const compact = value => L.formatCompactMoney(value, { maximumFractionDigits: 2 });
  const pct = (value, digits = 1) => `${Number(value).toFixed(digits)}%`;

  function identity(region = L.getRegion()) {
    return IDENTITIES[region] || IDENTITIES.OTHER;
  }

  function sortedRegions() {
    return Object.entries(L.regions).sort(([a, av], [b, bv]) => {
      if (a === 'OTHER') return 1;
      if (b === 'OTHER') return -1;
      return av.label.localeCompare(bv.label, 'en', { sensitivity: 'base' });
    });
  }
  function sortedCurrencies() {
    return Object.entries(L.currencies).sort(([, a], [, b]) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
  }

  function populateLocaleControls() {
    $('regionSelect').innerHTML = sortedRegions().map(([code, cfg]) => `<option value="${code}">${cfg.label}</option>`).join('');
    $('currencySelect').innerHTML = sortedCurrencies().map(([code, cfg]) => `<option value="${code}">${code} · ${cfg.label}</option>`).join('');
    $('regionSelect').value = L.getRegion();
    $('currencySelect').value = L.getCurrency();
  }

  function applyIdentity() {
    const copy = identity();
    $('productLabel').textContent = copy.tool;
    $('chipPayment').textContent = copy.payment;
    $('targetPaymentLabel').textContent = copy.target;
    $('reportBtn').textContent = copy.cta;
    if (mode === 'payment') $('heroResultLabel').textContent = copy.payment;
    else $('heroResultLabel').textContent = 'Modeled loan amount';
  }

  function applyLocale() {
    $('regionSelect').value = L.getRegion();
    $('currencySelect').value = L.getCurrency();
    const profile = L.getProfile();
    $('localeCurrent').textContent = `${profile.label} · ${L.getCurrency()}`;
    document.body.classList.toggle('india-inr', L.getRegion() === 'IN' && L.getCurrency() === 'INR');
    document.querySelectorAll('.currency-prefix').forEach(el => { el.textContent = L.currencySymbol(); });
    applyIdentity();
    render();
  }

  function stateFromUi() {
    return {
      mode,
      principal: n($('principal').value),
      targetPayment: n($('targetPayment').value),
      annualRate: n($('annualRate').value),
      termYears: n($('termYears').value),
      termMonths: n($('termMonths').value),
      firstPaymentDate: $('firstPaymentDate').value,
      fixedFee: n($('fixedFee').value),
      percentageFee: n($('percentageFee').value),
      extraMonthly: n($('extraMonthly').value),
      oneTimeExtra: n($('oneTimeExtra').value),
      oneTimeMonth: n($('oneTimeMonth').value)
    };
  }

  function syncMode() {
    const paymentMode = mode === 'payment';
    $('principalField').hidden = !paymentMode;
    $('targetPaymentField').hidden = paymentMode;
    $('paymentModeBtn').classList.toggle('active', paymentMode);
    $('principalModeBtn').classList.toggle('active', !paymentMode);
    $('paymentModeBtn').setAttribute('aria-selected', String(paymentMode));
    $('principalModeBtn').setAttribute('aria-selected', String(!paymentMode));
    $('modeHelp').textContent = paymentMode
      ? 'Enter the amount you plan to borrow, then set the annual interest rate and repayment term.'
      : 'Enter the monthly payment budget you want to model, then set the annual interest rate and repayment term. The result is a mathematical principal, not lender eligibility.';
    applyIdentity();
  }

  function syncAdvancedFields() {
    $('oneTimeMonth').disabled = !(n($('oneTimeExtra').value) > 0);
  }

  function clearInvalid() {
    ['principal','targetPayment','annualRate','termYears','termMonths','firstPaymentDate','fixedFee','percentageFee','extraMonthly','oneTimeExtra','oneTimeMonth'].forEach(id => $(id).removeAttribute('aria-invalid'));
  }

  function showValidation(errors) {
    const box = $('validationMessage');
    clearInvalid();
    if (!errors.length) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = errors.join(' ');
    const mark = (prefix, id) => { if (errors.some(e => e.startsWith(prefix) || e.includes(prefix))) $(id).setAttribute('aria-invalid', 'true'); };
    mark('Loan amount', 'principal');
    mark('Target monthly payment', 'targetPayment');
    mark('Annual interest rate', 'annualRate');
    mark('Loan term years', 'termYears');
    mark('Additional months', 'termMonths');
    mark('Total loan term', 'termYears');
    mark('First payment date', 'firstPaymentDate');
    mark('Fixed fee', 'fixedFee');
    mark('Percentage fee', 'percentageFee');
    mark('Extra monthly payment', 'extraMonthly');
    mark('One-time extra payment cannot', 'oneTimeExtra');
    mark('One-time extra payment month', 'oneTimeMonth');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const parts = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(iso);
    if (!parts) return iso;
    const d = new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])));
    try {
      return new Intl.DateTimeFormat(L.getLocale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
    } catch (_) {
      return iso;
    }
  }

  function monthsText(months) {
    const total = Math.max(0, Math.round(months));
    const years = Math.floor(total / 12);
    const rest = total % 12;
    const parts = [];
    if (years) parts.push(`${years} year${years === 1 ? '' : 's'}`);
    if (rest || !parts.length) parts.push(`${rest} month${rest === 1 ? '' : 's'}`);
    return parts.join(' ');
  }

  function renderHeadline(r) {
    const copy = identity();
    if (mode === 'principal') {
      $('heroResultLabel').textContent = 'Modeled loan amount';
      $('heroResultValue').textContent = money(r.principal);
      $('heroResultNote').textContent = `A ${copy.payment.toLowerCase()} of ${money(r.scheduledPayment)} for ${monthsText(r.state.totalMonths)} at ${pct(r.state.annualRate, 2)}.`;
    } else {
      $('heroResultLabel').textContent = copy.payment;
      $('heroResultValue').textContent = money(r.scheduledPayment);
      $('heroResultNote').textContent = `For ${money(r.principal)} over ${monthsText(r.state.totalMonths)} at ${pct(r.state.annualRate, 2)} annual interest.`;
    }

    $('totalInterest').textContent = money(r.totalInterest);
    $('totalRepayment').textContent = money(r.totalRepayment);
    $('payoffHorizon').textContent = monthsText(r.payoffMonths);
    $('payoffDateNote').textContent = r.payoffDate ? `Modeled final payment: ${formatDate(r.payoffDate)}.` : `Modeled payoff after ${r.payoffMonths} monthly payments.`;
    $('enteredFees').textContent = money(r.fees);
    $('feesNote').textContent = `${money(r.state.fixedFee)} fixed + ${r.state.percentageFee.toFixed(2)}% of principal.`;
    $('totalCostIncludingFees').textContent = money(r.totalCostIncludingFees);

    $('extraSavingsCard').hidden = !r.hasExtraPayments;
    if (r.hasExtraPayments) {
      $('interestSaved').textContent = `${money(r.interestSaved)} interest saved`;
      $('timeSaved').textContent = r.monthsSaved > 0
        ? `${monthsText(r.monthsSaved)} sooner than the no-extra baseline.${r.payoffDate ? ` Modeled payoff: ${formatDate(r.payoffDate)}.` : ''}`
        : 'The entered extra payment does not shorten the modeled term under these assumptions.';
    }
  }

  function svgEl(name, attrs = {}, text = '') {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function renderChart(r) {
    const svg = $('balanceChart');
    [...svg.children].filter(el => !['title','desc'].includes(el.tagName.toLowerCase())).forEach(el => el.remove());
    const W = 800, H = 380, Lm = 92, Rm = 28, T = 34, B = 58;
    const rows = [{ paymentNumber: 0, endingBalance: r.principal, cumulativePrincipal: 0, cumulativeInterest: 0 }, ...r.schedule];
    const maxV = Math.max(1, ...rows.flatMap(row => [row.endingBalance, row.cumulativePrincipal, row.cumulativeInterest]));
    const yMax = maxV * 1.08;
    const maxMonth = Math.max(1, r.payoffMonths);
    const xFor = month => Lm + (month / maxMonth) * (W - Lm - Rm);
    const yFor = value => T + (1 - (Math.max(0, value) / yMax)) * (H - T - B);
    const g = svgEl('g');
    svg.appendChild(g);

    for (let i = 0; i <= 4; i += 1) {
      const y = T + i * (H - T - B) / 4;
      const value = yMax * (1 - i / 4);
      g.appendChild(svgEl('line', { x1: Lm, y1: y, x2: W - Rm, y2: y, stroke: '#dce6ea', 'stroke-width': 1 }));
      g.appendChild(svgEl('text', { x: Lm - 12, y: y + 4, 'text-anchor': 'end', fill: '#61798b', 'font-size': 12, 'font-weight': 600 }, compact(value)));
    }

    const ticks = [...new Set([0, Math.round(maxMonth / 2), maxMonth])];
    ticks.forEach(month => {
      const x = xFor(month);
      g.appendChild(svgEl('text', { x, y: H - 22, 'text-anchor': 'middle', fill: '#61798b', 'font-size': 12, 'font-weight': 650 }, month === 0 ? 'Start' : `Payment ${month}`));
    });

    const path = key => rows.map((row, i) => `${i ? 'L' : 'M'} ${xFor(row.paymentNumber).toFixed(2)} ${yFor(row[key] || 0).toFixed(2)}`).join(' ');
    g.appendChild(svgEl('path', { d: path('endingBalance'), fill: 'none', stroke: '#0e8b80', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: path('cumulativePrincipal'), fill: 'none', stroke: '#315e9a', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    g.appendChild(svgEl('path', { d: path('cumulativeInterest'), fill: 'none', stroke: '#b47b21', 'stroke-width': 3, 'stroke-dasharray': '8 6', 'stroke-linecap': 'round' }));

    const final = rows[rows.length - 1];
    const fx = xFor(final.paymentNumber);
    const label = (value, color, dy, text) => {
      const y = yFor(value);
      g.appendChild(svgEl('circle', { cx: fx, cy: y, r: 5, fill: color, stroke: '#fff', 'stroke-width': 2 }));
      g.appendChild(svgEl('text', { x: fx - 8, y: Math.max(17, y + dy), 'text-anchor': 'end', fill: color, 'font-size': 12, 'font-weight': 850 }, text));
    };
    label(final.endingBalance, '#0e8b80', -10, `Balance ${compact(final.endingBalance)}`);
    label(final.cumulativePrincipal, '#315e9a', -10, `Principal ${compact(final.cumulativePrincipal)}`);
    label(final.cumulativeInterest, '#9a6413', 18, `Interest ${compact(final.cumulativeInterest)}`);

    $('chartDesc').textContent = `Across ${r.payoffMonths} modeled payments, principal falls from ${money(r.principal)} to zero while cumulative interest reaches ${money(r.totalInterest)}.`;
    $('chartSummary').textContent = `${money(r.principal)} of principal is modeled across ${r.payoffMonths} payments. Total modeled interest is ${money(r.totalInterest)}.${r.hasExtraPayments ? ` Extra payments save ${money(r.interestSaved)} of interest and ${monthsText(r.monthsSaved)} versus the no-extra baseline.` : ''}`;
  }

  function renderTable(r) {
    $('amortizationTableBody').innerHTML = r.schedule.map(row => {
      const paymentLabel = row.date ? `${row.paymentNumber}<small>${formatDate(row.date)}</small>` : String(row.paymentNumber);
      return `<tr><td>${paymentLabel}</td><td>${money(row.payment)}</td><td>${money(row.principal)}</td><td>${money(row.interest)}</td><td>${money(row.extraPayment)}</td><td>${money(row.endingBalance)}</td></tr>`;
    }).join('');
    $('tableNote').textContent = `Showing all ${r.schedule.length} modeled monthly payments. Download CSV for the same schedule in machine-readable form.`;
  }

  function render() {
    syncAdvancedFields();
    const result = C.calculate(stateFromUi());
    if (!result.ok) {
      showValidation(result.errors);
      lastResult = null;
      return;
    }
    showValidation([]);
    lastResult = result;
    renderHeadline(result);
    renderChart(result);
    renderTable(result);
  }

  function setMode(nextMode) {
    mode = nextMode === 'principal' ? 'principal' : 'payment';
    syncMode();
    render();
  }

  function reset() {
    mode = 'payment';
    $('principal').value = '500000';
    $('targetPayment').value = '12000';
    $('annualRate').value = '10';
    $('termYears').value = '5';
    $('termMonths').value = '0';
    $('firstPaymentDate').value = '';
    $('fixedFee').value = '0';
    $('percentageFee').value = '0';
    $('extraMonthly').value = '0';
    $('oneTimeExtra').value = '0';
    $('oneTimeMonth').value = '12';
    syncMode();
    render();
  }

  function summaryText() {
    const r = lastResult;
    if (!r) return '';
    const copy = identity();
    const lines = [
      `Carrowmont ${copy.tool}`,
      `Calculation mode: ${mode === 'payment' ? `Calculate ${copy.payment.toLowerCase()}` : 'Calculate loan amount from monthly budget'}`,
      `Modeled loan amount: ${money(r.principal)}`,
      `Annual interest rate: ${r.state.annualRate.toFixed(2)}%`,
      `Original term: ${monthsText(r.state.totalMonths)}`,
      `${copy.payment}: ${money(r.scheduledPayment)}`,
      `Total interest: ${money(r.totalInterest)}`,
      `Total repayment: ${money(r.totalRepayment)}`,
      `Entered fees: ${money(r.fees)}`,
      `Total cost including entered fees: ${money(r.totalCostIncludingFees)}`,
      `Modeled payoff: ${monthsText(r.payoffMonths)}${r.payoffDate ? ` · ${formatDate(r.payoffDate)}` : ''}`
    ];
    if (r.hasExtraPayments) lines.push(`Extra-payment savings: ${money(r.interestSaved)} interest · ${monthsText(r.monthsSaved)} time`);
    lines.push('Educational fixed-rate reducing-balance illustration only; not lender eligibility, approval or a settlement quote.');
    return lines.join('\n');
  }

  async function copySummary() {
    const text = summaryText();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('clipboard unavailable');
      $('reportDownloadStatus').textContent = 'Summary copied.';
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      $('reportDownloadStatus').textContent = 'Summary copied.';
    }
  }

  function downloadCsv() {
    if (!lastResult) return;
    const rows = [['payment_number','date','payment','principal','interest','extra_payment','ending_balance','cumulative_principal','cumulative_interest']];
    lastResult.schedule.forEach(row => rows.push([
      row.paymentNumber,
      row.date || '',
      row.payment,
      row.principal,
      row.interest,
      row.extraPayment,
      row.endingBalance,
      row.cumulativePrincipal,
      row.cumulativeInterest
    ]));
    const csv = rows.map(row => row.map(v => typeof v === 'number' ? Number(v.toFixed(6)) : String(v)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'carrowmont-loan-amortization.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('reportDownloadStatus').textContent = 'CSV has been downloaded.';
  }

  async function downloadReport() {
    if (!lastResult || !window.CarrowmontLoanPdf) return;
    const btn = $('reportBtn');
    btn.disabled = true;
    $('reportDownloadStatus').textContent = 'Preparing report…';
    try {
      await window.CarrowmontLoanPdf.download(lastResult, $('balanceChart'));
      $('reportDownloadStatus').textContent = 'Report has been downloaded.';
    } catch (err) {
      console.error(err);
      $('reportDownloadStatus').textContent = 'The report could not be generated. Please try again.';
    } finally {
      btn.disabled = false;
    }
  }

  function bind() {
    ['principal','targetPayment','annualRate','termYears','termMonths','fixedFee','percentageFee','extraMonthly','oneTimeExtra','oneTimeMonth'].forEach(id => $(id).addEventListener('input', render));
    $('firstPaymentDate').addEventListener('change', render);
    $('paymentModeBtn').addEventListener('click', () => setMode('payment'));
    $('principalModeBtn').addEventListener('click', () => setMode('principal'));
    $('resetBtn').addEventListener('click', reset);
    $('copySummaryBtn').addEventListener('click', copySummary);
    $('csvBtn').addEventListener('click', downloadCsv);
    $('reportBtn').addEventListener('click', downloadReport);
    $('regionSelect').addEventListener('change', () => L.setRegion($('regionSelect').value, { syncCurrency: true }));
    $('currencySelect').addEventListener('change', () => L.setCurrency($('currencySelect').value));
    $('localeDone').addEventListener('click', () => { $('localeMenu').open = false; });
    window.addEventListener('carrowmont:localechange', applyLocale);
  }

  function consumeSharedLocale() {
    const S = window.CarrowmontPlanState;
    if (!S) return;
    const region = S.readValue('locale.region');
    const currency = S.readValue('locale.currency');
    if (region && L.regions[region] && currency && L.currencies[currency] && (region !== L.getRegion() || currency !== L.getCurrency())) {
      L.setLocale(region, currency);
    }
  }

  populateLocaleControls();
  bind();
  consumeSharedLocale();
  syncMode();
  applyLocale();
})();
