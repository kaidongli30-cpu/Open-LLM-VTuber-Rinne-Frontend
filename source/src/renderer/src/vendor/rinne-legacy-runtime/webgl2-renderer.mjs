function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("WebGL2 could not allocate a shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`WebGL2 shader compilation failed: ${message}`);
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("WebGL2 could not allocate a program");
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`WebGL2 program link failed: ${message}`);
  }
  return program;
}

function checkedObject(value, label) {
  if (value === null) {
    throw new Error(`WebGL2 could not allocate ${label}`);
  }
  return value;
}

function uploadBuffer(gl, target, values) {
  const buffer = checkedObject(gl.createBuffer(), "buffer");
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, values, gl.STATIC_DRAW);
  return buffer;
}

function createAtlasTexture(gl, bundle) {
  const texture = checkedObject(gl.createTexture(), "atlas texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    bundle.manifest.texture.width,
    bundle.manifest.texture.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bundle.texture,
  );
  return texture;
}

function createDeformationTexture(gl, dynamicBundle) {
  const texture = checkedObject(gl.createTexture(), "deformation texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const width = dynamicBundle?.manifest.deformation.texture_width ?? 1;
  const height = dynamicBundle?.manifest.deformation.texture_height ?? 1;
  const values = dynamicBundle?.deformationFloats ?? new Float32Array(4);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    width,
    height,
    0,
    gl.RGBA,
    gl.FLOAT,
    values,
  );
  return { texture, width, height };
}

function createEyeDeformationTexture(gl, eyeBundle) {
  const texture = checkedObject(gl.createTexture(), "eye-deformation texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const width = eyeBundle?.manifest.lookup.texture_width ?? 1;
  const height = eyeBundle?.manifest.lookup.texture_height ?? 1;
  const values = eyeBundle?.deformationFloats ?? new Float32Array(4);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    width,
    height,
    0,
    gl.RGBA,
    gl.FLOAT,
    values,
  );
  return { texture, width, height };
}

function createRenderTarget(gl, width, height) {
  const texture = checkedObject(gl.createTexture(), "render-target texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  const framebuffer = checkedObject(gl.createFramebuffer(), "framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("WebGL2 framebuffer is incomplete");
  }
  return { texture, framebuffer };
}

function createGpuMesh(
  gl,
  source,
  vertexOffset,
  eyeBinding,
  runtimeOpacityBinding,
) {
  const vao = checkedObject(gl.createVertexArray(), "vertex array");
  gl.bindVertexArray(vao);
  const positionBuffer = uploadBuffer(gl, gl.ARRAY_BUFFER, source.positions);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const uvBuffer = uploadBuffer(gl, gl.ARRAY_BUFFER, source.uvs);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  let opacityBuffer = null;
  if (source.vertexOpacities !== null) {
    opacityBuffer = uploadBuffer(gl, gl.ARRAY_BUFFER, source.vertexOpacities);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
  } else {
    gl.disableVertexAttribArray(2);
    gl.vertexAttrib1f(2, 1.0);
  }
  const indexBuffer = uploadBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, source.indices);
  gl.bindVertexArray(null);
  return {
    descriptor: source.descriptor,
    vao,
    positionBuffer,
    uvBuffer,
    opacityBuffer,
    indexBuffer,
    vertexOffset,
    eyeBinding,
    runtimeOpacityBinding,
  };
}

function setLegacyBlend(gl) {
  gl.enable(gl.BLEND);
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);
}

function clearTarget(gl, framebuffer, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function flipReadPixelsTopToBottom(source, width, height) {
  const rowBytes = width * 4;
  const output = new Uint8Array(source.length);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - 1 - row) * rowBytes;
    output.set(
      source.subarray(sourceOffset, sourceOffset + rowBytes),
      row * rowBytes,
    );
  }
  return output;
}

