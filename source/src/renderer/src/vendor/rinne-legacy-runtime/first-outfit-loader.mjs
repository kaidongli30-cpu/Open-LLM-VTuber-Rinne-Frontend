const FORMAT = "rinne-legacy-gpu-first-outfit";
const VERSION = 1;
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_NAMES = [
  "manifest.json",
  "texture.rgba8",
  "geometry.bin",
  "dynamic-manifest.json",
  "deformation.rgba32f",
  "eye-dynamic-manifest.json",
  "eye-deformation.rgba32f",
  "runtime-control-manifest.json",
  "timeline-manifest.json",
  "amb-channels.f32",
];
const PROFILES = [
  [60101, "thinking", ["thinking"], 14, false, false],
  [60102, "neutral", ["neutral"], 114, false, false],
  [60103, "confused", ["confused"], 47, false, false],
  [60104, "gentle", ["gentle"], 61, false, false],
  [60105, "awkward", ["awkward"], 41, true, false],
  [60106, "happy", ["happy"], 37, true, false],
  [60107, "worried", ["worried"], 26, false, false],
  [60108, "surprised", ["surprised", "surprise"], 27, false, false],
  [60109, "dissatisfaction", ["dissatisfaction"], 1, true, true],
  [60110, "flustered", ["flustered"], 10, false, false],
  [60111, "sad", ["sad"], 15, false, false],
  [60112, "embarrassed", ["embarrassed"], 29, true, true],
  [60113, "shy", ["shy"], 13, false, false],
  [60114, "uneasy", ["uneasy"], 14, false, true],
  [60115, "angry", ["angry"], 9, false, false],
];

function fail(message) {
  throw new Error(`invalid Rinne first-outfit bundle: ${message}`);
}

function ownBytes(value) {
  let view;
  if (value instanceof ArrayBuffer) view = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) {
    view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else fail("manifest is not binary data");
  if (view.byteLength <= 0 || view.byteLength > MANIFEST_MAX_BYTES) {
    fail("manifest exceeds its size limit");
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

export function validateRinneGpuFirstOutfitManifest(input) {
  const manifestBytes = ownBytes(input.firstOutfitManifestJson);
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
    manifest.outfit_id !== "rinne_mp0601_first_outfit" ||
    !equalJson(manifest.portrait_id_range, [60101, 60115]) ||
    manifest.portrait_count !== 15 ||
    manifest.default_portrait_id !== 60102 ||
    !equalJson(manifest.selection_contract, {
      canonical_selector: "portrait_id",
      tags_are_compatibility_labels: true,
      switching_policy: "load_selected_bundle_then_reset_its_timeline",
      resident_cache_recommendation: 2,
    }) ||
    !equalJson(manifest.source_policy, {
      original_pcks_remain_read_only: true,
      bundle_is_local_only: true,
      game_assets_are_not_stored_in_source_repository: true,
    })
  ) {
    fail("manifest contract is invalid");
  }
  if (!Array.isArray(manifest.portraits) || manifest.portraits.length !== 15) {
    fail("portrait list is invalid");
  }
  const topologyHashes = new Set();
  const byId = new Map();
  for (let index = 0; index < PROFILES.length; index += 1) {
    const [id, label, tags, usage, closed, sweat] = PROFILES[index];
    const paddedId = String(id).padStart(6, "0");
    const entry = objectValue(manifest.portraits[index], "portrait entry");
    const source = objectValue(entry.source, "source identity");
    const identity = objectValue(entry.bundle_identity, "bundle identity");
    if (
      entry.portrait_id !== id ||
      entry.directory !== `MP${paddedId}` ||
      entry.compatibility_label !== label ||
      !equalJson(entry.tags, tags) ||
      entry.game_usage_count !== usage ||
      entry.has_closed_eye_layer !== closed ||
      entry.has_sweat_layer !== sweat ||
      source.filename !== `MP${paddedId}.pck` ||
      !Number.isSafeInteger(source.byte_length) ||
      source.byte_length <= 0 ||
      typeof source.sha256 !== "string" ||
      !SHA256.test(source.sha256) ||
      typeof identity.base_topology_sha256 !== "string" ||
      !SHA256.test(identity.base_topology_sha256) ||
      typeof identity.timeline_manifest_sha256 !== "string" ||
      !SHA256.test(identity.timeline_manifest_sha256) ||
      !Array.isArray(entry.files) ||
      entry.files.length !== FILE_NAMES.length
    ) {
      fail("portrait entry is invalid");
    }
    for (let fileIndex = 0; fileIndex < FILE_NAMES.length; fileIndex += 1) {
      const file = objectValue(entry.files[fileIndex], "file entry");
      if (
        file.name !== FILE_NAMES[fileIndex] ||
        file.name.includes("/") ||
        file.name.includes("\\") ||
        !Number.isSafeInteger(file.byte_length) ||
        file.byte_length <= 0 ||
        typeof file.sha256 !== "string" ||
        !SHA256.test(file.sha256)
      ) {
        fail("file entry is invalid");
      }
    }
    topologyHashes.add(identity.base_topology_sha256);
    byId.set(id, entry);
  }
  const sortedTopologyHashes = [...topologyHashes].sort();
  if (
    !equalJson(manifest.topology, {
      distinct_hashes: sortedTopologyHashes,
      shared_across_all_portraits: sortedTopologyHashes.length === 1,
    })
  ) {
    fail("topology summary is invalid");
  }
  return { manifest, manifestBytes, byId };
}

export function selectRinneGpuFirstOutfitPortrait(firstOutfit, portraitId) {
  if (
    firstOutfit === null ||
    typeof firstOutfit !== "object" ||
    !(firstOutfit.byId instanceof Map)
  ) {
    throw new TypeError("validated Rinne first-outfit manifest is required");
  }
  if (!Number.isSafeInteger(portraitId)) {
    throw new TypeError("Rinne portrait id must be an integer");
  }
  const entry = firstOutfit.byId.get(portraitId);
  if (entry === undefined) {
    throw new RangeError(
      `Rinne portrait id ${portraitId} is not in this outfit`,
    );
  }
  return entry;
}

export const rinneGpuFirstOutfitSchema = Object.freeze({
  format: FORMAT,
  version: VERSION,
  defaultPortraitId: 60102,
  portraitCount: 15,
  fileNames: FILE_NAMES,
});
