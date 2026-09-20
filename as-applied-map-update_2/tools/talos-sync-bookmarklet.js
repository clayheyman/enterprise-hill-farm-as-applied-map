// "Sync fields from Talos" bookmarklet -- readable source.
//
// This is not served by the app; it's the human-readable version of the
// one-line `javascript:...` bookmarklet Clay keeps in his browser bookmarks
// bar. Run `node tools/build-bookmarklet.js <sync-url> <token>` to
// (re)generate the minified bookmarklet string from this file after editing
// it.
//
// What it does, when clicked while on Talos's Field Management page
// (https://manage.talosagcenter.com/us/mission), logged in as normal:
//
//   1. Patches window.XMLHttpRequest (the transport Talos's page actually
//      uses for this) just long enough to catch the response of the
//      "lands" GraphQL query Talos's own page makes -- properly
//      authenticated by Talos's own signed-request code. This script never
//      forges or replays credentials of its own; it only reads the real
//      response Talos's page already produced.
//
//   2. Shows a small on-page prompt asking Clay to type something in
//      Talos's own search box (e.g. "United States", or his town) and
//      click Talos's own "Search" button. This one manual step turned out
//      to be unavoidable: Talos's search box is a React-controlled input,
//      and there's no way for a script (as opposed to a real person typing)
//      to fill it in a way React's own app code will recognize -- setting
//      `.value` directly, even with the usual dispatchEvent tricks, gets
//      silently ignored, and clicking Search without doing that just
//      re-runs whatever was last actually typed (or nothing). So rather
//      than silently fail or produce incomplete data, the bookmarklet asks
//      for that one real click and takes it from there.
//
//   3. For each field, follows the signed download URL Talos returns for
//      its boundary (a plain GeoJSON file) and reads the polygon out of it.
//
//   4. POSTs the resulting {name, boundary, area, address} list to this
//      app's /api/admin/field-library/sync endpoint, authenticated with a
//      long-lived token (FIELD_SYNC_TOKEN) baked into the bookmarklet --
//      not Clay's login password, so it can be rotated independently if it
//      ever leaks.
//
// Placeholders __SYNC_URL__ and __TOKEN__ are filled in by the build script.

(function () {
  var TOKEN = '__TOKEN__';
  var SYNC_URL = '__SYNC_URL__';

  if (!/talosagcenter\.com$/.test(location.hostname)) {
    alert('Open this on the Talos "Field Management" page first, then click the bookmark again.');
    return;
  }

  if (!window.__ehfPatched) {
    window.__ehfCalls = [];
    var OrigXHR = window.XMLHttpRequest;
    var origOpen = OrigXHR.prototype.open;
    var origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url) {
      this.__ehfUrl = url;
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function () {
      this.addEventListener('load', function () {
        try {
          if (
            typeof this.__ehfUrl === 'string' &&
            this.__ehfUrl.indexOf('name=lands') !== -1 &&
            this.__ehfUrl.indexOf('Cluster') === -1
          ) {
            window.__ehfCalls.push(String(this.responseText));
          }
        } catch (e) {
          /* ignore */
        }
      });
      return origSend.apply(this, arguments);
    };
    window.__ehfPatched = true;
  }
  window.__ehfCalls.length = 0;

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  var status = document.createElement('div');
  status.style.cssText =
    'position:fixed;top:16px;right:16px;z-index:999999;background:#12294d;color:#fff;' +
    'padding:14px 18px;border-radius:8px;font:14px/1.4 sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:300px';
  status.innerHTML =
    'Type anything in the search box above (e.g. your town, or "United States") and click <b>Search</b> — ' +
    "I'll grab your fields automatically once you do.";
  document.body.appendChild(status);

  (async function () {
    try {
      var waited = 0;
      while (window.__ehfCalls.length === 0 && waited < 60000) {
        await wait(500);
        waited += 500;
      }
      if (window.__ehfCalls.length === 0) {
        status.textContent = "Didn't see a search happen — click the bookmark again when you're ready.";
        return;
      }

      status.textContent = 'Got it — syncing your fields...';

      var nodesByUuid = {};
      window.__ehfCalls.forEach(function (body) {
        try {
          var data = JSON.parse(body);
          ((data.data && data.data.lands && data.data.lands.edges) || []).forEach(function (e) {
            nodesByUuid[e.node.uuid] = e.node;
          });
        } catch (e) {
          /* ignore a malformed response */
        }
      });
      var nodes = Object.keys(nodesByUuid).map(function (k) {
        return nodesByUuid[k];
      });

      if (!nodes.length) {
        status.textContent = 'That search found no fields. Try a broader search term and click the bookmark again.';
        return;
      }

      var fields = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        var geomUrl = n.geometry && n.geometry.storage && n.geometry.storage.signedURL;
        if (!geomUrl) continue;
        try {
          var r = await fetch(geomUrl);
          var gj = await r.json();
          var feat = gj.features && gj.features[0];
          if (!feat || !feat.geometry) continue;
          var geom = feat.geometry;
          if (geom.type === 'MultiPolygon') geom = { type: 'Polygon', coordinates: geom.coordinates[0] };
          if (geom.type !== 'Polygon') continue;
          fields.push({ name: n.name, boundary: geom, area: n.totalArea, address: n.address });
        } catch (e) {
          /* skip this one field, keep going */
        }
      }

      if (!fields.length) {
        status.textContent = 'Found fields in Talos, but none had boundary shapes yet.';
        return;
      }

      var res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ fields: fields }),
      });
      var out = await res.json().catch(function () {
        return { error: 'HTTP ' + res.status };
      });
      status.textContent = res.ok
        ? 'Synced ' + out.total + ' field(s): ' + out.created + ' new, ' + out.updated + ' updated.'
        : 'Sync failed: ' + (out.error || res.status);
    } catch (err) {
      status.textContent = 'Sync error: ' + err.message;
    } finally {
      setTimeout(function () {
        status.remove();
      }, 7000);
    }
  })();
})();
