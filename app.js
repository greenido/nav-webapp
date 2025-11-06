// TrailTrack - Main Application Logic

class TrailTrack {
    constructor(options = {}) {
        this.options = {
            autoInit: true,
            ...options
        };
        this.map = null;
        this.currentRoute = null;
        this.routes = [];
        this.isTracking = false;
        this.isDrawingRoute = false;
        this.currentLocation = null;
        this.locationWatchId = null;
        this.locationMarker = null;
        this.hasSetInitialLocation = false;
        this.db = null;
        this.routeSearchQuery = '';
        
        if (this.options.autoInit) {
            this.init();
        }
    }

    async init() {
        await this.initDB();
        await this.requestGeolocationPermission();
        this.initMap();
        await this.loadRoutes();
        this.initTheme();
        this.initEventListeners();
        this.checkOnlineStatus();
    }

    // Request geolocation permission at startup
    async requestGeolocationPermission() {
        if (!navigator.geolocation) {
            this.showToast('Geolocation not supported by your browser', 'error');
            return false;
        }

        try {
            // Request permission by trying to get current position
            await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        // Successfully got position, store it
                        this.currentLocation = [position.coords.latitude, position.coords.longitude];
                        resolve(position);
                    },
                    (error) => {
                        if (error.code === 1) { // PERMISSION_DENIED
                            this.showToast('Please enable location permissions to use this app', 'warning');
                        } else if (error.code === 3) { // TIMEOUT
                            this.showToast('Location request timed out. You can still use the app.', 'warning');
                        } else {
                            this.showToast('Could not get your location: ' + error.message, 'warning');
                        }
                        // Don't reject - allow app to continue without location
                        resolve(null);
                    },
                    { timeout: 10000, maximumAge: 0, enableHighAccuracy: false }
                );
            });
            return true;
        } catch (error) {
            // Error already handled in the error callback
            return false;
        }
    }

    // Initialize IndexedDB
    async initDB() {
        this.db = await idb.openDB('trailtrack', 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('routes')) {
                    db.createObjectStore('routes', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('tiles')) {
                    db.createObjectStore('tiles', { keyPath: 'key' });
                }
            }
        });
    }

    // Initialize Map
    initMap() {
        const defaultCenter = [40.7128, -74.0060];
        const startingCenter = this.currentLocation || defaultCenter;
        const startingZoom = this.currentLocation ? 16 : 13;

        this.map = L.map('map', {
            center: startingCenter,
            zoom: startingZoom,
            zoomControl: true
        });

        // Add OpenStreetMap tile layer with offline support
        this.tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);
        
        // Listen for tile loading to cache them
        this.tileLayer.on('tileload', (e) => {
            this.cacheTile(e.tile.src);
        });

        this.map.on('locationfound', (e) => {
            // Store location as [lat, lng] array for consistency
            this.currentLocation = [e.latlng.lat, e.latlng.lng];
            this.createOrUpdateLocationMarker(e.latlng);

            if (!this.hasSetInitialLocation) {
                this.map.setView(e.latlng, 16);
                this.hasSetInitialLocation = true;
            }
        });

        this.map.on('locationerror', (e) => {
            // Only show error if we don't already have a location
            if (!this.currentLocation) {
                this.showToast('Could not get your location. You can still use the app.', 'warning');
            }
        });

        if (this.currentLocation) {
            this.createOrUpdateLocationMarker(this.currentLocation);
            this.hasSetInitialLocation = true;
        }

        // Try to get user's current location
        this.map.locate({ 
            setView: !this.hasSetInitialLocation, 
            maxZoom: 16,
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 60000
        });
    }

    createOrUpdateLocationMarker(latlng) {
        if (!this.map || !latlng) {
            return;
        }

        let latitude;
        let longitude;

        if (Array.isArray(latlng) && latlng.length >= 2) {
            [latitude, longitude] = latlng;
        } else if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number') {
            latitude = latlng.lat;
            longitude = latlng.lng;
        } else {
            console.warn('Unsupported latlng format passed to createOrUpdateLocationMarker', latlng);
            return;
        }

        const leafletLatLng = L.latLng(latitude, longitude);

        if (this.locationMarker) {
            this.locationMarker.setLatLng(leafletLatLng);
            return;
        }

        this.locationMarker = L.marker(leafletLatLng, {
            icon: L.divIcon({
                className: 'current-location-marker',
                html: `
                    <div style="position: relative;">
                        <div class="location-pulse" style="
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            width: 24px;
                            height: 24px;
                            background: rgba(59, 130, 246, 0.4);
                            border-radius: 50%;
                            animation: pulse 2s infinite;
                        "></div>
                        <div style="
                            position: relative;
                            width: 20px;
                            height: 20px;
                            background: #3b82f6;
                            border: 3px solid white;
                            border-radius: 50%;
                            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                        "></div>
                        <div style="
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            width: 8px;
                            height: 8px;
                            background: white;
                            border-radius: 50%;
                        "></div>
                    </div>
                `,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(this.map);
    }

    // Initialize Theme
    initTheme() {
        const theme = localStorage.getItem('theme') || 'light';
        document.documentElement.classList.toggle('dark', theme === 'dark');
        
        document.getElementById('theme-toggle').addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // Initialize Event Listeners
    initEventListeners() {
        // Sidebar toggle
        document.getElementById('routes-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('sidebar-hidden');
        });
        
        document.getElementById('close-sidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('sidebar-hidden');
        });

        const routesSearchInput = document.getElementById('routes-search');
        if (routesSearchInput) {
            const handleSearchInput = (event) => {
                this.routeSearchQuery = event.target.value || '';
                this.renderRoutesList();
            };

            routesSearchInput.addEventListener('input', handleSearchInput);
            routesSearchInput.addEventListener('search', handleSearchInput);
        }

        // Help overlay
        const helpOverlay = document.getElementById('help-overlay');
        const helpToggle = document.getElementById('help-toggle');
        const helpClose = document.getElementById('help-close');
        const helpContent = document.getElementById('help-content');

        if (helpOverlay) {
            const openHelp = () => {
                helpOverlay.classList.remove('hidden');
                helpOverlay.setAttribute('aria-hidden', 'false');
                helpContent && helpContent.focus();
            };

            const closeHelp = () => {
                helpOverlay.classList.add('hidden');
                helpOverlay.setAttribute('aria-hidden', 'true');
                if (helpToggle) {
                    helpToggle.focus();
                }
            };

            if (helpToggle) {
                helpToggle.addEventListener('click', openHelp);
            }

            if (helpClose) {
                helpClose.addEventListener('click', closeHelp);
            }

            helpOverlay.addEventListener('click', (event) => {
                if (event.target === helpOverlay) {
                    closeHelp();
                }
            });

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && !helpOverlay.classList.contains('hidden')) {
                    closeHelp();
                }
            });
        }

        // Center location
        document.getElementById('center-location').addEventListener('click', () => {
            if (this.currentLocation) {
                // currentLocation is stored as [lat, lng] array
                this.map.setView(this.currentLocation, 16);
            } else {
                this.map.locate({ 
                    setView: true, 
                    maxZoom: 16,
                    enableHighAccuracy: false,
                    timeout: 10000
                });
            }
        });

        // GPS Tracking toggle
        document.getElementById('toggle-tracking').addEventListener('click', () => {
            this.toggleTracking();
        });

        // Create route
        document.getElementById('create-route-btn').addEventListener('click', () => {
            this.startRouteCreation();
        });

        // Finish/Cancel route
        document.getElementById('finish-route').addEventListener('click', () => {
            this.finishRouteCreation();
        });

        document.getElementById('cancel-route').addEventListener('click', () => {
            this.cancelRouteCreation();
        });

        // GPX Import
        document.getElementById('gpx-import').addEventListener('change', (e) => {
            this.importGPX(e.target.files[0]);
        });

        // Download area for offline
        document.getElementById('download-area').addEventListener('click', () => {
            this.downloadAreaForOffline();
        });

        // Network status
        window.addEventListener('online', () => {
            this.showToast('Back online', 'success');
            this.checkOnlineStatus();
        });

        window.addEventListener('offline', () => {
            this.showToast('You are offline', 'warning');
            this.checkOnlineStatus();
        });
    }

    // Toggle GPS Tracking
    toggleTracking() {
        if (this.isTracking) {
            this.stopTracking();
        } else {
            this.startTracking();
        }
    }

    startTracking() {
        if (!navigator.geolocation) {
            this.showToast('Geolocation not supported', 'error');
            return;
        }

        this.isTracking = true;
        document.getElementById('tracking-icon').classList.remove('text-gray-500');
        document.getElementById('tracking-icon').classList.add('text-green-600');

        this.locationWatchId = navigator.geolocation.watchPosition(
            (position) => {
                // Store as [lat, lng] array for consistency
                const latlngArray = [position.coords.latitude, position.coords.longitude];
                const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
                this.currentLocation = latlngArray;
                
                this.createOrUpdateLocationMarker(latlng);

                if (!this.hasSetInitialLocation) {
                    this.map.setView(latlng, 16);
                    this.hasSetInitialLocation = true;
                }

                // If drawing route, add point to current route
                // Pass Leaflet LatLng object which has .lat and .lng properties
                if (this.isDrawingRoute && this.currentRoute) {
                    this.addPointToRoute(latlng);
                }
            },
            (error) => {
                let errorMsg = 'GPS error: ';
                if (error.code === 1) {
                    errorMsg += 'Permission denied';
                } else if (error.code === 2) {
                    errorMsg += 'Position unavailable';
                } else if (error.code === 3) {
                    errorMsg += 'Timeout';
                } else {
                    errorMsg += error.message;
                }
                this.showToast(errorMsg, 'error');
            },
            {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 10000
            }
        );

        this.showToast('GPS tracking started', 'success');
    }

    stopTracking() {
        if (this.locationWatchId !== null) {
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.locationWatchId = null;
        }
        this.isTracking = false;
        document.getElementById('tracking-icon').classList.add('text-gray-500');
        document.getElementById('tracking-icon').classList.remove('text-green-600');
        this.showToast('GPS tracking stopped', 'info');
    }

    // Route Creation
    startRouteCreation() {
        this.isDrawingRoute = true;
        this.currentRoute = {
            id: Date.now().toString(),
            name: 'New Route',
            points: [],
            polyline: null,
            created: new Date().toISOString()
        };

        document.getElementById('route-controls').classList.remove('hidden');
        document.getElementById('sidebar').classList.add('sidebar-hidden');
        
        this.showToast('Click on map or enable GPS tracking to create route', 'info');
        
        // Add click handler to map
        this.map.on('click', this.handleMapClick = (e) => {
            if (this.isDrawingRoute) {
                this.addPointToRoute(e.latlng);
            }
        });
    }

    addPointToRoute(latlng) {
        // Handle both Leaflet LatLng objects and arrays
        let point;
        if (Array.isArray(latlng)) {
            point = latlng;
        } else if (latlng && typeof latlng.lat === 'number' && typeof latlng.lng === 'number') {
            point = [latlng.lat, latlng.lng];
        } else {
            console.error('Invalid latlng format:', latlng);
            return;
        }
        
        this.currentRoute.points.push(point);
        
        // Convert to Leaflet LatLng for polyline if needed
        const leafletLatLng = Array.isArray(latlng) ? L.latLng(latlng[0], latlng[1]) : latlng;
        
        // Update or create polyline (yellow color)
        if (this.currentRoute.polyline) {
            this.currentRoute.polyline.addLatLng(leafletLatLng);
        } else {
            this.currentRoute.polyline = L.polyline([leafletLatLng], {
                color: '#eab308', // Yellow color
                weight: 5,
                opacity: 0.9
            }).addTo(this.map);
        }

        // Add marker for waypoint
        const marker = L.marker(leafletLatLng, {
            icon: L.divIcon({
                className: 'route-marker',
                html: '<div class="w-3 h-3 bg-green-600 rounded-full border border-white"></div>',
                iconSize: [12, 12]
            })
        }).addTo(this.map);
        
        if (!this.currentRoute.markers) {
            this.currentRoute.markers = [];
        }
        this.currentRoute.markers.push(marker);
    }

    async finishRouteCreation() {
        if (!this.currentRoute || this.currentRoute.points.length < 2) {
            this.showToast('Route needs at least 2 points', 'error');
            return;
        }

        // Calculate route stats
        this.currentRoute.distance = this.calculateDistance(this.currentRoute.points);
        this.currentRoute.elevationGain = 0; // Would need elevation data
        
        // Save route
        await this.saveRoute(this.currentRoute);
        
        // Add to routes list
        this.routes.push(this.currentRoute);
        this.renderRoutesList();
        
        this.cancelRouteCreation();
        this.showToast('Route saved successfully', 'success');
    }

    cancelRouteCreation() {
        this.isDrawingRoute = false;
        document.getElementById('route-controls').classList.add('hidden');
        
        if (this.handleMapClick) {
            this.map.off('click', this.handleMapClick);
        }

        if (this.currentRoute) {
            // Remove polyline and markers
            if (this.currentRoute.polyline) {
                this.map.removeLayer(this.currentRoute.polyline);
            }
            if (this.currentRoute.markers) {
                this.currentRoute.markers.forEach(m => this.map.removeLayer(m));
            }
            this.currentRoute = null;
        }
    }

    // Calculate distance in meters
    calculateDistance(points = []) {
        if (!Array.isArray(points) || points.length < 2) {
            return 0;
        }

        const canUseLeaflet = Boolean(
            this.map &&
            typeof this.map.distance === 'function' &&
            typeof L !== 'undefined' &&
            typeof L.latLng === 'function'
        );

        let distance = 0;
        for (let i = 1; i < points.length; i++) {
            const start = TrailTrack.normalizeLatLng(points[i - 1]);
            const end = TrailTrack.normalizeLatLng(points[i]);

            if (!start || !end) {
                continue;
            }

            if (canUseLeaflet) {
                distance += this.map.distance(
                    L.latLng(start.lat, start.lng),
                    L.latLng(end.lat, end.lng)
                );
            } else {
                distance += TrailTrack.haversineDistance(start, end);
            }
        }
        return distance;
    }

    static normalizeLatLng(point) {
        if (Array.isArray(point) && point.length >= 2) {
            const [lat, lng] = point;
            return {
                lat: Number(lat),
                lng: Number(lng)
            };
        }

        if (point && typeof point.lat === 'number' && typeof point.lng === 'number') {
            return {
                lat: Number(point.lat),
                lng: Number(point.lng)
            };
        }

        return null;
    }

    static haversineDistance(start, end) {
        const toRadians = (value) => (value * Math.PI) / 180;
        const R = 6371000; // meters
        const lat1 = toRadians(start.lat);
        const lat2 = toRadians(end.lat);
        const deltaLat = toRadians(end.lat - start.lat);
        const deltaLng = toRadians(end.lng - start.lng);

        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Save route to IndexedDB
    async saveRoute(route) {
        // Serialize route data, excluding Leaflet objects that can't be cloned
        // Ensure points are plain arrays (not Leaflet LatLng objects)
        const points = route.points.map(point => {
            if (Array.isArray(point)) {
                return [Number(point[0]), Number(point[1])];
            } else if (point && (typeof point.lat !== 'undefined' && typeof point.lng !== 'undefined')) {
                // Handle objects with lat/lng properties (can be numbers or strings)
                return [Number(point.lat), Number(point.lng)];
            }
            return point;
        });
        
        // Normalize created date to ISO string
        let created;
        if (route.created instanceof Date) {
            created = route.created.toISOString();
        } else if (typeof route.created === 'string') {
            created = route.created;
        } else {
            created = new Date().toISOString();
        }
        
        const routeData = {
            id: String(route.id),
            name: String(route.name || 'Unnamed Route'),
            points: points,
            distance: Number(route.distance || 0),
            elevationGain: Number(route.elevationGain || 0),
            created: created
        };
        await this.db.put('routes', routeData);
    }

    // Load routes from IndexedDB
    async loadRoutes() {
        this.routes = await this.db.getAll('routes');
        this.renderRoutesList();
        this.routes.forEach(route => {
            // Recreate polyline from saved points (routes are saved without polyline objects)
            if (route.points && route.points.length > 0) {
                route.polyline = L.polyline(route.points, {
                    color: '#eab308', // Yellow color
                    weight: 5,
                    opacity: 0.9
                }).addTo(this.map);
            }
        });
    }

    // Render routes list
    renderRoutesList() {
        const list = document.getElementById('routes-list');
        if (!list) {
            return;
        }
        list.innerHTML = '';

        if (this.routes.length === 0) {
            list.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No routes yet. Create your first route!</p>';
            return;
        }

        const filteredRoutes = this.getFilteredRoutes();

        if (filteredRoutes.length === 0) {
            list.innerHTML = '<p class="text-gray-500 dark:text-gray-400 text-sm">No routes match your search. Try a different term.</p>';
            return;
        }

        filteredRoutes.forEach(route => {
            const routeEl = document.createElement('div');
            routeEl.className = 'bg-gray-50 dark:bg-gray-700 p-3 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600';
            routeEl.innerHTML = `
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <h3 class="font-semibold dark:text-white">${route.name}</h3>
                        <p class="text-sm text-gray-600 dark:text-gray-300">
                            ${(route.distance / 1000).toFixed(2)} km
                        </p>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                            ${new Date(route.created).toLocaleDateString()}
                        </p>
                    </div>
                    <div class="flex gap-1">
                        <button class="route-view-btn p-1 hover:bg-gray-200 dark:hover:bg-gray-500 rounded" data-id="${route.id}" title="View this route on the map" aria-label="View this route on the map">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                            </svg>
                        </button>
                        <button class="route-export-btn p-1 hover:bg-gray-200 dark:hover:bg-gray-500 rounded" data-id="${route.id}" title="Export this route as a GPX file" aria-label="Export this route as a GPX file">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
                            </svg>
                        </button>
                        <button class="route-delete-btn p-1 hover:bg-red-200 dark:hover:bg-red-800 rounded" data-id="${route.id}" title="Delete this route" aria-label="Delete this route">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            `;
            list.appendChild(routeEl);

            // Add event listeners
            routeEl.querySelector('.route-view-btn').addEventListener('click', () => {
                this.viewRoute(route.id);
            });
            routeEl.querySelector('.route-export-btn').addEventListener('click', () => {
                this.exportGPX(route.id);
            });
            routeEl.querySelector('.route-delete-btn').addEventListener('click', () => {
                this.deleteRoute(route.id);
            });
        });
    }

    getFilteredRoutes() {
        const query = (this.routeSearchQuery || '').trim().toLowerCase();
        if (!query) {
            return [...this.routes];
        }

        return this.routes.filter(route => {
            const name = (route.name || '').toString().toLowerCase();
            return name.includes(query);
        });
    }

    // View route on map
    viewRoute(routeId) {
        const route = this.routes.find(r => r.id === routeId);
        if (!route) return;

        // Remove existing route highlights
        this.routes.forEach(r => {
            if (r.polyline) {
                r.polyline.setStyle({ color: '#eab308', opacity: 0.9, weight: 5 });
            }
        });

        // Highlight selected route (brighter yellow)
        if (route.polyline) {
            route.polyline.setStyle({ color: '#facc15', opacity: 1, weight: 6 });
            this.map.fitBounds(route.polyline.getBounds());
        } else if (route.points.length > 0) {
            // Recreate polyline if needed
            route.polyline = L.polyline(route.points, {
                color: '#facc15',
                weight: 6,
                opacity: 1
            }).addTo(this.map);
            this.map.fitBounds(route.polyline.getBounds());
        }

        document.getElementById('sidebar').classList.add('sidebar-hidden');
    }

    // Delete route
    async deleteRoute(routeId) {
        if (!confirm('Delete this route?')) return;

        const route = this.routes.find(r => r.id === routeId);
        if (route && route.polyline) {
            this.map.removeLayer(route.polyline);
        }

        this.routes = this.routes.filter(r => r.id !== routeId);
        await this.db.delete('routes', routeId);
        this.renderRoutesList();
        this.showToast('Route deleted', 'success');
    }

    // Import GPX
    async importGPX(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const gpxContent = e.target.result;
                const parser = new DOMParser();
                const gpxDoc = parser.parseFromString(gpxContent, 'text/xml');
                
                // Convert GPX to GeoJSON using toGeoJSON
                const geojson = toGeoJSON.gpx(gpxDoc);
                
                if (!geojson.features || geojson.features.length === 0) {
                    this.showToast('No route data found in GPX file', 'error');
                    return;
                }

                // Extract coordinates from GeoJSON
                const points = [];
                geojson.features.forEach(feature => {
                    if (feature.geometry.type === 'LineString') {
                        feature.geometry.coordinates.forEach(coord => {
                            points.push([coord[1], coord[0]]); // GeoJSON is [lng, lat], Leaflet uses [lat, lng]
                        });
                    }
                });

                if (points.length === 0) {
                    this.showToast('No valid route found in GPX file', 'error');
                    return;
                }

                // Create route from GPX
                const route = {
                    id: Date.now().toString(),
                    name: file.name.replace('.gpx', '') || 'Imported Route',
                    points: points,
                    distance: this.calculateDistance(points),
                    created: new Date().toISOString()
                };

                // Draw route on map (yellow color)
                route.polyline = L.polyline(points, {
                    color: '#eab308', // Yellow color
                    weight: 5,
                    opacity: 0.9
                }).addTo(this.map);
                this.map.fitBounds(route.polyline.getBounds());

                // Save route
                await this.saveRoute(route);
                this.routes.push(route);
                this.renderRoutesList();
                
                this.showToast('GPX imported successfully', 'success');
            } catch (error) {
                console.error('GPX import error:', error);
                this.showToast('Error importing GPX file', 'error');
            }
        };
        reader.readAsText(file);
    }

    // Export GPX
    exportGPX(routeId) {
        const route = this.routes.find(r => r.id === routeId);
        if (!route || route.points.length === 0) {
            this.showToast('Route has no points', 'error');
            return;
        }

        // Convert route points to GeoJSON
        const geojson = {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                properties: {
                    name: route.name
                },
                geometry: {
                    type: 'LineString',
                    coordinates: route.points.map(p => [p[1], p[0]]) // Leaflet [lat, lng] to GeoJSON [lng, lat]
                }
            }]
        };

        // Convert GeoJSON to GPX
        const gpx = toGPX(geojson);

        // Download file
        const blob = new Blob([gpx], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${route.name.replace(/\s+/g, '_')}.gpx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast('GPX exported successfully', 'success');
    }

    // Cache individual tile
    async cacheTile(tileUrl) {
        if ('caches' in window) {
            try {
                const cache = await caches.open('trailtrack-tiles-v1');
                const cached = await cache.match(tileUrl);
                if (!cached) {
                    await cache.add(tileUrl).catch(() => {
                        // Silently fail - tile caching is best effort
                    });
                }
            } catch (error) {
                // Silently fail - tile caching is best effort
            }
        }
    }

    // Download area for offline use
    async downloadAreaForOffline() {
        if (!navigator.onLine) {
            this.showToast('You are offline. Cannot download tiles.', 'error');
            return;
        }

        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        const minZoom = Math.max(zoom - 2, 10); // Download from 2 zoom levels below
        const maxZoom = Math.min(zoom + 2, 18); // Up to 2 zoom levels above

        this.showToast('Downloading map tiles for offline use...', 'info');

        const tiles = [];
        const tilePromises = [];

        // Calculate tile coordinates for all zoom levels
        for (let z = minZoom; z <= maxZoom; z++) {
            const nw = this.map.project(bounds.getNorthWest(), z);
            const se = this.map.project(bounds.getSouthEast(), z);
            
            const minX = Math.floor(Math.min(nw.x, se.x) / 256);
            const maxX = Math.ceil(Math.max(nw.x, se.x) / 256);
            const minY = Math.floor(Math.min(nw.y, se.y) / 256);
            const maxY = Math.ceil(Math.max(nw.y, se.y) / 256);

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    // OpenStreetMap tile URL
                    const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
                    tiles.push(tileUrl);
                    tilePromises.push(this.cacheTile(tileUrl));
                }
            }
        }

        try {
            await Promise.allSettled(tilePromises);
            this.showToast(`Downloaded ${tiles.length} tiles for offline use`, 'success');
        } catch (error) {
            this.showToast('Error downloading tiles', 'error');
        }
    }

    // Check online status
    checkOnlineStatus() {
        const status = navigator.onLine ? 'online' : 'offline';
        // Could add visual indicator here
    }

    // Toast notifications
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 border-l-4 ${
            type === 'success' ? 'border-green-500' :
            type === 'error' ? 'border-red-500' :
            type === 'warning' ? 'border-yellow-500' :
            'border-blue-500'
        }`;
        
        toast.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="dark:text-white">${message}</span>
            </div>
        `;

        document.getElementById('toast-container').appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease-out reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

if (typeof window !== 'undefined') {
    window.TrailTrack = TrailTrack;
}

const shouldAutoInit = typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    !window.__TRAILTRACK_DISABLE_AUTO_INIT__;

if (shouldAutoInit) {
    const initApp = () => {
        if (!window.app || !(window.app instanceof TrailTrack)) {
            window.app = new TrailTrack();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initApp, { once: true });
    } else {
        initApp();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TrailTrack };
}

