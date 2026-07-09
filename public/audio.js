const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export let isMusicPlaying = false;
export let isSFXEnabled = true;
export let audioCtx = null;
export let masterFilter = null;
export let currentVibe = null; // 'paddling', 'camping', 'resting', 'disconnected'
export let musicMode = isIOS ? 'off' : 'waai'; // Default to OFF on iOS to save cellular data, WAAI on other platforms
let radioAudio = null;
export let currentWeather = null;
export let currentTimeOfDay = null;

export let bgmSynth = null;
export let sfxSynth = null;
export let seGenerator = null;

// Variables updated from the main application
let currentData = null;
let devTimeOverride = 'auto';
let pollIntervalSeconds = 30;

export function setAudioState(data, timeOverride, pollInterval) {
  currentData = data;
  devTimeOverride = timeOverride;
  if (pollInterval) {
    pollIntervalSeconds = pollInterval;
  }
}

let initPromise = null;

export async function initAudioContext() {
  if (initPromise) {
    return initPromise;
  }
  
  initPromise = (async () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    
    if (!masterFilter) {
      masterFilter = audioCtx.createBiquadFilter();
      masterFilter.type = 'lowpass';
      masterFilter.frequency.setValueAtTime(20000, audioCtx.currentTime);
      masterFilter.connect(audioCtx.destination);
    }
    
    if (!bgmSynth) {
      try {
        bgmSynth = new window.AlgoChip.AlgoChipSynthesizer(audioCtx, {
          workletBasePath: './worklets/',
          gainNode: masterFilter // Connect BGM synth through weather filter
        });
        await bgmSynth.init();
        console.log('AlgoChip BGM Synth initialized.');
      } catch (e) {
        console.error('Failed to initialize BGM Synth:', e);
      }
    }
    
    if (!sfxSynth) {
      try {
        sfxSynth = new window.AlgoChip.AlgoChipSynthesizer(audioCtx, {
          workletBasePath: './worklets/' // Connect SFX synth directly to output
        });
        await sfxSynth.init();
        
        seGenerator = new window.AlgoChip.SEGenerator();
        console.log('AlgoChip SFX Synth initialized.');
      } catch (e) {
        console.error('Failed to initialize SFX Synth:', e);
      }
    }
  })();
  
  return initPromise;
}

export async function playStartupChime() {
  await initAudioContext();
  if (seGenerator && sfxSynth) {
    try {
      // Play a beautiful ascending chime
      const se = seGenerator.generateSE({ type: 'powerup' });
      sfxSynth.play(se.events, { volume: 0.5 });
    } catch (e) {
      console.error('Failed to play startup chime:', e);
    }
  }
}

function playRadioStream(mode) {
  if (!radioAudio) {
    radioAudio = new Audio();
    radioAudio.crossOrigin = 'anonymous';
  }
  if (mode === 'waai') {
    radioAudio.src = 'https://ais-sa1.streamon.fm/11200_96k.aac';
  } else if (mode === 'jazz') {
    radioAudio.src = 'https://streams.fluxfm.de/jazzschwarz/mp3-128/';
  } else if (mode === 'folk') {
    radioAudio.src = 'https://freshgrass.streamguys1.com/ss1-128mp3';
  }
  radioAudio.volume = 0.5;
  radioAudio.play().catch(err => {
    console.error(`Failed to play ${mode} stream:`, err);
  });
}

function stopRadioStream() {
  if (radioAudio) {
    radioAudio.pause();
    radioAudio.src = '';
  }
}

export async function startMusicOnSplash() {
  await initAudioContext();
  playStartupChime();
  if (musicMode === 'waai') {
    playRadioStream('waai');
  } else if (musicMode === 'jazz') {
    playRadioStream('jazz');
  } else if (musicMode === 'folk') {
    playRadioStream('folk');
  } else if (musicMode === 'chiptune') {
    isMusicPlaying = true;
    updateAudioVibe(currentData ? currentData.currentState : 'disconnected');
  }
}

