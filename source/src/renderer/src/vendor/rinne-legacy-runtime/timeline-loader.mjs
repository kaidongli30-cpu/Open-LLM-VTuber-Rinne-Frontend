import { sha256Hex } from "./bundle-loader.mjs";

const FORMAT = "rinne-legacy-gpu-resident-timeline";
const VERSION = 1;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const DATA_MAX_BYTES = 64 * 1024 * 1024;
const UINT32_MAX = 0xffffffff;
const INT32_MAX = 0x7fffffff;
const BLINK_RAND_MAX = 32767;
const CAPABILITIES = [
  "amb_playback",
  "automatic_blink",
  "automatic_breath",
  "baseline_expression",
  "live_mouth",
];
const COMPOSITION_ORDER = [
  "automatic_breath",
  "amb_baseline_composition",
  "automatic_blink",
  "live_mouth",
  "gpu_coefficient_easing",
];
const SPEECH_INDICES = [5, 6, 7];
const BLINK_BASE_WEIGHTS = Float32Array.from([1, 0.7, 0.49, 0.343]);
const ACCEPTANCE_TIMES = [0, 33, 80, 160, 333, 1000, 2000, 3007, 3087, 3167];
const ACCEPTANCE_RANDOM_VALUES = [0, 0, 0, 32767, 1, 5];

function acceptanceControls(expressionCount) {
  const expressions = Array(expressionCount).fill(0);
  for (const [index, value] of [
    [0, 0.2],
    [1, 0.3],
    [8, 0.15],
  ]) {
    if (index < expressionCount) expressions[index] = value;
  }
  return {
    expression_weights: expressions,
    mouth_scale: 0.75,
    mouth_gains: [0.1, 0.2, 0.3],
    right_eye_close: 0.1,
    left_eye_close: 0.25,
    neck_rotation: [1, -0.5, 0.25],
    neck_translation: [0.01, -0.005, 0.0025],
    right_pupil_position: [-0.2, 0.1],
    left_pupil_position: [0.15, -0.05],
    type2_intensity: 0.8,
  };
}

function fail(message) {
  throw new Error(`invalid Rinne GPU timeline: ${message}`);
}

function ownBytes(value, label, maximum) {
  let view;
  if (value instanceof ArrayBuffer) {
    view = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    fail(`${label} is not binary data`);
  }
  if (view.byteLength <= 0 || view.byteLength > maximum) {
    fail(`${label} exceeds its size limit`);
  }
  return Uint8Array.from(view);
}

function objectValue(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function equalJson(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    );
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      equalJson(leftKeys, rightKeys) &&
      leftKeys.every((key) => equalJson(left[key], right[key]))
    );
  }
  return false;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer`);
  }
  return value;
}

function finitePositive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${label} must be finite and positive`);
  }
  return value;
}

function f32(value) {
  const result = Math.fround(value);
  if (!Number.isFinite(result)) {
    throw new Error("Rinne timeline value is outside float32 range");
  }
  return result;
}

function f32Add(left, right) {
  return f32(f32(left) + f32(right));
}

function f32Subtract(left, right) {
  return f32(f32(left) - f32(right));
}

function f32Multiply(left, right) {
  return f32(f32(left) * f32(right));
}

function f32Divide(left, right) {
  const divisor = f32(right);
  if (divisor === 0) {
    throw new Error("Rinne timeline divisor must be nonzero");
  }
  return f32(f32(left) / divisor);
}

function checkedU32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new Error(`Rinne timeline ${label} must be uint32`);
  }
  return value;
}

function signedU32Difference(left, right) {
  const value = (left - right) >>> 0;
  return value > INT32_MAX ? value - 0x100000000 : value;
}

function checkedFiniteArray(input, length, label) {
  if (
    (!ArrayBuffer.isView(input) && !Array.isArray(input)) ||
    input.length !== length
  ) {
    throw new Error(`Rinne timeline ${label} must contain ${length} values`);
  }
  const output = Float32Array.from(input, (value) => Number(value));
  if (Array.from(output).some((value) => !Number.isFinite(value))) {
    throw new Error(`Rinne timeline ${label} must be finite`);
  }
  return output;
}

