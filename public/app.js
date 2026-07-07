// Project Lukas-Alexander-Transit (v1.0)
// Frontend Controller, Custom Polyline Snap Engine, Particle Canvas, & Web Audio Jukebox

let map;
let trackPolyline;
let avatarMarker;
let pollInterval;
let baseTileLayer;
let goalMarker = null;
let currentTileUrl = '';

// State data cache
let currentData = {
  currentState: 'disconnected',
  history: [],
  weather: 'clear',
  batteryLevel: 100,
  highScore: 0,
  statusText: 'Initializing...'
};

// Canvas & Particle System Settings
const canvas = document.getElementById('weather-canvas');
const ctx = canvas.getContext('2d');
let particles = [];
let animationFrameId;

// Audio Jukebox Settings
let audioCtx = null;
let masterFilter = null;
let isMusicPlaying = true; // Enabled by default!
let isSFXEnabled = true;
let currentVibe = null; // 'paddling', 'camping', 'skeleton'
let synthNodes = {}; // Container for oscillators/gain nodes
let audioTimer = null; // Sequencer timer reference

// Dev Panel Settings
let devStateOverride = 'auto';
let devTimeOverride = 'auto';
let devWeatherOverride = 'auto';

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    if (map) map.invalidateSize();
  });
  
  // Set default button UI state to ON since it is enabled by default
  const btn = document.getElementById('music-toggle');
  btn.className = 'neon-btn play';
  document.getElementById('music-label').textContent = 'MUSIC: ON';

  // Setup dev panel overrides
  const devToggleBtn = document.getElementById('dev-toggle');
  const devPanel = document.getElementById('dev-panel');
  const devStateSelect = document.getElementById('dev-state');
  const devTimeSelect = document.getElementById('dev-time');
  const devWeatherSelect = document.getElementById('dev-weather');
  
  devToggleBtn.addEventListener('click', () => {
    devPanel.classList.toggle('hidden');
    devToggleBtn.classList.toggle('play'); // glowing toggle effect
  });
  
  devStateSelect.addEventListener('change', (e) => {
    devStateOverride = e.target.value;
    triggerOverrideUpdate();
  });
  
  devTimeSelect.addEventListener('change', (e) => {
    devTimeOverride = e.target.value;
    triggerOverrideUpdate();
  });

  devWeatherSelect.addEventListener('change', (e) => {
    devWeatherOverride = e.target.value;
    triggerOverrideUpdate();
  });

  const devResetBtn = document.getElementById('dev-reset');
  devResetBtn.addEventListener('click', () => {
    devStateOverride = 'auto';
    devTimeOverride = 'auto';
    devWeatherOverride = 'auto';
    
    devStateSelect.value = 'auto';
    devTimeSelect.value = 'auto';
    devWeatherSelect.value = 'auto';
    
    triggerOverrideUpdate();
  });

  // Set up polling
  fetchData();
  pollInterval = setInterval(fetchData, 60000); // Poll Go server every 60s
  
  // Setup music toggle listener
  btn.addEventListener('click', toggleMusic);
  
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
  sfxBtn.addEventListener('click', toggleSFX);
  
  // Start particle animation loop
  animateParticles();

  // Retro double square-wave power-up sound (like Game Boy start!)
  function playStartupChime() {
    const time = audioCtx.currentTime;
    const lead1 = audioCtx.createOscillator();
    const lead2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    lead1.type = 'square';
    lead1.frequency.setValueAtTime(370, time); // F#4
    lead1.frequency.setValueAtTime(740, time + 0.08); // F#5
    
    lead2.type = 'square';
    lead2.frequency.setValueAtTime(440, time + 0.08); // A4
    lead2.frequency.setValueAtTime(880, time + 0.16); // A5
    
    gain.gain.setValueAtTime(0.015, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.8);
    
    lead1.connect(gain);
    lead2.connect(gain);
    gain.connect(audioCtx.destination);
    
    lead1.start(time);
    lead1.stop(time + 0.85);
    lead2.start(time);
    lead2.stop(time + 0.85);
  }

  // One-time global interaction listener to unlock Web Audio context and fade out splash screen
  const splash = document.getElementById('splash-screen');
  const startAudioOnSplash = () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!masterFilter) {
      masterFilter = audioCtx.createBiquadFilter();
      masterFilter.type = 'lowpass';
      masterFilter.frequency.setValueAtTime(20000, audioCtx.currentTime);
      masterFilter.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    // Play retro Game Boy start sound
    playStartupChime();
    
    // Fade out and remove splash screen
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.remove();
      }, 800);
    }
    
    if (isMusicPlaying) {
      updateAudioVibe(currentData.currentState);
    }
    
    // Clean up event listeners
    document.removeEventListener('keydown', startAudioOnSplash, true);
    document.removeEventListener('touchstart', startAudioOnSplash, true);
  };

  if (splash) {
    splash.addEventListener('click', startAudioOnSplash);
  }
  document.addEventListener('keydown', startAudioOnSplash, true);
  document.addEventListener('touchstart', startAudioOnSplash, true);
});

// 1. Map Initialization
function initMap() {
  // Center map on Vancouver by default, will re-center to latest coordinates once loaded
  map = L.map('map', {
    zoomControl: true,
    boxZoom: false,
    doubleClickZoom: false,
    scrollWheelZoom: true,
    minZoom: 3,
    maxZoom: 18
  }).setView([49.236816, -123.125818], 13);

  baseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png', {
    maxZoom: 18,
    minZoom: 3,
    noWrap: false,
    subdomains: 'abcd',
    attribution: 'CartoDB'
  }).addTo(map);

  map.on('move', updateMapPositionWrapping);
  map.on('zoomend', () => {
    updateMapPositionWrapping();
    updateZoomLevelDisplay();
  });
  
  updateTheme();
  updateZoomLevelDisplay();
}

function updateZoomLevelDisplay() {
  if (map) {
    const display = document.getElementById('dev-zoom-val');
    if (display) display.textContent = map.getZoom();
  }
}

function updateTheme() {
  const isNight = isNightTime();
  const targetUrl = isNight 
    ? 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'
    : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png';
    
  if (currentTileUrl !== targetUrl) {
    currentTileUrl = targetUrl;
    if (baseTileLayer) {
      baseTileLayer.setUrl(targetUrl);
    }
  }
  
  if (isNight) {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
    document.body.classList.add('light-theme');
  }
}

function getCurrentTimeOfDayVibe() {
  let localHour = new Date().getHours();
  
  if (devTimeOverride === 'morning') {
    localHour = 8; // force 8 AM
  } else if (devTimeOverride === 'afternoon') {
    localHour = 14; // force 2 PM
  } else if (devTimeOverride === 'evening') {
    localHour = 20; // force 8 PM
  } else if (devTimeOverride === 'latenight') {
    localHour = 2; // force 2 AM
  } else if (currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    const offsetHours = Math.round(latest.lng / 15.0);
    const localDate = new Date(new Date().getTime() + (offsetHours * 3600000));
    localHour = localDate.getUTCHours();
  }
  
  if (localHour >= 6 && localHour < 12) {
    return {
      name: 'morning',
      leadVoices: ['sine', 'triangle'],
      chordType: 'major',
      drumMute: false,
      bassVolume: 0.04,
      leadProb: 0.35,
    };
  } else if (localHour >= 12 && localHour < 18) {
    return {
      name: 'afternoon',
      leadVoices: ['square', 'triangle'],
      chordType: 'major',
      drumMute: false,
      bassVolume: 0.07,
      leadProb: 0.25,
    };
  } else if (localHour >= 18 && localHour < 24) {
    return {
      name: 'evening',
      leadVoices: ['sine'],
      chordType: 'minor',
      drumMute: true,
      bassVolume: 0.03,
      leadProb: 0.20,
    };
  } else {
    return {
      name: 'latenight',
      leadVoices: ['sine'],
      chordType: 'minor',
      drumMute: true,
      bassVolume: 0.015,
      leadProb: 0.12,
    };
  }
}

function getWrappedLatLng(latlng) {
  if (!map) return latlng;
  const centerLng = map.getCenter().lng;
  const diff = centerLng - latlng.lng;
  const wraps = Math.round(diff / 360.0);
  return L.latLng(latlng.lat, latlng.lng + (wraps * 360.0));
}

