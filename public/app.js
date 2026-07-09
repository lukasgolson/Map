import { 
  getWrappedLatLng as wrapLatLng, 
  getWrappedLatLngs as wrapLatLngs, 
  getDistanceKM, 
  snapToTransitAngles, 
  getBezierSplinePoints 
} from './map-utils.js';

import {
  isMusicPlaying,
  isSFXEnabled,
  initAudioContext,
  startMusicOnSplash,
  toggleMusic,
  toggleSFX,
  stopAllSynths,
  updateAudioVibe,
  playSFX,
  modulateMusicByWeather,
  setAudioState,
  musicMode
} from './audio.js';

import {
  resizeCanvas,
  animateParticles,
  setWeatherState
} from './weather.js';

// Core State Variables
let pollIntervalSeconds = 30; // Will be synced dynamically from config
let pollInterval = null;
let currentData = {
  currentState: 'disconnected',
  history: [],
  weather: 'clear',
  batteryLevel: 100,
  highScore: 0,
  statusText: 'Connecting to Dino Tracker...'
};

let map = null;
let routeGeoJsonLayer = null;
let trackPolyline = null;
let trackDots = [];
let avatarMarker = null;
let goalMarker = null;
let shelterMarker = null;
let winnipegMarker = null;
let isZooming = false;
let pendingUpdateMap = false;

// Gliding & Extrapolation State
let visualAvatarLatLng = null;
let extrapolatedTargetLatLng = null;
let isFollowingDino = true;

// Dev Overrides Settings
let devStateOverride = 'auto';
let devTimeOverride = 'auto';
let devWeatherOverride = 'auto';

// Extrapolation calibration
let previousUpdateClientTime = null;
let lastUpdateClientTime = null;
let gpsTimeScale = 1.0;

function getWrappedLatLng(latlng) {
  return wrapLatLng(map, latlng);
}

function getWrappedLatLngs(latlngs) {
  return wrapLatLngs(map, latlngs);
}

function getApiUrl(path) {
  if (window.location.protocol === 'file:') {
    return 'http://localhost:8080' + path;
  }
  return path;
}

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  // Register Service Worker for PWA capability
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(getApiUrl('/sw.js'))
      .then(reg => console.log('Service Worker registered successfully with scope:', reg.scope))
      .catch(err => console.error('Service Worker registration failed:', err));
  }

  initMap();
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (map) map.invalidateSize();
  });
  
  // Set default button UI state based on detected OS/musicMode
  const btn = document.getElementById('music-toggle');
  if (btn) {
    const label = document.getElementById('music-label');
    if (musicMode === 'off') {
      btn.className = 'neon-btn mute';
      if (label) label.textContent = 'MUSIC: OFF';
    } else {
      btn.className = 'neon-btn play';
      if (label) label.textContent = `MUSIC: ${musicMode.toUpperCase()}`;
    }
  }

  // Initialize follow button state
  updateFollowButtonUI();
  const followBtn = document.getElementById('follow-toggle');
  if (followBtn) {
    followBtn.addEventListener('click', () => {
      isFollowingDino = !isFollowingDino;
      updateFollowButtonUI();
      if (isFollowingDino && visualAvatarLatLng) {
        map.panTo(visualAvatarLatLng, { animate: true, duration: 1.0 });
      }
    });
  }

  // Bind settings/music toggles to audio engine
  const musicBtn = document.getElementById('music-toggle');
  if (musicBtn) musicBtn.addEventListener('click', toggleMusic);
  
  // Setup interactive control SFX bindings
  document.querySelectorAll('button, select').forEach(elem => {
    if (elem.id === 'sfx-toggle') return; // handled separately in toggleSFX
    if (elem.tagName === 'SELECT') {
      elem.addEventListener('change', () => playSFX('click'));
    } else {
      elem.addEventListener('click', () => playSFX('click'));
    }
  });
  
  // Setup SFX toggle listener
  const sfxBtn = document.getElementById('sfx-toggle');
  if (sfxBtn) sfxBtn.addEventListener('click', toggleSFX);

  // Real-time ticking clock for departure timer
  setInterval(updateDepartureTimer, 1000);

  // Dev panel open/close toggle
  const devToggleBtn = document.getElementById('dev-toggle');
  const devPanel = document.getElementById('dev-panel');
  if (devToggleBtn && devPanel) {
    // Check backend capability: retrieve dev panel toggle setting
    fetch(getApiUrl('/api/v1/dashboard'))
      .then(res => res.json())
      .then(data => {
        if (data.enableDevPanel) {
          devToggleBtn.style.display = 'flex';
        } else {
          devToggleBtn.style.display = 'none';
          devPanel.classList.add('hidden');
        }
      })
      .catch(() => {
        devToggleBtn.style.display = 'flex'; // fallback
      });

    devToggleBtn.addEventListener('click', () => {
      devPanel.classList.toggle('hidden');
      devToggleBtn.classList.toggle('play'); // glowing toggle effect
      updateMap(); // Redraw map instantly to show/hide points based on new dev mode state
    });
  }
  
  // Start particle weather animation loop
  animateParticles();

  // One-time global interaction listener to unlock Web Audio context and fade out splash screen
  const splash = document.getElementById('splash-screen');
  const startAudioOnSplash = () => {
    startMusicOnSplash();
    
    // Fade out and remove splash screen
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.remove();
      }, 800);
    }
    
    // Clean up event listeners
    if (splash) {
      splash.removeEventListener('click', startAudioOnSplash);
      splash.removeEventListener('touchend', startAudioOnSplash);
    }
    document.removeEventListener('keydown', startAudioOnSplash, true);
    document.removeEventListener('touchend', startAudioOnSplash, true);
  };

  if (splash) {
    splash.addEventListener('click', startAudioOnSplash);
    splash.addEventListener('touchend', startAudioOnSplash);
  }
  document.addEventListener('keydown', startAudioOnSplash, true);
  document.addEventListener('touchend', startAudioOnSplash, true);

  // Sync state with audio and weather modules
  setAudioState(currentData, devTimeOverride, pollIntervalSeconds);
  setWeatherState(map, avatarMarker, currentData, devTimeOverride);

  // Start polling immediately
  fetchSettings();
  fetchData();

  // Start avatar animation loop
  requestAnimationFrame(animateAvatar);
});

