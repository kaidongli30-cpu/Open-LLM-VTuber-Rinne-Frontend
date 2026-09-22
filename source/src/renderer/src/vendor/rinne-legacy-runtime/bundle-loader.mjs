const FORMAT = "rinne-legacy-gpu-bundle";
const VERSION = 1;
const PASS_NAMES = [
  "eye_buffer",
  "mask_buffer",
  "before_trigger",
  "final_eye_overlay",
  "after_trigger",
];
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 128 * 1024 * 1024;
const MAX_GEOMETRY_BYTES = 256 * 1024 * 1024;

function fail(message) {
  throw new Error(`invalid Rinne GPU bundle: ${message}`);
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

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function finiteArray(value, label, expectedLength = null) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    (expectedLength !== null && value.length !== expectedLength) ||
    value.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    fail(`${label} contains invalid numbers`);
  }
  return value;
}

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    fail("Web Crypto SHA-256 is unavailable");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function bufferView(value, geometryLength, componentType, componentCount) {
  const view = objectValue(value, "buffer view");
  if (view.component_type !== componentType) {
    fail("buffer component type does not match the schema");
  }
  const offset = integer(view.byte_offset, "buffer byte offset");
  const length = integer(view.byte_length, "buffer byte length");
  const count = integer(view.component_count, "buffer component count");
  if (
    offset % 4 !== 0 ||
    count !== componentCount ||
    length !== count * 4 ||
    offset + length > geometryLength
  ) {
    fail("buffer view exceeds geometry bounds");
  }
  return { offset, length, count, componentType };
}

function verifyFloatView(geometry, view, label) {
  const values = new Float32Array(geometry.buffer, view.offset, view.count);
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      fail(`${label} contains a non-finite float at ${index}`);
    }
  }
  return values;
}

function verifyIndexView(geometry, view, vertexCount) {
  const values = new Uint32Array(geometry.buffer, view.offset, view.count);
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] >= vertexCount) {
      fail(
        `triangle index ${values[index]} exceeds vertex count ${vertexCount}`,
      );
    }
  }
  return values;
}

function supportedRinnePortraitId(portraitId) {
  const family = Math.trunc(portraitId / 100);
  const suffix = portraitId % 100;
  return (
    (family >= 601 && family <= 604 && suffix >= 1 && suffix <= 15) ||
    (family === 1601 && suffix >= 1 && suffix <= 7)
  );
}

function verifySource(value) {
  const source = objectValue(value, "source");
  const portraitId = integer(source.portrait_id, "portrait id", 1);
  if (
    !supportedRinnePortraitId(portraitId) ||
    source.filename !== `MP${portraitId.toString().padStart(6, "0")}.pck` ||
    integer(source.pck_size, "PCK size", 1) <= 0 ||
    typeof source.pck_sha256 !== "string" ||
    !SHA256.test(source.pck_sha256)
  ) {
    fail("source identity is inconsistent");
  }
  const members = objectValue(source.parsed_member_sha256, "member hashes");
  const expected = ["face.mpb", "tex_all.tex", "face.uca.bin", "001.amb"];
  if (
    Object.keys(members).sort().join("\0") !== expected.sort().join("\0") ||
    expected.some(
      (name) =>
        typeof members[name] !== "string" || !SHA256.test(members[name]),
    )
  ) {
    fail("parsed member hashes are invalid");
  }
}

function verifyReference(value) {
  const reference = objectValue(value, "reference");
  integer(reference.canvas_width, "reference width", 1);
  integer(reference.canvas_height, "reference height", 1);
  integer(reference.compositor_trigger_type, "compositor trigger");
  if (
    typeof reference.rgba_sha256 !== "string" ||
    !SHA256.test(reference.rgba_sha256)
  ) {
    fail("reference RGBA hash is invalid");
  }
  finiteArray(reference.expression_weights, "expression weights");
  finiteArray(reference.blink_deformation, "blink deformation", 4);
  finiteArray(reference.blink_base_weights, "blink base weights", 4);
}