function getWrappedLatLngs(latlngs) {
  if (latlngs.length === 0) return [];
  const centerLng = map.getCenter().lng;
  const latest = latlngs[latlngs.length - 1];
  const diff = centerLng - latest.lng;
  const wraps = Math.round(diff / 360.0);
  const shift = wraps * 360.0;
  if (shift === 0) return latlngs;
  return latlngs.map(latlng => L.latLng(latlng.lat, latlng.lng + shift));
}

function updateMapPositionWrapping() {
  if (!map) return;
  if (avatarMarker) {
    avatarMarker.setLatLng(getWrappedLatLng(avatarMarker.getLatLng()));
  }
  if (goalMarker) {
    goalMarker.setLatLng(getWrappedLatLng(goalMarker.getLatLng()));
  }
  if (trackPolyline) {
    trackPolyline.setLatLngs(getWrappedLatLngs(trackPolyline.getLatLngs()));
  }
}

// 2. Custom Polyline Snap Engine (Transit Map 45/90 angles)
function snapToTransitAngles(coords) {
  if (coords.length === 0) return [];
  
  const snapped = [];
  // Seed the first coordinate
  snapped.push(L.latLng(coords[0].lat, coords[0].lng));
  
  for (let i = 1; i < coords.length; i++) {
    const prev = snapped[i - 1];
    const curr = coords[i];
    
    // Calculate deltas in degrees
    let dx = curr.lng - prev.lng;
    let dy = curr.lat - prev.lat;
    
    let snappedLng = curr.lng;
    let snappedLat = curr.lat;
    
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    
    // Snap logic:
    // If delta x is much larger than delta y, force horizontal (lat stays same)
    if (absDx > 2.2 * absDy) {
      snappedLat = prev.lat;
    } 
    // If delta y is much larger than delta x, force vertical (lng stays same)
    else if (absDy > 2.2 * absDx) {
      snappedLng = prev.lng;
    } 
    // Otherwise force 45 degree angle (step size is the average)
    else {
      const step = (absDx + absDy) / 2;
      snappedLng = prev.lng + step * Math.sign(dx);
      snappedLat = prev.lat + step * Math.sign(dy);
    }
    
    snapped.push(L.latLng(snappedLat, snappedLng));
  }
  
  return snapped;
}