export async function toggleMusic() {
  const btn = document.getElementById('music-toggle');
  const label = document.getElementById('music-label');
  await initAudioContext();
  
  if (musicMode === 'waai') {
    // Cycle: WAAI -> CHIPTUNE
    musicMode = 'chiptune';
    isMusicPlaying = true;
    stopRadioStream();
    if (btn) btn.className = 'neon-btn play';
    if (label) label.textContent = 'MUSIC: CHIPTUNE';
    currentVibe = null; // force initialization
    updateAudioVibe(currentData ? currentData.currentState : 'disconnected');
  } else if (musicMode === 'chiptune') {
    // Cycle: CHIPTUNE -> JAZZ
    musicMode = 'jazz';
    isMusicPlaying = false;
    stopAllSynths();
    playRadioStream('jazz');
    if (btn) btn.className = 'neon-btn play';
    if (label) label.textContent = 'MUSIC: JAZZ';
  } else if (musicMode === 'jazz') {
    // Cycle: JAZZ -> FOLK
    musicMode = 'folk';
    isMusicPlaying = false;
    stopAllSynths();
    playRadioStream('folk');
    if (btn) btn.className = 'neon-btn play';
    if (label) label.textContent = 'MUSIC: FOLK';
  } else if (musicMode === 'folk') {
    // Cycle: FOLK -> OFF
    musicMode = 'off';
    isMusicPlaying = false;
    stopAllSynths();
    stopRadioStream();
    if (btn) btn.className = 'neon-btn mute';
    if (label) label.textContent = 'MUSIC: OFF';
  } else {
    // Cycle: OFF -> WAAI
    musicMode = 'waai';
    isMusicPlaying = false;
    stopAllSynths();
    playRadioStream('waai');
    if (btn) btn.className = 'neon-btn play';
    if (label) label.textContent = 'MUSIC: WAAI';
  }
}

export async function toggleSFX() {
  const btn = document.getElementById('sfx-toggle');
  await initAudioContext();
  
  if (!isSFXEnabled) {
    isSFXEnabled = true;
    if (btn) btn.className = 'neon-btn play';
    const label = document.getElementById('sfx-label');
    if (label) label.textContent = 'SFX: ON';
    playSFX('click');
  } else {
    isSFXEnabled = false;
    if (btn) btn.className = 'neon-btn mute';
    const label = document.getElementById('sfx-label');
    if (label) label.textContent = 'SFX: OFF';
  }
}

export function stopAllSynths() {
  if (bgmSynth && bgmSynth.channels) {
    bgmSynth.stop();
  }
  if (sfxSynth && sfxSynth.channels) {
    sfxSynth.stop();
  }
  currentVibe = null;
  currentWeather = null;
  currentTimeOfDay = null;
}

