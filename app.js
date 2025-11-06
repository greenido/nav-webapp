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
        this.selectedRouteId = null;
        this.batterySaveMode = localStorage.getItem('batterySaveMode') === 'true';
        this.gpsCheckInterval = parseInt(localStorage.getItem('gpsCheckInterval') || '5000', 10); // Default 5 seconds
        this.gpsIntervalTimer = null;
        
        if (this.options.autoInit) {
            this.init();
        }
    }

    async init() {
        await this.initDB();
        // Initialize map first so it's always visible, even if location fails
        this.initMap();
        // Request location in parallel - don't block on it
        this.requestGeolocationPermission().catch(() => {
            // Silently handle any errors - map is already initialized
        });
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
                        console.log('getCurrentPosition success:', position.coords);
                        // Successfully got position, store it
                        this.currentLocation = [position.coords.latitude, position.coords.longitude];
                        // Update map view if map is already initialized
                        if (this.map) {
                            const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
                            this.createOrUpdateLocationMarker(latlng);
                            if (!this.hasSetInitialLocation) {
                                this.map.setView(latlng, 16);
                                this.hasSetInitialLocation = true;
                                console.log('Map view set to location from getCurrentPosition');
                            }
                        }
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
            console.log('Location found event:', e.latlng);
            // Store location as [lat, lng] array for consistency
            this.currentLocation = [e.latlng.lat, e.latlng.lng];
            this.createOrUpdateLocationMarker(e.latlng);

            if (!this.hasSetInitialLocation) {
                this.map.setView(e.latlng, 16);
                this.hasSetInitialLocation = true;
                console.log('Map view set to location');
            }
        });

        this.map.on('locationerror', (e) => {
            console.error('Location error event:', e.message);
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
        console.log('Calling map.locate(), hasSetInitialLocation:', this.hasSetInitialLocation);
        this.map.locate({ 
            setView: !this.hasSetInitialLocation, 
            maxZoom: 16,
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 60000,
            watch: false
        });
    }

    createOrUpdateLocationMarker(latlng) {
        if (!this.map || !latlng) {
            console.warn('createOrUpdateLocationMarker: map or latlng is missing', { map: this.map, latlng });
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
        console.log('Creating/updating location marker at:', latitude, longitude);

        if (this.locationMarker) {
            this.locationMarker.setLatLng(leafletLatLng);
            console.log('Location marker updated');
            return;
        }

        this.locationMarker = L.marker(leafletLatLng, {
            icon: L.divIcon({
                className: 'current-location-marker',
                html: `
                    <div style="position: relative; width: 20px; height: 20px;">
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
                            z-index: 1000;
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
                            z-index: 1001;
                        "></div>
                    </div>
                `,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            }),
            zIndexOffset: 1000
        }).addTo(this.map);
        
        console.log('Location marker created and added to map');
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

    // Toggle battery save mode
    toggleBatterySaveMode() {
        this.batterySaveMode = !this.batterySaveMode;
        localStorage.setItem('batterySaveMode', this.batterySaveMode.toString());
        
        // Update UI
        const batterySaveToggle = document.getElementById('battery-save-toggle');
        if (batterySaveToggle) {
            batterySaveToggle.checked = this.batterySaveMode;
        }
        
        // Enable/disable interval input based on battery save mode
        const intervalInput = document.getElementById('gps-interval-input');
        if (intervalInput) {
            intervalInput.disabled = !this.batterySaveMode;
            if (!this.batterySaveMode) {
                intervalInput.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                intervalInput.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
        
        // If tracking is active, restart it with new mode
        if (this.isTracking) {
            this.stopTracking();
            setTimeout(() => this.startTracking(), 100);
        }
        
        this.showToast(
            `Battery save mode ${this.batterySaveMode ? 'enabled' : 'disabled'}`,
            'info'
        );
    }

    // Update GPS check interval
    updateGpsCheckInterval(intervalMs) {
        const minInterval = 1000; // Minimum 1 second
        const maxInterval = 60000; // Maximum 60 seconds
        const clampedInterval = Math.max(minInterval, Math.min(maxInterval, intervalMs));
        
        this.gpsCheckInterval = clampedInterval;
        localStorage.setItem('gpsCheckInterval', clampedInterval.toString());
        
        // Update UI
        const intervalInput = document.getElementById('gps-interval-input');
        if (intervalInput) {
            intervalInput.value = clampedInterval / 1000; // Display in seconds
        }
        
        // If tracking is active in battery save mode, restart it with new interval
        if (this.isTracking && this.batterySaveMode) {
            this.stopTracking();
            setTimeout(() => this.startTracking(), 100);
        }
        
        this.showToast(
            `GPS check interval set to ${clampedInterval / 1000}s`,
            'info'
        );
    }

    // Initialize Event Listeners
    initEventListeners() {
        // Sidebar toggle - using Tailwind classes
        document.getElementById('routes-toggle').addEventListener('click', () => {
            document.getElementById('sidebar').classList.remove('-translate-x-full');
        });
        
        document.getElementById('close-sidebar').addEventListener('click', () => {
            document.getElementById('sidebar').classList.add('-translate-x-full');
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

        // Mobile floating action button for route creation
        const mobileFab = document.getElementById('mobile-create-route-fab');
        if (mobileFab) {
            mobileFab.addEventListener('click', () => {
                this.startRouteCreation();
            });
        }

        // Finish/Cancel route
        document.getElementById('finish-route').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from reaching the map
            this.finishRouteCreation();
        });

        document.getElementById('cancel-route').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from reaching the map
            this.cancelRouteCreation();
        });

        // Undo point
        document.getElementById('undo-point').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent click from reaching the map
            this.undoLastPoint();
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

        // Battery save mode toggle
        const batterySaveToggle = document.getElementById('battery-save-toggle');
        if (batterySaveToggle) {
            batterySaveToggle.checked = this.batterySaveMode;
            batterySaveToggle.addEventListener('change', () => {
                this.toggleBatterySaveMode();
            });
        }

        // GPS interval input
        const gpsIntervalInput = document.getElementById('gps-interval-input');
        if (gpsIntervalInput) {
            gpsIntervalInput.value = this.gpsCheckInterval / 1000; // Display in seconds
            gpsIntervalInput.disabled = !this.batterySaveMode;
            if (!this.batterySaveMode) {
                gpsIntervalInput.classList.add('opacity-50', 'cursor-not-allowed');
            }
            gpsIntervalInput.addEventListener('change', (e) => {
                const seconds = parseFloat(e.target.value) || 5;
                this.updateGpsCheckInterval(seconds * 1000);
            });
        }
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

        const handlePosition = (position) => {
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
        };

        const handleError = (error) => {
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
        };

        if (this.batterySaveMode) {
            // Battery save mode: use getCurrentPosition with intervals
            const checkPosition = () => {
                if (!this.isTracking) return;
                
                navigator.geolocation.getCurrentPosition(
                    handlePosition,
                    handleError,
                    {
                        enableHighAccuracy: false, // Lower accuracy for battery saving
                        maximumAge: this.gpsCheckInterval,
                        timeout: 10000
                    }
                );
            };

            // Get initial position immediately
            checkPosition();
            
            // Then check at intervals
            this.gpsIntervalTimer = setInterval(checkPosition, this.gpsCheckInterval);
            this.showToast(`GPS tracking started (battery save: ${this.gpsCheckInterval / 1000}s interval)`, 'success');
        } else {
            // Normal mode: use watchPosition for continuous tracking
            this.locationWatchId = navigator.geolocation.watchPosition(
                handlePosition,
                handleError,
                {
                    enableHighAccuracy: true,
                    maximumAge: 1000,
                    timeout: 10000
                }
            );
            this.showToast('GPS tracking started', 'success');
        }
    }

    stopTracking() {
        if (this.locationWatchId !== null) {
            navigator.geolocation.clearWatch(this.locationWatchId);
            this.locationWatchId = null;
        }
        if (this.gpsIntervalTimer !== null) {
            clearInterval(this.gpsIntervalTimer);
            this.gpsIntervalTimer = null;
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
        document.getElementById('sidebar').classList.add('-translate-x-full');
        
        // Hide mobile FAB when route controls are shown
        const mobileFab = document.getElementById('mobile-create-route-fab');
        if (mobileFab) {
            mobileFab.classList.add('hidden');
        }
        
        // Initialize route name input
        const routeNameInput = document.getElementById('route-name-input');
        if (routeNameInput) {
            routeNameInput.value = this.currentRoute.name;
            // Clear default text when user clicks on the input
            this.handleRouteNameClick = (e) => {
                e.stopPropagation(); // Prevent click from reaching the map
                if (e.target.value === 'New Route') {
                    e.target.value = '';
                }
            };
            routeNameInput.addEventListener('click', this.handleRouteNameClick);
            // Also prevent focus/input events from propagating
            routeNameInput.addEventListener('focus', (e) => {
                e.stopPropagation();
            });
            // Update route name when input changes - store handler for cleanup
            this.handleRouteNameInput = (e) => {
                if (this.currentRoute) {
                    this.currentRoute.name = e.target.value.trim() || 'New Route';
                }
            };
            routeNameInput.addEventListener('input', this.handleRouteNameInput);
        }
        
        this.showToast('Click on map or enable GPS tracking to create route', 'info');
        
        // Add click handler to map
        this.map.on('click', this.handleMapClick = (e) => {
            if (this.isDrawingRoute) {
                this.addPointToRoute(e.latlng);
            }
        });
        
        // Update undo button state
        this.updateUndoButtonState();
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
        
        // Update undo button state
        this.updateUndoButtonState();
    }

    undoLastPoint() {
        if (!this.currentRoute || !this.isDrawingRoute || this.currentRoute.points.length === 0) {
            return;
        }

        // Remove last point
        this.currentRoute.points.pop();

        // Remove last marker
        if (this.currentRoute.markers && this.currentRoute.markers.length > 0) {
            const lastMarker = this.currentRoute.markers.pop();
            this.map.removeLayer(lastMarker);
        }

        // Update polyline
        if (this.currentRoute.polyline) {
            if (this.currentRoute.points.length === 0) {
                // No points left, remove polyline
                this.map.removeLayer(this.currentRoute.polyline);
                this.currentRoute.polyline = null;
            } else {
                // Update polyline with remaining points using setLatLngs to avoid map panning
                const latlngs = this.currentRoute.points.map(p => L.latLng(p[0], p[1]));
                this.currentRoute.polyline.setLatLngs(latlngs);
            }
        }

        // Update undo button state
        this.updateUndoButtonState();
        
        this.showToast('Last point removed', 'info');
    }

    updateUndoButtonState() {
        const undoButton = document.getElementById('undo-point');
        if (undoButton) {
            const canUndo = this.currentRoute && 
                           this.isDrawingRoute && 
                           this.currentRoute.points.length > 0;
            undoButton.disabled = !canUndo;
        }
    }

    async finishRouteCreation() {
        if (!this.currentRoute || this.currentRoute.points.length < 2) {
            this.showToast('Route needs at least 2 points', 'error');
            return;
        }

        // Update route name from input if it exists
        const routeNameInput = document.getElementById('route-name-input');
        if (routeNameInput && routeNameInput.value.trim()) {
            this.currentRoute.name = routeNameInput.value.trim();
        } else if (!this.currentRoute.name || this.currentRoute.name.trim() === '') {
            this.currentRoute.name = 'New Route';
        }

        // Calculate route stats
        this.currentRoute.distance = this.calculateDistance(this.currentRoute.points);
        this.currentRoute.elevationGain = 0; // Would need elevation data
        
        // Save route
        await this.saveRoute(this.currentRoute);
        
        // Add to routes list
        this.routes.push(this.currentRoute);
        
        // Keep the polyline on the map - don't remove it
        // Just clean up the drawing state
        this.isDrawingRoute = false;
        document.getElementById('route-controls').classList.add('hidden');
        
        // Show mobile FAB again when route controls are hidden (only on mobile, below md breakpoint)
        const mobileFab = document.getElementById('mobile-create-route-fab');
        if (mobileFab && window.innerWidth < 768) {
            mobileFab.classList.remove('hidden');
        }
        
        // Remove route name input event listeners
        if (routeNameInput) {
            if (this.handleRouteNameInput) {
                routeNameInput.removeEventListener('input', this.handleRouteNameInput);
                this.handleRouteNameInput = null;
            }
            if (this.handleRouteNameClick) {
                routeNameInput.removeEventListener('click', this.handleRouteNameClick);
                this.handleRouteNameClick = null;
            }
        }
        
        if (this.handleMapClick) {
            this.map.off('click', this.handleMapClick);
        }
        
        // Remove waypoint markers but keep the polyline
        if (this.currentRoute.markers) {
            this.currentRoute.markers.forEach(m => this.map.removeLayer(m));
            this.currentRoute.markers = null; // Clear markers array
        }
        
        // Clear currentRoute but polyline stays on map
        const savedRoute = this.currentRoute;
        this.currentRoute = null;
        
        // Update undo button state
        this.updateUndoButtonState();
        
        this.renderRoutesList();
        this.showToast('Route saved successfully', 'success');
    }

    cancelRouteCreation() {
        this.isDrawingRoute = false;
        document.getElementById('route-controls').classList.add('hidden');
        
        // Show mobile FAB again when route controls are hidden (only on mobile, below md breakpoint)
        const mobileFab = document.getElementById('mobile-create-route-fab');
        if (mobileFab && window.innerWidth < 768) {
            mobileFab.classList.remove('hidden');
        }
        
        // Remove route name input event listeners
        const routeNameInput = document.getElementById('route-name-input');
        if (routeNameInput) {
            if (this.handleRouteNameInput) {
                routeNameInput.removeEventListener('input', this.handleRouteNameInput);
                this.handleRouteNameInput = null;
            }
            if (this.handleRouteNameClick) {
                routeNameInput.removeEventListener('click', this.handleRouteNameClick);
                this.handleRouteNameClick = null;
            }
        }
        
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
        
        // Update undo button state
        this.updateUndoButtonState();
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
        
        // Show all routes on map by default (or selected route if one is selected)
        if (this.selectedRouteId) {
            const selectedRoute = this.routes.find(r => r.id === this.selectedRouteId);
            if (selectedRoute) {
                // Show only selected route
                this.routes.forEach(route => {
                    if (route.points && route.points.length > 0) {
                        if (route.id === this.selectedRouteId) {
                            route.polyline = L.polyline(route.points, {
                                color: '#facc15', // Bright yellow for selected
                                weight: 6,
                                opacity: 1
                            }).addTo(this.map);
                        }
                        // Don't add other routes to map when one is selected
                    }
                });
            } else {
                // Selected route not found, show all
                this.selectedRouteId = null;
                this.showAllRoutes();
            }
        } else {
            // Show all routes
            this.showAllRoutes();
        }
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
            const isSelected = this.selectedRouteId === route.id;
            const routeEl = document.createElement('div');
            routeEl.className = `bg-gray-50 dark:bg-gray-700 p-3 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 ${isSelected ? 'ring-2 ring-green-500 dark:ring-green-400' : ''}`;
            routeEl.innerHTML = `
                <div class="flex items-start justify-between">
                    <div class="flex-1" data-route-id="${route.id}">
                        <h3 class="font-semibold dark:text-white">${route.name}${isSelected ? ' <span class="text-green-600 dark:text-green-400">(Selected)</span>' : ''}</h3>
                        <p class="text-sm text-gray-600 dark:text-gray-300">
                            ${(route.distance / 1000).toFixed(2)} km
                        </p>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                            ${new Date(route.created).toLocaleDateString()}
                        </p>
                    </div>
                    <div class="flex gap-1">
                        <button class="route-view-btn p-1 hover:bg-gray-200 dark:hover:bg-gray-500 rounded ${isSelected ? 'bg-green-100 dark:bg-green-900' : ''}" data-id="${route.id}" title="${isSelected ? 'Deselect this route (show all)' : 'Show only this route on the map'}" aria-label="${isSelected ? 'Deselect this route' : 'Show only this route on the map'}">
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
            routeEl.querySelector('.route-view-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.viewRoute(route.id);
            });
            routeEl.querySelector('.route-export-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportGPX(route.id);
            });
            routeEl.querySelector('.route-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteRoute(route.id);
            });
            
            // Make the route item clickable to select/deselect
            routeEl.querySelector('[data-route-id]').addEventListener('click', () => {
                this.viewRoute(route.id);
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

    // View route on map - toggle selection
    viewRoute(routeId) {
        const route = this.routes.find(r => r.id === routeId);
        if (!route) return;

        // If clicking the same route, deselect it (show all routes)
        if (this.selectedRouteId === routeId) {
            this.selectedRouteId = null;
            this.showAllRoutes();
            this.renderRoutesList();
            return;
        }

        // Set selected route
        this.selectedRouteId = routeId;

        // Hide all routes first
        this.routes.forEach(r => {
            if (r.polyline) {
                this.map.removeLayer(r.polyline);
            }
        });

        // Show only the selected route
        if (route.points && route.points.length > 0) {
            // Recreate polyline if needed or if it was removed
            if (!route.polyline || !this.map.hasLayer(route.polyline)) {
                route.polyline = L.polyline(route.points, {
                    color: '#facc15', // Bright yellow for selected route
                    weight: 6,
                    opacity: 1
                }).addTo(this.map);
            } else {
                // Update style if polyline exists
                route.polyline.setStyle({ color: '#facc15', opacity: 1, weight: 6 });
            }
            this.map.fitBounds(route.polyline.getBounds());
        }

        this.renderRoutesList();
        document.getElementById('sidebar').classList.add('-translate-x-full');
    }

    // Show all routes on map
    showAllRoutes() {
        // Remove all routes from map first
        this.routes.forEach(r => {
            if (r.polyline) {
                this.map.removeLayer(r.polyline);
            }
        });

        // Add all routes back to map
        this.routes.forEach(route => {
            if (route.points && route.points.length > 0) {
                if (!route.polyline) {
                    route.polyline = L.polyline(route.points, {
                        color: '#eab308', // Yellow color
                        weight: 5,
                        opacity: 0.9
                    }).addTo(this.map);
                } else {
                    route.polyline.setStyle({ color: '#eab308', opacity: 0.9, weight: 5 });
                    route.polyline.addTo(this.map);
                }
            }
        });
    }

    // Show confirmation dialog
    async showConfirmDialog(message, title = 'Confirm Action') {
        return new Promise((resolve) => {
            const overlay = document.getElementById('confirm-dialog-overlay');
            const messageEl = document.getElementById('confirm-dialog-message');
            const titleEl = document.getElementById('confirm-dialog-title');
            const confirmBtn = document.getElementById('confirm-dialog-confirm');
            const cancelBtn = document.getElementById('confirm-dialog-cancel');

            // Set content
            titleEl.textContent = title;
            messageEl.textContent = message;

            // Show dialog - remove aria-hidden attribute entirely when visible
            overlay.classList.remove('hidden');
            overlay.removeAttribute('aria-hidden');
            
            // Focus after DOM update to avoid aria-hidden conflict
            requestAnimationFrame(() => {
                confirmBtn.focus();
            });

            // Handle confirm
            const handleConfirm = () => {
                cleanup();
                resolve(true);
            };

            // Handle cancel
            const handleCancel = () => {
                cleanup();
                resolve(false);
            };

            // Handle escape key
            const handleEscape = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                }
            };

            // Cleanup function
            const cleanup = () => {
                overlay.classList.add('hidden');
                overlay.setAttribute('aria-hidden', 'true');
                // Remove focus from button before hiding
                confirmBtn.blur();
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                document.removeEventListener('keydown', handleEscape);
                overlay.removeEventListener('click', handleOverlayClick);
            };

            // Handle overlay click (close on backdrop)
            const handleOverlayClick = (e) => {
                if (e.target === overlay) {
                    handleCancel();
                }
            };

            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
            document.addEventListener('keydown', handleEscape);
            overlay.addEventListener('click', handleOverlayClick);
        });
    }

    // Delete route
    async deleteRoute(routeId) {
        const confirmed = await this.showConfirmDialog('Are you sure you want to delete this route?', 'Delete Route');
        if (!confirmed) return;

        const route = this.routes.find(r => r.id === routeId);
        if (route && route.polyline) {
            this.map.removeLayer(route.polyline);
        }

        // If deleting the selected route, clear selection
        if (this.selectedRouteId === routeId) {
            this.selectedRouteId = null;
        }

        this.routes = this.routes.filter(r => r.id !== routeId);
        await this.db.delete('routes', routeId);
        
        // If we had a route selected and deleted it, show all remaining routes
        if (this.selectedRouteId === null && this.routes.length > 0) {
            this.showAllRoutes();
        }
        
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

                // Save route
                await this.saveRoute(route);
                this.routes.push(route);
                
                // Clear any route selection and show all routes (including the new one)
                this.selectedRouteId = null;
                this.showAllRoutes();
                
                // Fit bounds to the newly imported route
                if (route.polyline) {
                    this.map.fitBounds(route.polyline.getBounds());
                }
                
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
        toast.className = `bg-white dark:bg-gray-800 shadow-lg rounded-lg p-4 border-l-4 animate-[slideIn_0.3s_ease-out] ${
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