function checkedUnit(value, label) {
  const result = f32(Number(value));
  if (result < 0 || result > 1) {
    throw new Error(`Rinne timeline ${label} must be within 0..1`);
  }
  return result;
}

function clampUnit(value) {
  const result = f32(value);
  return result <= 0 ? 0 : result >= 1 ? 1 : result;
}

function easeExpression(value, mode) {
  let result = f32(value);
  if (mode === "cosine_ease_then_threshold_0_01") {
    if (result <= 0) {
      result = 0;
    } else if (result >= 1) {
      result = 1;
    } else {
      result = f32((1 - Math.cos(Math.PI * result)) * 0.5);
    }
  }
  return result >= f32(0.01) ? result : 0;
}

function blinkEase01(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  const input = f32(value);
  const degrees = f32Subtract(f32Multiply(input, 180), 90);
  const radians = f32Divide(f32Multiply(degrees, 3.1415927410125732), 180);
  return f32Add(f32Multiply(f32(Math.sin(radians)), 0.5), 0.5);
}

function blinkDecay(index) {
  let ratio = f32Divide(f32(index), 400);
  ratio = f32Divide(ratio, 0.30000001192092896);
  const exponent = f32(-f32Multiply(ratio, ratio));
  return f32(Math.exp(exponent));
}

function blinkCurveValue(blinkType, index) {
  if (blinkType === 0) {
    if (index < 80) return blinkEase01(f32Divide(index, 80));
    if (index < 90) return 1;
    if (index < 490) return blinkDecay(index - 90);
    return 0;
  }
  if (blinkType === 1) {
    if (index < 100) {
      return f32Multiply(
        blinkEase01(f32Divide(index, 100)),
        0.4000000059604645,
      );
    }
    if (index < 400) return f32(0.4000000059604645);
    if (index < 500) {
      const eased = blinkEase01(f32Divide(index - 400, 100));
      return f32Multiply(f32Subtract(1, eased), 0.4000000059604645);
    }
    return 0;
  }
  if (blinkType === 2) {
    if (index < 80) {
      return f32Multiply(blinkEase01(f32Divide(index, 80)), 0.699999988079071);
    }
    if (index < 160) {
      const eased = blinkEase01(f32Divide(index - 80, 80));
      return f32Multiply(f32Subtract(1, eased), 0.699999988079071);
    }
    if (index < 240) {
      return f32Multiply(
        blinkEase01(f32Divide(index - 160, 80)),
        0.800000011920929,
      );
    }
    if (index < 250) return f32(0.800000011920929);
    if (index < 650) {
      return f32Multiply(blinkDecay(index - 250), 0.800000011920929);
    }
    return 0;
  }
  throw new Error("Rinne timeline blink type must be within 0..2");
}

const BLINK_CURVES = Array.from({ length: 3 }, (_, blinkType) =>
  Float32Array.from({ length: 1024 }, (_, index) =>
    blinkCurveValue(blinkType, index),
  ),
);

function normalizedBlinkIndex(blinkType, elapsed) {
  let result = elapsed;
  if (blinkType === 1) {
    if (result > 1000) result -= 800;
    else if (result > 200) return 200;
  }
  return Math.min(1023, Math.max(0, result));
}

function sampleBlinkGeometry(
  blinkType,
  currentElapsed,
  previousElapsed,
  singleBlinkGain,
  floor,
) {
  const current = normalizedBlinkIndex(blinkType, currentElapsed);
  const previous = normalizedBlinkIndex(blinkType, previousElapsed);
  const delta = current - previous;
  const gain = blinkType === 0 ? f32(singleBlinkGain) : 1;
  const floorValue = f32(floor);
  const deformation = new Float32Array(4);
  for (let sample = 1; sample <= 4; sample += 1) {
    const curveIndex = previous + Math.trunc((sample * delta) / 4);
    deformation[sample - 1] = Math.max(
      floorValue,
      f32Multiply(BLINK_CURVES[blinkType][curveIndex], gain),
    );
  }
  return { deformation, baseWeights: BLINK_BASE_WEIGHTS };
}

