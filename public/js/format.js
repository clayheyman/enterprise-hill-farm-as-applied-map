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

function unitLabel(unit) {
  return unit === 'L' ? 'L' : 'kg';
}

function formatAmount(field) {
  const primary = `${field.totalAmount} ${unitLabel(field.unit)}`;
  const secondary = field.unit === 'L' ? `${field.totalAmountGal} gal` : `${field.totalAmountLb} lb`;
  return `${primary} <span class="hint">(${secondary})</span>`;
}

function formatRate(field) {
  return `${field.avgRatePerAcre} ${unitLabel(field.unit)}/ac`;
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