// 3. Main Polling & Data Update
function fetchData() {
  fetch('/api/v1/dashboard')
    .then(response => response.json())
    .then(data => {
      // If dev state is overridden, apply it to the incoming data
      if (devStateOverride !== 'auto') {
    currentData.currentState = devStateOverride;
    if (devStateOverride === 'driving') {
      currentData.statusText = "[DEV] Driving down the highway! Lukas and Alexander are on the move.";
    } else if (devStateOverride === 'paddling') {
      currentData.statusText = "[DEV] Paddling upstream. Steady pace.";
    } else if (devStateOverride === 'camping') {
      currentData.statusText = "[DEV] Chilling by the campfire. Roasting marshmallows.";
    } else if (devStateOverride === 'resting') {
      currentData.statusText = "[DEV] Sleeping soundly under the stars. Lukas and Alexander are dreaming.";
    } else {
      currentData.statusText = "[DEV] Out of range. Lukas and Alexander are offline.";
    }
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
  
  // Battery indicators
  const batteryPercent = currentData.batteryLevel;
  document.getElementById('battery-val').textContent = batteryPercent + '%';
  const batteryBar = document.getElementById('battery-bar');
  batteryBar.style.width = batteryPercent + '%';
  
  // Set battery bar colors based on level
  if (batteryPercent > 50) {
    batteryBar.style.backgroundColor = '#39ff14';
    batteryBar.style.boxShadow = '0 0 8px #39ff14';
  } else if (batteryPercent > 20) {
    batteryBar.style.backgroundColor = '#ffaa00';
    batteryBar.style.boxShadow = '0 0 8px #ffaa00';
  } else {
    batteryBar.style.backgroundColor = '#ff0055';
    batteryBar.style.boxShadow = '0 0 8px #ff0055';
  }
  
  // Status badges
  const stateBadge = document.getElementById('status-badge');
  stateBadge.className = 'status-badge';
  
  // Determine dynamic render state based on time of day
  let renderState = currentData.currentState;
  const isNight = isNightTime();
  if (renderState === 'resting' || renderState === 'camping') {
    renderState = isNight ? 'camping' : 'resting';
  }
  
  if (renderState === 'driving') {
    stateBadge.textContent = 'DRIVING';
    stateBadge.classList.add('status-paddling'); // reuse paddling color for now
  } else if (renderState === 'paddling') {
    stateBadge.textContent = 'PADDLING';
    stateBadge.classList.add('status-paddling');
  } else if (renderState === 'camping') {
    stateBadge.textContent = 'SLEEPING';
    stateBadge.classList.add('status-camping');
  } else if (renderState === 'resting') {
    stateBadge.textContent = 'LAZING';
    stateBadge.classList.add('status-resting');
  } else {
    stateBadge.textContent = 'OFFLINE';
    stateBadge.classList.add('status-disconnected');
  }
  
  // Update ticker status text dynamically if not custom overridden
  let statusText = currentData.statusText;
  if (devStateOverride === 'auto') {
    if (currentData.currentState === 'resting' || currentData.currentState === 'camping') {
      statusText = isNight 
        ? "Sleeping soundly under the stars. Zzz..."
        : "Lazing around in a hammock. Enjoying the sunshine.";
    }
  }
  
  // Update floating telemetry stats
  updateTelemetry();
  
  // Toggle cloudy overlay
  const cloudyOverlay = document.getElementById('cloudy-overlay');
  if (cloudyOverlay) {
    if (currentData.weather === 'cloudy' || currentData.weather === 'rainy' || currentData.weather === 'stormy' || currentData.weather === 'snowy') {
      cloudyOverlay.classList.add('active');
    } else {
      cloudyOverlay.classList.remove('active');
    }
  }
  
  // Modulate music filter based on weather
  modulateMusicByWeather();
  
  // Ticker text
  typewriterEffect(statusText);
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
  document.getElementById('telemetry-weather').textContent = weatherIcons[weatherVal] || '☀️ CLEAR';
  
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
  document.getElementById('telemetry-time').textContent = timeStr;
  
  // 3. Distance moved during the day
  let todayDist = 0;
  if (currentData.history && currentData.history.length >= 2) {
    todayDist = calculateTodayDistance(currentData.history);
  }
  document.getElementById('telemetry-dist').textContent = todayDist.toFixed(2) + ' km';
  
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
  document.getElementById('telemetry-velocity').textContent = velocity.toFixed(2) + ' km/h';
  
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
  document.getElementById('telemetry-coords').textContent = coordsStr;
}

function calculateTodayDistance(history) {
  if (history.length < 2) return 0;
  // Get calendar day of the latest point
  const latestDate = new Date(history[history.length - 1].timestamp).toDateString();
  
  let dist = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const pDate = new Date(history[i].timestamp).toDateString();
    const nDate = new Date(history[i+1].timestamp).toDateString();
    
    // If both points fall on today's calendar day
    if (pDate === latestDate && nDate === latestDate) {
      dist += getDistanceKM(history[i], history[i+1]);
    }
  }
  return dist;
}

// Simple typewriter simulation for ticker tape
let currentTextTimeout = null;
function typewriterEffect(text) {
  const elem = document.getElementById('ticker-text');
  if (elem.textContent === text) return;
  
  if (currentTextTimeout) clearTimeout(currentTextTimeout);
  
  let i = 0;
  elem.textContent = '';
  
  function type() {
    if (i < text.length) {
      elem.textContent += text.charAt(i);
      i++;
      currentTextTimeout = setTimeout(type, 30);
    }
  }
  type();
}

function calculateTotalDistance(history) {
  if (history.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < history.length - 1; i++) {
    total += getDistanceKM(history[i], history[i+1]);
  }
  return total;
}

function getDistanceKM(c1, c2) {
  const R = 6371; // Earth radius
  const dLat = (c2.lat - c1.lat) * Math.PI / 180;
  const dLon = (c2.lng - c1.lng) * Math.PI / 180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(c1.lat*Math.PI/180)*Math.cos(c2.lat*Math.PI/180)*
            Math.sin(dLon/2)*Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// 4. Map Updates
function updateMap() {
  if (currentData.history.length === 0) return;
  
  // Get snapped transit coordinates
  const snappedLatLngs = snapToTransitAngles(currentData.history);
  
  const wrappedLatLngs = getWrappedLatLngs(snappedLatLngs);
  
  // Draw / Update thick neon polyline
  if (trackPolyline) {
    trackPolyline.setLatLngs(wrappedLatLngs);
  } else {
    trackPolyline = L.polyline(wrappedLatLngs, {
      color: '#ff5500', // Neon transit orange
      weight: 6,
      opacity: 0.9,
      lineJoin: 'miter',
      lineCap: 'square',
      shadowColor: '#ff5500',
      shadowBlur: 10
    }).addTo(map);
  }
  
  // Latest coordinate
  const latestCoord = getWrappedLatLng(snappedLatLngs[snappedLatLngs.length - 1]);
  
  // Determine if it is night time
  const isNight = isNightTime();
  
  // Create / Update avatar marker using procedural SVGs
  let svgHtml = '';
  let bobbingClass = '';
  let iconSize = [48, 48];
  let iconAnchor = [24, 24];
  
  let renderState = currentData.currentState;
  if (renderState === 'resting' || renderState === 'camping') {
    renderState = isNight ? 'camping' : 'resting';
  }
  
  if (renderState === 'driving') {
    svgHtml = getHatchbackSVG();
    bobbingClass = 'bobbing-loop';
    iconSize = [64, 48];
    iconAnchor = [32, 24];
  } else if (renderState === 'paddling') {
    svgHtml = getCanoeSVG();
    bobbingClass = 'bobbing-loop';
    iconSize = [64, 48];
    iconAnchor = [32, 32];
  } else if (renderState === 'camping') {
    svgHtml = getTwoTentsSVG();
    bobbingClass = 'flicker-loop';
    iconSize = [72, 48];
    iconAnchor = [36, 32];
  } else if (renderState === 'resting') {
    svgHtml = getTwoHammocksSVG();
    bobbingClass = 'bobbing-loop';
    iconSize = [72, 64];
    iconAnchor = [36, 40];
  } else {
    // disconnected
    svgHtml = getDisconnectedSVG();
    bobbingClass = 'flicker-loop';
    iconSize = [64, 48];
    iconAnchor = [32, 38];
  }
  
  const customIcon = L.divIcon({
    className: 'pixel-avatar-marker',
    html: `<div class="${bobbingClass}" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">${svgHtml}</div>`,
    iconSize: iconSize,
    iconAnchor: iconAnchor
  });
  
  if (avatarMarker) {
    avatarMarker.setLatLng(latestCoord);
    avatarMarker.setIcon(customIcon);
  } else {
    avatarMarker = L.marker(latestCoord, { icon: customIcon }).addTo(map);
  }
  
  // Pan to latest point on load
  map.panTo(latestCoord);

  // Update Goal flag marker if coordinates are set
  if (currentData.goalLatitude && currentData.goalLongitude) {
    const goalLatLng = getWrappedLatLng(L.latLng(currentData.goalLatitude, currentData.goalLongitude));
    const goalTitle = currentData.goalTitle || 'Goal Destination';
    
    const goalIcon = L.divIcon({
      className: 'goal-marker',
      html: `<div class="bobbing-loop" style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">${getGoalFlagSVG()}</div>`,
      iconSize: [48, 48],
      iconAnchor: [12, 44]
    });
    
    if (goalMarker) {
      goalMarker.setLatLng(goalLatLng);
      goalMarker.setIcon(goalIcon);
    } else {
      goalMarker = L.marker(goalLatLng, { icon: goalIcon }).addTo(map);
      goalMarker.bindTooltip(goalTitle, {
        permanent: true,
        direction: 'top',
        className: 'retro-tooltip'
      });
    }
  }
}

// 5. Canvas Particles Layer (Weather & Campfire Smoke)
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

class Particle {
  constructor(type, customX, customY) {
    this.type = type; // 'rain', 'snow', 'smoke', 'cloud'
    this.reset(customX, customY);
  }
  
  reset(customX, customY) {
    this.x = customX !== undefined ? customX : Math.random() * canvas.width;
    this.y = customY !== undefined ? customY : (this.type === 'smoke' ? customY : -10);
    
    if (this.type === 'rain') {
      this.size = Math.random() * 2 + 1;
      this.speedY = Math.random() * 10 + 12;
      this.speedX = -Math.random() * 3 - 2; // wind blow left
      this.length = Math.random() * 12 + 8;
      this.color = 'rgba(0, 243, 255, 0.4)';
    } else if (this.type === 'snow') {
      this.size = Math.random() * 3 + 2; // pixel snow
      this.speedY = Math.random() * 2 + 1;
      this.speedX = Math.random() * 1.5 - 0.5; // slow drift
      this.color = 'rgba(255, 255, 255, 0.7)';
    } else if (this.type === 'smoke') {
      this.x = customX;
      this.y = customY;
      this.size = Math.random() * 4 + 2;
      this.speedY = -Math.random() * 1.5 - 0.8;
      this.speedX = Math.random() * 1.2 - 0.6;
      this.alpha = 0.8;
      this.fade = Math.random() * 0.015 + 0.008;
      this.color = 'rgba(180, 180, 180, ';
    } else if (this.type === 'cloud') {
      this.x = -150;
      this.y = Math.random() * (canvas.height * 0.3) + 20;
      this.size = Math.random() * 30 + 30; // width
      this.speedX = Math.random() * 0.4 + 0.1;
      this.color = 'rgba(80, 80, 95, 0.2)';
    }
  }
  
  update(markerPos) {
    if (this.type === 'smoke') {
      this.x += this.speedX;
      this.y += this.speedY;
      this.alpha -= this.fade;
      if (this.alpha <= 0) {
        // Respawn at campfire location
        if (markerPos) {
          this.reset(markerPos.x, markerPos.y);
        } else {
          this.alpha = 0;
        }
      }
    } else {
      this.x += this.speedX;
      this.y += this.speedY;
      
      // Boundaries
      if (this.y > canvas.height || this.x < 0 || this.x > canvas.width) {
        this.reset();
      }
    }
  }
  
  draw() {
    const isNight = isNightTime();
    let renderColor = this.color;
    
    if (this.type === 'rain') {
      renderColor = isNight ? 'rgba(0, 243, 255, 0.4)' : 'rgba(11, 108, 124, 0.5)';
    } else if (this.type === 'snow') {
      renderColor = isNight ? 'rgba(255, 255, 255, 0.7)' : 'rgba(100, 120, 140, 0.4)';
    } else if (this.type === 'smoke') {
      const smokeBase = isNight ? '180, 180, 180, ' : '80, 75, 65, ';
      renderColor = 'rgba(' + smokeBase + this.alpha + ')';
    } else if (this.type === 'cloud') {
      renderColor = isNight ? 'rgba(80, 80, 95, 0.2)' : 'rgba(120, 110, 90, 0.15)';
    }
    
    ctx.fillStyle = renderColor;
    
    if (this.type === 'rain') {
      ctx.fillRect(this.x, this.y, this.size, this.length);
    } else if (this.type === 'snow') {
      ctx.fillRect(this.x, this.y, this.size, this.size);
    } else if (this.type === 'smoke') {
      ctx.fillRect(this.x, this.y, this.size, this.size);
    } else if (this.type === 'cloud') {
      // Draw pixel cloud block
      ctx.fillRect(this.x, this.y, this.size, 10);
      ctx.fillRect(this.x + 10, this.y - 6, this.size - 20, 6);
      ctx.fillRect(this.x + 20, this.y + 10, this.size - 30, 4);
    }
  }
}

// Render loop for weather canvas
function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Find marker pixel position for campfire smoke
  let markerScreenPos = null;
  if (avatarMarker && map) {
    const latlng = avatarMarker.getLatLng();
    markerScreenPos = map.latLngToContainerPoint(latlng);
  }
  
  // Decide particle numbers based on weather and state
  const targetCount = { rain: 0, snow: 0, smoke: 0, cloud: 0 };
  
  if (currentData.weather === 'rainy' || currentData.weather === 'stormy') {
    targetCount.rain = currentData.weather === 'stormy' ? 120 : 60;
  } else if (currentData.weather === 'snowy') {
    targetCount.snow = 50;
  } else if (currentData.weather === 'cloudy') {
    targetCount.cloud = 3;
  }
  
  if (currentData.currentState === 'camping') {
    targetCount.smoke = 25;
  }
  
  // Maintain particle pools
  updateParticlePool('rain', targetCount.rain);
  updateParticlePool('snow', targetCount.snow);
  updateParticlePool('cloud', targetCount.cloud);
  
  // Smoke requires specific spawn coordinates
  if (currentData.currentState === 'camping' && markerScreenPos) {
    updateParticlePool('smoke', targetCount.smoke, markerScreenPos.x, markerScreenPos.y);
  } else {
    // Kill smoke particles if not camping
    particles = particles.filter(p => p.type !== 'smoke');
  }
  
  // Stormy Lightning flash
  if (currentData.weather === 'stormy' && Math.random() < 0.005) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    playSFX('thunder');
  }
  
  // Update and draw particles
  particles.forEach(p => {
    p.update(markerScreenPos);
    p.draw();
  });
  
  animationFrameId = requestAnimationFrame(animateParticles);
}

function updateParticlePool(type, targetAmt, spawnX, spawnY) {
  const currentCount = particles.filter(p => p.type === type).length;
  
  if (currentCount < targetAmt) {
    // Add particles
    for (let i = 0; i < (targetAmt - currentCount); i++) {
      particles.push(new Particle(type, spawnX, spawnY));
    }
  } else if (currentCount > targetAmt) {
    // Remove excess
    let removed = 0;
    particles = particles.filter(p => {
      if (p.type === type && removed < (currentCount - targetAmt)) {
        removed++;
        return false;
      }
      return true;
    });
  }
}

// 6. Procedural Lo-Fi Jukebox (Web Audio API)
function toggleMusic() {
  const btn = document.getElementById('music-toggle');
  
  if (!audioCtx) {
    // Initialize Web Audio Context
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  // If music is enabled by default but hasn't started yet, play it!
  if (isMusicPlaying && !currentVibe) {
    updateAudioVibe(currentData.currentState);
    return;
  }
  
  if (!isMusicPlaying) {
    isMusicPlaying = true;
    btn.className = 'neon-btn play';
    document.getElementById('music-label').textContent = 'MUSIC: ON';
    // Initialize music synthesis for current state
    currentVibe = null; // force initialization
    updateAudioVibe(currentData.currentState);
  } else {
    isMusicPlaying = false;
    btn.className = 'neon-btn mute';
    document.getElementById('music-label').textContent = 'MUSIC: OFF';
    // Suspend sound generation
    stopAllSynths();
  }
}

function stopAllSynths() {
  if (audioTimer) {
    clearTimeout(audioTimer);
    audioTimer = null;
  }
  Object.keys(synthNodes).forEach(key => {
    if (synthNodes[key]) {
      try {
        synthNodes[key].forEach(node => {
          if (node.stop) node.stop();
          if (node.disconnect) node.disconnect();
        });
      } catch (e) {}
    }
  });
  synthNodes = {};
  currentVibe = null;
}

function updateAudioVibe(state, forceRestart = false) {
  if (!isMusicPlaying || !audioCtx) return;
  if (currentVibe === state && !forceRestart) return; // Vibe already correct
  
  // Transition vibe!
  stopAllSynths();
  currentVibe = state;
  
  if (state === 'paddling') {
    playPaddlingVibe();
  } else if (state === 'camping') {
    playCampingVibe();
  } else if (state === 'resting') {
    playRestingVibe();
  } else {
    // disconnected
    playDisconnectedVibe();
  }
}

function connectToOutput(node) {
  if (masterFilter) {
    node.connect(masterFilter);
  } else {
    node.connect(audioCtx.destination);
  }
}

// Helper: Create a short White Noise Buffer
function createNoiseBuffer(durationSeconds) {
  const bufferSize = audioCtx.sampleRate * durationSeconds;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// Synthesis Helper: Play a retro chiptune Kick
var kickVolume = 0.25;
function playKick(time) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  connectToOutput(gain);
  
  osc.frequency.setValueAtTime(140, time);
  osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.1);
  
  gain.gain.setValueAtTime(kickVolume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  
  osc.start(time);
  osc.stop(time + 0.15);
}

// Synthesis Helper: Play a retro chiptune Snare
var snareVolume = 0.08;
function playSnare(time) {
  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(0.15);
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(900, time);
  filter.Q.setValueAtTime(2.0, time);
  
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(snareVolume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
  
  noise.connect(filter);
  filter.connect(gain);
  connectToOutput(gain);
  
  noise.start(time);
  noise.stop(time + 0.15);
}

// Synthesis Helper: Play a low chiptune Bass note
function playBass(freq, time, duration) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, time);
  
  gain.gain.setValueAtTime(0.10, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.02);
  
  osc.connect(gain);
  connectToOutput(gain);
  
  osc.start(time);
  osc.stop(time + duration);
}

// Synthesis Helper: Play a warm chiptune Rhodes pad chord note
function playPadNote(freq, time, duration) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, time);
  osc.detune.setValueAtTime((Math.random() - 0.5) * 8, time);
  
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(450, time);
  
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.02, time + 0.15); // soft swell
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  
  osc.connect(filter);
  filter.connect(gain);
  connectToOutput(gain);
  
  osc.start(time);
  osc.stop(time + duration);
}

