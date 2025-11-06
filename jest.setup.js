if (typeof window !== 'undefined') {
  window.__TRAILTRACK_DISABLE_AUTO_INIT__ = true;
}

if (typeof navigator === 'undefined') {
  global.navigator = {};
}

if (!navigator.geolocation) {
  navigator.geolocation = {
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(),
    clearWatch: jest.fn()
  };
}