function nextRandom(randomInt) {
  const value = randomInt();
  if (!Number.isSafeInteger(value) || value < 0 || value > BLINK_RAND_MAX) {
    throw new Error("Rinne timeline random source must return 0..32767");
  }
  return value;
}

export async function validateRinneGpuTimelineBundle(
  input,
  runtimeBundle,
  dynamicBundle,
  { preverified = false } = {},
) {
  if (typeof preverified !== "boolean") {
    fail("preverified option must be boolean");
  }
  if (
    runtimeBundle === null ||
    typeof runtimeBundle !== "object" ||
    !(runtimeBundle.manifestBytes instanceof Uint8Array)
  ) {
    fail("validated runtime-control bundle is required");
  }
  if (
    dynamicBundle === null ||
    typeof dynamicBundle !== "object" ||
    !Array.isArray(dynamicBundle.manifest.deformation.controls)
  ) {
    fail("validated linear-dynamic bundle is required");
  }
  const manifestBytes = ownBytes(
    input.timelineManifestJson,
    "manifest",
    MANIFEST_MAX_BYTES,
  );
  const channelBytes = ownBytes(
    input.ambChannelsF32,
    "AMB data",
    DATA_MAX_BYTES,
  );
  let manifest;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    );
  } catch (error) {
    fail(`manifest is not valid UTF-8 JSON: ${error.message}`);
  }
  objectValue(manifest, "manifest root");
  if (
    manifest.format !== FORMAT ||
    manifest.version !== VERSION ||
    !equalJson(manifest.capabilities, CAPABILITIES)
  ) {
    fail("format or capabilities are invalid");
  }
  const parent = objectValue(
    manifest.runtime_bundle,
    "runtime bundle identity",
  );
  if (
    (!preverified &&
      parent.manifest_sha256 !==
        (await sha256Hex(runtimeBundle.manifestBytes))) ||
    parent.base_topology_sha256 !==
      runtimeBundle.manifest.eye_bundle.base_topology_sha256
  ) {
    fail("runtime-bundle identity is inconsistent");
  }
  if (
    !equalJson(manifest.clock, {
      unit: "uint32_milliseconds",
      amb_divisor: 1000,
      caller_controls_loop: true,
    })
  ) {
    fail("clock contract is invalid");
  }
  const amb = objectValue(manifest.amb, "AMB contract");
  const channelCount = positiveInteger(amb.channel_count, "channel count");
  const expressionCount = positiveInteger(
    amb.expression_channel_count,
    "expression channel count",
  );
  const auxiliaryCount = positiveInteger(
    amb.auxiliary_channel_count,
    "auxiliary channel count",
  );
  const frameCount = positiveInteger(amb.frame_count, "frame count");
  const rate = finitePositive(amb.rate, "AMB rate");
  const expectedGroups = {
    core: [0, 12],
    expression: [12, 12 + expressionCount],
    auxiliary: [12 + expressionCount, 12 + expressionCount + auxiliaryCount],
    trailing_triplet: [
      12 + expressionCount + auxiliaryCount,
      15 + expressionCount + auxiliaryCount,
    ],
    extended: [15 + expressionCount + auxiliaryCount, channelCount],
  };
  if (
    amb.file !== "amb-channels.f32" ||
    amb.format !== "channel_major_float32_little_endian" ||
    amb.byte_length !== channelBytes.byteLength ||
    channelBytes.byteLength !== channelCount * frameCount * 4 ||
    (!preverified && amb.sha256 !== (await sha256Hex(channelBytes))) ||
    channelCount !== expressionCount + auxiliaryCount + 29 ||
    expressionCount !==
      dynamicBundle.manifest.deformation.controls.length - 4 ||
    auxiliaryCount !== runtimeBundle.manifest.opacity.record_count ||
    !Number.isSafeInteger(amb.runtime_loop_start) ||
    !Number.isSafeInteger(amb.runtime_loop_end) ||
    amb.runtime_loop_start < 0 ||
    amb.runtime_loop_end < amb.runtime_loop_start ||
    amb.runtime_loop_end >= frameCount ||
    !equalJson(amb.groups, expectedGroups) ||
    amb.discrete_selector_count !== 10 ||
    amb.selectors_all_zero !== true ||
    amb.continuous_interpolation !== "legacy_float32_linear" ||
    amb.discrete_selection !== "following_frame_when_fraction_at_least_half"
  ) {
    fail("AMB contract is inconsistent");
  }
  const littleEndian =
    new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
  if (!littleEndian || channelBytes.byteOffset % 4 !== 0) {
    fail("host float32 layout is unsupported");
  }
  const channelFloats = new Float32Array(channelBytes.buffer);
  if (Array.from(channelFloats).some((value) => !Number.isFinite(value))) {
    fail("AMB data contains a non-finite value");
  }
  for (let selector = 0; selector < 10; selector += 1) {
    const channel = expectedGroups.extended[0] + selector;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const offset = (channel * frameCount + frame) * 4;
      if (new DataView(channelBytes.buffer).getUint32(offset, true) !== 0) {
        fail("selector channel is nonzero");
      }
    }
  }
  const automatic = objectValue(manifest.automatic, "automatic config");
  const blink = objectValue(automatic.blink, "blink config");
  const breath = objectValue(automatic.breath, "breath config");
  if (
    automatic.source_member !== "face.uca.bin" ||
    !Number.isSafeInteger(blink.enabled) ||
    blink.enabled < 0 ||
    !Number.isFinite(blink.duration_factor) ||
    blink.duration_factor <= 0 ||
    !Array.isArray(blink.frequencies) ||
    blink.frequencies.length !== 3 ||
    blink.frequencies.some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    blink.frequencies.reduce((left, right) => left + right, 0) <= 0 ||
    blink.random_contract !== "inclusive_integer_0_to_32767_three_draw_cycle" ||
    !Number.isSafeInteger(breath.enabled) ||
    breath.enabled < 0 ||
    !Number.isFinite(breath.duration_factor) ||
    breath.duration_factor <= 0 ||
    breath.expression_index !== 4 ||
    breath.initial_phase_degrees !== -90 ||
    breath.phase_step_degrees !== 3.5 ||
    breath.clock_divisor_milliseconds !== 30
  ) {
    fail("automatic config is invalid");
  }
  if (
    !equalJson(manifest.composition, {
      order: COMPOSITION_ORDER,
      speech_expression_indices: SPEECH_INDICES,
      pupil_x_scale: 0.1,
      pupil_y_scale: 0.05,
      extended_baseline_gain_indices: {
        pupil: 0,
        eye: 1,
        pose: 2,
        expression: 3,
      },
    })
  ) {
    fail("composition contract is invalid");
  }
  if (
    !equalJson(manifest.acceptance_sequence, {
      start_time: 0,
      loop: true,
      blink_floor: 0,
      times: ACCEPTANCE_TIMES,
      random_values: ACCEPTANCE_RANDOM_VALUES,
      base_controls: acceptanceControls(expressionCount),
      final_time: ACCEPTANCE_TIMES.at(-1),
    })
  ) {
    fail("acceptance sequence is invalid");
  }
  return {
    manifest,
    manifestBytes,
    channelBytes,
    channelFloats,
    frameCount,
    channelCount,
    expressionCount,
    auxiliaryCount,
    rate,
  };
}