export async function updateAudioVibe(state, forceRestart = false) {
  if (!audioCtx) {
    currentVibe = state;
    return;
  }
  await initAudioContext();
  if (!isMusicPlaying || !bgmSynth) return;
  
  // Calculate current local time of day (morning, afternoon, evening, latenight)
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
  
  const weather = currentData ? (currentData.weather || 'clear') : 'clear';

  // Check if anything has changed
  if (currentVibe === state && currentWeather === weather && currentTimeOfDay === timeOfDay && !forceRestart) {
    return;
  }
  
  if (bgmSynth.channels) {
    bgmSynth.stop();
  }
  
  currentVibe = state;
  currentWeather = weather;
  currentTimeOfDay = timeOfDay;
  
  // 1. Map Activity base style (percussiveMelodic: -1 to 1, calmEnergetic: -1 to 1)
  let activityPercussiveMelodic = 0.2;
  let activityCalmEnergetic = 0.0; // Calmer base (instead of 0.6)
  let length = 32;
  
  if (state === 'paddling') {
    activityPercussiveMelodic = 0.2;
    activityCalmEnergetic = 0.0; // Neutral pace (instead of 0.6)
  } else if (state === 'camping') {
    activityPercussiveMelodic = 0.8; // Very melodic
    activityCalmEnergetic = -0.6; // Much calmer BGM (instead of -0.4)
  } else if (state === 'resting') {
    activityPercussiveMelodic = 0.6; // Minimal melodic notes
    activityCalmEnergetic = -0.9; // Sleepy ambient BGM (instead of -0.8)
  } else {
    // disconnected
    activityPercussiveMelodic = -0.6; // Heavy noise / rhythmic tension
    activityCalmEnergetic = -0.5; // Tense background beat (instead of -0.2)
    length = 16;
  }
  
  // 2. Map Weather modifiers
  let weatherPercussiveMelodicMod = 0.0;
  let weatherCalmEnergeticMod = 0.0;
  if (weather === 'clear') {
    weatherPercussiveMelodicMod = 0.2; // Bright melodies
    weatherCalmEnergeticMod = 0.0; // Neutral (instead of 0.1)
  } else if (weather === 'cloudy') {
    weatherPercussiveMelodicMod = 0.0;
    weatherCalmEnergeticMod = -0.1; // Softer/introspective feel
  } else if (weather === 'rainy') {
    weatherPercussiveMelodicMod = 0.3; // Clean droplets sounds
    weatherCalmEnergeticMod = -0.3; // Gentle flow
  } else if (weather === 'stormy') {
    weatherPercussiveMelodicMod = -0.5; // Heavy noise sweeps / chaotic percussions
    weatherCalmEnergeticMod = 0.2; // Subtle stormy chiptunes (instead of 0.6)
  } else if (weather === 'snowy') {
    weatherPercussiveMelodicMod = 0.4; // Clear crystalline bells
    weatherCalmEnergeticMod = -0.5; // Super quiet flakes atmosphere
  }
  
  // 3. Map Time modifiers
  let timePercussiveMelodicMod = 0.0;
  let timeCalmEnergeticMod = 0.0;
  if (timeOfDay === 'morning') {
    timePercussiveMelodicMod = 0.1;
    timeCalmEnergeticMod = 0.0; // Neutral morning start (instead of 0.2)
  } else if (timeOfDay === 'afternoon') {
    timePercussiveMelodicMod = 0.2;
    timeCalmEnergeticMod = 0.1; // Moderate afternoon pace (instead of 0.4)
  } else if (timeOfDay === 'evening') {
    timePercussiveMelodicMod = 0.3;
    timeCalmEnergeticMod = -0.3; // Golden hour winding down BGM (instead of -0.2)
  } else if (timeOfDay === 'latenight') {
    timePercussiveMelodicMod = 0.1;
    timeCalmEnergeticMod = -0.7; // Deep night ambient chiptunes (instead of -0.6)
  }
  
  // Combine factors and clamp to limits [-1.0, 1.0]
  let percussiveMelodic = activityPercussiveMelodic + weatherPercussiveMelodicMod + timePercussiveMelodicMod;
  let calmEnergetic = activityCalmEnergetic + weatherCalmEnergeticMod + timeCalmEnergeticMod;
  
  // Add GPS velocity-based energy modulation (faster movement speeds up and boosts BGM energy)
  if (currentData && currentData.history && currentData.history.length > 0) {
    const latestPt = currentData.history[currentData.history.length - 1];
    const velocity = latestPt.velocity || 0;
    // Map velocity 0 - 15 km/h to a 0.0 - 0.2 calmEnergetic boost (instead of 0.4)
    const velocityMod = Math.min(velocity / 15.0, 0.2);
    calmEnergetic += velocityMod;
  }
  
  percussiveMelodic = Math.max(-1.0, Math.min(1.0, percussiveMelodic));
  calmEnergetic = Math.max(-1.0, Math.min(1.0, calmEnergetic));
  
  // Make the seed depend on coordinate longitude/latitude to dynamically shift BGM over time!
  let seed = 12345;
  if (currentData && currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    seed = Math.floor(Math.abs(latest.lat * 100) + Math.abs(latest.lng * 100));
  }
  
  try {
    const bgm = await window.AlgoChip.generateComposition({
      seed: seed,
      lengthInMeasures: length,
      twoAxisStyle: {
        percussiveMelodic: percussiveMelodic,
        calmEnergetic: calmEnergetic
      }
    });
    
    // Double check that we are still in the same vibe and music is still playing
    if (isMusicPlaying && currentVibe === state && currentWeather === weather && currentTimeOfDay === timeOfDay && bgmSynth.channels) {
      bgmSynth.playLoop(bgm.events, { volume: 0.35 });
    }
  } catch (e) {
    console.error('Failed to generate composition:', e);
  }
}

export function playSFX(type) {
  if (!isSFXEnabled || !sfxSynth || !seGenerator || !sfxSynth.channels) return;
  
  let seType = 'click';
  if (type === 'click') {
    seType = 'click';
  } else if (type === 'paddle') {
    seType = 'select';
  } else if (type === 'thunder') {
    seType = 'explosion';
  } else if (type === 'chirp') {
    seType = 'coin';
  }
  
  try {
    const se = seGenerator.generateSE({ type: seType });
    sfxSynth.play(se.events, { volume: 0.4 });
  } catch (e) {
    console.error('Failed to play SFX:', e);
  }
}

export function modulateMusicByWeather() {
  if (!audioCtx || !masterFilter || !currentData) return;
  const time = audioCtx.currentTime;
  const weather = currentData.weather || 'clear';
  
  let baseFreq = 20000; // default clear
  if (weather === 'cloudy') {
    baseFreq = 1600; // slightly filtered
  } else if (weather === 'rainy') {
    baseFreq = 800; // muffled
  } else if (weather === 'stormy') {
    baseFreq = 480; // very dark/submerged
  } else if (weather === 'snowy') {
    baseFreq = 3500; // crisp
  }
  
  let latFactor = 1.0;
  if (currentData.history && currentData.history.length > 0) {
    const latest = currentData.history[currentData.history.length - 1];
    const lat = latest.lat || 49.0;
    // Map latitude range 40N (warmest) to 60N (coldest)
    latFactor = 1.25 - Math.min(Math.max((lat - 40) / 20.0, 0), 1) * 0.8;
  }
  
  const targetFreq = Math.min(Math.max(baseFreq * latFactor, 200), 20000);
  masterFilter.frequency.setTargetAtTime(targetFreq, time, 1.5);
}