// Synthesis Helper: Play a cute chiptune lead melody note
function playLeadNote(freq, time, duration, waveType) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  
  osc.type = waveType || 'square';
  osc.frequency.setValueAtTime(freq, time);
  
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1000, time);
  
  // Vibrato LFO
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.setValueAtTime(6.0, time); // 6 Hz vibrato
  lfoGain.gain.setValueAtTime(4, time); // detune range
  
  lfo.connect(lfoGain);
  lfoGain.connect(osc.detune);
  
  gain.gain.setValueAtTime(0.012, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  
  osc.connect(filter);
  filter.connect(gain);
  connectToOutput(gain);
  
  lfo.start(time);
  osc.start(time);
  
  lfo.stop(time + duration);
  osc.stop(time + duration);
}

// Vibe 1: Paddling (Happy Chiptune Groove)
function playPaddlingVibe() {
  const synthList = [];
  
  // 1. Water waves background noise
  const whiteNoise = audioCtx.createBufferSource();
  whiteNoise.buffer = createNoiseBuffer(3.0);
  whiteNoise.loop = true;
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 450;
  filter.Q.value = 0.8;
  
  const waveLFO = audioCtx.createOscillator();
  waveLFO.type = 'sine';
  waveLFO.frequency.value = 0.15; // slow waves
  
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 220;
  
  waveLFO.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  
  const waveGain = audioCtx.createGain();
  waveGain.gain.value = 0.035;
  
  whiteNoise.connect(filter);
  filter.connect(waveGain);
  connectToOutput(waveGain);
  
  whiteNoise.start();
  waveLFO.start();
  synthList.push(whiteNoise, waveLFO, waveGain);

  // 2. Chiptune step sequencer - Overhauled for Ambient Generative Variety
  let currentStep = 0;
  let nextNoteTime = audioCtx.currentTime;
  let currentTransposition = 0; // base key shift in semitones
  let activeSection = 'full'; // song part: full, ambient, breakdown, lead_only
  
  const lookAhead = 0.12;
  const scheduleInterval = 40;
  
  // Day vs Night chords
  const dayChords = [
    { bass: 98.00,  pad: [196.00, 246.94, 293.66, 392.00] }, // Gmaj7
    { bass: 130.81, pad: [261.63, 329.63, 392.00, 493.88] }, // Cmaj7
    { bass: 110.00, pad: [220.00, 261.63, 329.63, 392.00] }, // Am7
    { bass: 146.83, pad: [293.66, 369.99, 440.00, 587.33] }  // D7
  ];
  
  const nightChords = [
    { bass: 110.00, pad: [220.00, 261.63, 329.63, 392.00] }, // Am7
    { bass: 73.42,  pad: [146.83, 196.00, 220.00, 293.66] }, // Dm7
    { bass: 82.41,  pad: [164.81, 196.00, 246.94, 329.63] }, // Em7
    { bass: 87.31,  pad: [174.61, 220.00, 261.63, 349.23] }  // Fmaj7
  ];
  
  const dayScale = [392.00, 440.00, 493.88, 587.33, 659.25, 783.99, 880.00]; // G major pentatonic
  const nightScale = [440.00, 493.88, 523.25, 587.33, 659.25, 783.99, 880.00]; // A minor pentatonic

  function scheduleNote(step, time, stepSeconds) {
    const timeVibe = getCurrentTimeOfDayVibe();
    const activeChords = timeVibe.chordType === 'minor' ? nightChords : dayChords;
    const activeScale = timeVibe.chordType === 'minor' ? nightScale : dayScale;
    
    // Coords modulation: base key transposition shift derived from GPS longitude
    let coordShift = 0;
    if (currentData.history && currentData.history.length > 0) {
      const latestPt = currentData.history[currentData.history.length - 1];
      coordShift = Math.floor(Math.abs(latestPt.lng)) % 12; // shift key by longitude
    }
    
    // Evolve structure every 64 steps (32 beats)
    if (step % 64 === 0) {
      const sections = ['full', 'full', 'ambient', 'breakdown', 'lead_only'];
      activeSection = sections[Math.floor(Math.random() * sections.length)];
      
      const keys = [-2, 0, 0, 2, 5, 7]; // standard transposition semitones (fourths, fifths, seconds)
      currentTransposition = keys[Math.floor(Math.random() * keys.length)];
    }
    
    const totalSemitones = currentTransposition + coordShift;
    const transpose = (f) => f * Math.pow(2, totalSemitones / 12.0);
    const chordIndex = Math.floor(step / 16) % activeChords.length; 
    const stepInMeasure = step % 16;
    const chord = activeChords[chordIndex];
    
    // Softer drum beat (lo-fi style) - Mute if time-of-day requests it, or in ambient section
    const forceDrumMute = timeVibe.drumMute || activeSection === 'ambient';
    if (!forceDrumMute) {
      if (stepInMeasure === 0 || (stepInMeasure === 6 && Math.random() < 0.25)) {
        playKick(time);
        if (Math.random() < 0.6) {
          playSFX('paddle', time + 0.05); // paddle splash synced on kick
        }
      }
      if (stepInMeasure === 8) {
        playSnare(time);
      }
    }
    
    // Slow walking bassline - Mute in ambient or lead_only, volume from time-of-day params
    if (activeSection !== 'ambient' && activeSection !== 'lead_only') {
      if (stepInMeasure === 0 || stepInMeasure === 4 || stepInMeasure === 8 || stepInMeasure === 12) {
        let bassFreq = chord.bass;
        if (stepInMeasure === 8 && Math.random() < 0.4) bassFreq *= 1.5;
        
        // Dynamically adjust bassVolume using timeOfDay params
        const oldBassVol = bassVolume;
        bassVolume = timeVibe.bassVolume;
        playBass(transpose(bassFreq), time, stepSeconds * 1.5);
        bassVolume = oldBassVol;
      }
    }
    
    // Rhodes Pad chords - Mute in breakdown section
    if (activeSection !== 'breakdown') {
      if (stepInMeasure === 0) {
        chord.pad.forEach((f, idx) => {
          playPadNote(transpose(f), time + (idx * 0.04), stepSeconds * 12);
        });
      }
    }
    
    // Generative Lead Melodies - probability scaled by time-of-day & active sections
    let leadProb = timeVibe.leadProb;
    if (activeSection === 'breakdown') leadProb = 0.08;
    if (activeSection === 'lead_only') leadProb = 0.45;
    
    if (stepInMeasure % 2 === 1 && Math.random() < leadProb) {
      const freq = activeScale[Math.floor(Math.random() * activeScale.length)];
      const finalFreq = Math.random() < 0.3 ? freq * 2 : freq;
      
      // Select voice type from time-of-day options
      const voices = timeVibe.leadVoices;
      const activeVoice = voices[Math.floor(Math.random() * voices.length)];
      
      playLeadNote(transpose(finalFreq), time, stepSeconds * 0.8, activeVoice);
    }
  }

  function runSequencer() {
    // Velocity modulation: adjust tempo dynamically based on speed!
    let velocity = 0;
    if (currentData.history && currentData.history.length > 0) {
      velocity = currentData.history[currentData.history.length - 1].velocity || 0;
    }
    const tempo = 60 + Math.min(velocity * 6, 36); // maps 0-6 km/h to 60-96 BPM!
    const secondsPerBeat = 60.0 / tempo;
    const secondsPerStep = secondsPerBeat / 2; // eighth notes
    
    while (nextNoteTime < audioCtx.currentTime + lookAhead) {
      scheduleNote(currentStep, nextNoteTime, secondsPerStep);
      nextNoteTime += secondsPerStep;
      currentStep = (currentStep + 1) % 32;
    }
    if (isMusicPlaying && currentVibe === 'paddling') {
      audioTimer = setTimeout(runSequencer, scheduleInterval);
    }
  }
  
  runSequencer();
  synthNodes['paddling'] = synthList;
}