function acceptanceInputControls(raw) {
  return {
    expressionWeights: raw.expression_weights,
    mouthScale: raw.mouth_scale,
    mouthGains: raw.mouth_gains,
    rightEyeClose: raw.right_eye_close,
    leftEyeClose: raw.left_eye_close,
    neckRotation: raw.neck_rotation,
    neckTranslation: raw.neck_translation,
    rightPupilPosition: raw.right_pupil_position,
    leftPupilPosition: raw.left_pupil_position,
    type2Intensity: raw.type2_intensity,
  };
}

export function createRinneGpuTimelineAcceptanceRuntime(
  timelineBundle,
  dynamicBundle,
  runtimeBundle,
) {
  const acceptance = timelineBundle.manifest.acceptance_sequence;
  let randomCursor = 0;
  const runtime = new RinneGpuResidentTimeline(
    timelineBundle,
    dynamicBundle,
    runtimeBundle,
    {
      startTime: acceptance.start_time,
      loop: acceptance.loop,
      blinkFloor: acceptance.blink_floor,
      randomInt: () => {
        if (randomCursor >= acceptance.random_values.length) {
          throw new Error(
            "Rinne timeline acceptance random stream is exhausted",
          );
        }
        const value = acceptance.random_values[randomCursor];
        randomCursor += 1;
        return value;
      },
    },
  );
  return {
    runtime,
    times: [...acceptance.times],
    controls: acceptanceInputControls(acceptance.base_controls),
    randomValues: [...acceptance.random_values],
  };
}

