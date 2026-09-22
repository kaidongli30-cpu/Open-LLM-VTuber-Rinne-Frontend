import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const MANIFEST_NAME = "spirit-expression-preview.json";
const MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const OVERLAY_MAX_BYTES = 16 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_BINDINGS = Object.freeze({
  "manifest.json": "manifestJson",
  "texture.rgba8": "textureRgba8",
  "geometry.bin": "geometryBinary",
  "dynamic-manifest.json": "dynamicManifestJson",
  "deformation.rgba32f": "deformationRgba32f",
  "eye-dynamic-manifest.json": "eyeManifestJson",
  "eye-deformation.rgba32f": "eyeDeformationRgba32f",
  "runtime-control-manifest.json": "runtimeControlManifestJson",
  "timeline-manifest.json": "timelineManifestJson",
  "amb-channels.f32": "ambChannelsF32",
});
const MAX_FILE_BYTES = Object.freeze({
  "manifest.json": 4 * 1024 * 1024,
  "texture.rgba8": 128 * 1024 * 1024,
  "geometry.bin": 256 * 1024 * 1024,
  "dynamic-manifest.json": 4 * 1024 * 1024,
  "deformation.rgba32f": 64 * 1024 * 1024,
  "eye-dynamic-manifest.json": 4 * 1024 * 1024,
  "eye-deformation.rgba32f": 64 * 1024 * 1024,
  "runtime-control-manifest.json": 4 * 1024 * 1024,
  "timeline-manifest.json": 4 * 1024 * 1024,
  "amb-channels.f32": 64 * 1024 * 1024,
});
const PORTRAIT_IDS = Object.freeze(
  Array.from({ length: 7 }, (_value, index) => 160101 + index),
);
const OVERLAY_IDS = Object.freeze([
  "awkward-embarrassed-sweat",
  "flustered-blush",
  "shy-blush",
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
] as const);

type BoundFileName = keyof typeof FILE_BINDINGS;

interface FileEntry {
  name: BoundFileName;
  byte_length: number;
  sha256: string;
}

interface PortraitEntry {
  portrait_id: number;
  directory: string;
  source_family: string;
  files: FileEntry[];
}

interface OverlayEntry {
  overlay_id: string;
  file: string;
  byte_length: number;
  sha256: string;
}

interface MouthLayer {
  role: string;
  portrait_id: number;
  masks: unknown[];
}

interface ExpressionEntry {
  label: string;
  mode: string;
  base_portrait_id: number;
  mouth_gain_percent: number;
  mouth_layer: MouthLayer | null;
  overlay_id: string | null;
}

interface SpiritManifest {
  format: string;
  version: number;
  stage: string;
  display_name: string;
  canvas: number[];
  portrait_count: number;
  overlay_count: number;
  expression_count: number;
  complete_fifteen_label_set: boolean;
  default_expression: string;
  source_policy?: {
    uses_first_outfit_face_transplant?: boolean;
    approved_local_cues_only?: boolean;
  };
  portraits: PortraitEntry[];
  overlays: OverlayEntry[];
  expressions: ExpressionEntry[];
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

function validFileEntry(
  entry: FileEntry,
  expectedName: BoundFileName,
): boolean {
  return (
    entry?.name === expectedName &&
    Number.isSafeInteger(entry.byte_length) &&
    entry.byte_length > 0 &&
    entry.byte_length <= MAX_FILE_BYTES[expectedName] &&
    typeof entry.sha256 === "string" &&
    SHA256.test(entry.sha256)
  );
}

export class RinneSpiritAssetSource {
  private constructor(
    private readonly root: string,
    private readonly manifestBytes: Buffer,
    private readonly manifest: SpiritManifest,
    private readonly portraitsById: Map<number, PortraitEntry>,
    private readonly overlaysById: Map<string, OverlayEntry>,
    readonly canvasSize: number,
  ) {}