export async function validateRinneGpuBundle(
  input,
  { preverified = false } = {},
) {
  if (typeof preverified !== "boolean") {
    fail("preverified option must be boolean");
  }
  const manifestBytes = ownBytes(
    input.manifestJson,
    "manifest",
    MAX_MANIFEST_BYTES,
  );
  const texture = ownBytes(
    input.textureRgba8,
    "texture",
    MAX_TEXTURE_BYTES,
    !preverified,
  );
  const geometry = ownBytes(
    input.geometryBinary,
    "geometry",
    MAX_GEOMETRY_BYTES,
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
  const expectedCapabilities = [
    "resolved_static_draw_plan",
    "original_rgba8_atlas",
    "legacy_delayed_eye_pass_graph",
    "cpu_reference_hash",
  ];
  if (
    JSON.stringify(manifest.capabilities) !==
    JSON.stringify(expectedCapabilities)
  ) {
    fail("capability list is invalid");
  }
  if (
    !Array.isArray(manifest.dynamic_controls) ||
    manifest.dynamic_controls.length !== 0
  ) {
    fail("version 1 must not claim dynamic controls");
  }
  const requirements = objectValue(
    manifest.runtime_requirements,
    "runtime requirements",
  );
  if (
    requirements.graphics_api !== "WebGL2" ||
    requirements.little_endian_buffers !== true ||
    requirements.uint32_element_indices !== true
  ) {
    fail("runtime requirements are unsupported");
  }
  verifySource(manifest.source);
  verifyReference(manifest.reference);

  const textureInfo = objectValue(manifest.texture, "texture metadata");
  const textureWidth = integer(textureInfo.width, "texture width", 1);
  const textureHeight = integer(textureInfo.height, "texture height", 1);
  if (
    textureInfo.file !== "texture.rgba8" ||
    textureInfo.format !== "rgba8_unorm" ||
    textureInfo.row_order !== "top_to_bottom" ||
    textureInfo.byte_length !== texture.byteLength ||
    texture.byteLength !== textureWidth * textureHeight * 4 ||
    (!preverified && textureInfo.sha256 !== (await sha256Hex(texture)))
  ) {
    fail("texture metadata or SHA-256 does not match bytes");
  }

  const geometryInfo = objectValue(manifest.geometry, "geometry metadata");
  if (
    geometryInfo.file !== "geometry.bin" ||
    geometryInfo.byte_length !== geometry.byteLength ||
    (!preverified && geometryInfo.sha256 !== (await sha256Hex(geometry)))
  ) {
    fail("geometry metadata or SHA-256 does not match bytes");
  }
  if (
    !Array.isArray(geometryInfo.passes) ||
    geometryInfo.passes.map((item) => item?.name).join("\0") !==
      PASS_NAMES.join("\0")
  ) {
    fail("pass graph is invalid");
  }
  let cursor = 0;
  let totalMeshes = 0;
  const passes = new Map();
  for (const pass of geometryInfo.passes) {
    objectValue(pass, "pass");
    if (!Array.isArray(pass.meshes)) {
      fail("pass meshes must be an array");
    }
    totalMeshes += pass.meshes.length;
    if (totalMeshes > 256) {
      fail("mesh count exceeds safety limit");
    }
    const meshes = [];
    for (let meshIndex = 0; meshIndex < pass.meshes.length; meshIndex += 1) {
      const mesh = objectValue(pass.meshes[meshIndex], "mesh");
      const vertexCount = integer(mesh.vertex_count, "vertex count");
      const indexCount = integer(mesh.index_count, "index count");
      if (
        mesh.mesh_index !== meshIndex ||
        indexCount % 3 !== 0 ||
        mesh.triangle_count !== indexCount / 3 ||
        typeof mesh.opacity !== "number" ||
        !Number.isFinite(mesh.opacity) ||
        mesh.opacity < 0 ||
        mesh.opacity > 1 ||
        typeof mesh.depth_write !== "boolean" ||
        !["nearest", "linear"].includes(mesh.texture_filter)
      ) {
        fail("mesh metadata is invalid");
      }
      const positionView = bufferView(
        mesh.positions,
        geometry.byteLength,
        "float32",
        vertexCount * 3,
      );
      const uvView = bufferView(
        mesh.uvs,
        geometry.byteLength,
        "float32",
        vertexCount * 2,
      );
      const indexView = bufferView(
        mesh.indices,
        geometry.byteLength,
        "uint32",
        indexCount,
      );
      const orderedViews = [positionView, uvView, indexView];
      let vertexOpacityView = null;
      if (Object.hasOwn(mesh, "vertex_opacities")) {
        vertexOpacityView = bufferView(
          mesh.vertex_opacities,
          geometry.byteLength,
          "float32",
          vertexCount,
        );
        orderedViews.push(vertexOpacityView);
      }
      for (const view of orderedViews) {
        if (view.offset !== cursor) {
          fail("buffer views are not in canonical order");
        }
        cursor += view.length;
      }
      meshes.push({
        descriptor: mesh,
        positions: verifyFloatView(geometry, positionView, "positions"),
        uvs: verifyFloatView(geometry, uvView, "UVs"),
        indices: verifyIndexView(geometry, indexView, vertexCount),
        vertexOpacities:
          vertexOpacityView === null
            ? null
            : verifyFloatView(geometry, vertexOpacityView, "vertex opacities"),
      });
    }
    passes.set(pass.name, meshes);
  }
  if (cursor !== geometry.byteLength) {
    fail("geometry contains unreferenced trailing bytes");
  }
  const compositor = objectValue(manifest.compositor, "compositor");
  if (
    compositor.draw_depth_compare !== "disabled" ||
    compositor.draw_blend !== "legacy_mode0" ||
    compositor.eye_clip !== "eye_alpha_times_one_minus_mask_alpha" ||
    JSON.stringify(compositor.final_order) !==
      JSON.stringify([
        "before_trigger",
        "clipped_eye_buffer",
        "final_eye_overlay",
        "after_trigger",
      ])
  ) {
    fail("compositor graph is invalid");
  }
  return { manifest, manifestBytes, texture, geometry, passes };
}

export const rinneGpuBundleSchema = Object.freeze({
  format: FORMAT,
  version: VERSION,
  passNames: Object.freeze([...PASS_NAMES]),
});
