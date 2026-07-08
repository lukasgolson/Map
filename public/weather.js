import { playSFX } from './audio.js';

const canvas = document.getElementById('weather-canvas');
const ctx = canvas.getContext('2d');

let particles = [];
let animationFrameId = null;

let lastLightningTime = 0;
let lightningFlashIntensity = 0;

// Variables updated from the main application
let map = null;
let avatarMarker = null;
let currentData = null;
let devTimeOverride = 'auto';

export function setWeatherState(mapObj, markerObj, data, timeOverride) {
  map = mapObj;
  avatarMarker = markerObj;
  currentData = data;
  devTimeOverride = timeOverride;
}

function isNightTime() {
  if (devTimeOverride === 'night' || devTimeOverride === 'evening' || devTimeOverride === 'latenight') return true;
  if (devTimeOverride === 'day' || devTimeOverride === 'morning' || devTimeOverride === 'afternoon') return false;
  
  const now = new Date();
  let localHour = now.getHours();
  
  if (currentData && currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    const offsetHours = Math.round(latest.lng / 15.0);
    const localDate = new Date(now.getTime() + (offsetHours * 3600000));
    localHour = localDate.getUTCHours();
  }
  
  return localHour >= 18 || localHour < 6;
}

export function resizeCanvas() {
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
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
  
  update(markerPos, windX = 0, windY = 0) {
    if (this.type === 'smoke') {
      this.x += this.speedX;
      this.y += this.speedY;
      this.alpha -= this.fade;
      if (this.alpha <= 0) {
        if (markerPos) {
          this.reset(markerPos.x, markerPos.y);
        } else {
          this.alpha = 0;
        }
      }
    } else {
      this.x += (this.speedX + windX);
      this.y += (this.speedY + windY);
      
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
      ctx.fillRect(this.x, this.y, this.size, 10);
      ctx.fillRect(this.x + 10, this.y - 6, this.size - 20, 6);
      ctx.fillRect(this.x + 20, this.y + 10, this.size - 30, 4);
    }
  }
}

export function animateParticles() {
  if (!canvas || !currentData) {
    animationFrameId = requestAnimationFrame(animateParticles);
    return;
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  let markerScreenPos = null;
  if (avatarMarker && map) {
    const latlng = avatarMarker.getLatLng();
    markerScreenPos = map.latLngToContainerPoint(latlng);
  }
  
  const targetCount = { rain: 0, snow: 0, smoke: 0, cloud: 0 };
  
  if (currentData.weather === 'rainy' || currentData.weather === 'stormy') {
    targetCount.rain = currentData.weather === 'stormy' ? 120 : 60;
  } else if (currentData.weather === 'snowy') {
    targetCount.snow = 50;
  } else if (currentData.weather === 'cloudy') {
    targetCount.cloud = 3;
  }
  
  const isNight = isNightTime();
  if (currentData.currentState === 'camping' && isNight) {
    targetCount.smoke = 25;
  }
  
  updateParticlePool('rain', targetCount.rain);
  updateParticlePool('snow', targetCount.snow);
  updateParticlePool('cloud', targetCount.cloud);
  
  if (currentData.currentState === 'camping' && isNight && markerScreenPos) {
    updateParticlePool('smoke', targetCount.smoke, markerScreenPos.x, markerScreenPos.y);
  } else {
    particles = particles.filter(p => p.type !== 'smoke');
  }
  
  if (currentData.weather === 'stormy') {
    const now = Date.now();
    if (now - lastLightningTime > 15000 && Math.random() < 0.001) {
      lastLightningTime = now;
      lightningFlashIntensity = 0.85;
      
      const delay = 600 + Math.random() * 1200;
      setTimeout(() => {
        playSFX('thunder');
      }, delay);
    }
  }
  
  if (lightningFlashIntensity > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${lightningFlashIntensity})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    lightningFlashIntensity -= 0.08;
  }
  
  // Calculate relative wind vectors from GPS heading & velocity (dino movement headwind)
  let windX = 0;
  let windY = 0;
  if (currentData && currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    const velocity = latestPt.velocity || 0;
    const heading = latestPt.heading || 0;
    
    // Scale velocity down (10 km/h corresponds to a wind shift of ~1.5px per frame)
    const relativeSpeed = (velocity / 10.0) * 1.5;
    const headingRad = (heading * Math.PI) / 180.0;
    
    // Dinosaur moving vector
    const dinoVx = Math.sin(headingRad) * relativeSpeed;
    const dinoVy = -Math.cos(headingRad) * relativeSpeed;
    
    // Headwind is opposite of movement
    windX = -dinoVx;
    windY = -dinoVy;
    
    // Add baseline coordinate wind (e.g. planetary wind based on longitude)
    const baselineWind = Math.sin(latestPt.lng * 2.0) * 0.8;
    windX += baselineWind;
  }

  particles.forEach(p => {
    p.update(markerScreenPos, windX, windY);
    p.draw();
  });
  
  animationFrameId = requestAnimationFrame(animateParticles);
}

function updateParticlePool(type, targetAmt, spawnX, spawnY) {
  const currentCount = particles.filter(p => p.type === type).length;
  
  if (currentCount < targetAmt) {
    for (let i = 0; i < (targetAmt - currentCount); i++) {
      particles.push(new Particle(type, spawnX, spawnY));
    }
  } else if (currentCount > targetAmt) {
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
