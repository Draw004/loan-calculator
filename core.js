(() => {
  'use strict';

  const LIMITS = Object.freeze({
    principal: [0.01, 1_000_000_000],
    targetPayment: [0.01, 100_000_000],
    annualRate: [0, 60],
    totalMonths: [1, 600],
    fixedFee: [0, 100_000_000],
    percentageFee: [0, 20],
    extraMonthly: [0, 100_000_000],
    oneTimeExtra: [0, 1_000_000_000]
  });

  const finite = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function parseIsoDate(value) {
    if (!value || typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return { year, month, day };
  }

  function addMonthsIso(value, offset) {
    const parsed = parseIsoDate(value);
    if (!parsed) return null;
    const monthIndex = (parsed.year * 12) + (parsed.month - 1) + offset;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const day = Math.min(parsed.day, lastDay);
    const pad = n => String(n).padStart(2, '0');
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function normalize(input = {}) {
    const years = Math.trunc(finite(input.termYears));
    const months = Math.trunc(finite(input.termMonths));
    const totalMonths = (years * 12) + months;
    return {
      mode: input.mode === 'principal' ? 'principal' : 'payment',
      principal: finite(input.principal),
      targetPayment: finite(input.targetPayment),
      annualRate: finite(input.annualRate),
      termYears: years,
      termMonths: months,
      totalMonths,
      firstPaymentDate: typeof input.firstPaymentDate === 'string' ? input.firstPaymentDate.trim() : '',
      fixedFee: finite(input.fixedFee),
      percentageFee: finite(input.percentageFee),
      extraMonthly: finite(input.extraMonthly),
      oneTimeExtra: finite(input.oneTimeExtra),
      oneTimeMonth: Math.trunc(finite(input.oneTimeMonth, 1))
    };
  }

  function paymentForPrincipal(principal, annualRatePct, totalMonths) {
    const P = finite(principal);
    const n = Math.max(1, Math.trunc(finite(totalMonths, 1)));
    const r = finite(annualRatePct) / 100 / 12;
    if (Math.abs(r) < 1e-14) return P / n;
    const factor = Math.pow(1 + r, n);
    return P * r * factor / (factor - 1);
  }

  function principalForPayment(payment, annualRatePct, totalMonths) {
    const PMT = finite(payment);
    const n = Math.max(1, Math.trunc(finite(totalMonths, 1)));
    const r = finite(annualRatePct) / 100 / 12;
    if (Math.abs(r) < 1e-14) return PMT * n;
    return PMT * (1 - Math.pow(1 + r, -n)) / r;
  }

  function validate(raw) {
    const s = normalize(raw);
    const errors = [];
    const inRange = (value, [min, max], label) => {
      if (!Number.isFinite(value) || value < min || value > max) errors.push(`${label} must be between ${min} and ${max}.`);
    };

    if (!Number.isInteger(s.termYears) || s.termYears < 0 || s.termYears > 50) errors.push('Loan term years must be a whole number from 0 to 50.');
    if (!Number.isInteger(s.termMonths) || s.termMonths < 0 || s.termMonths > 11) errors.push('Additional months must be a whole number from 0 to 11.');
    inRange(s.totalMonths, LIMITS.totalMonths, 'Total loan term');
    inRange(s.annualRate, LIMITS.annualRate, 'Annual interest rate');
    inRange(s.fixedFee, LIMITS.fixedFee, 'Fixed fee');
    inRange(s.percentageFee, LIMITS.percentageFee, 'Percentage fee');
    inRange(s.extraMonthly, LIMITS.extraMonthly, 'Extra monthly payment');
    inRange(s.oneTimeExtra, LIMITS.oneTimeExtra, 'One-time extra payment');

    if (s.mode === 'payment') inRange(s.principal, LIMITS.principal, 'Loan amount');
    else inRange(s.targetPayment, LIMITS.targetPayment, 'Target monthly payment');

    if (s.firstPaymentDate && !parseIsoDate(s.firstPaymentDate)) errors.push('First payment date must be a valid date.');
    if (s.oneTimeExtra > 0 && (s.oneTimeMonth < 1 || s.oneTimeMonth > Math.max(1, s.totalMonths))) {
      errors.push('One-time extra payment month must fall within the original loan term.');
    }

    if (!errors.length && s.mode === 'principal') {
      const modeledPrincipal = principalForPayment(s.targetPayment, s.annualRate, s.totalMonths);
      if (!Number.isFinite(modeledPrincipal) || modeledPrincipal < LIMITS.principal[0] || modeledPrincipal > LIMITS.principal[1]) {
        errors.push(`Modeled loan amount must be between ${LIMITS.principal[0]} and ${LIMITS.principal[1]}.`);
      }
    }

    return { state: s, valid: errors.length === 0, errors };
  }

  function buildSchedule({ principal, annualRate, totalMonths, scheduledPayment, extraMonthly = 0, oneTimeExtra = 0, oneTimeMonth = 0, firstPaymentDate = '' }) {
    const r = annualRate / 100 / 12;
    let balance = principal;
    let cumulativeInterest = 0;
    let cumulativePrincipal = 0;
    const schedule = [];
    const epsilon = 1e-8;

    for (let month = 1; month <= totalMonths && balance > epsilon; month += 1) {
      const openingBalance = balance;
      const interest = Math.max(0, openingBalance * r);
      const amountDue = openingBalance + interest;
      let scheduled = Math.min(scheduledPayment, amountDue);
      let scheduledPrincipal = Math.max(0, scheduled - interest);
      const afterScheduled = Math.max(0, openingBalance - scheduledPrincipal);
      const requestedExtra = Math.max(0, extraMonthly) + (month === oneTimeMonth ? Math.max(0, oneTimeExtra) : 0);
      const extraPayment = Math.min(requestedExtra, afterScheduled);
      let principalPaid = scheduledPrincipal + extraPayment;
      balance = Math.max(0, openingBalance - principalPaid);

      // The closed-form payment can leave a microscopic IEEE-754 residue on very long terms.
      // On the mathematically final scheduled period, reconcile only that negligible residue
      // into the last scheduled payment so the amortization table closes exactly at zero.
      const finalResidueTolerance = Math.max(epsilon, Math.abs(principal) * 1e-10);
      if (month === totalMonths && balance > 0 && balance <= finalResidueTolerance) {
        scheduled += balance;
        scheduledPrincipal += balance;
        principalPaid += balance;
        balance = 0;
      }
      cumulativeInterest += interest;
      cumulativePrincipal += principalPaid;
      const payment = scheduled + extraPayment;
      schedule.push({
        paymentNumber: month,
        date: firstPaymentDate ? addMonthsIso(firstPaymentDate, month - 1) : null,
        openingBalance,
        payment,
        scheduledPayment: scheduled,
        principal: principalPaid,
        scheduledPrincipal,
        interest,
        extraPayment,
        endingBalance: balance,
        cumulativePrincipal,
        cumulativeInterest
      });
    }

    const finalRow = schedule[schedule.length - 1] || null;
    const totalPayments = schedule.reduce((sum, row) => sum + row.payment, 0);
    const totalInterest = schedule.reduce((sum, row) => sum + row.interest, 0);
    return {
      schedule,
      payoffMonths: schedule.length,
      payoffDate: finalRow?.date || null,
      totalPayments,
      totalInterest,
      finalBalance: finalRow?.endingBalance ?? principal
    };
  }

  function annualSummary(schedule, principal) {
    if (!schedule.length) return [];
    const rows = [];
    for (let i = 0; i < schedule.length; i += 12) {
      const chunk = schedule.slice(i, i + 12);
      const last = chunk[chunk.length - 1];
      rows.push({
        year: Math.floor(i / 12) + 1,
        payments: chunk.length,
        paymentTotal: chunk.reduce((sum, row) => sum + row.payment, 0),
        principalPaid: chunk.reduce((sum, row) => sum + row.principal, 0),
        interestPaid: chunk.reduce((sum, row) => sum + row.interest, 0),
        extraPaid: chunk.reduce((sum, row) => sum + row.extraPayment, 0),
        endingBalance: last.endingBalance,
        cumulativePrincipal: last.cumulativePrincipal,
        cumulativeInterest: last.cumulativeInterest,
        principal
      });
    }
    return rows;
  }

  function calculate(raw) {
    const check = validate(raw);
    if (!check.valid) return { ok: false, errors: check.errors, state: check.state };
    const s = check.state;
    const principal = s.mode === 'principal'
      ? principalForPayment(s.targetPayment, s.annualRate, s.totalMonths)
      : s.principal;
    const scheduledPayment = s.mode === 'principal'
      ? s.targetPayment
      : paymentForPrincipal(principal, s.annualRate, s.totalMonths);

    if (s.oneTimeExtra > principal + 1e-8) {
      return { ok: false, errors: ['One-time extra payment cannot exceed the modeled opening loan amount.'], state: s };
    }

    const baseline = buildSchedule({
      principal,
      annualRate: s.annualRate,
      totalMonths: s.totalMonths,
      scheduledPayment,
      firstPaymentDate: s.firstPaymentDate
    });

    const scenario = buildSchedule({
      principal,
      annualRate: s.annualRate,
      totalMonths: s.totalMonths,
      scheduledPayment,
      extraMonthly: s.extraMonthly,
      oneTimeExtra: s.oneTimeExtra,
      oneTimeMonth: s.oneTimeMonth,
      firstPaymentDate: s.firstPaymentDate
    });

    const fees = s.fixedFee + (principal * s.percentageFee / 100);
    const interestSaved = Math.max(0, baseline.totalInterest - scenario.totalInterest);
    const monthsSaved = Math.max(0, baseline.payoffMonths - scenario.payoffMonths);
    const totalRepayment = scenario.totalPayments;
    const interestShare = totalRepayment > 0 ? scenario.totalInterest / totalRepayment : 0;

    return {
      ok: true,
      state: s,
      principal,
      scheduledPayment,
      monthlyRate: s.annualRate / 100 / 12,
      baseline,
      scenario,
      schedule: scenario.schedule,
      annualSummary: annualSummary(scenario.schedule, principal),
      totalInterest: scenario.totalInterest,
      totalRepayment,
      fees,
      totalCostIncludingFees: totalRepayment + fees,
      interestShare,
      payoffMonths: scenario.payoffMonths,
      payoffDate: scenario.payoffDate,
      baselinePayoffMonths: baseline.payoffMonths,
      baselinePayoffDate: baseline.payoffDate,
      baselineInterest: baseline.totalInterest,
      interestSaved,
      monthsSaved,
      hasExtraPayments: s.extraMonthly > 0 || s.oneTimeExtra > 0
    };
  }

  window.CarrowmontLoanCore = {
    LIMITS,
    normalize,
    validate,
    paymentForPrincipal,
    principalForPayment,
    buildSchedule,
    annualSummary,
    calculate,
    parseIsoDate,
    addMonthsIso,
    clamp
  };
})();
