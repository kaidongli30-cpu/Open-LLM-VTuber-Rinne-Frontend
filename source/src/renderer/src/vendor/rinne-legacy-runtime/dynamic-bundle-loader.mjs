import { sha256Hex } from "./bundle-loader.mjs";

const FORMAT = "rinne-legacy-gpu-linear-dynamics";
const VERSION = 1;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const DEFORMATION_MAX_BYTES = 64 * 1024 * 1024;
const DEFORMATION_WIDTH = 1024;
const MAX_CONTROLS = 64;
const SHA256 = /^[0-9a-f]{64}$/;
const CAPABILITIES = [
  "expression_weights",
  "mouth_expression_slots_5_6_7",
  "breath_expression_slot_4",
  "bilateral_pupil_position",
];
const UNSUPPORTED = [
  "blink_deformation",
  "bilateral_eye_close",
  "neck_pose",
  "render_record_opacity",
  "amb_playback",
];
const PUPIL_NAMES = [
  "right_pupil_x",
  "right_pupil_y",
  "left_pupil_x",
  "left_pupil_y",
];

function fail(message) {
  throw new Error(`invalid Rinne GPU dynamic bundle: ${message}`);
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

function expectedAcceptanceWeights(count) {
  const values = Array(count).fill(0);
  for (const [index, value] of [
    [0, 0.25],
    [1, 0.4],
    [4, 0.37],
    [5, 0.16],
    [6, 0.28],
    [7, 0.44],
    [8, 0.2],
  ]) {
    if (index < count) {
      values[index] = value;
    }
  }
  return values;
}

export function resolveRinneGpuDynamicCoefficients(dynamicBundle) {
  const controls = dynamicBundle.manifest.deformation.controls;
  const sample = dynamicBundle.manifest.acceptance_sample;
  const expressionCount = sample.raw_expression_weights.length;
  const coefficients = new Float32Array(controls.length);
  for (let index = 0; index < expressionCount; index += 1) {
    let value = Math.fround(sample.raw_expression_weights[index]);
    if (
      controls[index].coefficient_mode === "cosine_ease_then_threshold_0_01"
    ) {
      if (value <= 0) {
        value = 0;
      } else if (value >= 1) {
        value = 1;
      } else {
        value = Math.fround((1 - Math.cos(Math.PI * value)) * 0.5);
      }
    }
    coefficients[index] = value >= Math.fround(0.01) ? value : 0;
  }
  coefficients.set(sample.right_pupil_position, expressionCount);
  coefficients.set(sample.left_pupil_position, expressionCount + 2);
  return coefficients;
}

export async function validateRinneGpuLinearDynamicBundle(
  input,
  baseBundle,
  { preverified = false } = {},
) {
  if (typeof preverified !== "boolean") {
    fail("preverified option must be boolean");
  }
  if (
    baseBundle === null ||
    typeof baseBundle !== "object" ||
    !(baseBundle.manifestBytes instanceof Uint8Array) ||
    !(baseBundle.texture instanceof Uint8Array) ||
    !(baseBundle.geometry instanceof Uint8Array) ||
    !(baseBundle.passes instanceof Map)
  ) {
    fail("validated base bundle is required");
  }
  const manifestBytes = ownBytes(
    input.dynamicManifestJson,
    "manifest",
    MANIFEST_MAX_BYTES,
  );
  const deformation = ownBytes(
    input.deformationRgba32f,
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
  const base = objectValue(manifest.base_bundle, "base bundle identity");
  if (
    (!preverified &&
      base.manifest_sha256 !== (await sha256Hex(baseBundle.manifestBytes))) ||
    base.texture_sha256 !== baseBundle.manifest.texture.sha256 ||
    base.geometry_sha256 !== baseBundle.manifest.geometry.sha256 ||
    typeof base.topology_sha256 !== "string" ||
    !SHA256.test(base.topology_sha256)
  ) {
    fail("base-bundle identity is inconsistent");
  }
  const info = objectValue(manifest.deformation, "deformation metadata");
  const width = positiveInteger(info.texture_width, "texture width");
  const height = positiveInteger(info.texture_height, "texture height");
  const vertexCount = positiveInteger(info.vertex_count, "vertex count");
  const controlCount = positiveInteger(info.control_count, "control count");
  const usedTexels = positiveInteger(info.used_texel_count, "used texel count");
  if (
    info.file !== "deformation.rgba32f" ||
    info.format !== "rgba32f_little_endian" ||
    width !== DEFORMATION_WIDTH ||
    controlCount > MAX_CONTROLS ||
    usedTexels !== vertexCount * controlCount ||
    info.byte_length !== deformation.byteLength ||
    deformation.byteLength !== width * height * 16 ||
    (!preverified && info.sha256 !== (await sha256Hex(deformation)))
  ) {
    fail("deformation metadata or SHA-256 does not match bytes");
  }
  const expressionCount =
    baseBundle.manifest.reference.expression_weights.length;
  const expectedNames = [
    ...Array.from(
      { length: expressionCount },
      (_, index) => `expression_${index}`,
    ),
    ...PUPIL_NAMES,
  ];
  if (
    !Array.isArray(info.controls) ||
    info.controls.length !== expectedNames.length
  ) {
    fail("control descriptor count is invalid");
  }
  const names = new Set();
  for (let index = 0; index < info.controls.length; index += 1) {
    const control = objectValue(info.controls[index], "control descriptor");
    const expressionMode = [
      "threshold_0_01",
      "cosine_ease_then_threshold_0_01",
    ].includes(control.coefficient_mode);
    if (
      control.index !== index ||
      control.name !== expectedNames[index] ||
      names.has(control.name) ||
      (index < expressionCount
        ? !expressionMode
        : control.coefficient_mode !== "identity")
    ) {
      fail("control descriptor is invalid");
    }
    names.add(control.name);
  }
  if (controlCount !== info.controls.length) {
    fail("control count does not match descriptors");
  }
  if (!Array.isArray(info.mesh_vertex_offsets)) {
    fail("mesh vertex offsets are missing");
  }
  const baseMeshes = [];
  for (const [passName, meshes] of baseBundle.passes) {
    for (const mesh of meshes) {
      baseMeshes.push([passName, mesh]);
    }
  }
  if (info.mesh_vertex_offsets.length !== baseMeshes.length) {
    fail("mesh vertex offsets changed base mesh count");
  }
  let vertexCursor = 0;
  const meshVertexOffsets = new Map();
  for (let index = 0; index < baseMeshes.length; index += 1) {
    const offset = objectValue(info.mesh_vertex_offsets[index], "mesh offset");
    const [passName, mesh] = baseMeshes[index];
    if (
      offset.pass !== passName ||
      offset.mesh_index !== mesh.descriptor.mesh_index ||
      offset.vertex_offset !== vertexCursor ||
      offset.vertex_count !== mesh.descriptor.vertex_count
    ) {
      fail("mesh vertex offsets are not canonical");
    }
    meshVertexOffsets.set(`${passName}\0${offset.mesh_index}`, vertexCursor);
    vertexCursor += offset.vertex_count;
  }
  if (vertexCursor !== vertexCount) {
    fail("mesh vertex offsets do not cover all vertices");
  }
  const floats = new Float32Array(deformation.buffer);
  if (!preverified) {
    for (let texel = 0; texel < width * height; texel += 1) {
      const start = texel * 4;
      const values = floats.subarray(start, start + 4);
      if (Array.from(values).some((value) => !Number.isFinite(value))) {
        fail(`deformation contains a non-finite texel at ${texel}`);
      }
      if (
        values[3] !== 0 ||
        (texel >= usedTexels &&
          Array.from(values).some((value) => value !== 0))
      ) {
        fail("deformation padding is not canonical");
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
    !equalJson(
      acceptance.raw_expression_weights,
      expectedAcceptanceWeights(expressionCount),
    ) ||
    !equalJson(acceptance.right_pupil_position, [-0.6, 0.35]) ||
    !equalJson(acceptance.left_pupil_position, [0.45, -0.25])
  ) {
    fail("acceptance sample is invalid");
  }
  return {
    manifest,
    manifestBytes,
    deformation,
    deformationFloats: floats,
    meshVertexOffsets,
  };
}

export const rinneGpuLinearDynamicSchema = Object.freeze({
  format: FORMAT,
  version: VERSION,
  maximumControls: MAX_CONTROLS,
});