// Vibe 2: Camping (Warm Campfire Drone & Guitar Melody)
function playCampingVibe() {
  const synthList = [];
  
  // 1. Warm Analog Chord Drone (A Major 9th chord)
  const freqs = [110.00, 165.00, 220.00, 277.18, 392.00]; // Amaj9 notes
  
  freqs.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    
    osc.type = idx % 2 === 0 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.detune.setValueAtTime((Math.random() - 0.5) * 12, audioCtx.currentTime);
    
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(350, audioCtx.currentTime);
    
    // Drone swell LFO to make it drift organically
    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.1 + (idx * 0.05), audioCtx.currentTime); // very slow tremolos
    
    lfoGain.gain.setValueAtTime(0.015, audioCtx.currentTime);
    
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    
    gain.gain.setValueAtTime(0.005, audioCtx.currentTime);
    
    osc.connect(filter);
    filter.connect(gain);
    connectToOutput(gain);
    
    osc.start();
    lfo.start();
    synthList.push(osc, lfo, gain, filter);
  });
  
  // 2. Campfire Crackle & Whistling wood pop loop
  function triggerCrackle() {
    if (!isMusicPlaying || currentVibe !== 'camping') return;
    
    const time = audioCtx.currentTime;
    
    // Small crackle pops
    const pop = audioCtx.createOscillator();
    const popGain = audioCtx.createGain();
    pop.type = 'sawtooth';
    pop.frequency.setValueAtTime(800 + Math.random() * 2500, time);
    
    popGain.gain.setValueAtTime(0.012, time);
    popGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.005 + Math.random() * 0.015);
    
    const popFilter = audioCtx.createBiquadFilter();
    popFilter.type = 'bandpass';
    popFilter.frequency.setValueAtTime(1500, time);
    popFilter.Q.setValueAtTime(3.0, time);
    
    pop.connect(popFilter);
    popFilter.connect(popGain);
    popGain.connect(audioCtx.destination);
    
    pop.start(time);
    pop.stop(time + 0.05);
    
    // Next crackle pop
    audioTimer = setTimeout(triggerCrackle, 40 + Math.random() * 400);
  }
  
  triggerCrackle();

  // 3. Sparse Acoustic Guitar/Bell Melody - Overhauled for Ambient Generative Variety
  const dayMelodyScale = [196.00, 220.00, 246.94, 293.66, 329.63, 392.00, 440.00, 493.88]; // G Major Pentatonic (Day)
  const nightMelodyScale = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33]; // A Minor Pentatonic (Night)
  
  function triggerMelodyNote() {
    if (!isMusicPlaying || currentVibe !== 'camping') return;
    
    const time = audioCtx.currentTime;
    const isNight = isNightTime();
    const activeScale = isNight ? nightMelodyScale : dayMelodyScale;
    
    // Generative chord pluck (arpeggiated)
    const baseFreq = activeScale[Math.floor(Math.random() * 4)]; // root notes
    const chordIntervals = [0, 2, 4]; // arpeggiating notes
    
    chordIntervals.forEach((intervalIdx, index) => {
      const freq = activeScale[(activeScale.indexOf(baseFreq) + intervalIdx) % activeScale.length];
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const delayNode = audioCtx.createDelay(1.0);
      const delayGain = audioCtx.createGain();
      
      osc.type = 'triangle'; // triangle has a softer, guitar-like pluck feel
      osc.frequency.setValueAtTime(freq, time + (index * 0.18)); // arpeggiated delay start
      
      // Long spatial echoes
      delayNode.delayTime.setValueAtTime(0.55, time); // 550ms echoes
      delayGain.gain.setValueAtTime(0.38, time); // feedback volume
      
      delayNode.connect(delayGain);
      delayGain.connect(delayNode);
      
      gain.gain.setValueAtTime(0, time + (index * 0.18));
      gain.gain.linearRampToValueAtTime(0.022, time + (index * 0.18) + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + (index * 0.18) + 2.0);
      
      osc.connect(gain);
      connectToOutput(gain);
      
      gain.connect(delayNode);
      connectToOutput(delayNode);
      
      osc.start(time + (index * 0.18));
      osc.stop(time + (index * 0.18) + 2.2);
    });
    
    // Very slow, passive delay for campfire relaxation (5 to 11 seconds)
    const nextInterval = 5000 + Math.random() * 6000;
    audioTimer = setTimeout(triggerMelodyNote, nextInterval);
  }
  
  // Start melody loop after 1.5s
  audioTimer = setTimeout(triggerMelodyNote, 1500);
  synthNodes['camping'] = synthList;
}

