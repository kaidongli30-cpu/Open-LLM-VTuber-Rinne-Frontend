import { validateRinneGpuFirstOutfitManifest } from "./first-outfit-loader.mjs";

const FAMILY_FORMAT = "rinne-legacy-gpu-outfit-family";
const FAMILY_VERSION = 1;
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
const FAMILY_PROFILES = new Map([
  [
    2,
    [
      [60201, "thinking", ["thinking"], 20, false, false],
      [60202, "neutral", ["neutral"], 109, false, false],
      [60203, "confused", ["confused"], 26, false, false],
      [60204, "gentle", ["gentle"], 59, false, false],
      [60205, "awkward", ["awkward"], 21, true, false],
      [60206, "happy", ["happy"], 43, true, false],
      [60207, "worried", ["worried"], 19, false, false],
      [60208, "surprised", ["surprised", "surprise"], 6, false, false],
      [60209, "dissatisfaction", ["dissatisfaction"], 0, true, true],
      [60210, "flustered", ["flustered"], 3, false, false],
      [60211, "sad", ["sad"], 12, false, false],
      [60212, "embarrassed", ["embarrassed"], 9, true, true],
      [60213, "shy", ["shy"], 4, false, false],
      [60214, "uneasy", ["uneasy"], 5, false, true],
      [60215, "angry", ["angry"], 11, false, false],
    ],
  ],
  [
    3,
    [
      [60301, "thinking", ["thinking"], 10, false, false],
      [60302, "neutral", ["neutral"], 29, false, false],
      [60303, "confused", ["confused"], 9, false, false],
      [60304, "gentle", ["gentle"], 11, false, false],
      [60305, "awkward", ["awkward"], 11, true, false],
      [60306, "happy", ["happy"], 29, true, false],
      [60307, "worried", ["worried"], 13, false, false],
      [60308, "surprised", ["surprised", "surprise"], 3, false, false],
      [60309, "dissatisfaction", ["dissatisfaction"], 1, true, true],
      [60310, "flustered", ["flustered"], 2, false, false],
      [60311, "sad", ["sad"], 10, false, false],
      [60312, "embarrassed", ["embarrassed"], 0, true, true],
      [60313, "shy", ["shy"], 7, false, false],
      [60314, "uneasy", ["uneasy"], 2, false, true],
      [60315, "angry", ["angry"], 4, false, false],
    ],
  ],
  [
    4,
    [
      [60401, "thinking", ["thinking"], 8, false, false],
      [60402, "neutral", ["neutral"], 18, false, false],
      [60403, "confused", ["confused"], 3, false, false],
      [60404, "gentle", ["gentle"], 3, false, false],
      [60405, "awkward", ["awkward"], 11, true, false],
      [60406, "happy", ["happy"], 3, true, false],
      [60407, "worried", ["worried"], 1, false, false],
      [60408, "surprised", ["surprised", "surprise"], 1, false, false],
      [60409, "dissatisfaction", ["dissatisfaction"], 0, true, true],
      [60410, "flustered", ["flustered"], 0, false, false],
      [60411, "sad", ["sad"], 1, false, false],
      [60412, "embarrassed", ["embarrassed"], 3, true, true],
      [60413, "shy", ["shy"], 2, false, false],
      [60414, "uneasy", ["uneasy"], 2, false, true],
      [60415, "angry", ["angry"], 0, false, false],
    ],
  ],
]);
const FAMILY_METADATA = new Map([
  [
    2,
    {
      outfitId: "rinne_mp0602_second_outfit",
      displayName: "第二套衣服",
      portraitRange: [60201, 60215],
      defaultPortraitId: 60202,
    },
  ],
  [
    3,
    {
      outfitId: "rinne_mp0603_red_cardigan_casual",
      displayName: "红色开衫与棕色半身裙便装",
      portraitRange: [60301, 60315],
      defaultPortraitId: 60302,
    },
  ],
  [
    4,
    {
      outfitId: "rinne_mp0604_dark_navy_winter_uniform",
      displayName: "深蓝色冬季校服",
      portraitRange: [60401, 60415],
      defaultPortraitId: 60402,
    },
  ],
]);

function fail(message) {
  throw new Error(`invalid Rinne outfit bundle: ${message}`);
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

export function validateRinneGpuOutfitManifest(input) {
  const manifestBytes = ownBytes(
    input.outfitManifestJson ?? input.firstOutfitManifestJson,
  );
  let manifest;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    );
  } catch (error) {
    fail(`manifest is not valid UTF-8 JSON: ${error.message}`);
  }
  if (manifest?.format === "rinne-legacy-gpu-first-outfit") {
    return validateRinneGpuFirstOutfitManifest({
      firstOutfitManifestJson: manifestBytes,
    });
  }
  objectValue(manifest, "manifest root");
  const profiles = FAMILY_PROFILES.get(manifest.outfit_number);
  const metadata = FAMILY_METADATA.get(manifest.outfit_number);
  if (
    manifest.format !== FAMILY_FORMAT ||
    manifest.version !== FAMILY_VERSION ||
    profiles === undefined ||
    metadata === undefined ||
    manifest.outfit_id !== metadata.outfitId ||
    manifest.display_name !== metadata.displayName ||
    !equalJson(manifest.portrait_id_range, metadata.portraitRange) ||
    manifest.portrait_count !== 15 ||
    manifest.default_portrait_id !== metadata.defaultPortraitId ||
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
  for (let index = 0; index < profiles.length; index += 1) {
    const [id, label, tags, usage, closed, sweat] = profiles[index];
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

export function selectRinneGpuOutfitPortrait(outfit, portraitId) {
  if (
    outfit === null ||
    typeof outfit !== "object" ||
    !(outfit.byId instanceof Map)
  ) {
    throw new TypeError("validated Rinne outfit manifest is required");
  }
  if (!Number.isSafeInteger(portraitId)) {
    throw new TypeError("Rinne portrait id must be an integer");
  }
  const entry = outfit.byId.get(portraitId);
  if (entry === undefined) {
    throw new RangeError(
      `Rinne portrait id ${portraitId} is not in this outfit`,
    );
  }
  return entry;
}

export const rinneGpuOutfitSchema = Object.freeze({
  familyFormat: FAMILY_FORMAT,
  familyVersion: FAMILY_VERSION,
  fileNames: FILE_NAMES,
});
