const FORMAT = "rinne-spirit-dress-expression-preview";
const VERSION = 3;
const SHA256 = /^[0-9a-f]{64}$/;
const LABELS = Object.freeze([
  "thinking",
  "neutral",
  "confused",
  "gentle",
  "awkward",
  "happy",
  "worried",
  "surprised",
  "dissatisfaction",
  "flustered",
  "sad",
  "embarrassed",
  "shy",
  "uneasy",
  "angry",
]);
const PORTRAIT_IDS = Object.freeze(
  Array.from({ length: 7 }, (_value, index) => 160101 + index),
);
const OVERLAY_IDS = Object.freeze([
  "awkward-embarrassed-sweat",
  "flustered-blush",
  "shy-blush",
]);
const BUNDLE_FILES = Object.freeze([
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
]);
const APPROVED_RECIPES = Object.freeze([
  ["thinking", 160104, null, null, 100],
  ["neutral", 160101, null, null, 100],
  ["confused", 160102, null, null, 100],
  ["gentle", 160106, 160107, null, 100],
  ["awkward", 160106, 160107, "awkward-embarrassed-sweat", 100],
  ["happy", 160101, 160107, null, 100],
  ["worried", 160102, null, null, 100],
  ["surprised", 160105, null, null, 100],
  ["dissatisfaction", 160103, null, null, 100],
  ["flustered", 160105, null, "flustered-blush", 100],
  ["sad", 160106, null, null, 100],
  ["embarrassed", 160106, 160107, "awkward-embarrassed-sweat", 100],
  ["shy", 160101, 160107, "shy-blush", 100],
  ["uneasy", 160102, null, null, 100],
  ["angry", 160103, null, null, 100],
]);

function fail(message) {
  throw new Error(`spirit-expression manifest: ${message}`);
}

function objectValue(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function finitePair(value, label, positive = false) {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((item) => Number.isFinite(item) && (!positive || item > 0))
  ) {
    fail(`${label} must be a finite pair`);
  }
}

function validateMask(raw, label) {
  const mask = objectValue(raw, label);
  finitePair(mask.center, `${label} center`);
  finitePair(mask.radii, `${label} radii`, true);
  if (
    mask.shape !== "soft_ellipse" ||
    mask.role !== "mouth" ||
    !Number.isFinite(mask.feather) ||
    mask.feather <= 0 ||
    mask.feather >= 1 ||
    !mask.center.every((item) => item >= 0 && item <= 1) ||
    !mask.radii.every((item) => item <= 0.1)
  ) {
    fail(`${label} is invalid`);
  }
  return mask;
}

function decodeManifest(input) {
  const bytes = input?.spiritExpressionManifestJson;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    fail("bytes are missing");
  }
  try {
    return objectValue(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      "root",
    );
  } catch (error) {
    fail(`JSON is invalid: ${error.message}`);
  }
}

