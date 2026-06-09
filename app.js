const DEFAULT_BACKEND = "https://sec-edgar-proxy.ecamacho773.workers.dev";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const CACHE_VERSION = "v3";
const PERFECT_SCORES_KEY = "fqs:perfect-scores:v1";

const CPI = {
  2015: 0.1, 2016: 1.3, 2017: 2.1, 2018: 2.4, 2019: 1.8,
  2020: 1.2, 2021: 4.7, 2022: 8.0, 2023: 4.1, 2024: 2.9, 2025: 2.9,
};

const fields = [
  ["revenue", "Revenue", "$"],
  ["gross_profit", "Gross profit", "$"],
  ["net_income", "Net income", "$"],
  ["assets", "Assets", "$"],
  ["shareholders_equity", "Shareholders equity", "$"],
  ["long_term_debt", "Long-term debt", "$"],
  ["dividends_paid", "Dividends paid", "$"],
  ["share_buybacks", "Share buybacks", "$"],
  ["eps_diluted", "Diluted EPS", "$/share"],
  ["return_on_shareholder_equity_pct", "ROE", "%"],
  ["return_on_assets_pct", "ROA", "%"],
  ["net_income_margin_pct", "Net margin", "%"],
  ["gross_profit_margin_pct", "Gross margin", "%"],
];

const chartOptions = [
  ["revenue", "Revenue"],
  ["net_income", "Net income"],
  ["return_on_shareholder_equity_pct", "ROE"],
  ["return_on_assets_pct", "ROA"],
  ["net_income_margin_pct", "Net margin"],
  ["gross_profit_margin_pct", "Gross margin"],
  ["long_term_debt", "Long-term debt"],
  ["share_buybacks", "Share buybacks"],
];

