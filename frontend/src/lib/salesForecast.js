// Pure data-fetching logic for the Sales Forecast page (see
// pages/SalesForecastTab.jsx), separated out the same way autoRoster.js is
// so it's testable without rendering. apiGet is passed in rather than
// imported, so tests can supply a fake instead of hitting the network.

/** Store list for the picker — reuses the existing GET /store (already scoped to what the caller is allowed to see), no new endpoint. */
export async function fetchStoreOptions(apiGet) {
  const stores = await apiGet("/store");
  return [...stores].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

/**
 * Daily forecast for one store over a date range, via GET /forecast/preview — a read-only
 * endpoint that computes the forecast on the fly and never writes a sales_forecast row. Browsing
 * this page (switching stores, changing the date range) must never create the kind of repeated
 * forecast_model_run rows that POST /forecast/hourly leaves behind; that endpoint is reserved for
 * actually generating a roster from the forecast.
 */
export async function fetchForecastPreview(apiGet, { storeId, startDate, endDate }) {
  const query = new URLSearchParams({ storeId, startDate, endDate }).toString();
  return apiGet(`/forecast/preview?${query}`);
}

/** Total / average / peak / lowest across a fetched day series — display-only aggregation, not a forecast decision. */
export function summarizeForecast(days) {
  if (!days.length) return null;
  const total = days.reduce((sum, d) => sum + d.forecastedSales, 0);
  const average = Math.round(total / days.length);
  let peak = days[0];
  let low = days[0];
  for (const d of days) {
    if (d.forecastedSales > peak.forecastedSales) peak = d;
    if (d.forecastedSales < low.forecastedSales) low = d;
  }
  return { total, average, peak, low };
}
