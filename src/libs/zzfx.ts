// ZzFX - Zuper Zmall Zound Zynth - Micro Edition
// MIT License - Copyright 2019 Frank Force
// https://github.com/KilledByAPixel/ZzFX

// ZzFX parameters interface
export interface ZzfxParams {
  volume?: number;
  randomness?: number;
  frequency?: number;
  attack?: number;
  sustain?: number;
  release?: number;
  shape?: number;
  shapeCurve?: number;
  slide?: number;
  deltaSlide?: number;
  pitchJump?: number;
  pitchJumpTime?: number;
  repeatTime?: number;
  noise?: number;
  modulation?: number;
  bitCrush?: number;
  delay?: number;
  sustainVolume?: number;
  decay?: number;
  tremolo?: number;
}

let zzfxV = 0.3; // volume
const zzfxR = 44100; // sample rate
let zzfxX: AudioContext | null = null;

const getAudioContext = (): AudioContext => {
  if (!zzfxX) {
    zzfxX = new AudioContext();
  }
  return zzfxX;
};

/** Generate samples from parameters */
const zzfxG = (
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0
): Float32Array => {
  // init parameters
  const PI2 = Math.PI * 2;
  const sign = (v: number) => (v > 0 ? 1 : -1);
  const startSlide = (slide *= 500 * PI2 / zzfxR / zzfxR);
  let startFrequency =
    (frequency *= (1 + randomness * 2 * Math.random() - randomness) * PI2 / zzfxR);
  let b: number[] = [];
  let t = 0;
  let tm = 0;
  let i = 0;
  let j = 1;
  let r = 0;
  let c = 0;
  let s = 0;
  let f: number;
  let length: number;

  // scale by sample rate
  attack = attack * zzfxR + 9; // minimum attack to prevent pop
  decay *= zzfxR;
  sustain *= zzfxR;
  release *= zzfxR;
  delay *= zzfxR;
  deltaSlide *= (500 * PI2) / zzfxR ** 3;
  modulation *= PI2 / zzfxR;
  pitchJump *= PI2 / zzfxR;
  pitchJumpTime *= zzfxR;
  repeatTime = (repeatTime * zzfxR) | 0;

  // generate waveform
  for (
    length = (attack + decay + sustain + release + delay) | 0;
    i < length;
    b[i++] = s
  ) {
    if (!(++c % ((bitCrush * 100) | 0))) {
      // bit crush
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? // 4 noise
                Math.sin((t % PI2) ** 3)
              : // 3 tan
                Math.max(Math.min(Math.tan(t), 1), -1)
            : // 2 saw
              1 - ((2 * t) / PI2 % 2 + 2) % 2
          : // 1 triangle
            1 - 4 * Math.abs(Math.round(t / PI2) - t / PI2)
        : // 0 sin
          Math.sin(t);

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        sign(s) *
        Math.abs(s) ** shapeCurve *
        volume *
        zzfxV *
        // envelope
        (i < attack
          ? i / attack // attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume) // decay falloff
            : i < attack + decay + sustain
              ? sustainVolume // sustain volume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume // release falloff
                : 0); // post release

      s = delay
        ? s / 2 +
          (delay > i
            ? 0 // sample delay
            : (i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0] / 2) // release delay
        : s;
    }

    f =
      (frequency += (slide += deltaSlide)) * // frequency
      Math.cos(modulation * tm++); // modulation
    t += f - f * noise * (1 - ((Math.sin(i) + 1) * 1e9) % 2); // noise

    if (j && ++j > pitchJumpTime) {
      // pitch jump
      frequency += pitchJump; // apply pitch jump
      startFrequency += pitchJump; // also apply to start
      j = 0; // reset pitch jump time
    }

    if (repeatTime && !(++r % repeatTime)) {
      // repeat
      frequency = startFrequency; // reset frequency
      slide = startSlide; // reset slide
      j = j || 1; // reset pitch jump time
    }
  }

  return new Float32Array(b);
};

/** Play samples */
const zzfxP = (...samples: Float32Array[]): AudioBufferSourceNode => {
  const audioCtx = getAudioContext();
  // create buffer and source
  const buffer = audioCtx.createBuffer(samples.length, samples[0].length, zzfxR);
  const source = audioCtx.createBufferSource();

  // copy samples to buffer and play
  samples.forEach((d, i) => buffer.getChannelData(i).set(d));
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start();
  return source;
};

/** Generate and play sound */
const zzfx = (...parameters: any[]): AudioBufferSourceNode => {
  return zzfxP(zzfxG(...parameters));
};

export { zzfx, zzfxP, zzfxG };
export default zzfx;