# FlyBox ARTCC Feed Map (static web version)

A lightweight, **HTML + JavaScript only** version of the FlyBox map that works on any
device with a browser (iPad, phone, etc.). It shows **only the ARTCC feeds** on a Leaflet
map, with the same ARTCC altitude filter checkboxes as the desktop app.

It is intentionally minimal:

- ✅ Interactive, pannable/zoomable map (Leaflet + OpenStreetMap tiles)
- ✅ ARTCC feed markers, grouped by receiver location
- ✅ Filter checkboxes: **ARTCC**, **Low**, **High+Ultra High**, **Oceanic**
- ✅ Tap any marker to see the feed list (title, frequencies, altitude band)
- ✅ Optional "listen ↗" link that opens the feed on LiveATC.net
- ❌ No live/dynamic refreshing, weather, flights, airports, or search

The feed data in [`feeds.js`](feeds.js) is a **static snapshot** exported from the FlyBox
database. To refresh it, re-run the generator (see below).

## Run locally

It's pure static files — just serve the folder:

```bash
cd webmap
python -m http.server 8000
# then open http://localhost:8000
```

(Opening `index.html` directly via `file://` also works, since all data is local and
only the map tiles / Leaflet library are loaded from a CDN.)

## Host on GitHub Pages

1. Commit the `webmap/` folder to your repo.
2. In the repo on GitHub: **Settings → Pages**.
3. Set **Source** to "Deploy from a branch", pick your branch, and set the folder to
   `/webmap` (or move these files to `/docs` / a `gh-pages` branch if you prefer).
4. Save. Your map will be served at
   `https://<user>.github.io/<repo>/` (or the path Pages reports).

Because everything is static, no build step is required.

## Files

| File         | Purpose                                                        |
|--------------|----------------------------------------------------------------|
| `index.html` | Page shell, filter bar, Leaflet includes                       |
| `style.css`  | Filter bar, marker, and popup styling                          |
| `app.js`     | Map init, ARTCC altitude filtering, marker/popup rendering     |
| `feeds.js`   | **Static snapshot** of ARTCC feed data (`window.ARTCC_FEEDS`)  |

## Refreshing the snapshot

`feeds.js` is generated from the desktop app's SQLite database
(`%LocalAppData%\FlyBox\flybox.db`). Regenerate it with this script:

```python
# gen_feeds.py
import sqlite3, os, json
from datetime import datetime

db = os.path.join(os.environ['LOCALAPPDATA'], 'FlyBox', 'flybox.db')
c = sqlite3.connect(db); c.row_factory = sqlite3.Row

centers = {}
for r in c.execute("SELECT IcaoCode, Name, Latitude, Longitude FROM LiveATCAirports WHERE IsArtcc=1 ORDER BY IcaoCode"):
    centers[r['IcaoCode']] = {'name': r['Name'].replace(' (ARTCC)', ''), 'lat': r['Latitude'], 'lng': r['Longitude']}

feeds = []
for r in c.execute("""
    SELECT f.IcaoCode, f.FeedTitle, f.MountPoint, f.Frequencies, f.Status,
           f.AltitudeDesignation, f.SectorName, f.Latitude, f.Longitude, f.LocationText
    FROM LiveATCFeeds f JOIN LiveATCAirports a ON f.IcaoCode = a.IcaoCode
    WHERE a.IsArtcc = 1 AND f.Latitude IS NOT NULL AND f.Longitude IS NOT NULL
    ORDER BY f.IcaoCode, f.FeedTitle"""):
    feeds.append({'icaoCode': r['IcaoCode'], 'feedTitle': r['FeedTitle'], 'mountPoint': r['MountPoint'],
                  'frequencies': r['Frequencies'], 'status': r['Status'], 'alt': r['AltitudeDesignation'] or 0,
                  'sector': r['SectorName'], 'lat': round(r['Latitude'], 6), 'lng': round(r['Longitude'], 6),
                  'locationText': r['LocationText']})

with open('feeds.js', 'w', encoding='utf-8') as fh:
    fh.write("// AUTO-GENERATED snapshot of LiveATC ARTCC feed data.\n")
    fh.write("// Generated %s. Static data — not dynamically refreshed.\n" % datetime.utcnow().strftime('%Y-%m-%d'))
    fh.write("window.ARTCC_CENTERS = " + json.dumps(centers, indent=2) + ";\n\n")
    fh.write("window.ARTCC_FEEDS = " + json.dumps(feeds, indent=1) + ";\n")
```

The altitude flags in `alt` match `FlyBox/Models/AltitudeDesignation.cs`
(Low=1, High=2, Ultra High=4, Oceanic=8; combinable), and the filter logic in `app.js`
mirrors `MapViewModel.ShouldShowArtccFeedAtAltitude`.

> This is a standalone static export and is **separate from the FlyBox desktop app** —
> it makes no changes to the app itself.