export function validateRinneSpiritExpressionManifest(input) {
  const manifest = decodeManifest(input);
  if (
    manifest.format !== FORMAT ||
    manifest.version !== VERSION ||
    manifest.stage !== "approved-fifteen-native-runtime" ||
    manifest.display_name !== "灵装凛祢" ||
    JSON.stringify(manifest.canvas) !== "[4096,4096]" ||
    manifest.portrait_count !== 7 ||
    manifest.overlay_count !== 3 ||
    manifest.expression_count !== 15 ||
    manifest.complete_fifteen_label_set !== true ||
    manifest.default_expression !== "neutral" ||
    manifest.source_policy?.uses_first_outfit_face_transplant !== false ||
    manifest.source_policy?.approved_local_cues_only !== true
  ) {
    fail("header is invalid");
  }
  if (!Array.isArray(manifest.portraits) || manifest.portraits.length !== 7) {
    fail("portrait list is invalid");
  }
  const byPortraitId = new Map();
  for (const [index, value] of manifest.portraits.entries()) {
    const entry = objectValue(value, "portrait");
    const portraitId = PORTRAIT_IDS[index];
    if (
      entry.portrait_id !== portraitId ||
      entry.directory !== `MP${String(portraitId).padStart(6, "0")}` ||
      entry.source_family !== "spirit-native" ||
      !Array.isArray(entry.files) ||
      entry.files.length !== BUNDLE_FILES.length ||
      byPortraitId.has(portraitId)
    ) {
      fail("portrait entry is invalid");
    }
    for (const [fileIndex, rawFile] of entry.files.entries()) {
      const file = objectValue(rawFile, "portrait file");
      if (
        file.name !== BUNDLE_FILES[fileIndex] ||
        !Number.isSafeInteger(file.byte_length) ||
        file.byte_length <= 0 ||
        typeof file.sha256 !== "string" ||
        !SHA256.test(file.sha256)
      ) {
        fail("portrait file contract is invalid");
      }
    }
    byPortraitId.set(portraitId, entry);
  }
  if (!Array.isArray(manifest.overlays) || manifest.overlays.length !== 3) {
    fail("overlay list is invalid");
  }
  const byOverlayId = new Map();
  for (const [index, rawOverlay] of manifest.overlays.entries()) {
    const overlay = objectValue(rawOverlay, "overlay");
    const overlayId = OVERLAY_IDS[index];
    if (
      overlay.overlay_id !== overlayId ||
      overlay.file !== `overlays/${overlayId}.png` ||
      !Number.isSafeInteger(overlay.byte_length) ||
      overlay.byte_length <= 0 ||
      typeof overlay.sha256 !== "string" ||
      !SHA256.test(overlay.sha256) ||
      byOverlayId.has(overlayId)
    ) {
      fail("overlay entry is invalid");
    }
    byOverlayId.set(overlayId, overlay);
  }
  if (
    !Array.isArray(manifest.expressions) ||
    manifest.expressions.length !== 15
  ) {
    fail("expression list is invalid");
  }
  const byLabel = new Map();
  for (const [index, rawExpression] of manifest.expressions.entries()) {
    const expression = objectValue(rawExpression, "expression");
    const [label, baseId, mouthId, overlayId, mouthGain] =
      APPROVED_RECIPES[index];
    if (
      expression.label !== LABELS[index] ||
      expression.label !== label ||
      expression.mode !== "native-approved" ||
      expression.base_portrait_id !== baseId ||
      !byPortraitId.has(baseId) ||
      expression.mouth_gain_percent !== mouthGain ||
      typeof expression.closed_eye_expression !== "boolean" ||
      expression.overlay_id !== overlayId ||
      (overlayId !== null && !byOverlayId.has(overlayId)) ||
      byLabel.has(expression.label)
    ) {
      fail("expression identity is invalid");
    }
    const evidence = objectValue(
      expression.semantic_evidence,
      "semantic evidence",
    );
    if (
      !Array.isArray(evidence.required_cues) ||
      evidence.required_cues.length < 2 ||
      evidence.required_cues.some(
        (cue) => typeof cue !== "string" || cue.length === 0,
      ) ||
      typeof evidence.discriminator !== "string" ||
      evidence.discriminator.length === 0
    ) {
      fail("semantic evidence is invalid");
    }
    if (mouthId === null) {
      if (expression.mouth_layer !== null) fail("unexpected mouth layer");
    } else {
      const layer = objectValue(expression.mouth_layer, "mouth layer");
      const transform = objectValue(layer.transform, "mouth transform");
      finitePair(transform.source_center, "source center");
      finitePair(transform.target_center, "target center");
      if (
        layer.role !== "mouth_override" ||
        layer.portrait_id !== mouthId ||
        !byPortraitId.has(mouthId) ||
        transform.scale !== 1 ||
        transform.rotation_degrees !== 0 ||
        JSON.stringify(transform.source_center) !== "[0.5,0.5]" ||
        JSON.stringify(transform.target_center) !== "[0.5,0.5]" ||
        !Array.isArray(layer.masks) ||
        layer.masks.length !== 1
      ) {
        fail("mouth layer is invalid");
      }
      validateMask(layer.masks[0], "mouth mask");
    }
    byLabel.set(expression.label, expression);
  }
  return Object.freeze({ manifest, byPortraitId, byOverlayId, byLabel });
}

export function selectRinneSpiritExpression(catalog, label) {
  const expression = catalog?.byLabel?.get(label);
  if (expression === undefined) fail(`unknown expression label: ${label}`);
  return expression;
}