// 1. Map Initialization
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    boxZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: true,
    minZoom: 3,
    maxZoom: 18
  }).setView([55.8000, -97.9000], 8);
  
  const isNight = isNightTime();
  const themeUrl = isNight 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png';
    
  L.tileLayer(themeUrl, {
    maxZoom: 20
  }).addTo(map);

  map.on('zoomstart', () => { isZooming = true; });
  map.on('zoomend', () => { 
    isZooming = false; 
    updateZoomLevelDisplay();
    if (pendingUpdateMap) {
      pendingUpdateMap = false;
      updateMap();
    }
  });
  map.on('move', updateMapPositionWrapping);

  // Goal waterfall marker at Manitoba Kapakaytay Falls
  const goalLatLng = L.latLng(56.0653, -98.2004);
  
  const waterfallIcon = L.divIcon({
    html: `
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
        <!-- Cliff/rocks -->
        <rect x="2" y="16" width="10" height="12" fill="#555" stroke="#333" stroke-width="1.5"/>
        <rect x="20" y="16" width="10" height="12" fill="#555" stroke="#333" stroke-width="1.5"/>
        <!-- Water stream -->
        <rect x="12" y="8" width="8" height="20" fill="#00f3ff"/>
        <!-- Foam/splash -->
        <rect x="10" y="24" width="12" height="4" fill="#fff"/>
      </svg>
    `,
    className: 'waterfall-marker-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 28]
  });
  
  goalMarker = L.marker(goalLatLng, { icon: waterfallIcon }).addTo(map);
  
  goalMarker.bindPopup(`
    <div style="font-family: var(--font-retro); font-size: 8px; color: #fff; background: #222; padding: 4px; border: 1.5px solid var(--neon-cyan); border-radius: 4px;">
      <div style="color: var(--neon-cyan); font-weight: bold; margin-bottom: 2px;">GOAL: KAPAKAYTAY FALLS</div>
      Final expedition destination.
    </div>
  `, { closeButton: false, offset: L.point(0, -22) });

  // Thompson and Winnipeg real Manitoba markers
  const winnipeg = L.latLng(49.8951, -97.1384);
  const thompson = L.latLng(55.7433, -97.8553);
  
  const shelterIcon = L.divIcon({
    html: `
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
        <polygon points="16,4 4,16 28,16" fill="#ff5500" stroke="#7a2200" stroke-width="1.5"/>
        <rect x="7" y="16" width="18" height="12" fill="#555555" stroke="#333333" stroke-width="1.5"/>
        <rect x="14" y="20" width="4" height="8" fill="#111111"/>
      </svg>
    `,
    className: 'shelter-marker-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 28]
  });
  
  shelterMarker = L.marker(thompson, { icon: shelterIcon }).addTo(map);
  shelterMarker.bindPopup(`
    <div style="font-family: var(--font-retro); font-size: 8px; color: #fff; background: #222; padding: 4px; border: 1.5px solid var(--neon-orange); border-radius: 4px;">
      <div style="color: var(--neon-orange); font-weight: bold; margin-bottom: 2px;">STATION: THOMPSON</div>
      Supply caches and shelter.
    </div>
  `, { closeButton: false, offset: L.point(0, -22) });

  const winnipegIcon = L.divIcon({
    html: `
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
        <rect x="6" y="6" width="20" height="20" fill="#39ff14" stroke="#1d8f07" stroke-width="1.5"/>
        <text x="16" y="20" font-family="monospace" font-size="14" font-weight="bold" fill="#000" text-anchor="middle">W</text>
      </svg>
    `,
    className: 'winnipeg-marker-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 28]
  });

  winnipegMarker = L.marker(winnipeg, { icon: winnipegIcon }).addTo(map);
  winnipegMarker.bindPopup(`
    <div style="font-family: var(--font-retro); font-size: 8px; color: #fff; background: #222; padding: 4px; border: 1.5px solid var(--neon-green); border-radius: 4px;">
      <div style="color: var(--neon-green); font-weight: bold; margin-bottom: 2px;">START: WINNIPEG</div>
      Expedition departure point.
    </div>
  `, { closeButton: false, offset: L.point(0, -22) });

  updateTheme();
  updateZoomLevelDisplay();
  loadRouteGeoJson();
}

function loadRouteGeoJson() {
  fetch(getApiUrl('/route.geojson'))
    .then(response => response.json())
    .then(data => {
      routeGeoJsonLayer = L.geoJSON(data, {
        style: function () {
          const isNight = isNightTime();
          return {
            color: isNight ? '#555555' : '#888888',
            weight: 4,
            opacity: 0.6,
            dashArray: '5, 5'
          };
        }
      }).addTo(map);
      routeGeoJsonLayer.bringToBack();
    })
    .catch(err => {
      console.warn("Failed to load route.geojson:", err);
    });
}

function updateZoomLevelDisplay() {
  if (map) {
    const display = document.getElementById('dev-zoom-val');
    if (display) display.textContent = map.getZoom();
  }
}

function updateTheme() {
  const isNight = isNightTime();
  document.body.classList.toggle('light-theme', !isNight);
  
  if (map) {
    const themeUrl = isNight 
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png';
      
    map.eachLayer(layer => {
      if (layer instanceof L.TileLayer) {
        layer.setUrl(themeUrl);
      }
    });
  }
  
  if (routeGeoJsonLayer) {
    routeGeoJsonLayer.setStyle({
      color: isNight ? '#555555' : '#888888'
    });
  }

  // Update neon style colors dynamically based on Time of Day to give the HUD unique tints
  updateThemeColors();
}

function updateThemeColors() {
  const root = document.documentElement;
  
  let timeOfDay = 'afternoon';
  if (devTimeOverride !== 'auto') {
    timeOfDay = devTimeOverride;
  } else if (currentData && currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    const offsetHours = Math.round(latestPt.lng / 15.0);
    const localDate = new Date(new Date().getTime() + (offsetHours * 3600000));
    const hours = localDate.getUTCHours();
    if (hours >= 5 && hours < 12) {
      timeOfDay = 'morning';
    } else if (hours >= 12 && hours < 17) {
      timeOfDay = 'afternoon';
    } else if (hours >= 17 && hours < 21) {
      timeOfDay = 'evening';
    } else {
      timeOfDay = 'latenight';
    }
  }

  const isLightTheme = document.body.classList.contains('light-theme');

  if (isLightTheme) {
    // Light theme variants (Burnt/Aged parchment theme)
    if (timeOfDay === 'morning') {
      root.style.setProperty('--neon-orange', '#b85a00'); // softer gold orange
      root.style.setProperty('--neon-cyan', '#0b6c7c'); // teal
      root.style.setProperty('--neon-pink', '#9a0c4f');
    } else if (timeOfDay === 'afternoon') {
      root.style.setProperty('--neon-orange', '#a03c00'); // default burnt orange
      root.style.setProperty('--neon-cyan', '#0b6c7c');
      root.style.setProperty('--neon-pink', '#9a0c4f');
    } else if (timeOfDay === 'evening') {
      root.style.setProperty('--neon-orange', '#9c2400'); // reddish golden hour
      root.style.setProperty('--neon-cyan', '#512b70'); // purple twilight
      root.style.setProperty('--neon-pink', '#9a0c4f');
    } else {
      // latenight light theme
      root.style.setProperty('--neon-orange', '#5c1b6f');
      root.style.setProperty('--neon-cyan', '#004d61'); // dark deep blue
      root.style.setProperty('--neon-pink', '#8a063b');
    }
  } else {
    // Dark theme variants (Glow/CRT theme)
    if (timeOfDay === 'morning') {
      root.style.setProperty('--neon-orange', '#ff8800'); // soft bright gold
      root.style.setProperty('--neon-cyan', '#ffd700'); // amber gold
      root.style.setProperty('--neon-pink', '#ff44aa'); // soft rose
    } else if (timeOfDay === 'afternoon') {
      root.style.setProperty('--neon-orange', '#ff5500'); // neon orange
      root.style.setProperty('--neon-cyan', '#00f3ff'); // electric cyan
      root.style.setProperty('--neon-pink', '#ff007f'); // cyber pink
    } else if (timeOfDay === 'evening') {
      root.style.setProperty('--neon-orange', '#e23d28'); // warm flame
      root.style.setProperty('--neon-cyan', '#8a2be2'); // violet twilight
      root.style.setProperty('--neon-pink', '#ff1493'); // fluorescent magenta
    } else {
      // latenight
      root.style.setProperty('--neon-orange', '#6200ea'); // midnight violet
      root.style.setProperty('--neon-cyan', '#0d47a1'); // deep cobalt blue
      root.style.setProperty('--neon-pink', '#880e4f'); // dark plum
    }
  }
}

