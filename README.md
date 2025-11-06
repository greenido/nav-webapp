# TrailTrack - Web-Based Hiking & Cycling Routes App

A progressive web app (PWA) for discovering, creating, and navigating outdoor routes. Built with vanilla JavaScript, Leaflet.js, and Tailwind CSS.

## Features

- 🗺️ **Interactive Maps** - OpenStreetMap integration with Leaflet.js
- 📍 **GPS Tracking** - Real-time location tracking and route recording
- 🛤️ **Route Management** - Create routes by clicking on the map or using GPS tracking
- 📥 **GPX Import/Export** - Import existing routes or export your creations
- 📴 **Offline Support** - Download map tiles and use the app offline
- 🌓 **Dark Mode** - Toggle between light and dark themes
- 📱 **Mobile-First** - Responsive design optimized for mobile devices
- 🔄 **PWA** - Installable as a Progressive Web App

## Getting Started

### Prerequisites

- A modern web browser with JavaScript enabled
- HTTPS connection (required for Service Workers and Geolocation API)
- For local development, you can use a local server like:
  - Python: `python -m http.server 8000`
  - Node.js: `npx serve`
  - PHP: `php -S localhost:8000`

### Installation

1. Clone or download this repository
2. Serve the files using a local web server (required for Service Workers)
3. Open `index.html` in your browser

### Usage

#### Creating a Route

1. Click the "Routes" button (clipboard icon) in the header
2. Click "Create New Route"
3. Either:
   - Click on the map to add waypoints
   - Enable GPS tracking to automatically record your path
4. Click "Finish" when done
5. Your route will be saved automatically

#### Importing GPX Files

1. Open the Routes sidebar
2. Click "Import GPX"
3. Select a GPX file from your device
4. The route will be displayed on the map and saved

#### Exporting Routes

1. Open the Routes sidebar
2. Find the route you want to export
3. Click the download icon next to the route
4. The GPX file will be downloaded

#### Offline Mode

1. Navigate to the area you want to use offline
2. Click the download icon in the map controls (top right)
3. The app will download map tiles for the current viewport
4. Once downloaded, you can use the app offline in that area

#### GPS Tracking

1. Click the clock icon in the map controls
2. Grant location permissions when prompted
3. Your current location will be tracked and displayed
4. If creating a route, your path will be automatically recorded

## Technical Details

### Stack

- **Frontend**: Vanilla JavaScript (ES6+)
- **Styling**: Tailwind CSS (via CDN)
- **Maps**: Leaflet.js with OpenStreetMap tiles
- **Storage**: IndexedDB (via idb library)
- **Offline**: Service Workers
- **GPX**: toGeoJSON and toGPX libraries

### Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari (iOS 11.3+)
- Opera

### File Structure

```
nav-app/
├── index.html          # Main HTML file
├── app.js             # Application logic
├── service-worker.js  # Service worker for offline support
├── manifest.json      # PWA manifest
├── icon-192.png       # PWA icon 192x192 (optional)
├── icon-512.png       # PWA icon 512x512 (optional)
└── README.md          # This file
```

**Note**: The `manifest.json` references icon files (`icon-192.png` and `icon-512.png`). These are optional - the app will work without them, but browsers will use a default icon. You can generate PWA icons using tools like [PWA Asset Generator](https://github.com/onderceylan/pwa-asset-generator) or [RealFaviconGenerator](https://realfavicongenerator.net/).

### Service Worker

The service worker caches:
- Static assets (HTML, CSS, JS)
- Map tiles for offline use
- Routes data in IndexedDB

### IndexedDB Schema

- **routes**: Stores route data (points, name, distance, etc.)
- **tiles**: Stores cached map tiles

## Development

### Adding Features

The app is structured as a single class (`TrailTrack`) in `app.js`. Key methods:

- `initMap()` - Initialize Leaflet map
- `startRouteCreation()` - Begin creating a new route
- `importGPX()` - Import GPX file
- `exportGPX()` - Export route as GPX
- `downloadAreaForOffline()` - Cache map tiles

### Testing Offline Mode

1. Open Chrome DevTools
2. Go to Network tab
3. Select "Offline" from the throttling dropdown
4. The app should continue working with cached tiles

## Limitations

- Map tiles are cached on-demand (not pre-cached)
- Elevation data is not currently calculated (requires elevation API)
- Route sharing requires backend (not implemented)
- Large offline areas may use significant storage

## Future Enhancements

- [ ] Elevation profile display
- [ ] Route sharing via backend API
- [ ] User accounts and cloud sync
- [ ] Route search and discovery
- [ ] Terrain layers
- [ ] Route statistics (pace, time estimates)
- [ ] Waypoint management
- [ ] Route navigation mode

## License

This project is open source and available for personal and commercial use.

## Credits

- Maps: [OpenStreetMap](https://www.openstreetmap.org/)
- Map Library: [Leaflet](https://leafletjs.com/)
- Icons: Heroicons (via Tailwind CSS)