// Vibe 3: Skeleton (Hollow Echo Chimes & Desert Wind)
// Vibe 3: Resting (Hollow Echo Chimes & Desert Wind)
function playRestingVibe() {
  const synthList = [];
  
  // 1. Whistling Desert Wind (Modulated Noise)
  const windBuffer = createNoiseBuffer(3.0);
  const windSrc = audioCtx.createBufferSource();
  windSrc.buffer = windBuffer;
  windSrc.loop = true;
  
  const windFilter = audioCtx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.Q.setValueAtTime(5.0, audioCtx.currentTime); // high Q whistling
  
  // LFO to slowly sweep wind frequency
  const windLFO = audioCtx.createOscillator();
  windLFO.type = 'sine';
  windLFO.frequency.setValueAtTime(0.06, audioCtx.currentTime); // slow gusts
  
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.setValueAtTime(140, audioCtx.currentTime); // sweep between 220Hz and 500Hz
  
  windLFO.connect(lfoGain);
  lfoGain.connect(windFilter.frequency);
  
  const windGain = audioCtx.createGain();
  windGain.gain.setValueAtTime(0, audioCtx.currentTime);
  windGain.gain.linearRampToValueAtTime(0.065, audioCtx.currentTime + 3.0); // slow fade in
  
  windSrc.connect(windFilter);
  windFilter.connect(windGain);
  connectToOutput(windGain);
  
  windSrc.start();
  windLFO.start();
  synthList.push(windSrc, windLFO, windGain, windFilter);
  
  // 2. Sub-Bass Hum (Deep hollow tone)
  const subOsc = audioCtx.createOscillator();
  const subGain = audioCtx.createGain();
  
  subOsc.type = 'sine';
  subOsc.frequency.setValueAtTime(48.99, audioCtx.currentTime); // G1 note
  
  subGain.gain.setValueAtTime(0, audioCtx.currentTime);
  subGain.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 4.0);
  
  subOsc.connect(subGain);
  connectToOutput(subGain);
  subOsc.start();
  synthList.push(subOsc, subGain);

  // 3. Hollow Echoing Wind Chimes
  const chimeScale = [587.33, 659.25, 783.99, 880.00, 987.77, 1174.66, 1318.51]; // G Pentatonic high notes
  
  function triggerChime() {
    if (!isMusicPlaying || currentVibe !== 'resting') return;
    
    const time = audioCtx.currentTime;
    const freq = chimeScale[Math.floor(Math.random() * chimeScale.length)];
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const delay = audioCtx.createDelay(1.5);
    const delayFeedback = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    
    // Set feedback echo line
    delay.delayTime.setValueAtTime(0.65, time); // 650ms chime delay
    delayFeedback.gain.setValueAtTime(0.42, time); // echoing feedback
    
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.015, time + 0.02); // quick chime ring
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.2);
    
    osc.connect(gain);
    connectToOutput(gain);
    
    gain.connect(delay);
    connectToOutput(delay);
    
    osc.start(time);
    osc.stop(time + 1.5);
    
    // Next chime in 2 to 5 seconds
    const nextChimeTime = 2000 + Math.random() * 3000;
    audioTimer = setTimeout(triggerChime, nextChimeTime);
  }
  
  // Start chime loop
  audioTimer = setTimeout(triggerChime, 2000);
  
  // 4. Sparse Bird Chirping SFX (loop)
  function triggerBirdChirp() {
    if (!isMusicPlaying || currentVibe !== 'resting') return;
    playSFX('chirp');
    const nextChirp = 8000 + Math.random() * 7000;
    audioTimer = setTimeout(triggerBirdChirp, nextChirp);
  }
  audioTimer = setTimeout(triggerBirdChirp, 3000);
  
  synthNodes['resting'] = synthList;
}

// Vibe 4: Disconnected (Glitchy Static Record Crackle & Radar Ping)
function playDisconnectedVibe() {
  const synthList = [];
  
  // 1. Glitchy Vinyl Static Record Crackle
  function triggerStaticCrackle() {
    if (!isMusicPlaying || currentVibe !== 'disconnected') return;
    
    const time = audioCtx.currentTime;
    
    const pop = audioCtx.createOscillator();
    const popGain = audioCtx.createGain();
    
    pop.type = 'sawtooth';
    pop.frequency.setValueAtTime(100 + Math.random() * 800, time);
    
    popGain.gain.setValueAtTime(0.015, time);
    popGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.01 + Math.random() * 0.03);
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, time);
    filter.Q.setValueAtTime(1.0, time);
    
    pop.connect(filter);
    filter.connect(popGain);
    popGain.connect(audioCtx.destination);
    
    pop.start(time);
    pop.stop(time + 0.08);
    
    // Next crackle pop
    audioTimer = setTimeout(triggerStaticCrackle, 80 + Math.random() * 600);
  }
  
  triggerStaticCrackle();
  
  // 2. Slow Radar/Sonar Ping
  function triggerSonarPing() {
    if (!isMusicPlaying || currentVibe !== 'disconnected') return;
    
    const time = audioCtx.currentTime;
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const delay = audioCtx.createDelay(2.0);
    const delayFeedback = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880.00, time); // high A ping
    
    delay.delayTime.setValueAtTime(0.60, time);
    delayFeedback.gain.setValueAtTime(0.55, time);
    
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.02, time + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.8);
    
    osc.connect(gain);
    connectToOutput(gain);
    
    gain.connect(delay);
    connectToOutput(delay);
    
    osc.start(time);
    osc.stop(time + 1.0);
    
    audioTimer = setTimeout(triggerSonarPing, 4000);
  }
  
  audioTimer = setTimeout(triggerSonarPing, 1000);
  synthNodes['disconnected'] = synthList;
}

// 7. Developer Overrides & Procedural Assets

function triggerOverrideUpdate() {
  // If all overrides are set back to auto, refresh data from the server
  if (devStateOverride === 'auto' && devTimeOverride === 'auto' && devWeatherOverride === 'auto') {
    fetchData();
    return;
  }
  
  if (devStateOverride !== 'auto') {
    currentData.currentState = devStateOverride;
    if (devStateOverride === 'driving') {
      currentData.statusText = "[DEV] Driving down the highway! Lukas and Alexander are on the move.";
    } else if (devStateOverride === 'paddling') {
      currentData.statusText = "[DEV] Paddling upstream. Steady pace.";
    } else if (devStateOverride === 'camping') {
      currentData.statusText = "[DEV] Chilling by the campfire. Roasting marshmallows.";
    } else if (devStateOverride === 'resting') {
      currentData.statusText = "[DEV] Sleeping soundly under the stars. Lukas and Alexander are dreaming.";
    } else {
      currentData.statusText = "[DEV] Out of range. Lukas and Alexander are offline.";
    }
  }
  
  if (devWeatherOverride !== 'auto') {
    currentData.weather = devWeatherOverride;
  }
  
  updateUI();
  updateMap();
  updateAudioVibe(currentData.currentState, true);
}