// 3. Main Polling & Data Update
function fetchData() {
  fetch(getApiUrl('/api/v1/dashboard'))
    .then(response => response.json())
    .then(data => {
      // If dev state is overridden, apply it
      if (devStateOverride !== 'auto') {
        data.currentState = devStateOverride;
        if (devStateOverride === 'paddling') {
          data.statusText = "[DEV] Paddling upstream. Steady dino pace.";
        } else if (devStateOverride === 'camping') {
          data.statusText = "[DEV] Chilling by the campfire. Roasting marshmallows.";
        } else if (devStateOverride === 'resting') {
          data.statusText = "[DEV] Sleeping soundly under the stars. Dino is dreaming.";
        } else {
          data.statusText = "[DEV] Out of range. Dino is offline.";
        }
      }
      
      if (devWeatherOverride !== 'auto') {
        data.weather = devWeatherOverride;
      }
      
      let historyUpdated = false;
      const oldHistory = currentData.history || [];
      const newHistory = data.history || [];
      
      if (newHistory.length > 0) {
        if (oldHistory.length === 0) {
          historyUpdated = true;
        } else {
          const oldLast = oldHistory[oldHistory.length - 1];
          const newLast = newHistory[newHistory.length - 1];
          if (oldLast.lat !== newLast.lat || oldLast.lng !== newLast.lng || oldLast.timestamp !== newLast.timestamp) {
            historyUpdated = true;
          }
        }
      }
      
      if (historyUpdated) {
        const now = performance.now();
        const oldLastClientTime = lastUpdateClientTime;
        
        previousUpdateClientTime = lastUpdateClientTime;
        lastUpdateClientTime = now;
        
        if (newHistory.length >= 2) {
          const lastPt = newHistory[newHistory.length - 1];
          const prevPt = newHistory[newHistory.length - 2];
          
          if (oldLastClientTime !== null && previousUpdateClientTime !== null) {
            const clientTimeDiff = now - oldLastClientTime;
            const gpsTimeDiff = new Date(lastPt.timestamp).getTime() - new Date(prevPt.timestamp).getTime();
            if (clientTimeDiff > 1000 && gpsTimeDiff > 0) {
              gpsTimeScale = gpsTimeDiff / clientTimeDiff;
              console.log(`Updated GPS time scale to ${gpsTimeScale.toFixed(2)} (GPS: ${gpsTimeDiff}ms, Client: ${clientTimeDiff}ms)`);
            }
          } else {
            const devFeedSelect = document.getElementById('dev-feed');
            const useTestServer = devFeedSelect && devFeedSelect.value === 'test';
            if (useTestServer) {
              gpsTimeScale = 60 / pollIntervalSeconds;
            } else {
              gpsTimeScale = 1.0;
            }
          }
          
          if (data.extrapolatedTarget && visualAvatarLatLng) {
            const errLat = lastPt.lat - visualAvatarLatLng.lat;
            const errLng = lastPt.lng - visualAvatarLatLng.lng;
            const jumpDist = Math.sqrt(errLat * errLat + errLng * errLng);
            if (jumpDist > 0.05) {
              gpsTimeScale = 1.0;
              const snappedList = snapToTransitAngles(newHistory);
              if (snappedList.length > 0) {
                visualAvatarLatLng = getWrappedLatLng(snappedList[snappedList.length - 1]);
              }
            }
          }
        }
      }
      
      currentData = data;
      
      // Update pre-computed server extrapolation target
      if (currentData.extrapolatedTarget && currentData.currentState === 'paddling') {
        extrapolatedTargetLatLng = L.latLng(currentData.extrapolatedTarget.lat, currentData.extrapolatedTarget.lng);
      } else {
        extrapolatedTargetLatLng = null;
      }
      
      setAudioState(currentData, devTimeOverride, pollIntervalSeconds);
      setWeatherState(map, avatarMarker, currentData, devTimeOverride);

      updateUI();
      updateMap();
      updateAudioVibe(currentData.currentState);
    })
    .catch(err => {
      console.error('Error fetching dashboard data:', err);
      if (devStateOverride === 'auto') {
        const statusEl = document.getElementById('telemetry-status');
        if (statusEl) {
          statusEl.textContent = 'OFFLINE (Fetch Failed)';
          statusEl.style.color = 'var(--neon-pink)';
        }
      }
    });
}

function updateUI() {
  updateTheme();
  updateDepartureTimer();

  // Update trip header title
  const tripTitleEl = document.getElementById('trip-title');
  if (tripTitleEl) {
    tripTitleEl.textContent = currentData.goalTitle || 'Martin & Olson; Kapakaytay Falls, MB, Canada';
  }

  // Calculate Expedition Progress (Non-linear progress)
  // First 25% represents Winnipeg -> Thompson highway drive segment.
  // Next 75% represents the 120 km out-and-back backcountry trek (Thompson -> Falls -> Thompson).
  let progressPercent = 0;
  const winnipeg = { lat: 49.8951, lng: -97.1384 };
  const thompson = { lat: 55.7433, lng: -97.8553 };
  const goalLat = currentData.goalLatitude || 56.0653;
  const goalLng = currentData.goalLongitude || -98.2004;
  const waterfall = { lat: goalLat, lng: goalLng };
  
  if (currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    
    // Check if we have ever reached the waterfall (within 2 km)
    const reachedWaterfall = currentData.history.some(pt => getDistanceKM(pt, waterfall) < 2.0);
    
    const distToThompson = getDistanceKM(latestPt, thompson);
    const distWpgToThompson = getDistanceKM(winnipeg, thompson);
    const distToGoal = getDistanceKM(latestPt, waterfall);
    
    if (distToGoal > 60.0 && !reachedWaterfall) {
      // 1. Winnipeg -> Thompson Highway segment (0% to 25%)
      let seg1Ratio = (distWpgToThompson - distToThompson) / distWpgToThompson;
      if (seg1Ratio < 0) seg1Ratio = 0;
      if (seg1Ratio > 1) seg1Ratio = 1;
      progressPercent = seg1Ratio * 25.0;
    } else {
      // 2. Out-and-back backcountry segment (25% to 100%)
      // Outbound (Thompson -> Waterfall): 25% -> 62.5% (distToGoal goes 60km -> 0km)
      // Inbound (Waterfall -> Thompson): 62.5% -> 100% (distToGoal goes 0km -> 60km after reaching)
      let seg2Ratio = 0;
      if (!reachedWaterfall) {
        // Heading outbound
        seg2Ratio = 0.5 * Math.max(0, Math.min(1, (60.0 - distToGoal) / 60.0));
      } else {
        // Returning inbound
        seg2Ratio = 0.5 + 0.5 * Math.max(0, Math.min(1, distToGoal / 60.0));
      }
      progressPercent = 25.0 + (seg2Ratio * 75.0);
    }
  }
  
  const progressValEl = document.getElementById('progress-val');
  if (progressValEl) {
    progressValEl.textContent = Math.round(progressPercent) + '%';
  }
  const progressBarEl = document.getElementById('progress-bar');
  if (progressBarEl) {
    progressBarEl.style.width = progressPercent + '%';
  }

  const stateVal = document.getElementById('telemetry-state');
  if (stateVal) {
    stateVal.textContent = currentData.currentState.toUpperCase();
    if (currentData.currentState === 'paddling') {
      stateVal.style.color = 'var(--neon-green)';
    } else if (currentData.currentState === 'camping') {
      stateVal.style.color = 'var(--neon-orange)';
    } else if (currentData.currentState === 'resting') {
      stateVal.style.color = 'var(--neon-cyan)';
    } else {
      stateVal.style.color = 'var(--neon-pink)';
    }
  }

  const statusVal = document.getElementById('telemetry-status');
  if (statusVal) {
    statusVal.textContent = currentData.statusText;
    statusVal.style.color = '';
  }

  updateTelemetry();
  updateBatteryUI(currentData.batteryLevel);
  updateTheme();
}