const fallbackConcepts = {
  revenue: { unit: "USD", tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "SalesRevenueGoodsNet"] },
  gross_profit: { unit: "USD", tags: ["GrossProfit"] },
  net_income: { unit: "USD", tags: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"] },
  assets: { unit: "USD", instant: true, tags: ["Assets"] },
  shareholders_equity: { unit: "USD", instant: true, tags: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  retained_earnings: { unit: "USD", instant: true, tags: ["RetainedEarningsAccumulatedDeficit"] },
  long_term_debt: { unit: "USD", instant: true, tags: ["LongTermDebtNoncurrent", "LongTermDebtAndFinanceLeaseObligationsNoncurrent", "LongTermDebtAndFinanceLeaseObligations", "LongTermDebtAndFinanceLeaseObligationsIncludingCurrentMaturities", "LongTermDebt"] },
  dividends_paid: { unit: "USD", tags: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "PaymentsOfDividendsCommonStockAndPreferenceStock", "DividendsCommonStockCash"] },
  share_buybacks: { unit: "USD", tags: ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity", "RepaymentsOfCommonStocks", "TreasuryStockValueAcquiredCostMethod"] },
  eps_diluted: { unit: "USD/shares", tags: ["EarningsPerShareDiluted", "EarningsPerShareBasic"] },
  eps_basic: { unit: "USD/shares", tags: ["EarningsPerShareBasic"] },
};

const fallbackRequiredFields = [
  "revenue",
  "gross_profit",
  "net_income",
  "assets",
  "shareholders_equity",
  "retained_earnings",
  "long_term_debt",
  "dividends_paid",
  "share_buybacks",
  "eps_diluted",
];

const el = {
  ticker: document.querySelector("#tickerInput"),
  exclude: document.querySelector("#excludeInput"),
  exclude2020: document.querySelector("#exclude2020Toggle"),
  backend: document.querySelector("#backendInput"),
  analyze: document.querySelector("#analyzeButton"),
  result: document.querySelector("#result"),
  empty: document.querySelector("#empty"),
  message: document.querySelector("#message"),
  metricsStatus: document.querySelector("#metricsStatus"),
  submissionsStatus: document.querySelector("#submissionsStatus"),
  cacheStatus: document.querySelector("#cacheStatus"),
  fallbackStatus: document.querySelector("#fallbackStatus"),
  companyMeta: document.querySelector("#companyMeta"),
  companyTitle: document.querySelector("#companyTitle"),
  yearRange: document.querySelector("#yearRange"),
  scoreNumber: document.querySelector("#scoreNumber"),
  scoreLabel: document.querySelector("#scoreLabel"),
  summaryGrid: document.querySelector("#summaryGrid"),
  chartMetric: document.querySelector("#chartMetric"),
  chart: document.querySelector("#trendChart"),
  sourceLine: document.querySelector("#sourceLine"),
  table: document.querySelector("#dataTable"),
  copy: document.querySelector("#copyButton"),
  csv: document.querySelector("#csvButton"),
  perfectTable: document.querySelector("#perfectTable"),
  perfectExport: document.querySelector("#perfectExportButton"),
  perfectClear: document.querySelector("#perfectClearButton"),
};

let state = { payload: null, submissions: null, checks: [], activeMetric: "revenue" };

el.backend.value = DEFAULT_BACKEND;
chartOptions.forEach(([value, label]) => {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  el.chartMetric.append(option);
});

el.analyze.addEventListener("click", analyze);
el.ticker.addEventListener("keydown", (event) => {
  if (event.key === "Enter") analyze();
});
el.exclude.addEventListener("keydown", (event) => {
  if (event.key === "Enter") analyze();
});
el.exclude2020.addEventListener("change", () => {
  if (el.ticker.value.trim()) analyze();
});
el.chartMetric.addEventListener("change", () => {
  state.activeMetric = el.chartMetric.value;
  drawChart();
});
el.copy.addEventListener("click", copyJson);
el.csv.addEventListener("click", exportCsv);
el.perfectExport.addEventListener("click", exportPerfectScores);
el.perfectClear.addEventListener("click", clearPerfectScores);
renderPerfectScores();

function cleanBackend() {
  return (el.backend.value || DEFAULT_BACKEND).trim().replace(/\/+$/, "");
}

function parseExclude() {
  const typedYears = el.exclude.value
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((year) => Number.isFinite(year));
  if (el.exclude2020.checked) typedYears.push(2020);
  return Array.from(new Set(typedYears)).sort((a, b) => a - b);
}

function cacheKey(symbol, exclude, backend) {
  return `fqs:${CACHE_VERSION}:${backend}:${symbol}:${exclude.join("-")}`;
}

function readCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (!cached || Date.now() - cached.savedAt > CACHE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Storage can be disabled in some browser contexts. The app still works without it.
  }
}

async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const text = await response.text();
    const ms = Math.round(performance.now() - started);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
    return { ok: true, ms, bytes: text.length, json: JSON.parse(text) };
  } finally {
    clearTimeout(timer);
  }
}