export class RinneGpuResidentTimeline {
  constructor(
    timelineBundle,
    dynamicBundle,
    runtimeBundle,
    {
      startTime = 0,
      loop = true,
      blinkFloor = 0,
      randomInt = () => Math.floor(Math.random() * (BLINK_RAND_MAX + 1)),
    } = {},
  ) {
    if (
      timelineBundle === null ||
      typeof timelineBundle !== "object" ||
      !(timelineBundle.channelFloats instanceof Float32Array)
    ) {
      throw new TypeError(
        "Rinne resident timeline requires a validated bundle",
      );
    }
    if (
      dynamicBundle === null ||
      typeof dynamicBundle !== "object" ||
      !Array.isArray(dynamicBundle.manifest?.deformation?.controls)
    ) {
      throw new TypeError("Rinne resident timeline requires linear dynamics");
    }
    if (
      runtimeBundle === null ||
      typeof runtimeBundle !== "object" ||
      !Array.isArray(runtimeBundle.manifest?.opacity?.records)
    ) {
      throw new TypeError("Rinne resident timeline requires runtime controls");
    }
    if (typeof randomInt !== "function") {
      throw new TypeError("Rinne timeline random source must be callable");
    }
    this.bundle = timelineBundle;
    this.dynamicBundle = dynamicBundle;
    this.runtimeBundle = runtimeBundle;
    this.randomInt = randomInt;
    this.blinkFloor = f32(Number(blinkFloor));
    this.reset({ startTime, loop });
  }

  reset({ startTime = 0, loop = true } = {}) {
    this.startTime = checkedU32(startTime, "start time");
    if (typeof loop !== "boolean") {
      throw new Error("Rinne timeline loop flag must be boolean");
    }
    this.loop = loop;
    const automatic = this.bundle.manifest.automatic;
    this.breathState = {
      enabled: automatic.breath.enabled,
      durationFactor: f32(automatic.breath.duration_factor),
      phaseDegrees: f32(automatic.breath.initial_phase_degrees),
    };
    this.breathPreviousTime = null;
    this.blinkState = {
      enabled: automatic.blink.enabled,
      elapsed: 0,
      anchorTime: 0,
      interval: 0,
      durationFactor: f32(automatic.blink.duration_factor),
      frequencies: [...automatic.blink.frequencies],
      singleBlinkGain: 0,
      blinkType: 0,
      geometry: {
        deformation: new Float32Array(4),
        baseWeights: BLINK_BASE_WEIGHTS,
      },
    };
    this.blinkPreviousTime = null;
  }

  value(channelIndex, frameIndex) {
    return this.bundle.channelFloats[
      channelIndex * this.bundle.frameCount + frameIndex
    ];
  }

