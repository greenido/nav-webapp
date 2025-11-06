const { TrailTrack } = require('../app.js');

describe('TrailTrack core functionality', () => {
  afterEach(() => {
    if (typeof global.L !== 'undefined') {
      delete global.L;
    }
  });

  test('calculateDistance uses map.distance when available', () => {
    const track = new TrailTrack({ autoInit: false });

    global.L = {
      latLng: jest.fn((lat, lng) => ({ lat, lng }))
    };

    track.map = {
      distance: jest.fn(() => 100)
    };

    const distance = track.calculateDistance([
      [0, 0],
      [0, 1]
    ]);

    expect(track.map.distance).toHaveBeenCalledTimes(1);
    expect(distance).toBe(100);
  });

  test('calculateDistance falls back to haversine formula without map', () => {
    const track = new TrailTrack({ autoInit: false });
    track.map = null;

    const distance = track.calculateDistance([
      [0, 0],
      [0, 1]
    ]);

    // Distance between (0,0) and (0,1) is roughly 111,319 meters
    expect(distance).toBeGreaterThan(111000);
    expect(distance).toBeLessThan(112000);
  });

  test('saveRoute normalizes route data before persistence', async () => {
    const track = new TrailTrack({ autoInit: false });
    track.db = {
      put: jest.fn().mockResolvedValue()
    };

    const route = {
      id: 123,
      name: ' Test Route ',
      points: [
        { lat: '10', lng: '20' },
        ['11', '21']
      ],
      distance: '42',
      elevationGain: '5',
      created: new Date('2024-01-01T00:00:00Z')
    };

    await track.saveRoute(route);

    expect(track.db.put).toHaveBeenCalledWith('routes', {
      id: '123',
      name: ' Test Route ',
      points: [
        [10, 20],
        [11, 21]
      ],
      distance: 42,
      elevationGain: 5,
      created: '2024-01-01T00:00:00.000Z'
    });
  });

  test('renderRoutesList filters routes by search query', () => {
    document.body.innerHTML = `
      <div id="routes-list"></div>
    `;

    const track = new TrailTrack({ autoInit: false });
    track.routes = [
      { id: '1', name: 'Sunset Trail', distance: 2000, created: new Date('2024-01-01').toISOString() },
      { id: '2', name: 'Forest Loop', distance: 1500, created: new Date('2024-02-01').toISOString() }
    ];

    track.viewRoute = jest.fn();
    track.exportGPX = jest.fn();
    track.deleteRoute = jest.fn();

    track.routeSearchQuery = 'forest';
    track.renderRoutesList();

    const list = document.getElementById('routes-list');
    expect(list.textContent).toContain('Forest Loop');
    expect(list.textContent).not.toContain('Sunset Trail');

    track.routeSearchQuery = 'missing';
    track.renderRoutesList();
    expect(list.textContent).toContain('No routes match your search');
  });
});