const MESH_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUv;
layout(location = 2) in float aVertexOpacity;
uniform highp sampler2D uDeformation;
uniform highp ivec2 uDeformationSize;
uniform highp int uControlCount;
uniform highp int uVertexOffset;
uniform highp float uCoefficients[64];
uniform highp sampler2D uEyeDeformation;
uniform highp ivec2 uEyeDeformationSize;
uniform highp int uEyeDynamic;
uniform highp int uEyeGroupVertexOffset;
uniform highp int uEyeSampleLower;
uniform highp int uEyeSampleUpper;
uniform highp float uEyeSampleFraction;
uniform highp int uEyeSampleCount;
uniform highp int uEyeBasisCount;
uniform highp int uNeckPose;
uniform highp vec4 uNeckColumn0;
uniform highp vec4 uNeckColumn1;
uniform highp vec4 uNeckColumn2;
out highp vec2 vUv;
out highp float vVertexOpacity;
highp vec3 eyeDelta(highp int groupVertex, highp int sampleIndex, highp int basisIndex) {
  highp int texelIndex = (
    (groupVertex * uEyeSampleCount + sampleIndex) * uEyeBasisCount + basisIndex
  );
  highp ivec2 coordinate = ivec2(
    texelIndex % uEyeDeformationSize.x,
    texelIndex / uEyeDeformationSize.x
  );
  return texelFetch(uEyeDeformation, coordinate, 0).xyz;
}
void main() {
  highp vec3 position = aPosition;
  if (uEyeDynamic == 1) {
    highp int groupVertex = uEyeGroupVertexOffset + gl_VertexID;
    position += mix(
      eyeDelta(groupVertex, uEyeSampleLower, 0),
      eyeDelta(groupVertex, uEyeSampleUpper, 0),
      uEyeSampleFraction
    );
    for (int controlIndex = 0; controlIndex < 64; controlIndex += 1) {
      if (controlIndex >= uControlCount) {
        break;
      }
      highp vec3 delta = mix(
        eyeDelta(groupVertex, uEyeSampleLower, controlIndex + 1),
        eyeDelta(groupVertex, uEyeSampleUpper, controlIndex + 1),
        uEyeSampleFraction
      );
      position += delta * uCoefficients[controlIndex];
    }
  } else {
    highp int globalVertex = uVertexOffset + gl_VertexID;
    for (int controlIndex = 0; controlIndex < 64; controlIndex += 1) {
      if (controlIndex >= uControlCount) {
        break;
      }
      highp int texelIndex = globalVertex * uControlCount + controlIndex;
      highp ivec2 coordinate = ivec2(
        texelIndex % uDeformationSize.x,
        texelIndex / uDeformationSize.x
      );
      position += texelFetch(uDeformation, coordinate, 0).xyz * uCoefficients[controlIndex];
    }
  }
  if (uNeckPose == 1) {
    highp vec4 model = vec4(
      position.x * 4.0 - 2.0,
      position.y * 4.0 - 2.0,
      position.z / 0.01 + 9.021416664123535,
      1.0
    );
    highp vec3 transformed = vec3(
      dot(model, uNeckColumn0),
      dot(model, uNeckColumn1),
      dot(model, uNeckColumn2)
    );
    position = vec3(
      (transformed.x * 0.5 + 1.0) * 0.5,
      (transformed.y * 0.5 + 1.0) * 0.5,
      transformed.z * 0.01
    );
  }
  gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0);
  vUv = aUv;
  vVertexOpacity = aVertexOpacity;
}`;

const MESH_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform float uOpacity;
uniform int uFilterMode;
uniform ivec2 uAtlasSize;
in highp vec2 vUv;
in highp float vVertexOpacity;
out vec4 outputColor;
vec4 sampleLegacyNearest(vec2 uv) {
  vec2 lastTexel = vec2(uAtlasSize - ivec2(1));
  ivec2 coordinate = ivec2(floor(clamp(uv, vec2(0.0), vec2(1.0)) * lastTexel + 0.5));
  return texelFetch(uAtlas, coordinate, 0);
}
vec4 sampleLegacyLinear(vec2 uv) {
  vec2 samplePosition = clamp(uv, vec2(0.0), vec2(1.0)) * vec2(uAtlasSize) - 0.5;
  ivec2 lowerUnclamped = ivec2(floor(samplePosition));
  vec2 fraction = samplePosition - vec2(lowerUnclamped);
  ivec2 maximum = uAtlasSize - ivec2(1);
  ivec2 lower = clamp(lowerUnclamped, ivec2(0), maximum);
  ivec2 upper = clamp(lowerUnclamped + ivec2(1), ivec2(0), maximum);
  vec4 row0 = mix(
    texelFetch(uAtlas, ivec2(lower.x, lower.y), 0),
    texelFetch(uAtlas, ivec2(upper.x, lower.y), 0),
    fraction.x
  );
  vec4 row1 = mix(
    texelFetch(uAtlas, ivec2(lower.x, upper.y), 0),
    texelFetch(uAtlas, ivec2(upper.x, upper.y), 0),
    fraction.x
  );
  return mix(row0, row1, fraction.y);
}
void main() {
  vec4 sampled = uFilterMode == 1 ? sampleLegacyLinear(vUv) : sampleLegacyNearest(vUv);
  outputColor = vec4(sampled.rgb, sampled.a * uOpacity * vVertexOpacity);
}`;