  resolveAmbPosition(currentTime) {
    const elapsedTime = (currentTime - this.startTime) >>> 0;
    const rawFramePosition = f32Multiply(
      f32Divide(elapsedTime, 1000),
      this.bundle.rate,
    );
    if (rawFramePosition > INT32_MAX) {
      return { finished: true, rawFramePosition, elapsedTime };
    }
    const rawFrameIndex = Math.trunc(rawFramePosition);
    const fraction = f32Subtract(rawFramePosition, rawFrameIndex);
    let frameIndex = rawFrameIndex;
    let loopCount = 0;
    const amb = this.bundle.manifest.amb;
    if (this.loop) {
      const loopStart = amb.runtime_loop_start;
      const loopEnd = amb.runtime_loop_end;
      if (rawFrameIndex > loopEnd) {
        const loopSpan = loopEnd - loopStart + 1;
        const excess = rawFrameIndex - loopEnd - 1;
        loopCount = Math.trunc(excess / loopSpan) + 1;
        frameIndex = loopStart + (excess % loopSpan);
      }
      if (frameIndex > this.bundle.frameCount - 2) {
        return { finished: true, rawFramePosition, rawFrameIndex, elapsedTime };
      }
      return {
        finished: false,
        rawFramePosition,
        rawFrameIndex,
        frameIndex,
        nextFrameIndex: Math.min(frameIndex + 1, loopEnd),
        fraction,
        loopCount,
        elapsedTime,
      };
    }
    if (rawFrameIndex < 0 || rawFrameIndex >= this.bundle.frameCount - 2) {
      return { finished: true, rawFramePosition, rawFrameIndex, elapsedTime };
    }
    return {
      finished: false,
      rawFramePosition,
      rawFrameIndex,
      frameIndex,
      nextFrameIndex: frameIndex + 1,
      fraction,
      loopCount: 0,
      elapsedTime,
    };
  }

  sampleAmb(position) {
    const currentWeight = f32Subtract(1, position.fraction);
    const linear = (channel) =>
      f32Add(
        f32Multiply(
          this.value(channel, position.nextFrameIndex),
          position.fraction,
        ),
        f32Multiply(this.value(channel, position.frameIndex), currentWeight),
      );
    const groups = this.bundle.manifest.amb.groups;
    const sampleGroup = ([start, stop]) =>
      Float32Array.from({ length: stop - start }, (_, index) =>
        linear(start + index),
      );
    const extendedContinuousStart =
      groups.extended[0] + this.bundle.manifest.amb.discrete_selector_count;
    return {
      core: sampleGroup(groups.core),
      expression: sampleGroup(groups.expression),
      auxiliary: sampleGroup(groups.auxiliary),
      extendedContinuous: sampleGroup([
        extendedContinuousStart,
        groups.extended[1],
      ]),
    };
  }

  advanceBreath(currentTime) {
    const previousTime =
      this.breathPreviousTime === null ? currentTime : this.breathPreviousTime;
    const sampledPhase = f32(this.breathState.phaseDegrees);
    const radians = f32Divide(f32Multiply(sampledPhase, Math.PI), 180);
    const gain = f32Add(f32Multiply(f32(Math.sin(radians)), 0.5), 0.5);
    let nextPhase = sampledPhase;
    if (currentTime > previousTime && this.breathState.enabled === 1) {
      const deltaFrames = f32Divide(f32(currentTime - previousTime), 30);
      const increment = f32Divide(
        f32Multiply(deltaFrames, 3.5),
        this.breathState.durationFactor,
      );
      nextPhase = f32Add(nextPhase, increment);
      if (nextPhase >= 360) nextPhase = f32Subtract(nextPhase, 360);
    }
    this.breathState.phaseDegrees = nextPhase;
    if (
      this.breathPreviousTime === null ||
      currentTime > this.breathPreviousTime
    ) {
      this.breathPreviousTime = currentTime;
    }
    return { gain, sampledPhase, nextPhase };
  }

