import { sha256Hex } from "./bundle-loader.mjs";

const FORMAT = "rinne-legacy-gpu-eye-dynamics";
const VERSION = 1;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const DEFORMATION_MAX_BYTES = 64 * 1024 * 1024;
const TEXTURE_WIDTH = 1024;
const MIN_SAMPLES = 129;
const MAX_SAMPLES = 512;
const CAPABILITIES = [
  "blink_deformation",
  "bilateral_eye_close",
  "type2_intensity",
];
const UNSUPPORTED = ["neck_pose", "render_record_opacity", "amb_playback"];
const GROUPS = [
  ["special_eye_right", "special_eye", 0, 88],
  ["special_eye_left", "special_eye", 1, 88],
  ["type2_eye_strip_right", "type2_eye_strip", 0, 22],
  ["type2_eye_strip_left", "type2_eye_strip", 1, 22],
];
const ACCEPTANCE = {
  blink_deformation: [0.8, 0.55, 0.25, 0.05],
  blink_base_weights: [
    1, 0.699999988079071, 0.49000000953674316, 0.34299999475479126,
  ],
  right_eye_close: 0.2,
  left_eye_close: 0.65,
  type2_intensity: 0.7,
};

function fail(message) {
  throw new Error(`invalid Rinne GPU eye bundle: ${message}`);
}

function ownBytes(value, label, maximum, copy = true) {
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
  if (
    !copy &&
    view.byteOffset === 0 &&
    view.byteLength === view.buffer.byteLength
  ) {
    return view;
  }
  return Uint8Array.from(view);
}