const COMPOSITOR_VERTEX_SHADER = `#version 300 es
out highp vec2 vUv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMPOSITOR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uEye;
uniform sampler2D uMask;
in highp vec2 vUv;
out vec4 outputColor;
void main() {
  vec4 eye = texture(uEye, vUv);
  float maskAlpha = texture(uMask, vUv).a;
  outputColor = vec4(eye.rgb, eye.a * (1.0 - maskAlpha));
}`;

const f32 = (value) => Math.fround(value);
const f32Add = (left, right) => f32(f32(left) + f32(right));
const f32Sub = (left, right) => f32(f32(left) - f32(right));
const f32Mul = (left, right) => f32(f32(left) * f32(right));
const f32Div = (left, right) => f32(f32(left) / f32(right));

function f32SinDegrees(value) {
  value = f32(value);
  if (value === 0) {
    return 0;
  }
  return f32(Math.sin(f32Div(f32Mul(value, Math.PI), 180)));
}

function f32CosDegrees(value) {
  return f32(Math.cos(f32Div(f32Mul(f32(value), Math.PI), 180)));
}

export function buildRinneWebGl2NeckColumns(pivot, rotation, translation) {
  const [rx, ry, rz] = rotation;
  const [tx, ty, tz] = translation;
  const [px, py, pz] = pivot;
  const sx = f32SinDegrees(rx);
  const sy = f32SinDegrees(ry);
  const sz = f32SinDegrees(rz);
  const cx = f32CosDegrees(rx);
  const cy = f32CosDegrees(ry);
  const cz = f32CosDegrees(rz);

  const m00 = f32Mul(cz, cy);
  const m01 = f32(-f32Mul(cy, sz));
  const m02 = sy;
  const m10 = f32Add(f32Mul(f32Mul(sy, sx), cz), f32Mul(cx, sz));
  const m11 = f32Sub(f32Mul(cx, cz), f32Mul(f32Mul(sy, sx), sz));
  const m12 = f32(-f32Mul(cy, sx));
  const m20 = f32Sub(f32Mul(sz, sx), f32Mul(f32Mul(cx, sy), cz));
  const m21 = f32Add(f32Mul(f32Mul(cx, sy), sz), f32Mul(cz, sx));
  const m22 = f32Mul(cy, cx);
  const translatedZ = f32Sub(tz, 9.021416664123535);
  const outTx = f32Sub(
    f32Add(px, tx),
    f32Add(f32Add(f32Mul(px, m00), f32Mul(py, m10)), f32Mul(pz, m20)),
  );
  const outTy = f32Sub(
    f32Add(py, ty),
    f32Add(f32Add(f32Mul(px, m01), f32Mul(py, m11)), f32Mul(pz, m21)),
  );
  const outTz = f32Sub(
    f32Add(pz, translatedZ),
    f32Add(f32Add(f32Mul(px, m02), f32Mul(py, m12)), f32Mul(pz, m22)),
  );
  return [
    new Float32Array([m00, m10, m20, outTx]),
    new Float32Array([m01, m11, m21, outTy]),
    new Float32Array([m02, m12, m22, outTz]),
  ];
}

