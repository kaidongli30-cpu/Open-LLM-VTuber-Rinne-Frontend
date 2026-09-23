import { createHash } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  app,
  ipcMain,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { RinneSpiritAssetSource } from "./rinne-spirit-asset-source";
import { RinneCustomOutfitAssetSource } from "./rinne-custom-outfit-asset-source";

const FAMILY_MANIFEST_NAMES = Object.freeze([
  "outfit-manifest.json",
  "first-outfit-manifest.json",
]);
const FAMILY_MANIFEST_MAX_BYTES = 4 * 1024 * 1024;
const USER_SETTINGS_NAME = "rinne-legacy-renderer.json";
const CHANNELS = Object.freeze({
  status: "rinne-legacy:status",
  catalog: "rinne-legacy:load-catalog",
  portrait: "rinne-legacy:load-portrait",
  overlay: "rinne-legacy:load-overlay",
  customOutfit: "rinne-legacy:load-custom-outfit",
  refresh: "rinne-legacy:refresh",
});
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
const SHA256 = /^[0-9a-f]{64}$/;
const EMOTION_PORTRAIT_SUFFIX = Object.freeze({
  thinking: 1,
  neutral: 2,
  confused: 3,
  gentle: 4,
  awkward: 5,
  happy: 6,
  worried: 7,
  surprise: 8,
  surprised: 8,
  dissatisfaction: 9,
  flustered: 10,
  sad: 11,
  embarrassed: 12,
  shy: 13,
  uneasy: 14,
  angry: 15,
} as const);
const OUTFIT_FAMILY_METADATA = new Map<
  number,
  {
    outfitNumber: number;
    outfitId: string;
    manifestDisplayName: string;
    menuDisplayName: string;
    defaultPortraitId: number;
    portraitIdRange: readonly [number, number];
  }
>([
  [
    2,
    {
      outfitNumber: 2,
      outfitId: "rinne_mp0602_second_outfit",
      manifestDisplayName: "第二套衣服",
      menuDisplayName: "游戏原画：红白荷叶边便装",
      defaultPortraitId: 60202,
      portraitIdRange: [60201, 60215],
    },
  ],
  [
    3,
    {
      outfitNumber: 3,
      outfitId: "rinne_mp0603_red_cardigan_casual",
      manifestDisplayName: "红色开衫与棕色半身裙便装",
      menuDisplayName: "游戏原画：红色开衫与棕色半身裙便装",
      defaultPortraitId: 60302,
      portraitIdRange: [60301, 60315],
    },
  ],
  [
    4,
    {
      outfitNumber: 4,
      outfitId: "rinne_mp0604_dark_navy_winter_uniform",
      manifestDisplayName: "深蓝色冬季校服",
      menuDisplayName: "游戏原画：深蓝色冬季校服",
      defaultPortraitId: 60402,
      portraitIdRange: [60401, 60415],
    },
  ],
]);

type BoundFileName = keyof typeof FILE_BINDINGS;

interface FileEntry {
  name: BoundFileName;
  byte_length: number;
  sha256: string;
}

interface PortraitEntry {
  portrait_id: number;
  directory: string;
  files: FileEntry[];
}

interface OutfitManifest {
  format: string;
  version: number;
  outfit_number?: number;
  outfit_id?: string;
  display_name?: string;
  portrait_id_range?: number[];
  default_portrait_id: number;
  portrait_count: number;
  portraits: PortraitEntry[];
}

interface RinneLegacyStatus {
  available: boolean;
  reason: "ready" | "not_enabled" | "not_configured" | "invalid_bundle";
  defaultPortraitId?: number;
  portraitCount?: number;
  outfitNumber?: number;
  outfitDisplayName?: string;
  runtimeKind?: "outfit" | "spirit";
  canvasSize?: number;
  offlineAcceptance?: boolean;
  error?: string;
}

interface RinneLegacyUserSettings {
  version?: number;
  renderer?: string;
  first_outfit_dir?: string;
  outfit_dir?: string;
  outfit_id?: string;
  custom_outfit_dir?: string;
}

interface RinneLegacyRuntimeConfiguration {
  rendererMode: string;
  configuredPath?: string;
  configuredCustomOutfitPath?: string;
}

function loadRinneLegacyUserSettings(): RinneLegacyUserSettings {
  const configuredSettingsPath =
    process.env.RINNE_LEGACY_SETTINGS_PATH?.trim() ||
    process.env.RINNE_RENDERER_SETTINGS_PATH?.trim();
  const settingsPath =
    configuredSettingsPath ||
    resolve(app.getPath("userData"), USER_SETTINGS_NAME);
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings root must be an object");
    }
    return parsed as RinneLegacyUserSettings;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`Ignoring invalid Rinne legacy settings: ${String(error)}`);
    }
    return {};
  }
}