  advanceBlink(currentTime) {
    const previousTime =
      this.blinkPreviousTime === null ? currentTime : this.blinkPreviousTime;
    const state = this.blinkState;
    let anchorTime = state.anchorTime || currentTime;
    let elapsed = (currentTime - anchorTime) >>> 0;
    let interval = state.interval;
    let singleBlinkGain = f32(state.singleBlinkGain);
    let blinkType = state.blinkType;
    let cycleStarted = 0;
    if (elapsed >= interval && state.enabled !== 0) {
      const ratio = f32(nextRandom(this.randomInt) / BLINK_RAND_MAX);
      const gainBase = state.frequencies[1] === 0 ? f32(0.8) : f32(0.5);
      singleBlinkGain = f32Add(f32Multiply(ratio, 0.8), gainBase);
      if (singleBlinkGain > 1) singleBlinkGain = 1;
      anchorTime = currentTime;
      elapsed = 0;
      const intervalBase = 30 * (40 + (nextRandom(this.randomInt) % 50));
      interval = Math.trunc(f32Multiply(intervalBase, state.durationFactor));
      const selectionRandom = nextRandom(this.randomInt);
      const frequencySum = state.frequencies.reduce(
        (left, right) => left + right,
        0,
      );
      const selection = selectionRandom % frequencySum;
      if (selection < state.frequencies[0]) blinkType = 0;
      else if (selection < state.frequencies[0] + state.frequencies[1])
        blinkType = 1;
      else blinkType = 2;
      cycleStarted = 1;
    }
    const geometry = sampleBlinkGeometry(
      blinkType,
      signedU32Difference(currentTime, anchorTime),
      signedU32Difference(previousTime, anchorTime),
      singleBlinkGain,
      this.blinkFloor,
    );
    this.blinkState = {
      ...state,
      elapsed,
      anchorTime,
      interval,
      singleBlinkGain,
      blinkType,
      geometry,
    };
    this.blinkPreviousTime = currentTime;
    return { geometry, cycleStarted, blinkType, interval, singleBlinkGain };
  }

