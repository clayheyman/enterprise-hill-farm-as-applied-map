// Shared formatting helpers used by both the admin review page and the
// public client-facing map page.

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDuration(totalSeconds) {
  if (!totalSeconds) return '—';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const KG_TO_LB = 2.20462262;

function unitLabel(unit) {
  // Dry product (kg) is shown to clients in pounds; liquid (L) stays in gallons.
  return unit === 'L' ? 'gal' : 'lb';
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function formatAmount(field) {
  if (field.unit === 'L') {
    return `${field.totalAmountGal} gal <span class="hint">(${field.totalAmount} L)</span>`;
  }
  return `${field.totalAmountLb} lb <span class="hint">(${field.totalAmount} kg)</span>`;
}

function formatRate(field) {
  if (field.unit === 'L') {
    const galPerAcre = round1(field.avgRatePerAcre * 0.264172052);
    return `${galPerAcre} gal/ac`;
  }
  const lbPerAcre = round1(field.avgRatePerAcre * KG_TO_LB);
  return `${lbPerAcre} lb/ac`;
}

function formatDateRange(startIso, endIso) {
  if (!startIso) return '—';
  const start = new Date(startIso);
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  let out = start.toLocaleDateString(undefined, opts);
  if (endIso) {
    out += ` · ${start.toLocaleTimeString(undefined, timeOpts)}–${new Date(endIso).toLocaleTimeString(undefined, timeOpts)}`;
  }
  return out;
}