  static async createIfPresent(
    configuredPath: string,
  ): Promise<RinneSpiritAssetSource | null> {
    const root = await fs.realpath(resolve(configuredPath));
    if (!(await fs.stat(root)).isDirectory()) {
      throw new Error("spirit-dress path is not a directory");
    }
    const manifestCandidate = resolve(root, MANIFEST_NAME);
    if (dirname(manifestCandidate) !== root) {
      throw new Error("spirit-dress manifest escaped its directory");
    }
    let realManifest: string;
    try {
      realManifest = await fs.realpath(manifestCandidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (dirname(realManifest) !== root) {
      throw new Error("spirit-dress manifest escaped its directory");
    }
    const manifestBytes = await readBoundedFile(
      realManifest,
      MANIFEST_MAX_BYTES,
    );
    let manifest: SpiritManifest;
    try {
      manifest = JSON.parse(manifestBytes.toString("utf8")) as SpiritManifest;
    } catch (error) {
      throw new Error(
        `spirit-dress manifest is invalid JSON: ${String(error)}`,
      );
    }
    if (
      manifest?.format !== "rinne-spirit-dress-expression-preview" ||
      manifest.version !== 3 ||
      manifest.stage !== "approved-fifteen-native-runtime" ||
      manifest.display_name !== "灵装凛祢" ||
      JSON.stringify(manifest.canvas) !== "[4096,4096]" ||
      manifest.portrait_count !== 7 ||
      manifest.overlay_count !== 3 ||
      manifest.expression_count !== 15 ||
      manifest.complete_fifteen_label_set !== true ||
      manifest.default_expression !== "neutral" ||
      manifest.source_policy?.uses_first_outfit_face_transplant !== false ||
      manifest.source_policy?.approved_local_cues_only !== true ||
      !Array.isArray(manifest.portraits) ||
      manifest.portraits.length !== 7 ||
      !Array.isArray(manifest.overlays) ||
      manifest.overlays.length !== 3 ||
      !Array.isArray(manifest.expressions) ||
      manifest.expressions.length !== 15
    ) {
      throw new Error("spirit-dress manifest header is invalid");
    }

    const requiredNames = Object.keys(FILE_BINDINGS) as BoundFileName[];
    const portraitsById = new Map<number, PortraitEntry>();
    for (const [index, entry] of manifest.portraits.entries()) {
      const portraitId = PORTRAIT_IDS[index];
      if (
        entry?.portrait_id !== portraitId ||
        entry.directory !== `MP${portraitId}` ||
        entry.source_family !== "spirit-native" ||
        !Array.isArray(entry.files) ||
        entry.files.length !== requiredNames.length ||
        entry.files.some(
          (file, fileIndex) => !validFileEntry(file, requiredNames[fileIndex]),
        ) ||
        portraitsById.has(portraitId)
      ) {
        throw new Error("spirit-dress portrait entry is invalid");
      }
      portraitsById.set(portraitId, entry);
    }

    const overlaysById = new Map<string, OverlayEntry>();
    for (const [index, overlay] of manifest.overlays.entries()) {
      const overlayId = OVERLAY_IDS[index];
      if (
        overlay?.overlay_id !== overlayId ||
        overlay.file !== `overlays/${overlayId}.png` ||
        !Number.isSafeInteger(overlay.byte_length) ||
        overlay.byte_length <= 0 ||
        overlay.byte_length > OVERLAY_MAX_BYTES ||
        typeof overlay.sha256 !== "string" ||
        !SHA256.test(overlay.sha256) ||
        overlaysById.has(overlayId)
      ) {
        throw new Error("spirit-dress overlay entry is invalid");
      }
      overlaysById.set(overlayId, overlay);
    }

    for (const [index, expression] of manifest.expressions.entries()) {
      const [label, baseId, mouthId, overlayId, mouthGain] =
        APPROVED_RECIPES[index];
      if (
        expression?.label !== label ||
        expression.mode !== "native-approved" ||
        expression.base_portrait_id !== baseId ||
        !portraitsById.has(baseId) ||
        expression.mouth_gain_percent !== mouthGain ||
        expression.overlay_id !== overlayId ||
        (overlayId !== null && !overlaysById.has(overlayId)) ||
        (mouthId === null
          ? expression.mouth_layer !== null
          : expression.mouth_layer?.role !== "mouth_override" ||
            expression.mouth_layer.portrait_id !== mouthId ||
            !portraitsById.has(mouthId) ||
            !Array.isArray(expression.mouth_layer.masks) ||
            expression.mouth_layer.masks.length !== 1)
      ) {
        throw new Error("spirit-dress expression recipe is invalid");
      }
    }

    const requestedSize = Number(process.env.RINNE_LEGACY_CANVAS_SIZE ?? 2048);
    if (![512, 1024, 2048].includes(requestedSize)) {
      throw new Error("Rinne legacy canvas size must be 512, 1024, or 2048");
    }
    return new RinneSpiritAssetSource(
      root,
      manifestBytes,
      manifest,
      portraitsById,
      overlaysById,
      requestedSize,
    );
  }

  status() {
    return {
      available: true,
      reason: "ready" as const,
      runtimeKind: "spirit" as const,
      defaultPortraitId: 160101,
      portraitCount: this.manifest.portrait_count,
      outfitDisplayName: "游戏原画：灵装凛祢",
      canvasSize: this.canvasSize,
    };
  }

  loadCatalog() {
    return {
      spiritExpressionManifestJson: Uint8Array.from(this.manifestBytes),
    };
  }

  async loadPortrait(portraitId: number) {
    if (!Number.isSafeInteger(portraitId)) {
      throw new TypeError("portrait id must be an integer");
    }
    const entry = this.portraitsById.get(portraitId);
    if (entry === undefined) {
      throw new RangeError("portrait id is outside the spirit-dress family");
    }
    const portraitDirectory = await fs.realpath(
      resolve(this.root, entry.directory),
    );
    if (
      dirname(portraitDirectory) !== this.root ||
      !(await fs.stat(portraitDirectory)).isDirectory()
    ) {
      throw new Error("spirit-dress portrait directory escaped its root");
    }
    const result: Record<string, number | Uint8Array> = { portraitId };
    for (const file of entry.files) {
      const candidate = await fs.realpath(
        resolve(portraitDirectory, file.name),
      );
      if (dirname(candidate) !== portraitDirectory) {
        throw new Error("spirit-dress portrait file escaped its directory");
      }
      const payload = await readBoundedFile(
        candidate,
        MAX_FILE_BYTES[file.name],
        file.byte_length,
      );
      const digest = createHash("sha256").update(payload).digest("hex");
      if (digest !== file.sha256) {
        throw new Error(`${entry.directory}/${file.name} hash changed`);
      }
      result[FILE_BINDINGS[file.name]] = Uint8Array.from(payload);
    }
    return result;
  }

  async loadOverlay(overlayId: string): Promise<Uint8Array> {
    const entry = this.overlaysById.get(overlayId);
    if (entry === undefined) {
      throw new RangeError("overlay id is outside the approved spirit set");
    }
    const overlayDirectory = resolve(this.root, "overlays");
    const candidate = await fs.realpath(resolve(this.root, entry.file));
    if (dirname(candidate) !== overlayDirectory) {
      throw new Error("spirit-dress overlay escaped its directory");
    }
    const payload = await readBoundedFile(
      candidate,
      OVERLAY_MAX_BYTES,
      entry.byte_length,
    );
    const digest = createHash("sha256").update(payload).digest("hex");
    if (digest !== entry.sha256) {
      throw new Error(`${entry.file} hash changed`);
    }
    return Uint8Array.from(payload);
  }

  async preflight(emotion?: string): Promise<void> {
    const normalized = emotion?.trim().toLowerCase() === "surprise"
      ? "surprised"
      : emotion?.trim().toLowerCase() || this.manifest.default_expression;
    const selected = this.manifest.expressions.find(
      (entry) => entry.label === normalized,
    ) ?? this.manifest.expressions.find(
      (entry) => entry.label === this.manifest.default_expression,
    );
    const mouthDonor = this.manifest.expressions.find(
      (entry) => entry.mouth_layer !== null,
    )?.mouth_layer?.portrait_id;
    if (!selected || !Number.isSafeInteger(mouthDonor)) {
      throw new Error("spirit-dress preflight expression is unavailable");
    }
    const portraitIds = new Set([
      160101,
      mouthDonor as number,
      selected.base_portrait_id,
      selected.mouth_layer?.portrait_id,
    ]);
    portraitIds.delete(undefined);
    for (const portraitId of portraitIds) {
      await this.loadPortrait(portraitId as number);
    }
    if (selected.overlay_id) {
      await this.loadOverlay(selected.overlay_id);
    }
  }
}