export class RinneWebGl2ReferenceRenderer {
  constructor(
    gl,
    bundle,
    dynamicBundle = null,
    eyeBundle = null,
    runtimeBundle = null,
    outputSize = null,
  ) {
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new TypeError("Rinne reference renderer requires WebGL2");
    }
    this.gl = gl;
    this.bundle = bundle;
    this.dynamicBundle = dynamicBundle;
    this.eyeBundle = eyeBundle;
    this.runtimeBundle = runtimeBundle;
    if (eyeBundle !== null && dynamicBundle === null) {
      throw new Error("Rinne eye dynamics require linear dynamics");
    }
    if (runtimeBundle !== null && eyeBundle === null) {
      throw new Error("Rinne runtime controls require eye dynamics");
    }
    const referenceWidth = bundle.manifest.reference.canvas_width;
    const referenceHeight = bundle.manifest.reference.canvas_height;
    if (
      outputSize !== null &&
      (typeof outputSize !== "object" || Array.isArray(outputSize))
    ) {
      throw new TypeError("Rinne output size must be an object or null");
    }
    this.width = outputSize?.width ?? referenceWidth;
    this.height = outputSize?.height ?? referenceHeight;
    if (
      !Number.isSafeInteger(this.width) ||
      !Number.isSafeInteger(this.height) ||
      this.width <= 0 ||
      this.height <= 0 ||
      this.width > 4096 ||
      this.height > 4096
    ) {
      throw new Error("Rinne output dimensions must be within 1..4096");
    }
    if (
      gl.drawingBufferWidth !== this.width ||
      gl.drawingBufferHeight !== this.height
    ) {
      throw new Error(
        "WebGL2 drawing buffer does not match reference dimensions",
      );
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DITHER);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    this.meshProgram = createProgram(
      gl,
      MESH_VERTEX_SHADER,
      MESH_FRAGMENT_SHADER,
    );
    this.compositorProgram = createProgram(
      gl,
      COMPOSITOR_VERTEX_SHADER,
      COMPOSITOR_FRAGMENT_SHADER,
    );
    this.atlas = createAtlasTexture(gl, bundle);
    this.deformation = createDeformationTexture(gl, dynamicBundle);
    this.eyeDeformation = createEyeDeformationTexture(gl, eyeBundle);
    this.eyeTarget = createRenderTarget(gl, this.width, this.height);
    this.maskTarget = createRenderTarget(gl, this.width, this.height);
    this.passes = new Map(
      Array.from(bundle.passes, ([name, meshes]) => [
        name,
        meshes.map((mesh) =>
          createGpuMesh(
            gl,
            mesh,
            dynamicBundle?.meshVertexOffsets.get(
              `${name}\0${mesh.descriptor.mesh_index}`,
            ) ?? 0,
            eyeBundle?.meshBindings.get(
              `${name}\0${mesh.descriptor.mesh_index}`,
            ) ?? null,
            runtimeBundle?.meshBindings.get(
              `${name}\0${mesh.descriptor.mesh_index}`,
            ) ?? null,
          ),
        ),
      ]),
    );
    this.controlCount = dynamicBundle?.manifest.deformation.control_count ?? 0;
    this.coefficients = new Float32Array(64);
    this.eyeControls = {
      blinkDeformation: new Float32Array(4),
      blinkBaseWeights: new Float32Array([
        1, 0.699999988079071, 0.49000000953674316, 0.34299999475479126,
      ]),
      rightEyeClose: 0,
      leftEyeClose: 0,
      type2Intensity: 1,
    };
    this.runtimeControls = {
      neckPoseActive: false,
      neckColumns: [
        new Float32Array([1, 0, 0, 0]),
        new Float32Array([0, 1, 0, 0]),
        new Float32Array([0, 0, 1, 0]),
      ],
      recordOpacities:
        runtimeBundle === null
          ? new Float32Array(0)
          : Float32Array.from(
              runtimeBundle.manifest.opacity.records,
              (record) => record.initial_opacity,
            ),
    };
    this.hiddenDrawTypes = new Set();
    this.visibleDrawTypes = null;
    this.disposed = false;
    this.opacityUniform = gl.getUniformLocation(this.meshProgram, "uOpacity");
    this.atlasUniform = gl.getUniformLocation(this.meshProgram, "uAtlas");
    this.filterModeUniform = gl.getUniformLocation(
      this.meshProgram,
      "uFilterMode",
    );
    this.atlasSizeUniform = gl.getUniformLocation(
      this.meshProgram,
      "uAtlasSize",
    );
    this.deformationUniform = gl.getUniformLocation(
      this.meshProgram,
      "uDeformation",
    );
    this.deformationSizeUniform = gl.getUniformLocation(
      this.meshProgram,
      "uDeformationSize",
    );
    this.controlCountUniform = gl.getUniformLocation(
      this.meshProgram,
      "uControlCount",
    );
    this.vertexOffsetUniform = gl.getUniformLocation(
      this.meshProgram,
      "uVertexOffset",
    );
    this.coefficientsUniform = gl.getUniformLocation(
      this.meshProgram,
      "uCoefficients[0]",
    );
    this.eyeDeformationUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeDeformation",
    );
    this.eyeDeformationSizeUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeDeformationSize",
    );
    this.eyeDynamicUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeDynamic",
    );
    this.eyeGroupVertexOffsetUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeGroupVertexOffset",
    );
    this.eyeSampleLowerUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeSampleLower",
    );
    this.eyeSampleUpperUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeSampleUpper",
    );
    this.eyeSampleFractionUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeSampleFraction",
    );
    this.eyeSampleCountUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeSampleCount",
    );
    this.eyeBasisCountUniform = gl.getUniformLocation(
      this.meshProgram,
      "uEyeBasisCount",
    );
    this.neckPoseUniform = gl.getUniformLocation(this.meshProgram, "uNeckPose");
    this.neckColumn0Uniform = gl.getUniformLocation(
      this.meshProgram,
      "uNeckColumn0",
    );
    this.neckColumn1Uniform = gl.getUniformLocation(
      this.meshProgram,
      "uNeckColumn1",
    );
    this.neckColumn2Uniform = gl.getUniformLocation(
      this.meshProgram,
      "uNeckColumn2",
    );
    this.eyeUniform = gl.getUniformLocation(this.compositorProgram, "uEye");
    this.maskUniform = gl.getUniformLocation(this.compositorProgram, "uMask");
    if (
      this.opacityUniform === null ||
      this.atlasUniform === null ||
      this.filterModeUniform === null ||
      this.atlasSizeUniform === null ||
      this.deformationUniform === null ||
      this.deformationSizeUniform === null ||
      this.controlCountUniform === null ||
      this.vertexOffsetUniform === null ||
      this.coefficientsUniform === null ||
      this.eyeDeformationUniform === null ||
      this.eyeDeformationSizeUniform === null ||
      this.eyeDynamicUniform === null ||
      this.eyeGroupVertexOffsetUniform === null ||
      this.eyeSampleLowerUniform === null ||
      this.eyeSampleUpperUniform === null ||
      this.eyeSampleFractionUniform === null ||
      this.eyeSampleCountUniform === null ||
      this.eyeBasisCountUniform === null ||
      this.neckPoseUniform === null ||
      this.neckColumn0Uniform === null ||
      this.neckColumn1Uniform === null ||
      this.neckColumn2Uniform === null ||
      this.eyeUniform === null ||
      this.maskUniform === null
    ) {
      throw new Error("WebGL2 shader uniforms are incomplete");
    }
  }

  setDynamicCoefficients(values) {
    if (!ArrayBuffer.isView(values) && !Array.isArray(values)) {
      throw new TypeError("Rinne GPU coefficients must be an array");
    }
    if (values.length !== this.controlCount) {
      throw new Error(
        `Rinne GPU coefficient count ${values.length} does not equal ${this.controlCount}`,
      );
    }
    this.coefficients.fill(0);
    for (let index = 0; index < values.length; index += 1) {
      const value = Number(values[index]);
      if (!Number.isFinite(value)) {
        throw new Error(`Rinne GPU coefficient ${index} is not finite`);
      }
      this.coefficients[index] = value;
    }
  }

  setEyeControls(values) {
    if (
      this.eyeBundle === null ||
      values === null ||
      typeof values !== "object"
    ) {
      throw new TypeError("Rinne eye controls require an eye-dynamic bundle");
    }
    const checkedArray = (input, label) => {
      if (
        (!ArrayBuffer.isView(input) && !Array.isArray(input)) ||
        input.length !== 4
      ) {
        throw new Error(`Rinne ${label} must contain four values`);
      }
      const result = Float32Array.from(input, (value) => Number(value));
      if (
        Array.from(result).some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1,
        )
      ) {
        throw new Error(`Rinne ${label} values must be within 0..1`);
      }
      return result;
    };
    const unit = (value, label) => {
      const result = Math.fround(Number(value));
      if (!Number.isFinite(result) || result < 0 || result > 1) {
        throw new Error(`Rinne ${label} must be within 0..1`);
      }
      return result;
    };
    this.eyeControls = {
      blinkDeformation: checkedArray(
        values.blinkDeformation,
        "blink deformation",
      ),
      blinkBaseWeights: checkedArray(
        values.blinkBaseWeights,
        "blink base weights",
      ),
      rightEyeClose: unit(values.rightEyeClose, "right eye close"),
      leftEyeClose: unit(values.leftEyeClose, "left eye close"),
      type2Intensity: unit(values.type2Intensity, "type-2 intensity"),
    };
  }

  setRuntimeControls(values) {
    if (
      this.runtimeBundle === null ||
      values === null ||
      typeof values !== "object"
    ) {
      throw new TypeError("Rinne runtime controls require a runtime bundle");
    }
    const checkedTriple = (input, label) => {
      if (
        (!ArrayBuffer.isView(input) && !Array.isArray(input)) ||
        input.length !== 3
      ) {
        throw new Error(`Rinne ${label} must contain three values`);
      }
      const result = Float32Array.from(input, (value) => Number(value));
      if (Array.from(result).some((value) => !Number.isFinite(value))) {
        throw new Error(`Rinne ${label} values must be finite`);
      }
      return result;
    };
    const neckRotation = checkedTriple(values.neckRotation, "neck rotation");
    const neckTranslation = checkedTriple(
      values.neckTranslation,
      "neck translation",
    );
    const inputOpacities = values.recordOpacities;
    const recordCount = this.runtimeBundle.manifest.opacity.record_count;
    if (
      (!ArrayBuffer.isView(inputOpacities) && !Array.isArray(inputOpacities)) ||
      inputOpacities.length !== recordCount
    ) {
      throw new Error(`Rinne record opacity count must equal ${recordCount}`);
    }
    const recordOpacities = Float32Array.from(inputOpacities, (value) =>
      Number(value),
    );
    if (
      Array.from(recordOpacities).some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1,
      )
    ) {
      throw new Error("Rinne record opacities must be within 0..1");
    }
    const neckPoseActive =
      Array.from(neckRotation).some((value) => value !== 0) ||
      Array.from(neckTranslation).some((value) => value !== 0);
    this.runtimeControls = {
      neckPoseActive,
      neckColumns: neckPoseActive
        ? buildRinneWebGl2NeckColumns(
            this.runtimeBundle.pivot,
            neckRotation,
            neckTranslation,
          )
        : [
            new Float32Array([1, 0, 0, 0]),
            new Float32Array([0, 1, 0, 0]),
            new Float32Array([0, 0, 1, 0]),
          ],
      recordOpacities,
    };
  }

  setHiddenDrawTypes(values) {
    if (this.runtimeBundle === null || !Array.isArray(values)) {
      throw new TypeError(
        "Rinne hidden draw types require a runtime bundle and an array",
      );
    }
    const available = new Set(
      this.runtimeBundle.manifest.opacity.records.map((record) => record.type_id),
    );
    const hidden = new Set();
    for (const value of values) {
      if (
        !Number.isSafeInteger(value) ||
        value <= 2 ||
        !available.has(value) ||
        hidden.has(value)
      ) {
        throw new Error("Rinne hidden draw types are invalid");
      }
      hidden.add(value);
    }
    this.hiddenDrawTypes = hidden;
  }

  setVisibleDrawTypes(values) {
    if (this.runtimeBundle === null || !Array.isArray(values)) {
      throw new TypeError(
        "Rinne visible draw types require a runtime bundle and an array",
      );
    }
    const available = new Set(
      this.runtimeBundle.manifest.opacity.records.map((record) => record.type_id),
    );
    const visible = new Set();
    for (const value of values) {
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        !available.has(value) ||
        visible.has(value)
      ) {
        throw new Error("Rinne visible draw types are invalid");
      }
      visible.add(value);
    }
    this.visibleDrawTypes = visible;
  }

  resolveRuntimeOpacity(binding) {
    if (binding === null) {
      return null;
    }
    const record =
      this.runtimeBundle.manifest.opacity.records[binding.record_index];
    if (
      this.visibleDrawTypes !== null &&
      !this.visibleDrawTypes.has(record.type_id)
    ) {
      return 0;
    }
    if (this.hiddenDrawTypes.has(record.type_id)) {
      return 0;
    }
    const raw = this.runtimeControls.recordOpacities[binding.record_index];
    if (binding.curve === "direct") {
      return raw;
    }
    const squared = f32Mul(raw, raw);
    const cubed = f32Mul(squared, raw);
    return f32Mul(cubed, raw);
  }

  resolveEyeBinding(binding, runtimeOpacityBinding = null) {
    const controls = this.eyeControls;
    const close =
      binding.eye_side === 0 ? controls.rightEyeClose : controls.leftEyeClose;
    const deformation = controls.blinkDeformation[binding.blink_sample_index];
    const combined = Math.fround(
      Math.fround(Math.fround(1 - close) * deformation) + close,
    );
    const positions = this.eyeBundle.samplePositions;
    let lower = 0;
    let upperBound = positions.length;
    while (lower + 1 < upperBound) {
      const middle = (lower + upperBound) >> 1;
      if (positions[middle] <= combined) {
        lower = middle;
      } else {
        upperBound = middle;
      }
    }
    const upper = Math.min(positions.length - 1, lower + 1);
    const span = positions[upper] - positions[lower];
    const fraction = span === 0 ? 0 : (combined - positions[lower]) / span;
    let opacity;
    const runtimeOpacity = this.resolveRuntimeOpacity(runtimeOpacityBinding);
    if (binding.opacity_mode === "blur_sample_base_weight_0_9") {
      opacity = Math.fround(
        controls.blinkBaseWeights[binding.blink_sample_index] *
          0.8999999761581421,
      );
    } else if (binding.opacity_mode === "runtime_type0") {
      opacity = 1;
    } else if (binding.opacity_mode === "primary_base_weight_0_9") {
      opacity = Math.fround(controls.blinkBaseWeights[0] * 0.8999999761581421);
    } else {
      const type2U = Math.fround(combined * 0.949999988079071);
      let eased;
      if (type2U <= 0) {
        eased = 0;
      } else if (type2U >= 1) {
        eased = 1;
      } else {
        const degrees = Math.fround(Math.fround(type2U * 180) - 90);
        const radians = Math.fround(
          Math.fround(degrees * 3.1415927410125732) / 180,
        );
        eased = Math.fround(Math.fround(Math.sin(radians) * 0.5) + 0.5);
      }
      opacity = Math.fround(
        Math.fround(
          eased * Math.fround(controls.type2Intensity * 0.800000011920929),
        ),
      );
    }
    if (
      binding.opacity_mode !== "eased_u_intensity_0_8" &&
      runtimeOpacity !== null &&
      runtimeOpacity !== 1
    ) {
      opacity = runtimeOpacity;
    } else if (
      binding.opacity_mode === "eased_u_intensity_0_8" &&
      runtimeOpacity !== null
    ) {
      opacity = f32Mul(opacity, runtimeOpacity);
    }
    return { lower, upper, fraction, opacity };
  }

  drawPass(name, framebuffer) {
    const gl = this.gl;
    const meshes = this.passes.get(name);
    if (meshes === undefined) {
      throw new Error(`Rinne GPU pass is missing: ${name}`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.meshProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(this.atlasUniform, 0);
    gl.uniform2i(
      this.atlasSizeUniform,
      this.bundle.manifest.texture.width,
      this.bundle.manifest.texture.height,
    );
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.deformation.texture);
    gl.uniform1i(this.deformationUniform, 1);
    gl.uniform2i(
      this.deformationSizeUniform,
      this.deformation.width,
      this.deformation.height,
    );
    gl.uniform1i(this.controlCountUniform, this.controlCount);
    gl.uniform1fv(this.coefficientsUniform, this.coefficients);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.eyeDeformation.texture);
    gl.uniform1i(this.eyeDeformationUniform, 2);
    gl.uniform2i(
      this.eyeDeformationSizeUniform,
      this.eyeDeformation.width,
      this.eyeDeformation.height,
    );
    gl.uniform1i(
      this.eyeSampleCountUniform,
      this.eyeBundle?.manifest.lookup.sample_count ?? 1,
    );
    gl.uniform1i(
      this.eyeBasisCountUniform,
      this.eyeBundle?.manifest.lookup.basis_count ?? 1,
    );
    gl.uniform1i(
      this.neckPoseUniform,
      this.runtimeControls.neckPoseActive ? 1 : 0,
    );
    gl.uniform4fv(this.neckColumn0Uniform, this.runtimeControls.neckColumns[0]);
    gl.uniform4fv(this.neckColumn1Uniform, this.runtimeControls.neckColumns[1]);
    gl.uniform4fv(this.neckColumn2Uniform, this.runtimeControls.neckColumns[2]);
    setLegacyBlend(gl);
    for (const mesh of meshes) {
      gl.uniform1i(
        this.filterModeUniform,
        mesh.descriptor.texture_filter === "linear" ? 1 : 0,
      );
      if (mesh.eyeBinding === null) {
        gl.uniform1i(this.eyeDynamicUniform, 0);
        gl.uniform1f(
          this.opacityUniform,
          this.resolveRuntimeOpacity(mesh.runtimeOpacityBinding) ??
            mesh.descriptor.opacity,
        );
      } else {
        const resolved = this.resolveEyeBinding(
          mesh.eyeBinding,
          mesh.runtimeOpacityBinding,
        );
        const group =
          this.eyeBundle.manifest.lookup.groups[mesh.eyeBinding.group_index];
        gl.uniform1i(this.eyeDynamicUniform, 1);
        gl.uniform1i(this.eyeGroupVertexOffsetUniform, group.vertex_offset);
        gl.uniform1i(this.eyeSampleLowerUniform, resolved.lower);
        gl.uniform1i(this.eyeSampleUpperUniform, resolved.upper);
        gl.uniform1f(this.eyeSampleFractionUniform, resolved.fraction);
        gl.uniform1f(this.opacityUniform, resolved.opacity);
      }
      gl.uniform1i(this.vertexOffsetUniform, mesh.vertexOffset);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(
        gl.TRIANGLES,
        mesh.descriptor.index_count,
        gl.UNSIGNED_INT,
        0,
      );
    }
    gl.bindVertexArray(null);
  }

  drawClippedEye(framebuffer) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.compositorProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.eyeTarget.texture);
    gl.uniform1i(this.eyeUniform, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTarget.texture);
    gl.uniform1i(this.maskUniform, 1);
    setLegacyBlend(gl);
    gl.bindVertexArray(null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  draw() {
    const gl = this.gl;
    clearTarget(gl, this.eyeTarget.framebuffer, this.width, this.height);
    this.drawPass("eye_buffer", this.eyeTarget.framebuffer);
    clearTarget(gl, this.maskTarget.framebuffer, this.width, this.height);
    this.drawPass("mask_buffer", this.maskTarget.framebuffer);
    clearTarget(gl, null, this.width, this.height);
    this.drawPass("before_trigger", null);
    this.drawClippedEye(null);
    this.drawPass("final_eye_overlay", null);
    this.drawPass("after_trigger", null);
  }

  readRgba() {
    const gl = this.gl;
    gl.finish();
    const bottomToTop = new Uint8Array(this.width * this.height * 4);
    gl.readPixels(
      0,
      0,
      this.width,
      this.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      bottomToTop,
    );
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      throw new Error(
        `WebGL2 render failed with error 0x${error.toString(16)}`,
      );
    }
    return flipReadPixelsTopToBottom(bottomToTop, this.width, this.height);
  }

  render() {
    this.draw();
    return this.readRgba();
  }

  dispose() {
    if (this.disposed) return;
    const gl = this.gl;
    for (const meshes of this.passes.values()) {
      for (const mesh of meshes) {
        gl.deleteVertexArray(mesh.vao);
        gl.deleteBuffer(mesh.positionBuffer);
        gl.deleteBuffer(mesh.uvBuffer);
        if (mesh.opacityBuffer !== null) gl.deleteBuffer(mesh.opacityBuffer);
        gl.deleteBuffer(mesh.indexBuffer);
      }
    }
    gl.deleteTexture(this.atlas);
    gl.deleteTexture(this.deformation.texture);
    gl.deleteTexture(this.eyeDeformation.texture);
    gl.deleteFramebuffer(this.eyeTarget.framebuffer);
    gl.deleteTexture(this.eyeTarget.texture);
    gl.deleteFramebuffer(this.maskTarget.framebuffer);
    gl.deleteTexture(this.maskTarget.texture);
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.compositorProgram);
    this.disposed = true;
  }
}