async function analyze() {
  const symbol = el.ticker.value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const exclude = parseExclude();
  const backend = cleanBackend();
  if (!symbol) {
    showMessage("Enter a US-listed ticker first.");
    return;
  }

  setBusy(true);
  showMessage("");
  setStatus(el.metricsStatus, "pending", "SEC metrics", "Requesting compact metrics endpoint.");
  setStatus(el.submissionsStatus, "pending", "SEC submissions", "Requesting filing profile endpoint.");
  setStatus(el.fallbackStatus, "pending", "SEC fallback", "Will run only if compact metrics are sparse.");

  const key = cacheKey(symbol, exclude, backend);
  const cached = readCache(key);
  if (cached) {
    setStatus(el.cacheStatus, "ok", "Local cache", `Loaded cached copy from ${new Date(cached.savedAt).toLocaleString()}.`);
    applySourceChecks(cached.data.checks || []);
    render(cached.data.payload, cached.data.submissions, cached.data.checks);
    setBusy(false);
    return;
  }
  setStatus(el.cacheStatus, "warn", "Local cache", "No fresh cached copy for this request.");

  const params = new URLSearchParams({ years: "10" });
  exclude.forEach((year) => params.append("exclude", String(year)));
  const metricsUrl = `${backend}/metrics/${encodeURIComponent(symbol)}?${params.toString()}`;
  const submissionsUrl = `${backend}/submissions/${encodeURIComponent(symbol)}`;

  try {
    const [metricsResult, submissionsResult] = await Promise.allSettled([
      fetchJson(metricsUrl, 15000),
      fetchJson(submissionsUrl, 15000),
    ]);

    if (metricsResult.status !== "fulfilled") {
      setStatus(el.metricsStatus, "fail", "SEC metrics", readableError(metricsResult.reason));
      throw metricsResult.reason;
    }

    const metrics = metricsResult.value;
    setStatus(el.metricsStatus, "ok", "SEC metrics", `${formatBytes(metrics.bytes)} in ${metrics.ms} ms.`);

    let submissions = null;
    const checks = [{ name: "SEC metrics", url: metricsUrl, ms: metrics.ms, bytes: metrics.bytes, ok: true }];
    if (submissionsResult.status === "fulfilled") {
      submissions = submissionsResult.value.json;
      checks.push({ name: "SEC submissions", url: submissionsUrl, ms: submissionsResult.value.ms, bytes: submissionsResult.value.bytes, ok: true });
      setStatus(el.submissionsStatus, "ok", "SEC submissions", `${formatBytes(submissionsResult.value.bytes)} in ${submissionsResult.value.ms} ms.`);
    } else {
      checks.push({ name: "SEC submissions", url: submissionsUrl, ok: false, error: readableError(submissionsResult.reason) });
      setStatus(el.submissionsStatus, "warn", "SEC submissions", readableError(submissionsResult.reason));
    }

    const fallbackResult = await applySecConceptFallback(metrics.json, symbol, backend, exclude);
    const payload = fallbackResult.payload;
    checks.push(...fallbackResult.checks);
    updateFallbackStatus(fallbackResult);
    writeCache(key, { payload, submissions, checks });
    render(payload, submissions, checks);
  } catch (error) {
    showMessage(`Could not complete analysis for ${symbol}: ${readableError(error)}`);
  } finally {
    setBusy(false);
  }
}

function render(payload, submissions, checks) {
  const rows = (payload.data || []).slice().sort((a, b) => a.fiscal_year - b.fiscal_year);
  if (!rows.length) {
    showMessage("The metrics endpoint returned no annual rows.");
    return;
  }

  state = { payload, submissions, checks, activeMetric: state.activeMetric || "revenue" };
  const profile = submissions && submissions.data ? submissions.data : {};
  const symbol = (profile.tickers && profile.tickers[0]) || el.ticker.value.trim().toUpperCase();
  const exchange = profile.exchanges && profile.exchanges[0] ? profile.exchanges[0] : "US listed";
  const company = profile.name || payload.entityName || symbol;
  const passItems = buildScore(rows);
  const passed = passItems.filter((item) => item.status === "pass").length;
  const scoreText = `${passed}/${passItems.length}`;

  el.companyMeta.textContent = `${exchange}${profile.sicDescription ? ` - ${profile.sicDescription}` : ""}`;
  el.companyTitle.textContent = `${company} (${symbol})`;
  el.yearRange.textContent = `FY ${rows[0].fiscal_year}-${rows[rows.length - 1].fiscal_year} - CIK ${payload.cik || "unknown"} - ${payload.cache || "source unknown"}`;
  el.scoreNumber.textContent = scoreText;
  el.scoreLabel.textContent = "criteria passed";
  el.sourceLine.textContent = checks.map((check) => check.ok ? `${check.name}: ${formatBytes(check.bytes)} in ${check.ms} ms` : `${check.name}: ${check.error}`).join(" | ");

  el.summaryGrid.replaceChildren(...passItems.map(metricCard));
  renderTable(rows);
  drawChart();
  if (passed === passItems.length) {
    savePerfectScore({
      symbol,
      company,
      score: scoreText,
      years: `${rows[0].fiscal_year}-${rows[rows.length - 1].fiscal_year}`,
      analyzedAt: new Date().toISOString(),
      source: checks.map((check) => check.name).join(" + "),
    });
  }

  el.empty.classList.add("hidden");
  el.result.classList.remove("hidden");
  showMessage("");
}