function updateTelemetry() {
  // 1. Weather overview
  const weatherVal = currentData.weather || 'clear';
  const weatherIcons = {
    clear: '☀️ CLEAR',
    cloudy: '☁️ CLOUDY',
    rainy: '🌧️ RAINY',
    stormy: '⛈️ STORMY',
    snowy: '❄️ SNOWY'
  };
  const weatherEl = document.getElementById('telemetry-weather');
  if (weatherEl) {
    weatherEl.textContent = weatherIcons[weatherVal] || '☀️ CLEAR';
  }
  
  // 2. Local Time (Live calculation of current real-world UTC time converted to location's local time)
  let timeStr = '12:00 PM';
  const now = new Date();
  
  if (devTimeOverride !== 'auto') {
    const mockTimes = {
      morning: '09:00 AM (DEV MORNING)',
      afternoon: '02:00 PM (DEV AFTERNOON)',
      evening: '08:00 PM (DEV EVENING)',
      latenight: '02:00 AM (DEV LATENIGHT)'
    };
    timeStr = mockTimes[devTimeOverride] || '12:00 PM';
  } else if (currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    // Determine offset from longitude (15 degrees per hour)
    const offsetHours = Math.round(latestPt.lng / 15.0);
    // Convert current UTC time to local timezone at coordinates
    const localDate = new Date(now.getTime() + (offsetHours * 3600000));
    
    let hours = localDate.getUTCHours();
    const minutes = localDate.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minStr = minutes < 10 ? '0' + minutes : minutes;
    
    const offsetSign = offsetHours >= 0 ? '+' : '';
    timeStr = `${hours}:${minStr} ${ampm} (UTC${offsetSign}${offsetHours})`;
  } else {
    timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const timeEl = document.getElementById('telemetry-time');
  if (timeEl) {
    timeEl.textContent = timeStr;
  }
  
  // 2b. Last Update Time (UTC timestamp from latest track point formatted to local time)
  let lastUpdateStr = 'N/A';
  if (currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    if (latestPt.timestamp) {
      const date = new Date(latestPt.timestamp);
      if (!isNaN(date.getTime())) {
        let hours = date.getHours();
        const minutes = date.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const minStr = minutes < 10 ? '0' + minutes : minutes;
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        // Calculate relative elapsed time
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        let relativeStr = 'Just now';
        if (diffMins >= 1 && diffMins < 60) {
          relativeStr = `${diffMins}m ago`;
        } else if (diffMins >= 60 && diffMins < 1440) {
          relativeStr = `${Math.floor(diffMins / 60)}h ago`;
        } else if (diffMins >= 1440) {
          relativeStr = `${Math.floor(diffMins / 1440)}d ago`;
        }
        
        lastUpdateStr = `${month}/${day} ${hours}:${minStr} ${ampm} (${relativeStr})`;
      }
    }
  }
  const lastUpdateEl = document.getElementById('telemetry-last-update');
  if (lastUpdateEl) {
    lastUpdateEl.textContent = lastUpdateStr;
  }
  
  // 3. Distance moved during the day
  let todayDist = 0;
  if (currentData.history && currentData.history.length >= 2) {
    todayDist = calculateTodayDistance(currentData.history);
  }
  const distEl = document.getElementById('telemetry-dist');
  if (distEl) {
    distEl.textContent = todayDist.toFixed(2) + ' km';
  }
  
  // 3b. Distance to Goal
  let goalDistStr = 'N/A';
  if (currentData.history && currentData.history.length > 0 && currentData.goalLatitude && currentData.goalLongitude) {
    const latestPt = currentData.history[currentData.history.length - 1];
    const distToGoal = getDistanceKM(latestPt, { lat: currentData.goalLatitude, lng: currentData.goalLongitude });
    goalDistStr = distToGoal.toFixed(2) + ' km';
  }
  const goalDistEl = document.getElementById('telemetry-goal-dist');
  if (goalDistEl) {
    goalDistEl.textContent = goalDistStr;
  }
  
  // 4. Velocity
  let velocity = 0;
  if (currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    velocity = latestPt.velocity || 0;
  }
  const velocityEl = document.getElementById('telemetry-velocity');
  if (velocityEl) {
    velocityEl.textContent = velocity.toFixed(2) + ' km/h';
  }
  
  // 5. Coords
  let coordsStr = '00.000N, 000.000W';
  if (currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    const lat = latestPt.lat;
    const lng = latestPt.lng;
    const latDir = lat >= 0 ? 'N' : 'S';
    const lngDir = lng >= 0 ? 'E' : 'W';
    coordsStr = `${Math.abs(lat).toFixed(3)}°${latDir}, ${Math.abs(lng).toFixed(3)}°${lngDir}`;
  }
  const coordsEl = document.getElementById('telemetry-coords');
  if (coordsEl) {
    coordsEl.textContent = coordsStr;
  }
}

function calculateTodayDistance(history) {
  if (!history || history.length < 2) return 0;
  const latestDate = new Date(history[history.length - 1].timestamp).toDateString();
  
  let dist = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const pDate = new Date(history[i].timestamp).toDateString();
    const nDate = new Date(history[i+1].timestamp).toDateString();
    
    if (pDate === latestDate && nDate === latestDate) {
      dist += getDistanceKM(history[i], history[i+1]);
    }
  }
  return dist;
}

function calculateTotalDistance(history) {
  if (!history || history.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < history.length - 1; i++) {
    total += getDistanceKM(history[i], history[i+1]);
  }
  return total;
}