function isNightTime() {
  if (devTimeOverride === 'night' || devTimeOverride === 'evening' || devTimeOverride === 'latenight') return true;
  if (devTimeOverride === 'day' || devTimeOverride === 'morning' || devTimeOverride === 'afternoon') return false;
  
  const now = new Date();
  let localHour = now.getHours(); // fallback
  
  if (currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    const offsetHours = Math.round(latest.lng / 15.0);
    const localDate = new Date(now.getTime() + (offsetHours * 3600000));
    localHour = localDate.getUTCHours();
  }
  
  return localHour >= 18 || localHour < 6;
}

// Procedural 8-bit SVG Sprite Drawings

function getGoalFlagSVG() {
  return `
    <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Flag pole -->
      <rect x="10" y="4" width="4" height="40" fill="#aaaaaa"/>
      <rect x="8" y="42" width="8" height="2" fill="#888888"/>
      
      <!-- Flag banner (checkerboard retro pattern) -->
      <!-- Row 1 -->
      <rect x="14" y="6" width="6" height="6" fill="#ffffff"/>
      <rect x="20" y="6" width="6" height="6" fill="#000000"/>
      <rect x="26" y="6" width="6" height="6" fill="#ffffff"/>
      <rect x="32" y="6" width="6" height="6" fill="#000000"/>
      <!-- Row 2 -->
      <rect x="14" y="12" width="6" height="6" fill="#000000"/>
      <rect x="20" y="12" width="6" height="6" fill="#ffffff"/>
      <rect x="26" y="12" width="6" height="6" fill="#000000"/>
      <rect x="32" y="12" width="6" height="6" fill="#ffffff"/>
      <!-- Row 3 -->
      <rect x="14" y="18" width="6" height="6" fill="#ffffff"/>
      <rect x="20" y="18" width="6" height="6" fill="#000000"/>
      <rect x="26" y="18" width="6" height="6" fill="#ffffff"/>
      <rect x="32" y="18" width="6" height="6" fill="#000000"/>
      
      <!-- Bottom border glow -->
      <rect x="14" y="24" width="24" height="2" fill="#ff0055"/>
    </svg>
  `;
}

function getCanoeSVG() {
  // Orange-brown wood canoe containing two green NES-style pixel art dinosaurs
  return `
    <svg width="64" height="48" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Lukas (Rear/Left) -->
      <g transform="translate(16, 4)">
        <rect x="6" y="0" width="8" height="6" fill="#39ff14"/>
        <rect x="12" y="2" width="2" height="2" fill="#000"/>
        <rect x="2" y="6" width="10" height="12" fill="#39ff14"/>
        <rect x="4" y="18" width="2" height="4" fill="#32c710"/>
        <rect x="8" y="18" width="2" height="4" fill="#32c710"/>
        <rect x="0" y="10" width="2" height="6" fill="#39ff14"/>
        <rect x="10" y="12" width="4" height="2" fill="#39ff14"/>
      </g>
      <!-- Alexander (Front/Right) -->
      <g transform="translate(28, 6)">
        <rect x="6" y="0" width="8" height="6" fill="#2ad10d"/>
        <rect x="12" y="2" width="2" height="2" fill="#000"/>
        <rect x="2" y="6" width="10" height="12" fill="#2ad10d"/>
        <rect x="4" y="18" width="2" height="4" fill="#209c09"/>
        <rect x="8" y="18" width="2" height="4" fill="#209c09"/>
        <rect x="0" y="10" width="2" height="6" fill="#2ad10d"/>
        <rect x="10" y="12" width="4" height="2" fill="#2ad10d"/>
      </g>
      <!-- Canoe Hull -->
      <path d="M 6,32 C 14,44 50,44 58,32 L 55,26 C 46,30 18,30 9,26 Z" fill="#b05d2e" stroke="#5a2c16" stroke-width="2"/>
      <!-- Oar 1 -->
      <line x1="20" y1="24" x2="10" y2="40" stroke="#ffcc00" stroke-width="3" stroke-linecap="round"/>
      <!-- Oar 2 -->
      <line x1="34" y1="26" x2="24" y2="42" stroke="#ffcc00" stroke-width="3" stroke-linecap="round"/>
      <!-- Water splash pixels -->
      <rect x="3" y="31" width="2" height="2" fill="#00f3ff"/>
      <rect x="59" y="31" width="2" height="2" fill="#00f3ff"/>
    </svg>
  `;
}

function getHatchbackSVG() {
  // Orange-brown wood hatchback with 2 dinos
  return `
    <svg width="64" height="48" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Car body -->
      <path d="M 10,20 L 20,10 L 44,10 L 54,20 L 58,20 L 58,34 L 6,34 L 6,20 Z" fill="#d32f2f" stroke="#b71c1c" stroke-width="2"/>
      <!-- Windows -->
      <path d="M 14,20 L 22,12 L 30,12 L 30,20 Z" fill="#81d4fa" stroke="#4fc3f7" stroke-width="1"/>
      <path d="M 32,20 L 32,12 L 42,12 L 50,20 Z" fill="#81d4fa" stroke="#4fc3f7" stroke-width="1"/>
      <!-- Wheels -->
      <circle cx="16" cy="36" r="6" fill="#212121" stroke="#424242" stroke-width="2"/>
      <circle cx="48" cy="36" r="6" fill="#212121" stroke="#424242" stroke-width="2"/>
      
      <!-- Lukas (Driver) -->
      <g transform="translate(18, 12)">
        <rect x="0" y="0" width="6" height="4" fill="#39ff14"/>
        <rect x="4" y="1" width="1" height="1" fill="#000"/>
        <rect x="-2" y="4" width="8" height="4" fill="#39ff14"/>
      </g>
      <!-- Alexander (Passenger) -->
      <g transform="translate(36, 12)">
        <rect x="0" y="0" width="6" height="4" fill="#2ad10d"/>
        <rect x="4" y="1" width="1" height="1" fill="#000"/>
        <rect x="-2" y="4" width="8" height="4" fill="#2ad10d"/>
      </g>
    </svg>
  `;
}

function getTwoTentsSVG() {
  // Two triangular pixel-art tents next to each other with a glowing campfire (Night Mode)
  return `
    <svg width="72" height="48" viewBox="0 0 72 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Tent 1 (Left/Back) -->
      <g transform="translate(4, 4)">
        <polygon points="24,12 10,36 38,36" fill="#005757" stroke="#002d2d" stroke-width="2"/>
        <polygon points="24,12 24,36 38,36" fill="#008080"/>
        <polygon points="24,22 18,36 30,36" fill="#111"/>
      </g>
      <!-- Tent 2 (Right/Front) -->
      <g transform="translate(20, 8)">
        <polygon points="24,12 10,36 38,36" fill="#007d7d" stroke="#004747" stroke-width="2"/>
        <polygon points="24,12 24,36 38,36" fill="#00acac"/>
        <polygon points="24,22 18,36 30,36" fill="#181818"/>
      </g>
      
      <!-- Campfire -->
      <g transform="translate(18, 34)">
        <line x1="0" y1="4" x2="10" y2="0" stroke="#5c2c16" stroke-width="2.5"/>
        <line x1="1" y1="0" x2="9" y2="4" stroke="#5c2c16" stroke-width="2.5"/>
        <polygon points="5,-9 1,-1 9,-1" fill="#ff3300"/>
        <polygon points="5,-5 3,0 7,0" fill="#ffcc00"/>
      </g>
    </svg>
  `;
}

