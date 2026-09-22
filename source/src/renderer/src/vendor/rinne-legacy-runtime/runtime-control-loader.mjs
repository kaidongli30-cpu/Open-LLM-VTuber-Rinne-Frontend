import { sha256Hex } from "./bundle-loader.mjs";

const FORMAT = "rinne-legacy-gpu-runtime-controls";
const VERSION = 1;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const CAPABILITIES = ["neck_pose", "render_record_opacity"];
const UNSUPPORTED = ["amb_playback"];
const ACCEPTANCE_ROTATION = [2, -1.5, 1];
const ACCEPTANCE_TRANSLATION = [0.015, -0.01, 0.005];

function fail(message) {
  throw new Error(`invalid Rinne GPU runtime controls: ${message}`);
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
  return JSON.stringify(left) === JSON.stringify(right);
}

function finiteTriple(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    fail(`${label} must contain three finite values`);
  }
  return value;
}

function expectedAcceptanceOpacities(records) {
  return records.map((record, index) =>
    record.type_id === 25 ? 1 : Math.fround(0.8 + 0.05 * (index % 5)),
  );
}

export function resolveRinneGpuRuntimeAcceptanceControls(runtimeBundle) {
  const sample = runtimeBundle.manifest.acceptance_sample;
  return {
    neckRotation: Float32Array.from(sample.neck_rotation),
    neckTranslation: Float32Array.from(sample.neck_translation),
    recordOpacities: Float32Array.from(sample.record_opacities),
  };
}

export async function validateRinneGpuRuntimeControlBundle(
  input,
  dynamicBundle,
  eyeBundle,
  { preverified = false } = {},
) {
  if (typeof preverified !== "boolean") {
    fail("preverified option must be boolean");
  }
  if (
    dynamicBundle === null ||
    typeof dynamicBundle !== "object" ||
    !(dynamicBundle.meshVertexOffsets instanceof Map)
  ) {
    fail("validated linear dynamic bundle is required");
  }
  if (
    eyeBundle === null ||
    typeof eyeBundle !== "object" ||
    !(eyeBundle.manifestBytes instanceof Uint8Array) ||
    !(eyeBundle.deformation instanceof Uint8Array)
  ) {
    fail("validated eye-dynamic bundle is required");
  }
  const manifestBytes = ownBytes(
    input.runtimeControlManifestJson,
    "manifest",
    MANIFEST_MAX_BYTES,
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
  const parent = objectValue(manifest.eye_bundle, "eye bundle identity");
  if (
    (!preverified &&
      (parent.manifest_sha256 !==
        (await sha256Hex(eyeBundle.manifestBytes)) ||
        parent.deformation_sha256 !==
          (await sha256Hex(eyeBundle.deformation)))) ||
    parent.base_topology_sha256 !==
      eyeBundle.manifest.linear_bundle.base_topology_sha256
  ) {
    fail("eye-bundle identity is inconsistent");
  }

  const neck = objectValue(manifest.neck, "neck contract");
  const pivot = finiteTriple(neck.pivot_xyz, "neck pivot");
  if (
    neck.matrix_convention !== "row_vector_x_then_y_then_z_float32" ||
    neck.input_rotation_unit !== "degrees" ||
    neck.input_translation_space !== "legacy_model_xyz"
  ) {
    fail("neck matrix contract is invalid");
  }

  const opacity = objectValue(manifest.opacity, "opacity contract");
  const recordCount = opacity.record_count;
  if (
    !Number.isSafeInteger(recordCount) ||
    recordCount <= 0 ||
    recordCount > 256 ||
    !Array.isArray(opacity.records) ||
    opacity.records.length !== recordCount
  ) {
    fail("opacity records are invalid");
  }
  const typeIds = new Set();
  const records = opacity.records.map((value, index) => {
    const record = objectValue(value, "opacity record");
    const expectedCurve =
      record.type_id === 0 ? "type0_fourth_power" : "direct";
    if (
      record.index !== index ||
      !Number.isSafeInteger(record.type_id) ||
      typeIds.has(record.type_id) ||
      typeof record.initial_opacity !== "number" ||
      !Number.isFinite(record.initial_opacity) ||
      record.initial_opacity < 0 ||
      record.initial_opacity > 1 ||
      record.curve !== expectedCurve
    ) {
      fail("opacity record is inconsistent");
    }
    typeIds.add(record.type_id);
    return record;
  });

  const expectedKeys = new Set(dynamicBundle.meshVertexOffsets.keys());
  if (
    !Array.isArray(opacity.mesh_bindings) ||
    opacity.mesh_bindings.length !== expectedKeys.size
  ) {
    fail("opacity mesh bindings are invalid");
  }
  const meshBindings = new Map();
  for (const rawBinding of opacity.mesh_bindings) {
    const binding = objectValue(rawBinding, "opacity mesh binding");
    const key = `${binding.pass}\0${binding.mesh_index}`;
    const record = records[binding.record_index];
    if (
      !expectedKeys.has(key) ||
      meshBindings.has(key) ||
      record === undefined ||
      binding.curve !== record.curve
    ) {
      fail("opacity mesh binding is inconsistent");
    }
    meshBindings.set(key, binding);
  }
  if (meshBindings.size !== expectedKeys.size) {
    fail("opacity mesh binding coverage changed");
  }

  const acceptance = objectValue(
    manifest.acceptance_sample,
    "acceptance sample",
  );
  if (
    !equalJson(acceptance.neck_rotation, ACCEPTANCE_ROTATION) ||
    !equalJson(acceptance.neck_translation, ACCEPTANCE_TRANSLATION) ||
    !equalJson(
      acceptance.record_opacities,
      expectedAcceptanceOpacities(records),
    )
  ) {
    fail("acceptance sample is invalid");
  }
  return {
    manifest,
    manifestBytes,
    meshBindings,
    pivot: Float32Array.from(pivot),
  };
}

export const rinneGpuRuntimeControlSchema = Object.freeze({
  format: FORMAT,
  version: VERSION,
});