function updateBatteryUI(level) {
  const percentText = document.getElementById('battery-percent');
  if (percentText) {
    percentText.textContent = level + '%';
  }
  
  const bar = document.getElementById('battery-bar');
  if (bar) {
    bar.style.width = level + '%';
    if (level <= 20) {
      bar.style.backgroundColor = 'var(--neon-pink)';
      bar.style.boxShadow = '0 0 8px var(--neon-pink)';
    } else if (level <= 50) {
      bar.style.backgroundColor = 'var(--neon-orange)';
      bar.style.boxShadow = '0 0 8px var(--neon-orange)';
    } else {
      bar.style.backgroundColor = 'var(--neon-green)';
      bar.style.boxShadow = '0 0 8px var(--neon-green)';
    }
  }
}

function updateMapPositionWrapping() {
  if (!map) return;
  if (avatarMarker) {
    avatarMarker.setLatLng(getWrappedLatLng(avatarMarker.getLatLng()));
  }
  if (goalMarker) {
    goalMarker.setLatLng(getWrappedLatLng(goalMarker.getLatLng()));
  }
  if (shelterMarker) {
    shelterMarker.setLatLng(getWrappedLatLng(shelterMarker.getLatLng()));
  }
  if (winnipegMarker) {
    winnipegMarker.setLatLng(getWrappedLatLng(winnipegMarker.getLatLng()));
  }
  if (trackPolyline) {
    trackPolyline.setLatLngs(getWrappedLatLngs(trackPolyline.getLatLngs()));
  }
  if (trackDots && trackDots.length > 0) {
    trackDots.forEach(dot => {
      dot.setLatLng(getWrappedLatLng(dot.getLatLng()));
    });
  }
  if (routeGeoJsonLayer) {
    routeGeoJsonLayer.eachLayer(layer => {
      if (typeof layer.setLatLngs === 'function') {
        layer.setLatLngs(getWrappedLatLngs(layer.getLatLngs()));
      } else if (typeof layer.setLatLng === 'function') {
        layer.setLatLng(getWrappedLatLng(layer.getLatLng()));
      }
    });
  }
}

// 4. Map Updates
function updateMap() {
  if (!map || !map._loaded) {
    pendingUpdateMap = true;
    return;
  }

  if (isZooming) {
    pendingUpdateMap = true;
    return;
  }

  if (currentData.history.length === 0) return;

  // Don't display points before departure time unless in dev mode
  const isBeforeDeparture = currentData.departureTime && (Date.now() < new Date(currentData.departureTime).getTime());
  const devPanel = document.getElementById('dev-panel');
  const isDevPanelOpen = devPanel && !devPanel.classList.contains('hidden');
  const hasOverrides = devStateOverride !== 'auto' || devTimeOverride !== 'auto' || devWeatherOverride !== 'auto';
  const isDevMode = isDevPanelOpen || hasOverrides;

  if (isBeforeDeparture && !isDevMode) {
    if (trackPolyline) {
      map.removeLayer(trackPolyline);
      trackPolyline = null;
    }
    trackDots.forEach(dot => map.removeLayer(dot));
    trackDots = [];
    if (avatarMarker) {
      map.removeLayer(avatarMarker);
      avatarMarker = null;
    }
    return;
  }
  
  const snappedLatLngs = snapToTransitAngles(currentData.history);
  const wrappedLatLngs = getWrappedLatLngs(snappedLatLngs);
  const smoothedLatLngs = getBezierSplinePoints(wrappedLatLngs);
  
  // Draw / Update traveled polyline
  if (trackPolyline) {
    trackPolyline.setLatLngs(smoothedLatLngs);
  } else {
    trackPolyline = L.polyline(smoothedLatLngs, {
      color: '#ff5500',
      weight: 6,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap: 'round',
      shadowColor: '#ff5500',
      shadowBlur: 10
    }).addTo(map);
  }
  
  // Clean up old grid station dots
  trackDots.forEach(dot => map.removeLayer(dot));
  trackDots = [];
  
  // Plot snap grid station dots on map route snap points
  const dotColor = isNightTime() ? '#00f3ff' : '#00a3ab';
  wrappedLatLngs.forEach((latlng, idx) => {
    const isLast = (idx === wrappedLatLngs.length - 1);
    const radius = isLast ? 8 : 5;
    
    const dot = L.circleMarker(latlng, {
      radius: radius,
      fillColor: isLast ? 'transparent' : dotColor,
      fillOpacity: isLast ? 0 : 0.9,
      color: dotColor,
      weight: 3,
      opacity: 1.0
    }).addTo(map);
    
    // Station tooltip popup
    dot.bindTooltip(`
      GPS POINT ${idx + 1}<br/>
      Time: ${new Date(currentData.history[idx].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    `, {
      direction: 'top',
      offset: L.point(0, -5),
      className: 'retro-tooltip'
    });
    
    trackDots.push(dot);
  });
  
  const latestCoord = getWrappedLatLng(snappedLatLngs[snappedLatLngs.length - 1]);
  
  // Trigger paddle splash SFX when a new GPS snap point is appended to path
  if (currentData.history.length > 1 && isSFXEnabled) {
    playSFX('paddle');
  }

  // Create or place avatar sprite marker on map
  let iconHtml = getCanoeSVG();
  if (currentData.currentState === 'camping') {
    iconHtml = getTwoTentsSVG(isNightTime());
  } else if (currentData.currentState === 'resting') {
    iconHtml = getRestingHammockSVG();
  } else if (currentData.currentState === 'disconnected') {
    iconHtml = getDisconnectedDinoSVG();
  }
  
  const customIcon = L.divIcon({
    html: iconHtml,
    className: 'dino-avatar-marker-div',
    iconSize: [64, 48],
    iconAnchor: [32, 28]
  });

  if (!avatarMarker) {
    visualAvatarLatLng = latestCoord;
    avatarMarker = L.marker(visualAvatarLatLng, { icon: customIcon }).addTo(map);
    map.setView(visualAvatarLatLng, 13);
  } else {
    avatarMarker.setIcon(customIcon);
  }
  
  setWeatherState(map, avatarMarker, currentData, devTimeOverride);

  // Pan the camera immediately to the character if follow is enabled
  if (isFollowingDino && visualAvatarLatLng) {
    map.setView(visualAvatarLatLng, map.getZoom());
  }
  
  modulateMusicByWeather();
}

function isNightTime() {
  if (devTimeOverride === 'night' || devTimeOverride === 'evening' || devTimeOverride === 'latenight') return true;
  if (devTimeOverride === 'day' || devTimeOverride === 'morning' || devTimeOverride === 'afternoon') return false;
  
  const now = new Date();
  let localHour = now.getHours();
  
  if (currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    const offsetHours = Math.round(latest.lng / 15.0);
    const localDate = new Date(now.getTime() + (offsetHours * 3600000));
    localHour = localDate.getUTCHours();
  }
  
  return localHour >= 18 || localHour < 6;
}

