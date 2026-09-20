(function () {
  const jobId = location.pathname.split('/').filter(Boolean).pop();
  let job = null;
  let map, drawnItems, drawControl;
  let activeFieldId = null;

  const DEFAULT_CENTER = [41.2456, -82.6154]; // Norwalk, OH fallback
  const FIELD_COLORS = ['#2e6f40', '#c98a1f', '#2f5f8a', '#8a3f2f', '#6a4f8a', '#3f8a7a', '#8a2f5f', '#5f8a2f'];

  async function init() {
    const res = await fetch(`/api/admin/jobs/${jobId}`);
    if (!res.ok) {
      document.getElementById('jobTitleHeading').textContent = 'Job not found';
      return;
    }
    ({ job } = await res.json());
    render();
    initMap();
  }

  function render() {
    document.getElementById('jobTitleHeading').textContent = job.jobTitle || 'Untitled job';
    document.getElementById('jobSubline').textContent =
      `${job.overall.location || ''}${job.overall.date ? ' · ' + job.overall.date : ''}`;
    const badge = document.getElementById('statusBadge');
    badge.textContent = job.status;
    badge.className = `badge-pill ${job.status}`;

    document.getElementById('jobTitle').value = job.jobTitle || '';
    document.getElementById('clientName').value = job.clientName || '';
    document.getElementById('clientEmail').value = job.clientEmail || '';
    document.getElementById('notes').value = job.notes || '';

    const o = job.overall;
    document.getElementById('overallStats').innerHTML = `
      <div class="stat"><div class="label">Total acres</div><div class="value">${o.totalAcres}</div></div>
      <div class="stat"><div class="label">Fields</div><div class="value">${o.fieldCount}</div></div>
      <div class="stat"><div class="label">Product applied</div><div class="value">${o.totalAmount} ${unitLabel(o.unit)}</div></div>
      <div class="stat"><div class="label">Avg rate</div><div class="value">${o.avgRatePerAcre} ${unitLabel(o.unit)}/ac</div></div>
    `;

    document.getElementById('overallTable').innerHTML = `
      <tr><td>Date</td><td>${escapeHtml(o.date || '—')}</td></tr>
      <tr><td>Task type</td><td>${escapeHtml((o.taskTypes || []).join(', '))}</td></tr>
      <tr><td>Location</td><td>${escapeHtml(o.location || '—')}</td></tr>
      <tr><td>Pilot</td><td>${escapeHtml(o.pilot || '—')}</td></tr>
      <tr><td>Aircraft</td><td>${escapeHtml(o.aircraft || '—')}</td></tr>
      <tr><td>Flight time in air</td><td>${formatDuration(o.totalDurationSec)}</td></tr>
      <tr><td>Battery passes</td><td>${o.totalPasses}</td></tr>
    `;

    renderFieldTable();
  }

  function renderFieldTable() {
    const tbody = document.getElementById('fieldTableBody');
    tbody.innerHTML = job.fields.map((f) => `
      <tr>
        <td>
          <input type="text" data-field="${f.fieldId}" class="displayNameInput" value="${escapeHtml(f.displayName)}" style="min-width:160px;" />
        </td>
        <td><input type="color" data-field="${f.fieldId}" class="colorInput" value="${f.color}" /></td>
        <td>${f.totalAcres}</td>
        <td>${formatAmount(f)}</td>
        <td>${formatRate(f)}</td>
        <td>${f.passCount}</td>
        <td>
          <button class="btn ${f.boundary ? 'ghost' : 'gold'}" data-field="${f.fieldId}" data-action="draw" style="padding:6px 12px; font-size:13px;">
            ${f.boundary ? 'Edit boundary ✓' : 'Draw boundary'}
          </button>
        </td>
      </tr>
    `).join('');

    document.getElementById('totalAcres').textContent = job.overall.totalAcres;
    document.getElementById('totalAmount').innerHTML = `${job.overall.totalAmount} ${unitLabel(job.overall.unit)}`;
    document.getElementById('totalRate').textContent = `${job.overall.avgRatePerAcre} ${unitLabel(job.overall.unit)}/ac`;
    document.getElementById('totalPasses').textContent = job.overall.totalPasses;

    tbody.querySelectorAll('.displayNameInput').forEach((el) => {
      el.addEventListener('change', () => {
        const f = job.fields.find((x) => x.fieldId === el.dataset.field);
        f.displayName = el.value;
        saveField(f);
        const layer = findLayer(f.fieldId);
        if (layer) layer.bindTooltip(f.displayName);
      });
    });
    tbody.querySelectorAll('.colorInput').forEach((el) => {
      el.addEventListener('change', () => {
        const f = job.fields.find((x) => x.fieldId === el.dataset.field);
        f.color = el.value;
        saveField(f);
        const layer = findLayer(f.fieldId);
        if (layer) layer.setStyle({ color: f.color, fillColor: f.color });
      });
    });
    tbody.querySelectorAll('[data-action="draw"]').forEach((el) => {
      el.addEventListener('click', () => setActiveField(el.dataset.field));
    });
  }

  function setActiveField(fieldId) {
    activeFieldId = fieldId;
    const f = job.fields.find((x) => x.fieldId === fieldId);
    document.getElementById('activeFieldLabel').textContent = f.displayName;
    document.getElementById('boundaryMap').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const layer = findLayer(fieldId);
    if (layer) map.fitBounds(layer.getBounds(), { maxZoom: 18 });
  }

  function findLayer(fieldId) {
    let found = null;
    drawnItems.eachLayer((layer) => {
      if (layer.fieldId === fieldId) found = layer;
    });
    return found;
  }

  function initMap() {
    map = L.map('boundaryMap');
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Imagery © Esri',
      maxZoom: 20,
    }).addTo(map);

    drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    job.fields.forEach((f) => {
      if (!f.boundary) return;
      const layer = L.geoJSON(f.boundary, {
        style: { color: f.color, fillColor: f.color, fillOpacity: 0.35, weight: 2 },
      }).getLayers()[0];
      layer.fieldId = f.fieldId;
      layer.bindTooltip(f.displayName, { permanent: false });
      drawnItems.addLayer(layer);
    });

    drawControl = new L.Control.Draw({
      draw: { polygon: { allowIntersection: false, showArea: true }, polyline: false, circle: false, circlemarker: false, marker: false, rectangle: true },
      edit: { featureGroup: drawnItems },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e) => {
      if (!activeFieldId) {
        alert('Click "Draw boundary" next to a field in the table above first, so I know which field this shape belongs to.');
        return;
      }
      const existing = findLayer(activeFieldId);
      if (existing) drawnItems.removeLayer(existing);
      const layer = e.layer;
      const f = job.fields.find((x) => x.fieldId === activeFieldId);
      layer.fieldId = activeFieldId;
      layer.setStyle({ color: f.color, fillColor: f.color, fillOpacity: 0.35, weight: 2 });
      layer.bindTooltip(f.displayName);
      drawnItems.addLayer(layer);
      f.boundary = layer.toGeoJSON().geometry;
      saveField(f);
      renderFieldTable();
    });

    map.on(L.Draw.Event.EDITED, (e) => {
      e.layers.eachLayer((layer) => {
        const f = job.fields.find((x) => x.fieldId === layer.fieldId);
        if (f) {
          f.boundary = layer.toGeoJSON().geometry;
          saveField(f);
        }
      });
    });

    map.on(L.Draw.Event.DELETED, (e) => {
      e.layers.eachLayer((layer) => {
        const f = job.fields.find((x) => x.fieldId === layer.fieldId);
        if (f) {
          f.boundary = null;
          saveField(f);
        }
      });
      renderFieldTable();
    });

    const anyBoundary = job.fields.find((f) => f.boundary);
    if (anyBoundary) {
      map.fitBounds(drawnItems.getBounds(), { maxZoom: 17 });
    } else {
      map.setView(DEFAULT_CENTER, 15);
      geocodeAndCenter(job.overall.location);
    }
  }

  async function geocodeAndCenter(address) {
    if (!address) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
      const results = await res.json();
      if (results && results[0]) {
        map.setView([parseFloat(results[0].lat), parseFloat(results[0].lon)], 16);
      }
    } catch {
      // Fine, keep the fallback center — this is just a starting point for drawing.
    }
  }

  async function saveField(f) {
    await fetch(`/api/admin/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [{ fieldId: f.fieldId, displayName: f.displayName, color: f.color, boundary: f.boundary }] }),
    });
    flashSaveStatus();
  }

  let flashTimer;
  function flashSaveStatus() {
    const el = document.getElementById('saveStatus');
    el.textContent = 'Saved ✓';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.textContent = ''), 1500);
  }

  document.getElementById('saveDetailsBtn').addEventListener('click', async () => {
    const body = {
      jobTitle: document.getElementById('jobTitle').value,
      clientName: document.getElementById('clientName').value,
      clientEmail: document.getElementById('clientEmail').value,
      notes: document.getElementById('notes').value,
    };
    const res = await fetch(`/api/admin/jobs/${jobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    ({ job } = await res.json());
    render();
    flashSaveStatus();
  });

  document.getElementById('publishBtn').addEventListener('click', async () => {
    const res = await fetch(`/api/admin/jobs/${jobId}/publish`, { method: 'POST' });
    const data = await res.json();
    job = data.job;
    render();
    const url = `${location.origin}/map/${job.publicSlug}`;
    document.getElementById('publishResult').innerHTML = `
      Client link: <a href="${url}" target="_blank">${url}</a>
      <button class="btn ghost" id="copyLinkBtn" style="margin-left:8px; padding:4px 10px; font-size:13px;">Copy</button>
    `;
    document.getElementById('copyLinkBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(url);
      document.getElementById('copyLinkBtn').textContent = 'Copied!';
    });
  });

  document.getElementById('logoutLink').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });

  init();
})();