function applySourceChecks(checks) {
  const metrics = checks.find((check) => check.name === "SEC metrics");
  const submissions = checks.find((check) => check.name === "SEC submissions");
  if (metrics) {
    setStatus(
      el.metricsStatus,
      metrics.ok ? "ok" : "fail",
      "SEC metrics",
      metrics.ok ? `${formatBytes(metrics.bytes)} in ${metrics.ms} ms.` : metrics.error
    );
  }
  if (submissions) {
    setStatus(
      el.submissionsStatus,
      submissions.ok ? "ok" : "warn",
      "SEC submissions",
      submissions.ok ? `${formatBytes(submissions.bytes)} in ${submissions.ms} ms.` : submissions.error
    );
  }
  const fallbackChecks = checks.filter((check) => check.name && check.name.startsWith("SEC concept "));
  if (fallbackChecks.length) {
    const filled = fallbackChecks.reduce((sum, check) => sum + (check.filled || 0), 0);
    setStatus(
      el.fallbackStatus,
      filled ? "ok" : "warn",
      "SEC fallback",
      filled ? `Loaded ${filled} targeted annual values from SEC concepts.` : "Targeted concepts ran but did not add values."
    );
  } else {
    setStatus(el.fallbackStatus, "ok", "SEC fallback", "Compact metrics had enough coverage.");
  }
}

function updateFallbackStatus(result) {
  if (!result.attempted) {
    setStatus(el.fallbackStatus, "ok", "SEC fallback", "Compact metrics had enough coverage.");
  } else if (result.filled) {
    setStatus(el.fallbackStatus, "ok", "SEC fallback", `Filled ${result.filled} missing annual values from targeted concepts.`);
  } else {
    setStatus(el.fallbackStatus, "warn", "SEC fallback", "Targeted concepts ran but did not add values.");
  }
}

async function applySecConceptFallback(payload, symbol, backend, exclude) {
  const originalRows = (payload.data || []).slice();
  const fieldsToFetch = fallbackFieldsNeeded(originalRows);
  const checks = [];
  if (!fieldsToFetch.length) return { payload, checks, attempted: false, filled: 0 };

  const nextPayload = JSON.parse(JSON.stringify(payload));
  const rowsByYear = new Map((nextPayload.data || []).map((row) => [Number(row.fiscal_year), row]));
  const excludeSet = new Set(exclude);

  await Promise.all(fieldsToFetch.map(async (field) => {
    const result = await fetchBestConcept(field, symbol, backend);
    checks.push(result.check);
    if (!result.values) return;

    Object.entries(result.values).forEach(([yearText, value]) => {
      const year = Number(yearText);
      if (!Number.isFinite(year) || excludeSet.has(year)) return;
      let row = rowsByYear.get(year);
      if (!row) {
        row = { fiscal_year: year, tags_used: {}, fallback_fields: [] };
        rowsByYear.set(year, row);
      }
      if (!hasNumber(row[field])) {
        row[field] = value;
        row.tags_used = row.tags_used || {};
        row.tags_used[field] = `${result.tag} (targeted SEC fallback)`;
        row.fallback_fields = Array.from(new Set([...(row.fallback_fields || []), field]));
      }
    });
  }));

  const rows = Array.from(rowsByYear.values())
    .filter((row) => !excludeSet.has(Number(row.fiscal_year)))
    .sort((a, b) => Number(a.fiscal_year) - Number(b.fiscal_year))
    .slice(-10);
  recalculateDerivedMetrics(rows);
  nextPayload.data = rows;
  nextPayload.fallback = {
    applied: checks.some((check) => check.ok && check.filled),
    attempted_fields: fieldsToFetch,
    note: "Targeted SEC companyconcept endpoints only fill missing fields or years; compact metrics values are left intact.",
  };
  const filled = rows.reduce((sum, row) => sum + (row.fallback_fields ? row.fallback_fields.length : 0), 0);
  return { payload: nextPayload, checks, attempted: true, filled };
}