// 5. Procedural 8-bit SVG Sprite Drawings
function getGoalFlagSVG() {
  return `
    <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <rect x="10" y="4" width="4" height="40" fill="#aaaaaa"/>
      <rect x="8" y="42" width="8" height="2" fill="#888888"/>
      
      <rect x="14" y="6" width="6" height="6" fill="#ffffff"/>
      <rect x="20" y="6" width="6" height="6" fill="#000000"/>
      <rect x="26" y="6" width="6" height="6" fill="#ffffff"/>
      <rect x="32" y="6" width="6" height="6" fill="#000000"/>
      <rect x="14" y="12" width="6" height="6" fill="#000000"/>
      <rect x="20" y="12" width="6" height="6" fill="#ffffff"/>
      <rect x="26" y="12" width="6" height="6" fill="#000000"/>
      <rect x="32" y="12" width="6" height="6" fill="#ffffff"/>
      <rect x="14" y="18" width="6" height="6" fill="#ffffff"/>
      <rect x="20" y="18" width="6" height="6" fill="#000000"/>
      <rect x="26" y="18" width="6" height="6" fill="#ffffff"/>
      <rect x="32" y="18" width="6" height="6" fill="#000000"/>
      
      <rect x="14" y="24" width="24" height="2" fill="#ff0055"/>
      <g transform="translate(4, 36)">
         <rect x="0" y="0" width="2" height="2" fill="#39ff14"/>
         <rect x="1" y="1" width="2" height="2" fill="#39ff14"/>
         <rect x="2" y="0" width="2" height="2" fill="#39ff14"/>
      </g>
      <g transform="translate(18, 38)">
         <rect x="0" y="0" width="2" height="2" fill="#2ad10d"/>
         <rect x="1" y="1" width="2" height="2" fill="#2ad10d"/>
         <rect x="2" y="0" width="2" height="2" fill="#2ad10d"/>
      </g>
    </svg>
  `;
}

function getCanoeSVG() {
  return `
    <svg width="64" height="48" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Dinosaur in the back with a Scholar Cap (Mortarboard) -->
      <g transform="translate(6, 4)">
        <!-- Scholar Cap -->
        <rect x="6" y="-3" width="8" height="2" fill="#111111"/>
        <rect x="2" y="-5" width="15" height="2" fill="#111111"/>
        <rect x="3" y="-3" width="1" height="4" fill="#ffcc00"/>
        <rect x="2" y="1" width="2" height="2" fill="#ffcc00"/>
        
        <!-- Dino Body -->
        <rect x="6" y="0" width="8" height="6" fill="#39ff14"/>
        <rect x="12" y="2" width="2" height="2" fill="#000"/>
        <rect x="2" y="6" width="10" height="12" fill="#39ff14"/>
        <rect x="4" y="18" width="2" height="4" fill="#32c710"/>
        <rect x="8" y="18" width="2" height="4" fill="#32c710"/>
        <rect x="0" y="10" width="2" height="6" fill="#39ff14"/>
        <rect x="10" y="12" width="4" height="2" fill="#39ff14"/>
      </g>
      
      <!-- Dinosaur in the front with a Cowboy Hat -->
      <g transform="translate(38, 6)">
        <!-- Cowboy Hat -->
        <rect x="2" y="-2" width="15" height="2" fill="#a0522d"/>
        <rect x="5" y="-5" width="10" height="3" fill="#a0522d"/>
        <rect x="7" y="-6" width="6" height="1" fill="#5c2c16"/>
        <rect x="5" y="-2" width="10" height="1" fill="#ff0055"/>
        
        <!-- Dino Body -->
        <rect x="6" y="0" width="8" height="6" fill="#2ad10d"/>
        <rect x="12" y="2" width="2" height="2" fill="#000"/>
        <rect x="2" y="6" width="10" height="12" fill="#2ad10d"/>
        <rect x="4" y="18" width="2" height="4" fill="#209c09"/>
        <rect x="8" y="18" width="2" height="4" fill="#209c09"/>
        <rect x="0" y="10" width="2" height="6" fill="#2ad10d"/>
        <rect x="10" y="12" width="4" height="2" fill="#2ad10d"/>
      </g>
      <path d="M 6,32 C 14,44 50,44 58,32 L 55,26 C 46,30 18,30 9,26 Z" fill="#b05d2e" stroke="#5a2c16" stroke-width="2"/>
      <line x1="12" y1="26" x2="4" y2="42" stroke="#ffcc00" stroke-width="3" stroke-linecap="round"/>
      <line x1="48" y1="28" x2="56" y2="44" stroke="#ffcc00" stroke-width="3" stroke-linecap="round"/>
      <rect x="3" y="31" width="2" height="2" fill="#00f3ff"/>
      <rect x="59" y="31" width="2" height="2" fill="#00f3ff"/>
    </svg>
  `;
}

function getTwoTentsSVG(isNight) {
  const fireMarkup = isNight ? `
        <polygon points="5,-9 1,-1 9,-1" fill="#ff3300"/>
        <polygon points="5,-5 3,0 7,0" fill="#ffcc00"/>
  ` : '';
  return `
    <svg width="72" height="48" viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <g transform="translate(4, 4)">
        <polygon points="20,12 6,36 34,36" fill="#005757" stroke="#002d2d" stroke-width="2"/>
        <polygon points="20,12 20,36 34,36" fill="#008080"/>
        <polygon points="20,22 14,36 26,36" fill="#111"/>
      </g>
      <g transform="translate(36, 8)">
        <polygon points="20,12 6,36 34,36" fill="#007d7d" stroke="#004747" stroke-width="2"/>
        <polygon points="20,12 20,36 34,36" fill="#00acac"/>
        <polygon points="20,22 14,36 26,36" fill="#181818"/>
      </g>
      <g transform="translate(30, 36)">
        <line x1="0" y1="4" x2="10" y2="0" stroke="#5c2c16" stroke-width="2.5"/>
        <line x1="1" y1="0" x2="9" y2="4" stroke="#5c2c16" stroke-width="2.5"/>
        ${fireMarkup}
      </g>
    </svg>
  `;
}

function getRestingHammockSVG() {
  return `
    <svg width="72" height="48" viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <g transform="translate(0, 0)">
        <g transform="translate(2, 2)">
          <rect x="7" y="10" width="3" height="28" fill="#8d4a1f"/>
          <polygon points="8,10 0,4 6,7" fill="#1b850a"/>
          <polygon points="8,10 16,4 10,7" fill="#1b850a"/>
        </g>
        <g transform="translate(22, 2)">
          <rect x="7" y="10" width="3" height="28" fill="#8d4a1f"/>
          <polygon points="8,10 0,4 6,7" fill="#1b850a"/>
          <polygon points="8,10 16,4 10,7" fill="#1b850a"/>
        </g>
        <path d="M 10,24 Q 20,33 30,24" stroke="#d5601a" stroke-width="2.5" fill="none"/>
        <g transform="translate(14, 16)">
          <rect x="0" y="4" width="2" height="6" fill="#39ff14"/>
          <rect x="2" y="2" width="12" height="8" fill="#39ff14"/>
          <rect x="10" y="-1" width="5" height="5" fill="#39ff14"/>
          <rect x="11" y="0" width="4" height="2" fill="#000"/>
        </g>
      </g>
      <g transform="translate(36, 0)">
        <g transform="translate(2, 2)">
          <rect x="7" y="10" width="3" height="28" fill="#8d4a1f"/>
          <polygon points="8,10 0,4 6,7" fill="#1b850a"/>
          <polygon points="8,10 16,4 10,7" fill="#1b850a"/>
        </g>
        <g transform="translate(22, 2)">
          <rect x="7" y="10" width="3" height="28" fill="#8d4a1f"/>
          <polygon points="8,10 0,4 6,7" fill="#1b850a"/>
          <polygon points="8,10 16,4 10,7" fill="#1b850a"/>
        </g>
        <path d="M 10,24 Q 20,33 30,24" stroke="#007d7d" stroke-width="2.5" fill="none"/>
        <g transform="translate(14, 16)">
          <rect x="0" y="4" width="2" height="6" fill="#2ad10d"/>
          <rect x="2" y="2" width="12" height="8" fill="#2ad10d"/>
          <rect x="10" y="-1" width="5" height="5" fill="#2ad10d"/>
          <rect x="11" y="0" width="4" height="2" fill="#ff0000"/>
        </g>
      </g>
    </svg>
  `;
}

