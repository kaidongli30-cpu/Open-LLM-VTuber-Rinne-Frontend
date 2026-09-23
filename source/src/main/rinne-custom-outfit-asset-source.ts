import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, resolve, sep } from "node:path";

const MANIFEST_NAME = "custom-outfit-preview.json";
const MANIFEST_FORMAT = "rinne-custom-outfit-layered-preview";
const MANIFEST_MAX_BYTES = 1024 * 1024;
const ASSET_MAX_BYTES = 32 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const NATIVE_HIDDEN_DRAW_TYPES = Object.freeze([
  3, 4, 8, 11, 15, 16, 22, 24, 25,
]);
const ASSET_PATHS = Object.freeze({
  body: "layers/body.png",
  native_head_mask: "layers/native-head-mask.png",
  neutral_proof: "evidence/neutral-composite-proof.png",
});
const EXPRESSION_LABELS = Object.freeze([
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

interface CustomOutfitAsset {
  role: keyof typeof ASSET_PATHS;
  file: string;
  byte_length: number;
  sha256: string;
  canvas: number[];
  mode: string;
}

interface CustomOutfitManifest {
  preview_body_extension?: {
    file: string;
    width: number;
    height: number;
    sha256: string;
  };
  format: string;
  version: number;
  stage: string;
  outfit_id: string;
  display_name: string;
  canvas: number[];
  asset_count: number;
  assets: CustomOutfitAsset[];
  donor_runtime: {
    outfit_number: number;
    portrait_id_range: number[];
    default_portrait_id: number;
    expression_labels: string[];
    shy_base_portrait_id: number;
    shy_mouth_portrait_id: number;
  };
  composition: {
    layer_order: string[];
    native_head_mask_role: string;
    native_hidden_draw_types?: number[];
    native_head_translation_pixels?: number[];
    body_translation_pixels?: number[];
    body_breath: {
      horizontal_motion_pixels: number;
      vertical_motion_pixels: number;
      scale_y_peak: number;
      transform_origin: number[];
    };
    mouth_gain_percent: Record<string, number>;
    desktop_stable_required: boolean;
  };
  provenance: {
    source_reference_sha256: string;
    native_face_and_hair_are_runtime_donor: boolean;
    generated_face_and_hair_are_not_delivered: boolean;
  };
  source_policy: {
    original_game_files_remain_read_only: boolean;
    desktop_pet_remains_untouched: boolean;
    uses_prerendered_frame_sequence: boolean;
    uses_video_playback: boolean;
    requires_user_acceptance_before_integration: boolean;
  };
}

export interface RinneCustomOutfitRuntimePayload {
  bodyExtensionPng?: Uint8Array;
  manifest: CustomOutfitManifest;
  bodyPng: Uint8Array;
  nativeHeadMaskPng?: Uint8Array;
}

async function readBoundedFile(
  candidate: string,
  maximum: number,
  expectedLength?: number,
): Promise<Buffer> {
  const stat = await fs.stat(candidate);
  if (
    !stat.isFile() ||
    stat.size <= 0 ||
    stat.size > maximum ||
    (expectedLength !== undefined && stat.size !== expectedLength)
  ) {
    throw new Error(`${basename(candidate)} violates its size contract`);
  }
  return fs.readFile(candidate);
}

function sha256(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

function assertPng2048(payload: Buffer, label: string): void {
  if (
    payload.length < 33 ||
    !payload.subarray(0, 8).equals(PNG_SIGNATURE) ||
    payload.toString("ascii", 12, 16) !== "IHDR" ||
    payload.readUInt32BE(16) !== 2048 ||
    payload.readUInt32BE(20) !== 2048 ||
    payload[24] !== 8 ||
    payload[25] !== 6
  ) {
    throw new Error(`${label} must be a 2048 x 2048 RGBA PNG`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validTranslation(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length === 2 &&
      value.every(
        (coordinate) =>
          Number.isInteger(coordinate) && Math.abs(coordinate) <= 16,
      ))
  );
}

function validateManifest(manifest: CustomOutfitManifest): void {
  const donor = manifest?.donor_runtime;
  const composition = manifest?.composition;
  const provenance = manifest?.provenance;
  const policy = manifest?.source_policy;
  if (
    manifest?.format !== MANIFEST_FORMAT ||
    manifest.version !== 1 ||
    manifest.stage !== "offline-user-acceptance-before-desktop-integration" ||
    !sameJson(manifest.canvas, [2048, 2048]) ||
    typeof manifest.outfit_id !== "string" ||
    manifest.outfit_id.length === 0 ||
    typeof manifest.display_name !== "string" ||
    manifest.display_name.length === 0 ||
    ![1, 2, 3].includes(manifest.asset_count) ||
    (manifest.asset_count === 1 &&
      !sameJson(composition?.native_hidden_draw_types, NATIVE_HIDDEN_DRAW_TYPES)) ||
    donor?.outfit_number !== 1 ||
    !sameJson(donor?.portrait_id_range, [60101, 60115]) ||
    donor?.default_portrait_id !== 60102 ||
    !sameJson(donor?.expression_labels, EXPRESSION_LABELS) ||
    donor?.shy_base_portrait_id !== 60113 ||
    donor?.shy_mouth_portrait_id !== 60104 ||
    !sameJson(composition?.layer_order, ["body", "native_head", "shy_mouth"]) ||
    composition?.native_head_mask_role !== "native_head_mask" ||
    (composition?.native_hidden_draw_types !== undefined &&
      !sameJson(
        composition.native_hidden_draw_types,
        NATIVE_HIDDEN_DRAW_TYPES,
      )) ||
    !validTranslation(composition?.native_head_translation_pixels) ||
    !validTranslation(composition?.body_translation_pixels) ||
    composition?.body_breath?.horizontal_motion_pixels !== 0 ||
    composition?.body_breath?.vertical_motion_pixels !== 1.5 ||
    composition?.body_breath?.scale_y_peak !== 1.0015 ||
    !sameJson(composition?.body_breath?.transform_origin, [0.5, 0.82]) ||
    composition?.mouth_gain_percent?.neutral !== 68 ||
    composition?.mouth_gain_percent?.happy !== 68 ||
    composition?.mouth_gain_percent?.default !== 100 ||
    Object.keys(composition?.mouth_gain_percent ?? {}).length !== 3 ||
    composition?.desktop_stable_required !== true ||
    provenance?.native_face_and_hair_are_runtime_donor !== true ||
    provenance?.generated_face_and_hair_are_not_delivered !== true ||
    typeof provenance?.source_reference_sha256 !== "string" ||
    !SHA256.test(provenance.source_reference_sha256) ||
    policy?.original_game_files_remain_read_only !== true ||
    policy?.desktop_pet_remains_untouched !== true ||
    policy?.uses_prerendered_frame_sequence !== false ||
    policy?.uses_video_playback !== false ||
    policy?.requires_user_acceptance_before_integration !== true
  ) {
    throw new Error("custom outfit manifest contract is invalid");
  }
}

export class RinneCustomOutfitAssetSource {
  private constructor(
    readonly outfitId: string,
    readonly displayName: string,
    private readonly manifest: CustomOutfitManifest,
    private readonly bodyPng: Buffer,
    private readonly nativeHeadMaskPng?: Buffer,
    private readonly bodyExtensionPng?: Buffer,
  ) {}

  static async create(
    configuredPath: string,
  ): Promise<RinneCustomOutfitAssetSource> {
    const root = await fs.realpath(resolve(configuredPath));
    if (!(await fs.stat(root)).isDirectory()) {
      throw new Error("custom outfit path is not a directory");
    }
    const manifestPath = await fs.realpath(resolve(root, MANIFEST_NAME));
    if (!manifestPath.startsWith(`${root}${sep}`)) {
      throw new Error("custom outfit manifest escaped its directory");
    }
    const manifestBytes = await readBoundedFile(
      manifestPath,
      MANIFEST_MAX_BYTES,
    );
    let manifest: CustomOutfitManifest;
    try {
      manifest = JSON.parse(
        manifestBytes.toString("utf8"),
      ) as CustomOutfitManifest;
    } catch (error) {
      throw new Error(
        `custom outfit manifest is invalid JSON: ${String(error)}`,
      );
    }
    validateManifest(manifest);
    if (
      !Array.isArray(manifest.assets) ||
      manifest.assets.length !== manifest.asset_count
    ) {
      throw new Error("custom outfit asset list is invalid");
    }

    const verified = new Map<keyof typeof ASSET_PATHS, Buffer>();
    for (const asset of manifest.assets) {
      const expectedPath = ASSET_PATHS[asset?.role];
      if (
        expectedPath === undefined ||
        verified.has(asset.role) ||
        asset.file !== expectedPath ||
        !Number.isSafeInteger(asset.byte_length) ||
        asset.byte_length <= 0 ||
        asset.byte_length > ASSET_MAX_BYTES ||
        typeof asset.sha256 !== "string" ||
        !SHA256.test(asset.sha256) ||
        !sameJson(asset.canvas, [2048, 2048]) ||
        asset.mode !== "RGBA"
      ) {
        throw new Error("custom outfit asset entry is invalid");
      }
      const candidate = await fs.realpath(
        resolve(root, ...asset.file.split("/")),
      );
      if (!candidate.startsWith(`${root}${sep}`)) {
        throw new Error("custom outfit asset escaped its directory");
      }
      const payload = await readBoundedFile(
        candidate,
        ASSET_MAX_BYTES,
        asset.byte_length,
      );
      if (sha256(payload) !== asset.sha256) {
        throw new Error(`custom outfit ${asset.role} hash changed`);
      }
      assertPng2048(payload, `custom outfit ${asset.role}`);
      verified.set(asset.role, payload);
    }
    const bodyPng = verified.get("body");
    const nativeHeadMaskPng = verified.get("native_head_mask");
    if (
      bodyPng === undefined ||
      (manifest.asset_count !== 1 && nativeHeadMaskPng === undefined) ||
      (manifest.asset_count === 1 && verified.size !== 1)
    ) {
      throw new Error("custom outfit render layers are missing");
    }
    let bodyExtensionPng: Buffer | undefined;
    const extension = manifest.preview_body_extension;
    if (extension !== undefined) {
      if (
        extension.file !== "layers/body-extended.png" ||
        extension.width !== 2048 ||
        !Number.isSafeInteger(extension.height) ||
        extension.height <= 2048 ||
        extension.height > 2400 ||
        !SHA256.test(extension.sha256)
      ) {
        throw new Error("custom outfit body extension contract is invalid");
      }
      const candidate = await fs.realpath(resolve(root, extension.file));
      if (!candidate.startsWith(`${root}${sep}`))
        throw new Error("body extension escaped its directory");
      bodyExtensionPng = await readBoundedFile(candidate, ASSET_MAX_BYTES);
      const png = bodyExtensionPng;
      if (
        png.length < 33 ||
        !png.subarray(0, 8).equals(PNG_SIGNATURE) ||
        png.toString("ascii", 12, 16) !== "IHDR" ||
        png[24] !== 8 ||
        png[25] !== 6 ||
        png.readUInt32BE(16) !== 2048 ||
        png.readUInt32BE(20) !== extension.height ||
        sha256(png) !== extension.sha256
      ) {
        throw new Error(
          "custom outfit body extension dimensions or hash changed",
        );
      }
    }
    return new RinneCustomOutfitAssetSource(
      manifest.outfit_id,
      manifest.display_name,
      manifest,
      bodyPng,
      nativeHeadMaskPng,
      bodyExtensionPng,
    );
  }

  runtimePayload(): RinneCustomOutfitRuntimePayload {
    return {
      manifest: this.manifest,
      bodyPng: Uint8Array.from(this.bodyPng),
      ...(this.nativeHeadMaskPng
        ? { nativeHeadMaskPng: Uint8Array.from(this.nativeHeadMaskPng) }
        : {}),
      ...(this.bodyExtensionPng
        ? { bodyExtensionPng: Uint8Array.from(this.bodyExtensionPng) }
        : {}),
    };
  }
}