  resolveBaseControls(input = {}) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new TypeError("Rinne timeline controls must be an object");
    }
    const expressionWeights =
      input.expressionWeights === undefined
        ? new Float32Array(this.bundle.expressionCount)
        : checkedFiniteArray(
            input.expressionWeights,
            this.bundle.expressionCount,
            "expression weights",
          );
    const sharedEyeClose = checkedUnit(input.eyeClose ?? 0, "eye close");
    return {
      expressionWeights,
      mouthScale: f32(Number(input.mouthScale ?? 1)),
      mouthGains: checkedFiniteArray(
        input.mouthGains ?? [0, 0, 0],
        3,
        "mouth gains",
      ),
      rightEyeClose: checkedUnit(
        input.rightEyeClose ?? sharedEyeClose,
        "right eye close",
      ),
      leftEyeClose: checkedUnit(
        input.leftEyeClose ?? sharedEyeClose,
        "left eye close",
      ),
      neckRotation: checkedFiniteArray(
        input.neckRotation ?? [0, 0, 0],
        3,
        "neck rotation",
      ),
      neckTranslation: checkedFiniteArray(
        input.neckTranslation ?? [0, 0, 0],
        3,
        "neck translation",
      ),
      rightPupilPosition: checkedFiniteArray(
        input.rightPupilPosition ?? [0, 0],
        2,
        "right pupil position",
      ),
      leftPupilPosition: checkedFiniteArray(
        input.leftPupilPosition ?? [0, 0],
        2,
        "left pupil position",
      ),
      type2Intensity: checkedUnit(
        input.type2Intensity ?? 1,
        "type-2 intensity",
      ),
    };
  }

  advance(currentTime, inputControls = {}) {
    currentTime = checkedU32(currentTime, "current time");
    const base = this.resolveBaseControls(inputControls);
    const breath = this.advanceBreath(currentTime);
    const position = this.resolveAmbPosition(currentTime);
    if (position.finished) {
      return { currentTime, finished: true, position, breath };
    }
    const sample = this.sampleAmb(position);
    const gains =
      this.bundle.manifest.composition.extended_baseline_gain_indices;
    const expression = new Float32Array(this.bundle.expressionCount);
    const breathBaseline = Float32Array.from(base.expressionWeights);
    breathBaseline[4] = f32Add(breathBaseline[4], breath.gain);
    for (let index = 0; index < expression.length; index += 1) {
      expression[index] = f32Add(
        sample.expression[index],
        SPEECH_INDICES.includes(index)
          ? breathBaseline[index]
          : f32Multiply(
              breathBaseline[index],
              sample.extendedContinuous[gains.expression],
            ),
      );
    }
    for (let index = 0; index < SPEECH_INDICES.length; index += 1) {
      const expressionIndex = SPEECH_INDICES[index];
      expression[expressionIndex] = f32Add(
        f32Multiply(expression[expressionIndex], base.mouthScale),
        base.mouthGains[index],
      );
    }
    const coefficients = new Float32Array(
      this.dynamicBundle.manifest.deformation.controls.length,
    );
    const descriptors = this.dynamicBundle.manifest.deformation.controls;
    for (let index = 0; index < expression.length; index += 1) {
      coefficients[index] = easeExpression(
        expression[index],
        descriptors[index].coefficient_mode,
      );
    }
    const pupilGain = sample.extendedContinuous[gains.pupil];
    const rightPupil = Float32Array.from([
      f32Add(
        f32Multiply(sample.core[6], 0.1),
        f32Multiply(base.rightPupilPosition[0], pupilGain),
      ),
      f32Add(
        f32Multiply(sample.core[7], 0.05),
        f32Multiply(base.rightPupilPosition[1], pupilGain),
      ),
    ]);
    const leftPupil = Float32Array.from([
      f32Add(
        f32Multiply(sample.core[8], 0.1),
        f32Multiply(base.leftPupilPosition[0], pupilGain),
      ),
      f32Add(
        f32Multiply(sample.core[9], 0.05),
        f32Multiply(base.leftPupilPosition[1], pupilGain),
      ),
    ]);
    coefficients.set(rightPupil, expression.length);
    coefficients.set(leftPupil, expression.length + 2);
    const eyeGain = sample.extendedContinuous[gains.eye];
    const rightEyeClose = clampUnit(
      f32Add(sample.core[10], f32Multiply(base.rightEyeClose, eyeGain)),
    );
    const leftEyeClose = clampUnit(
      f32Add(sample.core[11], f32Multiply(base.leftEyeClose, eyeGain)),
    );
    const poseGain = sample.extendedContinuous[gains.pose];
    const neckRotation = Float32Array.from({ length: 3 }, (_, index) =>
      f32Add(
        sample.core[index],
        f32Multiply(base.neckRotation[index], poseGain),
      ),
    );
    const neckTranslation = Float32Array.from({ length: 3 }, (_, index) =>
      f32Add(
        sample.core[index + 3],
        f32Multiply(base.neckTranslation[index], poseGain),
      ),
    );
    const blink = this.advanceBlink(currentTime);
    return {
      currentTime,
      finished: false,
      position,
      breath,
      blink,
      rawExpressionWeights: expression,
      dynamicCoefficients: coefficients,
      eyeControls: {
        blinkDeformation: blink.geometry.deformation,
        blinkBaseWeights: blink.geometry.baseWeights,
        rightEyeClose,
        leftEyeClose,
        type2Intensity: base.type2Intensity,
      },
      runtimeControls: {
        neckRotation,
        neckTranslation,
        recordOpacities: sample.auxiliary,
      },
    };
  }
}

export const rinneGpuTimelineSchema = Object.freeze({
  format: FORMAT,
  version: VERSION,
  blinkRandomMaximum: BLINK_RAND_MAX,
});