function resolveRinneLegacyRendererArgument(): string | undefined {
  const prefix = "--rinne-legacy-renderer=";
  return process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length)
    .trim();
}

function loadRinneLegacyRuntimeConfiguration(): RinneLegacyRuntimeConfiguration {
  const userSettings = loadRinneLegacyUserSettings();
  const userRenderer =
    typeof userSettings.renderer === "string"
      ? userSettings.renderer.trim()
      : undefined;
  const userOutfitDir =
    typeof userSettings.outfit_dir === "string"
      ? userSettings.outfit_dir.trim()
      : typeof userSettings.first_outfit_dir === "string"
        ? userSettings.first_outfit_dir.trim()
        : undefined;
  return {
    rendererMode: (
      resolveRinneLegacyRendererArgument() ??
      process.env.RINNE_LEGACY_RENDERER ??
      userRenderer ??
      "live2d"
    )
      .trim()
      .toLowerCase(),
    configuredPath:
      process.env.RINNE_LEGACY_OUTFIT_DIR?.trim() ||
      process.env.RINNE_LEGACY_FIRST_OUTFIT_DIR?.trim() ||
      userOutfitDir,
    configuredCustomOutfitPath:
      process.env.RINNE_LEGACY_CUSTOM_OUTFIT_DIR?.trim() ||
      (typeof userSettings.custom_outfit_dir === "string"
        ? userSettings.custom_outfit_dir.trim()
        : undefined),
  };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class RinneLegacyAssetSource {
  private constructor(
    private readonly familyRoot: string,
    private readonly familyManifestBytes: Buffer,
    private readonly familyManifest: OutfitManifest,
    private readonly outfitNumber: number,
    private readonly entriesById: Map<number, PortraitEntry>,
    private readonly customOutfit: RinneCustomOutfitAssetSource | null,
    readonly canvasSize: number,
  ) {}

  static async create(
    configuredPath: string,
    customOutfitPath?: string,
  ): Promise<RinneLegacyAssetSource> {
    const familyRoot = await fs.realpath(resolve(configuredPath));
    if (!(await fs.stat(familyRoot)).isDirectory()) {
      throw new Error("outfit path is not a directory");
    }
    let familyManifestBytes: Buffer | null = null;
    for (const manifestName of FAMILY_MANIFEST_NAMES) {
      const candidate = resolve(familyRoot, manifestName);
      if (dirname(candidate) !== familyRoot) {
        throw new Error("outfit manifest escaped its directory");
      }
      try {
        const realCandidate = await fs.realpath(candidate);
        if (dirname(realCandidate) !== familyRoot) {
          throw new Error("outfit manifest escaped its directory");
        }
        familyManifestBytes = await readBoundedFile(
          realCandidate,
          FAMILY_MANIFEST_MAX_BYTES,
        );
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (familyManifestBytes === null) {
      throw new Error("outfit manifest was not found");
    }
    let familyManifest: OutfitManifest;
    try {
      familyManifest = JSON.parse(
        familyManifestBytes.toString("utf8"),
      ) as OutfitManifest;
    } catch (error) {
      throw new Error(
        `outfit manifest is invalid JSON: ${errorMessage(error)}`,
      );
    }
    const isFirstOutfit =
      familyManifest?.format === "rinne-legacy-gpu-first-outfit" &&
      familyManifest.default_portrait_id === 60102;
    const familyMetadata = Number.isSafeInteger(familyManifest?.outfit_number)
      ? OUTFIT_FAMILY_METADATA.get(familyManifest.outfit_number as number)
      : undefined;
    const isLaterOutfit =
      familyManifest?.format === "rinne-legacy-gpu-outfit-family" &&
      familyMetadata !== undefined &&
      familyManifest.outfit_id === familyMetadata.outfitId &&
      familyManifest.display_name === familyMetadata.manifestDisplayName &&
      familyManifest.default_portrait_id === familyMetadata.defaultPortraitId &&
      JSON.stringify(familyManifest.portrait_id_range) ===
        JSON.stringify(familyMetadata.portraitIdRange);
    if (
      (!isFirstOutfit && !isLaterOutfit) ||
      familyManifest.version !== 1 ||
      familyManifest.portrait_count !== 15 ||
      !Array.isArray(familyManifest.portraits) ||
      familyManifest.portraits.length !== 15
    ) {
      throw new Error("outfit manifest header is invalid");
    }
    const outfitNumber = isFirstOutfit ? 1 : familyMetadata!.outfitNumber;
    if (customOutfitPath && !isFirstOutfit) {
      throw new Error("custom outfits require the first-outfit donor runtime");
    }
    const customOutfit = customOutfitPath
      ? await RinneCustomOutfitAssetSource.create(customOutfitPath)
      : null;
    const firstPortraitId = 60000 + outfitNumber * 100 + 1;
    const lastPortraitId = firstPortraitId + 14;
    const entriesById = new Map<number, PortraitEntry>();
    const requiredNames = Object.keys(FILE_BINDINGS);
    for (const [index, entry] of familyManifest.portraits.entries()) {
      const expectedDirectory = `MP${String(entry?.portrait_id).padStart(6, "0")}`;
      if (
        !Number.isSafeInteger(entry?.portrait_id) ||
        entry.portrait_id !== firstPortraitId + index ||
        entry.portrait_id < firstPortraitId ||
        entry.portrait_id > lastPortraitId ||
        entry.directory !== expectedDirectory ||
        !Array.isArray(entry.files) ||
        entry.files.length !== requiredNames.length ||
        entriesById.has(entry.portrait_id)
      ) {
        throw new Error("outfit portrait entry is invalid");
      }
      const actualNames = entry.files.map((file) => file?.name);
      if (
        actualNames.some((name) => !requiredNames.includes(name)) ||
        new Set(actualNames).size !== requiredNames.length ||
        entry.files.some(
          (file) =>
            !Number.isSafeInteger(file.byte_length) ||
            file.byte_length <= 0 ||
            typeof file.sha256 !== "string" ||
            !SHA256.test(file.sha256),
        )
      ) {
        throw new Error("outfit portrait file contract is invalid");
      }
      entriesById.set(entry.portrait_id, entry);
    }
    const requestedSize = Number(process.env.RINNE_LEGACY_CANVAS_SIZE ?? 2048);
    if (![512, 1024, 2048].includes(requestedSize)) {
      throw new Error("Rinne legacy canvas size must be 512, 1024, or 2048");
    }
    return new RinneLegacyAssetSource(
      familyRoot,
      familyManifestBytes,
      familyManifest,
      outfitNumber,
      entriesById,
      customOutfit,
      requestedSize,
    );
  }

  status(): RinneLegacyStatus {
    return {
      available: true,
      reason: "ready",
      runtimeKind: "outfit",
      defaultPortraitId: this.familyManifest.default_portrait_id,
      portraitCount: this.familyManifest.portrait_count,
      outfitNumber: this.outfitNumber,
      outfitDisplayName:
        this.customOutfit?.displayName ??
        (this.outfitNumber === 1
          ? "游戏原画：夏季校服"
          : OUTFIT_FAMILY_METADATA.get(this.outfitNumber)!.menuDisplayName),
      canvasSize: this.canvasSize,
    };
  }

  loadCatalog() {
    return {
      outfitManifestJson: Uint8Array.from(this.familyManifestBytes),
    };
  }

  async loadPortrait(portraitId: number) {
    if (!Number.isSafeInteger(portraitId)) {
      throw new TypeError("portrait id must be an integer");
    }
    const entry = this.entriesById.get(portraitId);
    if (entry === undefined) {
      throw new RangeError("portrait id is outside the selected outfit");
    }
    const portraitDirectory = await fs.realpath(
      resolve(this.familyRoot, entry.directory),
    );
    if (
      dirname(portraitDirectory) !== this.familyRoot ||
      !(await fs.stat(portraitDirectory)).isDirectory()
    ) {
      throw new Error("portrait directory escaped the outfit root");
    }
    const result: Record<string, number | Uint8Array> = { portraitId };
    for (const file of entry.files) {
      const maximum = MAX_FILE_BYTES[file.name];
      if (file.byte_length > maximum) {
        throw new Error(`${file.name} exceeds the desktop safety limit`);
      }
      const candidate = await fs.realpath(
        resolve(portraitDirectory, file.name),
      );
      if (dirname(candidate) !== portraitDirectory) {
        throw new Error("portrait file escaped its directory");
      }
      const payload = await readBoundedFile(
        candidate,
        maximum,
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

  async loadOverlay(_overlayId: string): Promise<Uint8Array> {
    throw new Error("the selected outfit does not provide spirit overlays");
  }

  loadCustomOutfit() {
    return this.customOutfit?.runtimePayload() ?? null;
  }

  async preflight(emotion?: string): Promise<void> {
    const normalized = emotion?.trim().toLowerCase() ?? "neutral";
    const suffix =
      EMOTION_PORTRAIT_SUFFIX[
        normalized as keyof typeof EMOTION_PORTRAIT_SUFFIX
      ] ?? EMOTION_PORTRAIT_SUFFIX.neutral;
    const portraitId = 60000 + this.outfitNumber * 100 + suffix;
    await this.loadPortrait(this.familyManifest.default_portrait_id);
    if (portraitId !== this.familyManifest.default_portrait_id) {
      await this.loadPortrait(portraitId);
    }
  }
}

export function registerRinneLegacyIpc(
  expectedSender: WebContents,
): () => void {
  let configuration = loadRinneLegacyRuntimeConfiguration();
  const offlineAcceptance =
    !app.isPackaged &&
    process.env.RINNE_LEGACY_OFFLINE_ACCEPTANCE?.trim() === "1";
  let sourcePromise: Promise<
    RinneLegacyAssetSource | RinneSpiritAssetSource
  > | null = null;

  const assertSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== expectedSender || expectedSender.isDestroyed()) {
      throw new Error("unexpected renderer requested Rinne legacy assets");
    }
  };

  const resolveSource = async (): Promise<
    RinneLegacyAssetSource | RinneSpiritAssetSource
  > => {
    if (configuration.rendererMode !== "rinne") {
      throw new Error("Rinne legacy renderer is not enabled");
    }
    if (!configuration.configuredPath) {
      throw new Error("Rinne legacy outfit directory is not configured");
    }
    sourcePromise ??= RinneSpiritAssetSource.createIfPresent(
      configuration.configuredPath,
    ).then(
      (spiritSource) =>
        spiritSource ??
        RinneLegacyAssetSource.create(
          configuration.configuredPath!,
          configuration.configuredCustomOutfitPath,
        ),
    );
    return sourcePromise;
  };

  const createCandidateSource = async (
    candidate: RinneLegacyRuntimeConfiguration,
    emotion?: string,
  ): Promise<RinneLegacyAssetSource | RinneSpiritAssetSource> => {
    if (candidate.rendererMode !== "rinne") {
      throw new Error("Rinne legacy renderer is not enabled");
    }
    if (!candidate.configuredPath) {
      throw new Error("Rinne legacy outfit directory is not configured");
    }
    const source = (
      (await RinneSpiritAssetSource.createIfPresent(candidate.configuredPath)) ??
      (await RinneLegacyAssetSource.create(
        candidate.configuredPath,
        candidate.configuredCustomOutfitPath,
      ))
    );
    await source.preflight(emotion);
    return source;
  };

  ipcMain.handle(CHANNELS.status, async (event): Promise<RinneLegacyStatus> => {
    assertSender(event);
    if (configuration.rendererMode !== "rinne") {
      return { available: false, reason: "not_enabled" };
    }
    if (!configuration.configuredPath) {
      return { available: false, reason: "not_configured" };
    }
    try {
      return {
        ...(await resolveSource()).status(),
        offlineAcceptance,
      };
    } catch (error) {
      return {
        available: false,
        reason: "invalid_bundle",
        error: errorMessage(error),
      };
    }
  });
  ipcMain.handle(CHANNELS.catalog, async (event) => {
    assertSender(event);
    return (await resolveSource()).loadCatalog();
  });
  ipcMain.handle(CHANNELS.portrait, async (event, portraitId: number) => {
    assertSender(event);
    return (await resolveSource()).loadPortrait(portraitId);
  });
  ipcMain.handle(CHANNELS.overlay, async (event, overlayId: string) => {
    assertSender(event);
    return (await resolveSource()).loadOverlay(overlayId);
  });
  ipcMain.handle(CHANNELS.customOutfit, async (event) => {
    assertSender(event);
    const source = await resolveSource();
    return source instanceof RinneLegacyAssetSource
      ? source.loadCustomOutfit()
      : null;
  });
  ipcMain.handle(CHANNELS.refresh, async (
    event,
    emotion?: string,
  ): Promise<RinneLegacyStatus> => {
    assertSender(event);
    const candidate = loadRinneLegacyRuntimeConfiguration();
    const candidateSource = await createCandidateSource(candidate, emotion);
    // Commit the new source only after every manifest and required asset has
    // passed the same validation used during startup. A failed refresh leaves
    // the previous outfit fully usable.
    configuration = candidate;
    sourcePromise = Promise.resolve(candidateSource);
    return {
      ...candidateSource.status(),
      offlineAcceptance,
    };
  });

  return () => {
    ipcMain.removeHandler(CHANNELS.status);
    ipcMain.removeHandler(CHANNELS.catalog);
    ipcMain.removeHandler(CHANNELS.portrait);
    ipcMain.removeHandler(CHANNELS.overlay);
    ipcMain.removeHandler(CHANNELS.customOutfit);
    ipcMain.removeHandler(CHANNELS.refresh);
  };
}
