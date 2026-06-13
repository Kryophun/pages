// FlyBox ARTCC Feed Map — static, webpage-only version.
//
// Mirrors the relevant ARTCC-feed behavior of the FlyBox desktop app:
//   • Leaflet map (OpenStreetMap tiles), US-centered.
//   • ARTCC feed markers grouped by receiver location.
//   • ARTCC altitude sub-filters: Low / High+Ultra High / Oceanic.
//   • Tap a marker to see the feed list at that location.
// All data is a static snapshot in feeds.js — nothing is fetched at runtime.

console.log('FlyBox ARTCC web map loading...');

// Altitude designation flags (must match Models/AltitudeDesignation.cs)
const ALT_LOW = 1;
const ALT_HIGH = 2;
const ALT_ULTRA = 4;
const ALT_OCEANIC = 8;

// ── Filter state (defaults match the desktop app's MapViewModel) ───────
//   ShowArtccFeeds = true, Low = off, High+Ultra High = on, Oceanic = on.
const state = {
    artcc: true,
    low: false,
    highUltra: true,
    oceanic: true,
};

let map;
let feedLayer = null;

// ── Altitude helpers (ported from MapViewModel + AltitudeDesignation) ──

// Human-readable label, e.g. 3 -> "Low, High".
function altDisplayString(alt) {
    if (!alt) return '';
    const parts = [];
    if (alt & ALT_LOW) parts.push('Low');
    if (alt & ALT_HIGH) parts.push('High');
    if (alt & ALT_ULTRA) parts.push('Ultra High');
    if (alt & ALT_OCEANIC) parts.push('Oceanic');
    return parts.join(', ');
}

// Mirror of MapViewModel.ShouldShowArtccFeedAtAltitude.
function shouldShowAtAltitude(alt, showLow, showHighUltra, showOceanic) {
    let selectedBands =
        (showLow ? ALT_LOW : 0) |
        (showHighUltra ? (ALT_HIGH | ALT_ULTRA) : 0) |
        (showOceanic ? ALT_OCEANIC : 0);

    if (selectedBands === 0) return true; // no altitude restriction

    const categorized = alt & (ALT_LOW | ALT_HIGH | ALT_ULTRA | ALT_OCEANIC);
    if (categorized === 0) return true; // uncategorized (Unknown) — always show

    return (alt & selectedBands) !== 0;
}

// ── Marker rendering (ported from map.js feed-location layer) ──────────

function getFeedStatusColor(status) {
    if (status === 'UP') return '#27AE60';
    if (status === 'DOWN') return '#E74C3C';
    return '#95A5A6';
}

function feedAntennaSvg(color) {
    return '<svg width="28" height="28" viewBox="0 0 28 28">' +
        '<circle cx="14" cy="14" r="11" fill="#ffffff" stroke="' + color + '" stroke-width="2.5"/>' +
        '<line x1="14" y1="8" x2="14" y2="22" stroke="' + color + '" stroke-width="2.5"/>' +
        '<line x1="8" y1="12" x2="14" y2="8" stroke="' + color + '" stroke-width="2"/>' +
        '<line x1="20" y1="12" x2="14" y2="8" stroke="' + color + '" stroke-width="2"/>' +
        '<circle cx="14" cy="7" r="2.5" fill="' + color + '" stroke="#000" stroke-width="1"/>' +
        '</svg>';
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Group visible feeds by rounded receiver coordinates (5 dp, as the app does)
// and build a GeoJSON FeatureCollection of one marker per location.
function buildGeoJson() {
    if (!state.artcc) return { type: 'FeatureCollection', features: [] };

    const visible = window.ARTCC_FEEDS.filter(f =>
        shouldShowAtAltitude(f.alt, state.low, state.highUltra, state.oceanic));

    const groups = new Map();
    for (const f of visible) {
        const lat = Math.round(f.lat * 1e5) / 1e5;
        const lng = Math.round(f.lng * 1e5) / 1e5;
        const key = lat + ',' + lng;
        if (!groups.has(key)) groups.set(key, { lat, lng, feeds: [] });
        groups.get(key).feeds.push(f);
    }

    const features = [];
    for (const g of groups.values()) {
        const primaryStatus = g.feeds.some(f => f.status === 'UP') ? 'UP'
            : g.feeds.some(f => f.status === 'DOWN') ? 'DOWN' : 'unknown';
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [g.lng, g.lat] },
            properties: {
                count: g.feeds.length,
                primaryStatus,
                icaoCode: g.feeds[0].icaoCode,
                locationText: g.feeds[0].locationText,
                feeds: g.feeds,
            },
        });
    }
    return { type: 'FeatureCollection', features };
}

