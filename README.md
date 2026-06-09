# Fundamental Quality Screener

This is a rebuilt static version of the deployed screener at:

https://purple-violet-57e1.ecamacho773.workers.dev/

## What changed

- Uses `GET /metrics/{ticker}?years=10` first instead of downloading the full `/companyfacts/{ticker}` JSON into the browser.
- Pulls `GET /submissions/{ticker}` in parallel for company profile and filing context.
- Shows source health, payload size, and response time in the interface.
- Caches successful ticker responses in the browser for 24 hours.
- Keeps reviewable data, XBRL tags, CSV export, and JSON copy.

## Measured issue in the deployed app

For AAPL, the current page uses `/companyfacts/AAPL`, which returned about 8.1 MB. The backend already exposes `/metrics/AAPL?years=10`, which returned about 14 KB from the same service. That is roughly a 580x smaller payload before accounting for the browser-side parsing work avoided.

## Run locally

Serve this folder over HTTP and open the shown local URL. The app calls the existing Cloudflare backend directly.

## Share or publish

This is a static site. The whole app is:

- `index.html`
- `styles.css`
- `app.js`

Fastest hosted option:

1. Create a new Cloudflare Pages project.
2. Upload this folder as a direct upload project.
3. Use no build command.
4. Use `/` as the output directory if asked.

The app calls the existing backend at:

`https://sec-edgar-proxy.ecamacho773.workers.dev`

If you later move the backend, update `DEFAULT_BACKEND` in `app.js`.