function getTwoHammocksSVG() {
  // Orange-brown wood hammock between two pixel art palm trees, with 2 lounging green dinos wearing cool sunglasses
  return `
    <svg width="72" height="64" viewBox="0 0 72 64" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Left Palm Tree -->
      <g transform="translate(4, 2)">
        <rect x="7" y="10" width="4" height="40" fill="#8d4a1f"/>
        <rect x="6" y="14" width="2" height="2" fill="#b05d2e"/>
        <rect x="6" y="30" width="2" height="2" fill="#b05d2e"/>
        <!-- Leaves -->
        <polygon points="9,10 0,4 6,7" fill="#1b850a"/>
        <polygon points="9,10 18,4 12,7" fill="#1b850a"/>
        <polygon points="9,10 4,14 8,11" fill="#156407"/>
        <polygon points="9,10 14,14 10,11" fill="#156407"/>
        <polygon points="9,10 9,0 8,6" fill="#22aa0f"/>
      </g>
      
      <!-- Right Palm Tree -->
      <g transform="translate(54, 2)">
        <rect x="7" y="10" width="4" height="40" fill="#8d4a1f"/>
        <rect x="6" y="14" width="2" height="2" fill="#b05d2e"/>
        <rect x="6" y="30" width="2" height="2" fill="#b05d2e"/>
        <!-- Leaves -->
        <polygon points="9,10 0,4 6,7" fill="#1b850a"/>
        <polygon points="9,10 18,4 12,7" fill="#1b850a"/>
        <polygon points="9,10 4,14 8,11" fill="#156407"/>
        <polygon points="9,10 14,14 10,11" fill="#156407"/>
        <polygon points="9,10 9,0 8,6" fill="#22aa0f"/>
      </g>
      
      <!-- Hammock 1 ropes & bed -->
      <line x1="13" y1="20" x2="20" y2="28" stroke="#aa7a1e" stroke-width="2"/>
      <line x1="61" y1="20" x2="54" y2="28" stroke="#aa7a1e" stroke-width="2"/>
      <path d="M 20,28 Q 37,39 54,28" stroke="#d5601a" stroke-width="3" fill="none"/>
      
      <!-- Lounging Green Lukas inside Hammock 1 -->
      <g transform="translate(24, 18)">
        <rect x="0" y="4" width="3" height="6" fill="#39ff14"/>
        <rect x="1" y="8" width="2" height="4" fill="#32c710"/>
        <rect x="2" y="2" width="16" height="8" fill="#39ff14"/>
        <rect x="4" y="6" width="14" height="4" fill="#32c710"/>
        <rect x="14" y="-2" width="7" height="7" fill="#39ff14"/>
        <rect x="16" y="0" width="5" height="2" fill="#000"/>
        <line x1="15" y1="0" x2="16" y2="0" stroke="#000" stroke-width="1"/>
      </g>

      <!-- Hammock 2 ropes & bed -->
      <line x1="13" y1="36" x2="20" y2="44" stroke="#aa7a1e" stroke-width="2"/>
      <line x1="61" y1="36" x2="54" y2="44" stroke="#aa7a1e" stroke-width="2"/>
      <path d="M 20,44 Q 37,55 54,44" stroke="#d5601a" stroke-width="3" fill="none"/>

      <!-- Lounging Green Alexander inside Hammock 2 -->
      <g transform="translate(24, 34)">
        <rect x="0" y="4" width="3" height="6" fill="#2ad10d"/>
        <rect x="1" y="8" width="2" height="4" fill="#209c09"/>
        <rect x="2" y="2" width="16" height="8" fill="#2ad10d"/>
        <rect x="4" y="6" width="14" height="4" fill="#209c09"/>
        <rect x="14" y="-2" width="7" height="7" fill="#2ad10d"/>
        <rect x="16" y="0" width="5" height="2" fill="#000"/>
        <line x1="15" y1="0" x2="16" y2="0" stroke="#000" stroke-width="1"/>
      </g>
    </svg>
  `;
}

function getDisconnectedSVG() {
  // 2 Dinos holding a search flag or looking at a flashing warning antenna pole
  return `
    <svg width="64" height="48" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" style="image-rendering: pixelated; width: 100%; height: 100%;">
      <!-- Lukas standing -->
      <g transform="translate(6, 12)">
        <rect x="6" y="0" width="10" height="8" fill="#39ff14"/>
        <rect x="8" y="2" width="2" height="2" fill="#000"/>
        <rect x="0" y="8" width="12" height="14" fill="#39ff14"/>
        <rect x="2" y="22" width="3" height="4" fill="#32c710"/>
        <rect x="7" y="22" width="3" height="4" fill="#32c710"/>
        <path d="M 0,14 L -4,18 L -4,20 Z" fill="#39ff14"/>
        <rect x="12" y="8" width="2" height="4" fill="#39ff14"/>
        <rect x="10" y="6" width="4" height="2" fill="#39ff14"/>
      </g>
      <!-- Alexander standing -->
      <g transform="translate(24, 16)">
        <rect x="6" y="0" width="8" height="6" fill="#2ad10d"/>
        <rect x="8" y="2" width="2" height="2" fill="#000"/>
        <rect x="0" y="6" width="10" height="12" fill="#2ad10d"/>
        <rect x="2" y="18" width="3" height="4" fill="#209c09"/>
        <rect x="7" y="18" width="3" height="4" fill="#209c09"/>
        <path d="M 0,12 L -4,16 L -4,18 Z" fill="#2ad10d"/>
        <rect x="10" y="6" width="2" height="4" fill="#2ad10d"/>
      </g>
      <!-- Warning Antenna pole -->
      <g transform="translate(46, 14)">
        <rect x="5" y="6" width="2" height="24" fill="#888888"/>
        <rect x="2" y="28" width="8" height="2" fill="#888888"/>
        <path d="M 0,8 C 0,16 12,16 12,8" stroke="#aaaaaa" stroke-width="2.5" fill="none"/>
        <circle cx="6" cy="1" r="3.5" fill="#ff0055" class="flicker-loop"/>
      </g>
    </svg>
  `;
}

// 8. SFX & Weather Modulation Audio Engine

function toggleSFX() {
  const btn = document.getElementById('sfx-toggle');
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!masterFilter) {
    masterFilter = audioCtx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.setValueAtTime(20000, audioCtx.currentTime);
    masterFilter.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  
  if (!isSFXEnabled) {
    isSFXEnabled = true;
    btn.className = 'neon-btn play';
    document.getElementById('sfx-label').textContent = 'SFX: ON';
    playSFX('click');
  } else {
    isSFXEnabled = false;
    btn.className = 'neon-btn mute';
    document.getElementById('sfx-label').textContent = 'SFX: OFF';
  }
}

function playSFX(type, scheduledTime) {
  if (!isSFXEnabled || !audioCtx) return;
  const time = scheduledTime || audioCtx.currentTime;
  
  if (type === 'click') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.08);
    gain.gain.setValueAtTime(0.04, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.1);
  } 
  else if (type === 'paddle') {
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(0.2);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.exponentialRampToValueAtTime(600, time + 0.18);
    filter.Q.setValueAtTime(1.5, time);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.035, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(time);
    noise.stop(time + 0.2);
  } 
  else if (type === 'thunder') {
    const noise = audioCtx.createBufferSource();
    noise.buffer = createNoiseBuffer(1.5);
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, time);
    filter.frequency.linearRampToValueAtTime(30, time + 1.2);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.12, time);
    gain.gain.linearRampToValueAtTime(0.02, time + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.5);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    noise.start(time);
    noise.stop(time + 1.6);
  } 
  else if (type === 'chirp') {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, time);
    osc.frequency.linearRampToValueAtTime(1600, time + 0.04);
    osc.frequency.linearRampToValueAtTime(1200, time + 0.08);
    osc.frequency.linearRampToValueAtTime(1800, time + 0.12);
    gain.gain.setValueAtTime(0.015, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.15);
  }
}

function modulateMusicByWeather() {
  if (!audioCtx || !masterFilter) return;
  const time = audioCtx.currentTime;
  const weather = currentData.weather || 'clear';
  
  let baseFreq = 20000; // default clear
  if (weather === 'cloudy') {
    baseFreq = 1600; // slightly warm/filtered
  } else if (weather === 'rainy') {
    baseFreq = 800; // muffled
  } else if (weather === 'stormy') {
    baseFreq = 480; // very dark/submerged
  } else if (weather === 'snowy') {
    baseFreq = 3500; // crisp
  }
  
  // Latitude modulation: sound gets darker (colder) further north, brighter (warmer) further south
  let latFactor = 1.0;
  if (currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    const lat = latest.lat || 49.0;
    // Map latitude range 40N (warmest) to 60N (coldest) -> scales filter frequency by 1.25 down to 0.45
    latFactor = 1.25 - Math.min(Math.max((lat - 40) / 20.0, 0), 1) * 0.8;
  }
  
  const targetFreq = Math.min(Math.max(baseFreq * latFactor, 200), 20000);
  masterFilter.frequency.setTargetAtTime(targetFreq, time, 1.5); // 1.5s smooth transition glide!
}