function fallbackFieldsNeeded(rows) {
  if (rows.length < 10) return fallbackRequiredFields;
  const needed = fallbackRequiredFields.filter((field) => rows.some((row) => !hasNumber(row[field])));
  if (needed.includes("eps_diluted")) needed.push("eps_basic");
  return Array.from(new Set(needed));
}

async function fetchBestConcept(field, symbol, backend) {
  const spec = fallbackConcepts[field];
  for (const tag of spec.tags) {
    const url = `${backend}/companyconcept/${encodeURIComponent(symbol)}/us-gaap/${encodeURIComponent(tag)}`;
    const started = performance.now();
    try {
      const response = await fetchJson(url, 12000);
      const values = annualValuesFromConcept(response.json.data, spec);
      const filled = Object.keys(values).length;
      if (filled) {
        return {
          tag,
          values,
          check: { name: `SEC concept ${field}`, url, ms: response.ms, bytes: response.bytes, ok: true, filled },
        };
      }
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      if (tag === spec.tags[spec.tags.length - 1]) {
        return { tag, values: null, check: { name: `SEC concept ${field}`, url, ms, ok: false, error: readableError(error) } };
      }
    }
  }
  return { tag: "", values: null, check: { name: `SEC concept ${field}`, ok: false, error: "No annual values found" } };
}

function annualValuesFromConcept(concept, spec) {
  const units = concept && concept.units ? concept.units : {};
  const unitKey = Object.keys(units).find((key) => key === spec.unit) ||
    Object.keys(units).find((key) => key.includes(spec.unit)) ||
    Object.keys(units)[0];
  const facts = unitKey ? units[unitKey] || [] : [];
  const byYear = {};

  facts.forEach((fact) => {
    if (!(fact.form === "10-K" || fact.form === "10-K/A" || fact.form === "20-F" || fact.form === "40-F")) return;
    if (fact.fp && fact.fp !== "FY") return;
    if (!spec.instant) {
      if (!fact.start || !fact.end) return;
      const days = (new Date(fact.end) - new Date(fact.start)) / 86400000;
      if (days < 300 || days > 400) return;
    }
    const year = new Date(fact.end).getFullYear();
    const filed = fact.filed ? new Date(fact.filed).getTime() : 0;
    const current = byYear[year];
    if (!current || filed >= current.filed) {
      byYear[year] = { value: fact.val, filed };
    }
  });

  return Object.fromEntries(Object.entries(byYear).map(([year, item]) => [year, item.value]));
}

function recalculateDerivedMetrics(rows) {
  rows.forEach((row, index) => {
    const previous = rows[index - 1] || {};
    const netIncome = Number(row.net_income);
    const revenue = Number(row.revenue);
    const grossProfit = Number(row.gross_profit);
    const equity = Number(row.shareholders_equity);
    const assets = Number(row.assets);
    const retained = Number(row.retained_earnings);
    const priorEquity = Number(previous.shareholders_equity);
    const priorAssets = Number(previous.assets);
    const priorRetained = Number(previous.retained_earnings);

    if (Number.isFinite(netIncome) && Number.isFinite(revenue) && revenue) {
      row.net_income_margin_pct = (netIncome / revenue) * 100;
    }
    if (Number.isFinite(grossProfit) && Number.isFinite(revenue) && revenue) {
      row.gross_profit_margin_pct = (grossProfit / revenue) * 100;
    }
    if (Number.isFinite(netIncome) && Number.isFinite(equity)) {
      const avgEquity = Number.isFinite(priorEquity) ? (equity + priorEquity) / 2 : equity;
      if (avgEquity) row.return_on_shareholder_equity_pct = (netIncome / avgEquity) * 100;
    }
    if (Number.isFinite(netIncome) && Number.isFinite(assets)) {
      const avgAssets = Number.isFinite(priorAssets) ? (assets + priorAssets) / 2 : assets;
      if (avgAssets) row.return_on_assets_pct = (netIncome / avgAssets) * 100;
    }
    if (Number.isFinite(netIncome) && Number.isFinite(retained)) {
      const avgRetained = Number.isFinite(priorRetained) ? (retained + priorRetained) / 2 : retained;
      if (avgRetained) row.return_on_retained_earnings_pct = (netIncome / avgRetained) * 100;
    }
  });
}