function buildPopup(p) {
    const feeds = p.feeds || [];
    let html = '<div class="feed-loc-popup">';

    let header = escapeHtml(p.icaoCode || 'Unknown');
    if (p.locationText) header += ' — ' + escapeHtml(p.locationText);
    header += ' (' + feeds.length + ' feed' + (feeds.length !== 1 ? 's' : '') + ')';
    html += '<strong>' + header + '</strong>';
    html += '<hr style="margin:4px 0;border:none;border-top:1px solid #ddd">';

    for (const f of feeds) {
        const statusColor = getFeedStatusColor(f.status);
        html += '<div class="feed-loc-link">';
        html += '<span style="color:' + statusColor + '">&#9654;</span> ';
        html += '<span class="feed-loc-title">' + escapeHtml(f.feedTitle || 'Unknown') + '</span>';
        if (f.frequencies) {
            html += ' <span style="color:#666;font-size:11px">' + escapeHtml(f.frequencies) + '</span>';
        }
        const altDisp = altDisplayString(f.alt);
        if (altDisp) {
            html += ' <span style="color:#3498DB;font-size:11px">' + escapeHtml(altDisp) + '</span>';
        }
        // Optional manual link to the live feed page on LiveATC.net.
        if (f.mountPoint) {
            html += ' <a class="feed-listen" target="_blank" rel="noopener" ' +
                'href="https://www.liveatc.net/play/' + encodeURIComponent(f.mountPoint) + '.pls">listen \u2197</a>';
        }
        html += '</div>';
    }

    html += '</div>';
    return html;
}

function renderFeeds() {
    const geojson = buildGeoJson();

    if (feedLayer) {
        map.removeLayer(feedLayer);
        feedLayer = null;
    }

    feedLayer = L.geoJSON(geojson, {
        pointToLayer: function (feature, latlng) {
            const p = feature.properties;
            const color = getFeedStatusColor(p.primaryStatus);
            const count = p.count || 1;
            const svg = feedAntennaSvg(color);
            const badge = count > 1 ? '<span class="feed-loc-count">' + count + '</span>' : '';
            return L.marker(latlng, {
                icon: L.divIcon({
                    className: 'feed-location-marker',
                    html: '<div class="feed-loc-icon">' + svg + badge + '</div>',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14],
                }),
            });
        },
        onEachFeature: function (feature, layer) {
            layer.bindPopup(buildPopup(feature.properties), { maxWidth: 350 });
        },
    });

    feedLayer.addTo(map);

    const total = geojson.features.reduce((n, f) => n + (f.properties.count || 0), 0);
    const el = document.getElementById('feed-count');
    if (el) el.textContent = total + ' feeds · ' + geojson.features.length + ' locations';
}

// ── Filter wiring ──────────────────────────────────────────────────────

function syncSubGroupEnabled() {
    const group = document.querySelector('.filter-sub-group');
    if (group) group.classList.toggle('disabled', !state.artcc);
}

function wireFilters() {
    const map2 = {
        'f-artcc': 'artcc',
        'f-low': 'low',
        'f-highultra': 'highUltra',
        'f-oceanic': 'oceanic',
    };
    for (const [id, key] of Object.entries(map2)) {
        const cb = document.getElementById(id);
        if (!cb) continue;
        cb.addEventListener('change', function () {
            state[key] = cb.checked;
            if (key === 'artcc') syncSubGroupEnabled();
            renderFeeds();
        });
    }
    syncSubGroupEnabled();
}

// ── Init ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
    // Zoom control bottom-left so it never collides with the top filter bar
    // (which can wrap to multiple rows on narrow/iPad screens).
    map = L.map('map', { zoomControl: false }).setView([39.8283, -98.5795], 4);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        minZoom: 3,
    }).addTo(map);

    wireFilters();
    renderFeeds();

    console.log('Loaded', (window.ARTCC_FEEDS || []).length, 'ARTCC feeds');
});
