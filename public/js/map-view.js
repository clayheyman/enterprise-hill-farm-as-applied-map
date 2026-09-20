(function () {
  const slug = location.pathname.split('/').filter(Boolean).pop();
  let job = null;
  let map;

  async function init() {
    const res = await fetch(`/api/public/${slug}`);
    if (!res.ok) {
      document.getElementById('jobTitleHeading').textContent = 'Map not found';
      document.getElementById('jobSubline').textContent = 'This link may have been removed or is not yet published.';
      return;
    }
    ({ job } = await res.json());
    render();
    initMap();
  }

  function render() {
    document.getElementById('jobTitleHeading').textContent = job.jobTitle || 'As-applied map';
    document.getElementById('jobSubline').textContent = job.clientName ? `Prepared for ${job.clientName}` : '';

    const o = job.overall;
    document.getElementById('overallStats').innerHTML = `
      <div class="stat"><div class="label">Total acres</div><div class="value">${o.totalAcres}</div></div>
      <div class="stat"><div class="label">Fields</div><div class="value">${o.fieldCount}</div></div>
      <div class="stat"><div class="label">Product applied</div><div class="value">${formatAmount(o)}</div></div>
      <div class="stat"><div class="label">Date</div><div class="value" style="font-size:16px;">${o.date || '—'}</div></div>
    `;

    document.getElementById('fieldTableBody').innerHTML = job.fields.map((f) => `
      <tr>
        <td><span class="swatch" style="background:${f.color}"></span>${escapeHtml(f.displayName)}</td>
        <td>${f.totalAcres}</td>
        <td>${formatAmount(f)}</td>
        <td>${formatRate(f)}</td>
        <td>${f.passCount}</td>
      </tr>
    `).join('');

    document.getElementById('totalAcres').textContent = o.totalAcres;
    document.getElementById('totalAmount').innerHTML = formatAmount(o);
    document.getElementById('totalRate').textContent = formatRate(o);
    document.getElementById('totalPasses').textContent = o.totalPasses;

    document.getElementById('legend').innerHTML = job.fields.map((f) => `
      <div style="display:flex; align-items:center; font-size:13px;">
        <span class="swatch" style="background:${f.color}"></span>${escapeHtml(f.displayName)} — ${f.totalAcres} ac
      </div>
    `).join('');

    if (job.hasFlightImage) {
      document.getElementById('flightPathCard').style.display = '';
      document.getElementById('flightPathImg').src = `/api/public/${slug}/flight-image`;
    }
  }

  function initMap() {
    map = L.map('map');
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Imagery © Esri',
      maxZoom: 20,
    }).addTo(map);

    const group = L.featureGroup();
    let hasAny = false;
    job.fields.forEach((f) => {
      if (!f.boundary) return;
      hasAny = true;
      const layer = L.geoJSON(f.boundary, {
        style: { color: f.color, fillColor: f.color, fillOpacity: 0.4, weight: 2 },
      });
      layer.bindPopup(`<strong>${escapeHtml(f.displayName)}</strong><br>${f.totalAcres} ac · ${formatAmount(f)} · ${formatRate(f)}`);
      layer.addTo(group);
    });
    group.addTo(map);

    if (hasAny) {
      map.fitBounds(group.getBounds(), { padding: [30, 30] });
    } else {
      map.setView([41.2456, -82.6154], 14);
      document.getElementById('map').insertAdjacentHTML('afterend',
        '<p class="hint" style="margin-top:8px;">Field boundaries for this job haven\'t been drawn in yet — the summary numbers above are still accurate.</p>');
    }
  }

  document.getElementById('downloadPdfBtn').addEventListener('click', async () => {
    const btn = document.getElementById('downloadPdfBtn');
    btn.textContent = 'Preparing PDF…';
    btn.disabled = true;
    try {
      const root = document.getElementById('pageRoot');
      const canvas = await html2canvas(root, { useCORS: true, scale: 2, backgroundColor: '#f7f3ea' });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(`${(job.jobTitle || 'as-applied-map').replace(/[^a-z0-9]+/gi, '-')}.pdf`);
    } catch (err) {
      alert('Could not generate the PDF: ' + err.message);
    } finally {
      btn.textContent = 'Download PDF';
      btn.disabled = false;
    }
  });

  init();
})();