function buildScore(rows) {
  const latest = rows[rows.length - 1];
  const revGrowth = growthSeries(rows, "revenue");
  const inflation = rows.map((row) => CPI[row.fiscal_year]).filter(Number.isFinite);
  const buybackYears = rows.filter((row) => row.share_buybacks > 0).length;
  const dividendDownYears = rows.slice(1).filter((row, index) => row.dividends_paid < rows[index].dividends_paid).length;
  const debtToIncome = latest.net_income ? latest.long_term_debt / latest.net_income : NaN;

  return [
    score("ROE", avg(rows, "return_on_shareholder_equity_pct"), 12, "% avg", "Net income / average shareholders equity.", "gte"),
    score("ROA", avg(rows, "return_on_assets_pct"), 12, "% avg", "Net income / average assets.", "gte"),
    trendScore("EPS trend", rows.map((row) => row.eps_diluted || row.eps_basic), "Diluted EPS should rise over the window."),
    score("Net margin", avg(rows, "net_income_margin_pct"), 20, "% avg", "Net income divided by revenue.", "gte"),
    score("Gross margin", avg(rows, "gross_profit_margin_pct"), 40, "% avg", "Less useful for banks and insurers.", "gte"),
    {
      name: "Long-term debt / net income",
      value: Number.isFinite(debtToIncome) ? `${fmt(debtToIncome, 1)}x` : "n/a",
      note: "Latest long-term debt divided by latest net income.",
      status: Number.isFinite(debtToIncome) && debtToIncome < 5 ? "pass" : "fail",
      series: rows.map((row) => row.net_income ? row.long_term_debt / row.net_income : null),
    },
    {
      name: "Revenue growth vs CPI",
      value: `${fmt(mean(revGrowth), 1)}% vs ${fmt(mean(inflation), 1)}%`,
      note: "Average annual revenue growth compared with CPI fallback table.",
      status: mean(revGrowth) > mean(inflation) ? "pass" : "fail",
      series: revGrowth,
    },
    score("Return on retained earnings", avg(rows, "return_on_retained_earnings_pct"), 11, "% avg", "Proxy metric from backend; review before relying on it.", "gte"),
    {
      name: "Dividend stability",
      value: `${dividendDownYears} down years`,
      note: "Uses total dividends paid; per-share dividend data would be a stronger source.",
      status: dividendDownYears <= 1 ? "pass" : "fail",
      series: rows.map((row) => row.dividends_paid),
    },
    {
      name: "Share buybacks",
      value: `${buybackYears}/${rows.length} years`,
      note: "Years with positive reported repurchases.",
      status: buybackYears >= Math.min(8, rows.length) ? "pass" : "fail",
      series: rows.map((row) => row.share_buybacks),
    },
  ];
}

function score(name, value, threshold, suffix, note, direction) {
  const ok = direction === "lte" ? value <= threshold : value >= threshold;
  return {
    name,
    value: `${fmt(value, 1)}${suffix}`,
    note: `${note} Target ${direction === "lte" ? "<=" : ">="} ${threshold}.`,
    status: ok ? "pass" : "fail",
    series: null,
  };
}

function trendScore(name, series, note) {
  const clean = series.filter(Number.isFinite);
  const first = clean[0];
  const last = clean[clean.length - 1];
  return {
    name,
    value: clean.length ? `$${fmt(last, 2)}` : "n/a",
    note: `${note} Started at ${Number.isFinite(first) ? `$${fmt(first, 2)}` : "n/a"}.`,
    status: Number.isFinite(first) && Number.isFinite(last) && last > first ? "pass" : "fail",
    series,
  };
}