function objectValue(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive integer`);
  }
  return value;
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedGroups() {
  let vertexOffset = 0;
  return GROUPS.map(([name, kind, eyeSide, vertexCount], index) => {
    const result = {
      index,
      name,
      kind,
      eye_side: eyeSide,
      vertex_offset: vertexOffset,
      vertex_count: vertexCount,
    };
    vertexOffset += vertexCount;
    return result;
  });
}

export function resolveRinneGpuEyeAcceptanceControls(eyeBundle) {
  const sample = eyeBundle.manifest.acceptance_sample;
  return {
    blinkDeformation: Float32Array.from(sample.blink_deformation),
    blinkBaseWeights: Float32Array.from(sample.blink_base_weights),
    rightEyeClose: sample.right_eye_close,
    leftEyeClose: sample.left_eye_close,
    type2Intensity: sample.type2_intensity,
  };
}

export async function validateRinneGpuEyeDynamicBundle(
  input,
  dynamicBundle,
  { preverified = false } = {},
) {
  if (typeof preverified !== "boolean") {
    fail("preverified option must be boolean");
  }
  if (
    dynamicBundle === null ||
    typeof dynamicBundle !== "object" ||
    !(dynamicBundle.manifestBytes instanceof Uint8Array) ||
    !(dynamicBundle.deformation instanceof Uint8Array) ||
    !(dynamicBundle.meshVertexOffsets instanceof Map)
  ) {
    fail("validated linear dynamic bundle is required");
  }
  const manifestBytes = ownBytes(
    input.eyeManifestJson,
    "manifest",
    MANIFEST_MAX_BYTES,
  );
  const deformation = ownBytes(
    input.eyeDeformationRgba32f,
    "deformation",
    DEFORMATION_MAX_BYTES,
    !preverified,
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
  if (manifest.format !== FORMAT || manifest.version !== VERSION) {
    fail("format or version is unsupported");
  }
  if (!equalJson(manifest.capabilities, CAPABILITIES)) {
    fail("capability list is invalid");
  }
  if (!equalJson(manifest.unsupported_controls, UNSUPPORTED)) {
    fail("unsupported-control boundary is invalid");
  }
  const parent = objectValue(manifest.linear_bundle, "linear bundle identity");
  if (
    (!preverified &&
      (parent.dynamic_manifest_sha256 !==
        (await sha256Hex(dynamicBundle.manifestBytes)) ||
        parent.deformation_sha256 !==
          (await sha256Hex(dynamicBundle.deformation)))) ||
    parent.base_topology_sha256 !==
      dynamicBundle.manifest.base_bundle.topology_sha256
  ) {
    fail("linear-bundle identity is inconsistent");
  }
  const lookup = objectValue(manifest.lookup, "lookup metadata");
  const width = positiveInteger(lookup.texture_width, "texture width");
  const height = positiveInteger(lookup.texture_height, "texture height");
  const usedTexels = positiveInteger(
    lookup.used_texel_count,
    "used texel count",
  );
  const sampleCount = positiveInteger(lookup.sample_count, "sample count");
  const basisCount = positiveInteger(lookup.basis_count, "basis count");
  const groupVertexCount = positiveInteger(
    lookup.group_vertex_count,
    "group vertex count",
  );
  if (
    lookup.file !== "eye-deformation.rgba32f" ||
    lookup.format !== "rgba32f_little_endian" ||
    width !== TEXTURE_WIDTH ||
    sampleCount < MIN_SAMPLES ||
    sampleCount > MAX_SAMPLES ||
    lookup.sample_parameter !== "combined_eye_deformation_u_0_to_1" ||
    lookup.interpolation !== "linear_between_declared_samples" ||
    usedTexels !== groupVertexCount * sampleCount * basisCount ||
    lookup.byte_length !== deformation.byteLength ||
    deformation.byteLength !== width * height * 16 ||
    (!preverified && lookup.sha256 !== (await sha256Hex(deformation)))
  ) {
    fail("lookup metadata or SHA-256 does not match bytes");
  }
  const positions = lookup.sample_positions;
  if (
    !Array.isArray(positions) ||
    positions.length !== sampleCount ||
    positions[0] !== 0 ||
    positions.at(-1) !== 1 ||
    positions.some(
      (value, index) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1 ||
        (index > 0 && value <= positions[index - 1]),
    )
  ) {
    fail("sample positions are invalid");
  }
  const linearControls = dynamicBundle.manifest.deformation.controls.map(
    (item) => item.name,
  );
  if (
    basisCount !== linearControls.length + 1 ||
    !equalJson(lookup.linear_control_names, linearControls)
  ) {
    fail("lookup bases do not match linear controls");
  }
  const groups = expectedGroups();
  if (
    !Array.isArray(lookup.groups) ||
    lookup.groups.length !== groups.length ||
    lookup.groups.some((group, index) => {
      const expected = groups[index];
      return (
        group === null ||
        typeof group !== "object" ||
        Array.isArray(group) ||
        group.index !== expected.index ||
        group.name !== expected.name ||
        group.kind !== expected.kind ||
        group.eye_side !== expected.eye_side ||
        group.vertex_offset !== expected.vertex_offset ||
        group.vertex_count !== expected.vertex_count
      );
    }) ||
    groupVertexCount !== 220
  ) {
    fail("lookup groups are invalid");
  }
  if (
    !Array.isArray(lookup.mesh_bindings) ||
    lookup.mesh_bindings.length !== 14
  ) {
    fail("mesh bindings are invalid");
  }
  const meshBindings = new Map();
  const modes = new Map();
  for (const rawBinding of lookup.mesh_bindings) {
    const binding = objectValue(rawBinding, "mesh binding");
    const key = `${binding.pass}\0${binding.mesh_index}`;
    const offset = dynamicBundle.meshVertexOffsets.get(key);
    const group = groups[binding.group_index];
    if (
      offset === undefined ||
      meshBindings.has(key) ||
      group === undefined ||
      binding.vertex_offset !== offset ||
      binding.vertex_count !== group.vertex_count ||
      binding.eye_side !== group.eye_side ||
      !Number.isSafeInteger(binding.blink_sample_index) ||
      binding.blink_sample_index < 0 ||
      binding.blink_sample_index > 3 ||
      ![
        "blur_sample_base_weight_0_9",
        "runtime_type0",
        "primary_base_weight_0_9",
        "eased_u_intensity_0_8",
      ].includes(binding.opacity_mode)
    ) {
      fail("mesh binding is inconsistent");
    }
    meshBindings.set(key, binding);
    modes.set(binding.opacity_mode, (modes.get(binding.opacity_mode) ?? 0) + 1);
  }
  if (
    modes.get("blur_sample_base_weight_0_9") !== 8 ||
    modes.get("runtime_type0") !== 2 ||
    modes.get("primary_base_weight_0_9") !== 2 ||
    modes.get("eased_u_intensity_0_8") !== 2
  ) {
    fail("opacity binding coverage is invalid");
  }
  const floats = new Float32Array(deformation.buffer);
  if (!preverified) {
    for (let texel = 0; texel < width * height; texel += 1) {
      const start = texel * 4;
      const values = floats.subarray(start, start + 4);
      if (Array.from(values).some((value) => !Number.isFinite(value))) {
        fail(`lookup contains a non-finite texel at ${texel}`);
      }
      if (
        values[3] !== 0 ||
        (texel >= usedTexels &&
          Array.from(values).some((value) => value !== 0))
      ) {
        fail("lookup padding is not canonical");
      }
    }
  }
  if (
    !equalJson(manifest.reconstruction, {
      maximum_position_error: 2e-6,
      position_space: "projected_normalized_xyz_before_neck_pose",
    })
  ) {
    fail("reconstruction contract is invalid");
  }
  const acceptance = objectValue(
    manifest.acceptance_sample,
    "acceptance sample",
  );
  if (
    !equalJson(acceptance.blink_deformation, ACCEPTANCE.blink_deformation) ||
    !equalJson(acceptance.blink_base_weights, ACCEPTANCE.blink_base_weights) ||
    acceptance.right_eye_close !== ACCEPTANCE.right_eye_close ||
    acceptance.left_eye_close !== ACCEPTANCE.left_eye_close ||
    acceptance.type2_intensity !== ACCEPTANCE.type2_intensity
  ) {
    fail("acceptance sample is invalid");
  }
  return {
    manifest,
    manifestBytes,
    deformation,
    deformationFloats: floats,
    meshBindings,
    samplePositions: Float32Array.from(positions),
  };
}

export const rinneGpuEyeDynamicSchema = Object.freeze({
  format: FORMAT,
  version: VERSION,
  minimumSamples: MIN_SAMPLES,
  maximumSamples: MAX_SAMPLES,
});