function getDisconnectedDinoSVG() {
  return `
    <svg width="54" height="48" viewBox="0 0 54 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <g transform="translate(6, 12)">
        <rect x="6" y="0" width="10" height="8" fill="#39ff14"/>
        <rect x="8" y="2" width="2" height="2" fill="#000"/>
        <rect x="0" y="8" width="12" height="14" fill="#39ff14"/>
        <rect x="2" y="22" width="3" height="4" fill="#32c710"/>
        <rect x="7" y="22" width="3" height="4" fill="#32c710"/>
        <path d="M 0,14 L -4,18 L -4,20 Z" fill="#39ff14"/>
        <rect x="12" y="10" width="2" height="4" fill="#39ff14"/>
        <rect x="12" y="8" width="8" height="6" fill="#ffffff" stroke="#aaaaaa" stroke-width="1"/>
        <rect x="14" y="10" width="4" height="2" fill="#8d4a1f"/>
      </g>
      <g transform="translate(36, 14)">
        <rect x="5" y="6" width="2" height="24" fill="#888888"/>
        <rect x="2" y="28" width="8" height="2" fill="#888888"/>
        <path d="M 0,8 C 0,16 12,16 12,8" stroke="#aaaaaa" stroke-width="2.5" fill="none"/>
        <circle cx="6" cy="1" r="3.5" fill="#ff0055" class="flicker-loop"/>
      </g>
      <g transform="translate(24, 38)">
        <rect x="0" y="0" width="2" height="2" fill="#2ad10d"/>
        <rect x="3" y="1" width="2" height="2" fill="#2ad10d"/>
        <rect x="6" y="0" width="2" height="2" fill="#2ad10d"/>
      </g>
      <circle cx="3" cy="3" r="1" fill="#ff0055" opacity="0.3"/>
    </svg>
  `;
}

// 6. Test Settings Helpers
function fetchSettings() {
  fetch(getApiUrl('/api/v1/settings'))
    .then(response => response.json())
    .then(settings => {
      const devFeedSelect = document.getElementById('dev-feed');
      const devPeriodSelect = document.getElementById('dev-period');
      
      if (devFeedSelect) {
        devFeedSelect.value = settings.use_test_server ? 'test' : 'live';
        toggleResetRouteButton(settings.use_test_server);
      }
      
      pollIntervalSeconds = settings.poll_interval_seconds || 30;
      if (devPeriodSelect) {
        devPeriodSelect.value = pollIntervalSeconds;
      }
      
      // Update audio context settings
      setAudioState(currentData, devTimeOverride, pollIntervalSeconds);
      
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(fetchData, pollIntervalSeconds * 1000);
      fetchData();
    })
    .catch(err => {
      console.warn("Failed to fetch settings from server, using local defaults:", err);
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(fetchData, pollIntervalSeconds * 1000);
      fetchData();
    });
}

function updateSettingsOnServer(useTestServer, pollSecs) {
  fetch(getApiUrl('/api/v1/settings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      use_test_server: useTestServer,
      poll_interval_seconds: parseInt(pollSecs)
    })
  })
  .then(response => response.json())
  .then(settings => {
    console.log("Settings successfully updated on server:", settings);
    pollIntervalSeconds = settings.poll_interval_seconds || 30;
    
    // Reset client-side polling timer interval to match server
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(fetchData, pollIntervalSeconds * 1000);
  })
  .catch(err => {
    console.error("Error saving settings on server:", err);
  });
}

// 7. Developer Control Overrides
function triggerOverrideUpdate() {
  if (devStateOverride === 'auto' && devTimeOverride === 'auto' && devWeatherOverride === 'auto') {
    fetchData();
    return;
  }
  
  if (devStateOverride !== 'auto') {
    currentData.currentState = devStateOverride;
    if (devStateOverride === 'paddling') {
      currentData.statusText = "[DEV] Paddling upstream. Steady dino pace.";
    } else if (devStateOverride === 'camping') {
      currentData.statusText = "[DEV] Chilling by the campfire. Roasting marshmallows.";
    } else if (devStateOverride === 'resting') {
      currentData.statusText = "[DEV] Sleeping soundly under the stars. Dino is dreaming.";
    } else {
      currentData.statusText = "[DEV] Out of range. Dino is offline.";
    }
  }
  
  if (devWeatherOverride !== 'auto') {
    currentData.weather = devWeatherOverride;
  }
  
  setAudioState(currentData, devTimeOverride, pollIntervalSeconds);
  setWeatherState(map, avatarMarker, currentData, devTimeOverride);

  updateUI();
  updateMap();
  updateAudioVibe(currentData.currentState, true);
}

// Set up UI panel bindings
const stateSelect = document.getElementById('dev-state');
if (stateSelect) {
  stateSelect.addEventListener('change', (e) => {
    devStateOverride = e.target.value;
    triggerOverrideUpdate();
  });
}

const timeSelect = document.getElementById('dev-time');
if (timeSelect) {
  timeSelect.addEventListener('change', (e) => {
    devTimeOverride = e.target.value;
    triggerOverrideUpdate();
  });
}

const weatherSelect = document.getElementById('dev-weather');
if (weatherSelect) {
  weatherSelect.addEventListener('change', (e) => {
    devWeatherOverride = e.target.value;
    triggerOverrideUpdate();
  });
}

const feedSelect = document.getElementById('dev-feed');
if (feedSelect) {
  feedSelect.addEventListener('change', (e) => {
    const useTest = e.target.value === 'test';
    toggleResetRouteButton(useTest);
    updateSettingsOnServer(useTest, pollIntervalSeconds);
  });
}

const periodSelect = document.getElementById('dev-period');
if (periodSelect) {
  periodSelect.addEventListener('change', (e) => {
    const feedVal = document.getElementById('dev-feed').value;
    updateSettingsOnServer(feedVal === 'test', e.target.value);
  });
}

