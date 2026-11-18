// audio.js — WebAudio synth-only sound for Solmara. No audio files, no
// network. The AudioContext is created lazily on the first user gesture
// (any sound method counts as a gesture entry point); every method is a
// safe no-op until the context exists, so calling sound before the first
// gesture never throws.
// createAudio() -> { engine(speed01, on), siren(on), shot(), punch(),
// pickup(), sting(), click(), resume(), setMuted(b), muted }.
export function createAudio() {
  let ctx = null;
  let master = null;
  let engineOsc = null;
  let engineOsc2 = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = null;
  let sirenHigh = false;
  let mutedFlag = false;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = typeof window !== 'undefined'
        ? (window.AudioContext || window.webkitAudioContext)
        : null;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = mutedFlag ? 0 : 0.5;
      master.connect(ctx.destination);
      return true;
    } catch {
      ctx = null;
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function blip(freq, dur, type, vol, when = 0, slideTo = null) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function burst(dur, vol, filterFreq) {
    if (!ensure()) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  function ensureEngine() {
    if (engineOsc) return true;
    if (!ensure()) return false;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineOsc2.frequency.value = 28;
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();
    return true;
  }

  function ensureSiren() {
    if (sirenOsc) return true;
    if (!ensure()) return false;
    sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 700;
    sirenGain = ctx.createGain();
    sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(master);
    sirenOsc.start();
    sirenTimer = setInterval(() => {
      if (!sirenOsc) return;
      sirenHigh = !sirenHigh;
      sirenOsc.frequency.setTargetAtTime(sirenHigh ? 950 : 700, ctx.currentTime, 0.03);
    }, 380);
    return true;
  }

  const api = {
    get muted() { return mutedFlag; },

    resume() { ensure(); },

    // Continuous engine hum. speed01 0..1 scales pitch; on=false fades out.
    engine(speed01 = 0, on = true) {
      if (!on) {
        if (engineGain && ctx) engineGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        return;
      }
      if (!ensureEngine()) return;
      const s = Math.max(0, Math.min(1, speed01));
      engineOsc.frequency.setTargetAtTime(55 + s * 165, ctx.currentTime, 0.08);
      engineOsc2.frequency.setTargetAtTime(28 + s * 80, ctx.currentTime, 0.08);
      engineFilter.frequency.setTargetAtTime(380 + s * 900, ctx.currentTime, 0.1);
      engineGain.gain.setTargetAtTime(0.05 + s * 0.06, ctx.currentTime, 0.1);
    },

    // Two-tone police siren while on.
    siren(on) {
      if (!on) {
        if (sirenGain && ctx) sirenGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        return;
      }
      if (!ensureSiren()) return;
      sirenGain.gain.setTargetAtTime(0.045, ctx.currentTime, 0.15);
    },

    shot() {
      if (!ensure()) return;
      burst(0.16, 0.5, 2800);
      blip(160, 0.08, 'square', 0.18, 0, 60);
    },

    punch() {
      if (!ensure()) return;
      blip(110, 0.12, 'sine', 0.5, 0, 45);
      burst(0.07, 0.25, 500);
    },

    pickup() {
      blip(880, 0.12, 'sine', 0.3);
      blip(1318, 0.2, 'sine', 0.3, 0.09);
    },

    // Short mission-complete fanfare.
    sting() {
      blip(523, 0.14, 'triangle', 0.32);
      blip(659, 0.14, 'triangle', 0.32, 0.12);
      blip(784, 0.16, 'triangle', 0.32, 0.24);
      blip(1047, 0.34, 'triangle', 0.36, 0.36);
    },

    click() {
      blip(1200, 0.05, 'square', 0.12);
    },

    setMuted(b) {
      mutedFlag = !!b;
      if (master && ctx) master.gain.setTargetAtTime(mutedFlag ? 0 : 0.5, ctx.currentTime, 0.02);
    },
  };

  return api;
}