function metricCard(item) {
  const card = document.createElement("article");
  card.className = "metric-card";
  const series = item.series || (state.payload.data || []).map((row) => row[item.name]);
  card.innerHTML = `
    <div class="metric-head">
      <h3>${escapeHtml(item.name)}</h3>
      <span class="badge ${item.status}">${item.status.toUpperCase()}</span>
    </div>
    <div class="metric-value">${escapeHtml(item.value)}</div>
    <p class="metric-note">${escapeHtml(item.note)}</p>
    ${sparkline(series)}
  `;
  return card;
}

function renderTable(rows) {
  const header = ["Metric", ...rows.map((row) => row.fiscal_year)];
  const tags = rows[rows.length - 1].tags_used || {};
  const body = fields.map(([key, label, unit]) => {
    const source = tags[key] ? `${label} (${tags[key]})` : label;
    return [source, ...rows.map((row) => formatValue(row[key], unit))];
  });

  el.table.replaceChildren();
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  header.forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell;
    tr.append(th);
  });
  thead.append(tr);

  const tbody = document.createElement("tbody");
  body.forEach((row) => {
    const bodyRow = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell;
      bodyRow.append(td);
    });
    tbody.append(bodyRow);
  });
  el.table.append(thead, tbody);
}

function drawChart() {
  const rows = state.payload ? state.payload.data || [] : [];
  const ctx = el.chart.getContext("2d");
  ctx.clearRect(0, 0, el.chart.width, el.chart.height);
  if (!rows.length) return;

  const metric = state.activeMetric;
  const points = rows.map((row) => ({ year: row.fiscal_year, value: Number(row[metric]) })).filter((point) => Number.isFinite(point.value));
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = { left: 66, right: 24, top: 24, bottom: 42 };
  const width = el.chart.width - pad.left - pad.right;
  const height = el.chart.height - pad.top - pad.bottom;

  ctx.strokeStyle = "#d9e0e8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (height / 4) * i;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(el.chart.width - pad.right, y);
  }
  ctx.stroke();

  ctx.fillStyle = "#64717f";
  ctx.font = "13px system-ui";
  points.forEach((point, index) => {
    const x = pad.left + (index / Math.max(points.length - 1, 1)) * width;
    ctx.fillText(String(point.year), x - 14, el.chart.height - 15);
  });

  ctx.strokeStyle = "#4e2a84";
  ctx.lineWidth = 3;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = pad.left + (index / Math.max(points.length - 1, 1)) * width;
    const y = pad.top + height - ((point.value - min) / span) * height;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#4e2a84";
  points.forEach((point, index) => {
    const x = pad.left + (index / Math.max(points.length - 1, 1)) * width;
    const y = pad.top + height - ((point.value - min) / span) * height;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  const label = chartOptions.find(([value]) => value === metric)[1];
  ctx.fillStyle = "#17202a";
  ctx.font = "700 15px system-ui";
  ctx.fillText(label, pad.left, 18);
}

function sparkline(series) {
  const clean = (series || []).map(Number).filter(Number.isFinite);
  if (clean.length < 2) return "";
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const points = clean.map((value, index) => {
    const x = 4 + (index / (clean.length - 1)) * 140;
    const y = 30 - ((value - min) / span) * 26;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="spark" viewBox="0 0 148 34" role="img" aria-label="Small trend line"><polyline points="${points.join(" ")}" fill="none" stroke="#4e2a84" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline></svg>`;
}

function exportCsv() {
  if (!state.payload) return;
  const rows = state.payload.data || [];
  const header = ["fiscal_year", ...fields.map(([key]) => key)];
  const lines = [header, ...rows.map((row) => header.map((key) => row[key] ?? ""))];
  const csv = lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  download(`${el.ticker.value.trim().toUpperCase() || "company"}_metrics.csv`, csv, "text/csv");
}

function readPerfectScores() {
  try {
    return JSON.parse(localStorage.getItem(PERFECT_SCORES_KEY)) || [];
  } catch {
    return [];
  }
}

function writePerfectScores(rows) {
  try {
    localStorage.setItem(PERFECT_SCORES_KEY, JSON.stringify(rows));
  } catch {
    showMessage("Could not save the perfect score locally in this browser.");
  }
}

function savePerfectScore(entry) {
  const rows = readPerfectScores();
  const key = `${entry.symbol}:${entry.years}`;
  const next = [
    entry,
    ...rows.filter((row) => `${row.symbol}:${row.years}` !== key),
  ].slice(0, 50);
  writePerfectScores(next);
  renderPerfectScores();
}

function renderPerfectScores() {
  const rows = readPerfectScores();
  const header = ["Ticker", "Company", "Score", "Years", "Analyzed", "Source"];
  el.perfectTable.replaceChildren();

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  header.forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell;
    headRow.append(th);
  });
  thead.append(headRow);

  const tbody = document.createElement("tbody");
  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = header.length;
    cell.textContent = "No 10/10 results saved yet.";
    row.append(cell);
    tbody.append(row);
  } else {
    rows.forEach((entry) => {
      const row = document.createElement("tr");
      [
        entry.symbol,
        entry.company,
        entry.score,
        entry.years,
        new Date(entry.analyzedAt).toLocaleString(),
        entry.source,
      ].forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value || "";
        row.append(cell);
      });
      tbody.append(row);
    });
  }
  el.perfectTable.append(thead, tbody);
}

function exportPerfectScores() {
  const rows = readPerfectScores();
  const header = ["symbol", "company", "score", "years", "analyzedAt", "source"];
  const lines = [header, ...rows.map((row) => header.map((key) => row[key] ?? ""))];
  const csv = lines.map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  download("perfect_quality_scores.csv", csv, "text/csv");
}

function clearPerfectScores() {
  writePerfectScores([]);
  renderPerfectScores();
}

async function copyJson() {
  if (!state.payload) return;
  await navigator.clipboard.writeText(JSON.stringify({ metrics: state.payload, submissions: state.submissions, checks: state.checks }, null, 2));
  showMessage("Copied the current analysis JSON to the clipboard.");
}

function download(filename, body, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function setBusy(isBusy) {
  el.analyze.disabled = isBusy;
  el.analyze.textContent = isBusy ? "Analyzing..." : "Analyze";
}

function setStatus(node, mode, title, detail) {
  const dot = node.querySelector(".dot");
  dot.className = `dot ${mode}`;
  node.querySelector("strong").textContent = title;
  node.querySelector("p").textContent = detail;
}

function showMessage(message) {
  el.message.textContent = message;
  el.message.classList.toggle("hidden", !message);
}

function avg(rows, key) {
  return mean(rows.map((row) => Number(row[key])).filter(Number.isFinite));
}

function hasNumber(value) {
  return value !== "" && value != null && Number.isFinite(Number(value));
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : NaN;
}

function growthSeries(rows, key) {
  return rows.slice(1).map((row, index) => {
    const prior = Number(rows[index][key]);
    const current = Number(row[key]);
    return prior ? ((current - prior) / prior) * 100 : NaN;
  }).filter(Number.isFinite);
}

function fmt(value, decimals = 1) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) : "n/a";
}

function formatValue(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (unit === "%") return `${fmt(number, 1)}%`;
  if (unit === "$/share") return `$${fmt(number, 2)}`;
  if (unit === "$") return `$${fmt(number / 1e9, 2)}B`;
  return fmt(number, 1);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "unknown size";
  if (bytes > 1_000_000) return `${fmt(bytes / 1_000_000, 2)} MB`;
  if (bytes > 1_000) return `${fmt(bytes / 1_000, 1)} KB`;
  return `${bytes} B`;
}

function readableError(error) {
  if (!error) return "Unknown error";
  if (error.name === "AbortError") return "Request timed out";
  return error.message || String(error);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[char]));
}