const resetBtn = document.getElementById('dev-reset');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    fetch(getApiUrl('/api/v1/test/reset'), { method: 'POST' })
      .then(response => response.json())
      .then(res => {
        console.log("Route reset status:", res);
        fetchData();
      })
      .catch(err => console.error("Error resetting route:", err));
  });
}


function toggleResetRouteButton(show) {
  const resetRouteRow = document.getElementById('dev-reset').closest('.dev-row');
  if (resetRouteRow) {
    resetRouteRow.style.display = show ? 'flex' : 'none';
  }
}

// 8. 60fps Frame Animation Loop
let lastFrameTime = performance.now();
function animateAvatar(currentTime) {
  const frameDtMs = currentTime - lastFrameTime;
  lastFrameTime = currentTime;
  
  if (!map || !map._loaded) {
    requestAnimationFrame(animateAvatar);
    return;
  }
  
  if (currentData.history.length === 0) {
    requestAnimationFrame(animateAvatar);
    return;
  }
  
  const lastPoint = currentData.history[currentData.history.length - 1];
  
  // 1. Gather extrapolation coordinates for the route path preview line
  const historyWithExtrapolation = [...currentData.history];
  if (extrapolatedTargetLatLng && currentData.currentState === 'paddling') {
    historyWithExtrapolation.push({
      lat: extrapolatedTargetLatLng.lat,
      lng: extrapolatedTargetLatLng.lng,
      timestamp: new Date()
    });
  }
  
  const snappedLatLngs = snapToTransitAngles(historyWithExtrapolation);
  
  let extSnapped = [];
  if (extrapolatedTargetLatLng && snappedLatLngs.length > 1 && currentData.currentState === 'paddling') {
    extSnapped = [
      snappedLatLngs[snappedLatLngs.length - 2],
      snappedLatLngs[snappedLatLngs.length - 1]
    ];
  }
  
  if (extSnapped.length > 0) {
    const wrappedExtLatLngs = getWrappedLatLngs(extSnapped);
    if (extrapolationPolyline) {
      extrapolationPolyline.setLatLngs(wrappedExtLatLngs);
    } else {
      extrapolationPolyline = L.polyline(wrappedExtLatLngs, {
        color: '#ff5500',
        weight: 4,
        opacity: 0.8,
        dashArray: '5, 10',
        lineCap: 'round'
      }).addTo(map);
    }
  } else {
    if (extrapolationPolyline) {
      map.removeLayer(extrapolationPolyline);
      extrapolationPolyline = null;
    }
  }
  
  // 2. Gliding movement calculations
  const predPoint = (extrapolatedTargetLatLng && currentData.currentState === 'paddling') 
    ? extrapolatedTargetLatLng 
    : L.latLng(lastPoint.lat, lastPoint.lng);
    
  const wrappedPredPoint = getWrappedLatLng(predPoint);
  
  if (avatarMarker) {
    if (!visualAvatarLatLng) {
      visualAvatarLatLng = L.latLng(wrappedPredPoint.lat, wrappedPredPoint.lng);
    } else {
      const distKm = getDistanceKM(visualAvatarLatLng, wrappedPredPoint);
      
      let speedKmh = lastPoint.velocity;
      if (speedKmh <= 0) {
        speedKmh = 5.0;
      }
      
      const speedBoost = distKm * 120.0;
      speedKmh += speedBoost;
      
      const speedKmPerMs = speedKmh / 3600000;
      const stepKm = speedKmPerMs * frameDtMs;
      
      if (distKm > 0) {
        if (distKm > 3.0) {
          visualAvatarLatLng = L.latLng(wrappedPredPoint.lat, wrappedPredPoint.lng);
        } else if (stepKm >= distKm) {
          visualAvatarLatLng = L.latLng(wrappedPredPoint.lat, wrappedPredPoint.lng);
        } else {
          const fraction = stepKm / distKm;
          const newLat = visualAvatarLatLng.lat + (wrappedPredPoint.lat - visualAvatarLatLng.lat) * fraction;
          const newLng = visualAvatarLatLng.lng + (wrappedPredPoint.lng - visualAvatarLatLng.lng) * fraction;
          visualAvatarLatLng = L.latLng(newLat, newLng);
        }
      }
    }
    avatarMarker.setLatLng(visualAvatarLatLng);
    
    // 3. Camera dead-zone follow logic
    if (isFollowingDino && !isZooming) {
      const charPoint = map.latLngToContainerPoint(visualAvatarLatLng);
      const centerPoint = L.point(map.getSize().x / 2, map.getSize().y / 2);
      const dx = charPoint.x - centerPoint.x;
      const dy = charPoint.y - centerPoint.y;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      
      const bufferRadius = 60;
      
      if (pixelDist > bufferRadius) {
        const shiftX = dx * (1 - bufferRadius / pixelDist);
        const shiftY = dy * (1 - bufferRadius / pixelDist);
        const targetCenterLatLng = map.containerPointToLatLng(centerPoint.add([shiftX, shiftY]));
        
        const currentCenter = map.getCenter();
        const dt = frameDtMs / 1000;
        const camFactor = 1 - Math.exp(-dt / 0.8);
        const nextLat = currentCenter.lat + (targetCenterLatLng.lat - currentCenter.lat) * camFactor;
        const nextLng = currentCenter.lng + (targetCenterLatLng.lng - currentCenter.lng) * camFactor;
        
        map.setView(L.latLng(nextLat, nextLng), map.getZoom(), { animate: false });
      }
    }
  }
  
  // Wrap positions if map wrapping boundary is crossed
  updateMapPositionWrapping();
  
  requestAnimationFrame(animateAvatar);
}

let extrapolationPolyline = null;

function updateFollowButtonUI() {
  const followBtn = document.getElementById('follow-toggle');
  const label = document.getElementById('follow-label');
  if (followBtn && label) {
    if (isFollowingDino) {
      followBtn.className = 'neon-btn play';
      label.textContent = 'FOLLOW: ON';
    } else {
      followBtn.className = 'neon-btn mute';
      label.textContent = 'FOLLOW: OFF';
    }
  }
}

function updateDepartureTimer() {
  const timerLabel = document.getElementById('timer-label');
  const timerVal = document.getElementById('timer-val');
  if (!timerLabel || !timerVal || !currentData || !currentData.departureTime) return;

  const departureDate = new Date(currentData.departureTime);
  const now = new Date();
  const diffMs = departureDate.getTime() - now.getTime();

  if (diffMs > 0) {
    timerLabel.textContent = 'DEPARTURE IN';
    timerVal.textContent = formatTimeDiff(diffMs);
    timerVal.classList.remove('elapsed');
    timerVal.classList.add('countdown');
  } else {
    timerLabel.textContent = 'ELAPSED TIME';
    timerVal.textContent = formatTimeDiff(Math.abs(diffMs));
    timerVal.classList.remove('countdown');
    timerVal.classList.add('elapsed');
  }
}

function formatTimeDiff(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const totalHours = Math.floor(totalMins / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  const d = String(days).padStart(2, '0');
  const h = String(hours).padStart(2, '0');
  const m = String(mins).padStart(2, '0');
  const s = String(secs).padStart(2, '0');

  return `${d}d ${h}h ${m}m ${s}s`;
}
