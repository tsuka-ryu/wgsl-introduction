// 頂点シェーダー編 — 06 Vaporwave (卒業制作)
// 参考: Maxime Heckel "Vaporwave 3D scene with Three.js" を WGSL で再構成。
//       原典は Three の displacementMap 任せ。ここは全部手書き＝本物の頂点変位。
//
// ── §4 の総仕上げ: これまでの道具を全部合流 ──────────────────
//   ・ノイズ変位の地形     … 02/05 の変位（中央=谷=道、両脇=山）。時間でカメラへ流れる
//   ・数値的法線 + Lambert  … 05 の隣接サンプリング法線 → dot(N,光) で山を陰影
//   ・ネオングリッド線      … BoS 09 の格子 + fwidth で AA（横断トピックの微分の3つ目の顔）
//   ・フォグ               … 遠方を地平色へ mix
//   ・夕日 + グラデ空       … 背景（フルスクリーン。円=BoS 07）
//   ・RGBShift ポスト       ← ここだけ新capability: シーンを一旦テクスチャに描き(パス1)、
//                            そのテクスチャを R/G/B ずらして再描画(パス2)。textureSample 初登場

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  // ── 地形の格子 (x, z) ──
  const NX = 200;
  const NZ = 220;
  const X0 = -13, X1 = 13, Z0 = 7, Z1 = -65;
  const rowLen = NX + 1;
  const positions = new Float32Array((NX + 1) * (NZ + 1) * 2);
  let p = 0;
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + (Z1 - Z0) * (j / NZ);
    for (let i = 0; i <= NX; i++) {
      positions[p++] = X0 + (X1 - X0) * (i / NX); // x
      positions[p++] = z;                          // z
    }
  }
  const indices = new Uint32Array(NX * NZ * 6);
  let q = 0;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * rowLen + i;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }
  const vertexBuffer = device.createBuffer({
    label: "terrain vertices",
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, positions);
  const indexBuffer = device.createBuffer({
    label: "terrain indices",
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // ─────────────────── シェーダー3種 ───────────────────

  // ① 地形
  const terrainModule = device.createShaderModule({
    label: "vaporwave terrain",
    code: /* wgsl */ `
      struct U { mvp: mat4x4f, time: f32 };
      @group(0) @binding(0) var<uniform> u: U;

      const SPEED = 3.0;
      const AMP   = 3.2;
      const LIGHT_DIR = normalize(vec3f(0.0, 0.35, 1.0));
      const MAGENTA = vec3f(1.0, 0.15, 0.6);
      const CYAN    = vec3f(0.1, 0.85, 1.0);
      const VALLEY  = vec3f(0.06, 0.02, 0.12);
      const HORIZON = vec3f(0.95, 0.35, 0.5);

      struct VOut {
        @builtin(position) clip: vec4f,
        @location(0) worldPos: vec3f,
        @location(1) normal: vec3f,
        @location(2) height: f32,
        @location(3) sz: f32,
      };

      fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
      fn vnoise(p: vec2f) -> f32 {
        let i = floor(p); let f = fract(p);
        let w = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i),                 hash2(i + vec2f(1.0, 0.0)), w.x),
                   mix(hash2(i + vec2f(0.0,1.0)), hash2(i + vec2f(1.0, 1.0)), w.x), w.y);
      }
      fn fbm(p0: vec2f) -> f32 {
        var v = 0.0; var a = 0.5; var pp = p0;
        for (var i = 0; i < 5; i++) { v += a * vnoise(pp); pp = pp * 2.0; a = a * 0.5; }
        return v;
      }
      fn valleyMask(x: f32) -> f32 { return smoothstep(1.8, 5.5, abs(x)); } // 0=中央(道) 1=脇(山)
      fn terrainHeight(x: f32, z: f32) -> f32 { return valleyMask(x) * fbm(vec2f(x * 0.35, z * 0.35)) * AMP; }
      fn terrainNormal(x: f32, z: f32) -> vec3f {  // 05 の数値的法線 (ノイズは微分できないので)
        let e = 0.06;
        let h  = terrainHeight(x, z);
        let hx = terrainHeight(x + e, z);
        let hz = terrainHeight(x, z + e);
        return normalize(cross(vec3f(0.0, hz - h, e), vec3f(e, hx - h, 0.0)));
      }

      @vertex fn vs(@location(0) g: vec2f) -> VOut {
        let x = g.x;
        let z = g.y;
        let sz = z - u.time * SPEED;          // scrolled: 地形がカメラへ流れる
        let y = terrainHeight(x, sz);
        var o: VOut;
        o.worldPos = vec3f(x, y, z);
        o.normal   = terrainNormal(x, sz);
        o.height   = y;
        o.sz       = sz;
        o.clip     = u.mvp * vec4f(o.worldPos, 1.0);
        return o;
      }

      // AA グリッド線 (fwidth で線幅を画面上一定に)
      fn gridLine(pp: vec2f) -> f32 {
        let d = fwidth(pp);
        let gr = abs(fract(pp - 0.5) - 0.5) / d;
        return 1.0 - min(min(gr.x, gr.y), 1.0);
      }

      @fragment fn fs(in: VOut) -> @location(0) vec4f {
        let N = normalize(in.normal);
        let diffuse = max(dot(N, LIGHT_DIR), 0.0);

        let t = clamp(in.height / AMP, 0.0, 1.0);
        var col = mix(VALLEY, mix(MAGENTA, CYAN, t) * 0.6, t);
        col = col * (0.25 + diffuse * 0.9);

        let gl = gridLine(vec2f(in.worldPos.x, in.sz));
        let neon = mix(MAGENTA, CYAN, 0.5 + 0.5 * sin(in.sz * 0.3));
        col = col + neon * gl * 0.9;

        let fog = smoothstep(12.0, 55.0, -in.worldPos.z);
        col = mix(col, HORIZON, fog);
        return vec4f(col, 1.0);
      }
    `,
  });

  // ② 背景 (夕日 + グラデ空)。フルスクリーン三角形
  const bgModule = device.createShaderModule({
    label: "vaporwave background",
    code: /* wgsl */ `
      struct B { resolution: vec2f, time: f32 };
      @group(0) @binding(0) var<uniform> b: B;

      struct BOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> BOut {
        let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        var o: BOut;
        o.pos = vec4f(p[i], 0.0, 1.0);
        o.uv = p[i] * 0.5 + 0.5;   // uv.y=1 が上
        return o;
      }
      @fragment fn fs(in: BOut) -> @location(0) vec4f {
        let aspect = b.resolution.x / b.resolution.y;
        let uv = in.uv;
        let top = vec3f(0.10, 0.03, 0.28);
        let hor = vec3f(1.0, 0.45, 0.45);
        var col = mix(hor, top, smoothstep(0.42, 0.95, uv.y));

        let sunC = vec2f(0.5, 0.5);
        let d = length((uv - sunC) * vec2f(aspect, 1.0));
        let disk = smoothstep(0.24, 0.235, d);
        let sy = clamp((uv.y - (sunC.y - 0.24)) / 0.48, 0.0, 1.0);
        let sun = mix(vec3f(1.0, 0.2, 0.6), vec3f(1.0, 0.9, 0.3), sy);
        var band = 1.0;
        if (uv.y < sunC.y) { band = step(0.45, fract((sunC.y - uv.y) * 22.0)); }
        col = mix(col, sun, disk * band);
        return vec4f(col, 1.0);
      }
    `,
  });

  // ③ ポスト (RGBShift + 走査線 + ビネット)。オフスクリーンをサンプリング
  const postModule = device.createShaderModule({
    label: "vaporwave post",
    code: /* wgsl */ `
      struct P { resolution: vec2f, time: f32 };
      @group(0) @binding(0) var<uniform> pu: P;
      @group(0) @binding(1) var samp: sampler;
      @group(0) @binding(2) var tex: texture_2d<f32>;

      struct POut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
      @vertex fn vs(@builtin(vertex_index) i: u32) -> POut {
        let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        var o: POut;
        o.pos = vec4f(p[i], 0.0, 1.0);
        o.uv = vec2f(p[i].x * 0.5 + 0.5, p[i].y * -0.5 + 0.5); // テクスチャ座標(上=0)
        return o;
      }
      @fragment fn fs(in: POut) -> @location(0) vec4f {
        let uv = in.uv;
        // 中心から離れるほど色ずれ大
        let off = (0.0015 + 0.004 * distance(uv, vec2f(0.5))) * vec2f(1.0, 0.0);
        let r  = textureSample(tex, samp, uv + off).r;
        let g  = textureSample(tex, samp, uv).g;
        let bl = textureSample(tex, samp, uv - off).b;
        var col = vec3f(r, g, bl);
        let scan = 0.92 + 0.08 * sin(uv.y * pu.resolution.y * 1.6 + pu.time * 6.0);
        col = col * scan;
        let vig = smoothstep(0.95, 0.35, distance(uv, vec2f(0.5)));
        col = col * mix(0.55, 1.0, vig);
        return vec4f(col, 1.0);
      }
    `,
  });

  // ─────────────────── パイプライン ───────────────────
  const terrainPipeline = device.createRenderPipeline({
    label: "terrain",
    layout: "auto",
    vertex: {
      module: terrainModule, entryPoint: "vs",
      buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] }],
    },
    fragment: { module: terrainModule, entryPoint: "fs", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const bgPipeline = device.createRenderPipeline({
    label: "background",
    layout: "auto",
    vertex: { module: bgModule, entryPoint: "vs" },
    fragment: { module: bgModule, entryPoint: "fs", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list" },
    // 深度は書かず常に通す (背景として最初に全面を塗り、地形が上に載る)
    depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "always" },
  });

  const postPipeline = device.createRenderPipeline({
    label: "post",
    layout: "auto",
    vertex: { module: postModule, entryPoint: "vs" },
    fragment: { module: postModule, entryPoint: "fs", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list" },
  });

  // ─────────────────── uniform / sampler ───────────────────
  const sceneU = new Float32Array(20); // mvp + time
  const sceneBuf = device.createBuffer({ size: sceneU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bgU = new Float32Array(4); // resolution + time
  const bgBuf = device.createBuffer({ size: bgU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const postU = new Float32Array(4);
  const postBuf = device.createBuffer({ size: postU.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });

  const terrainBind = device.createBindGroup({ layout: terrainPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: sceneBuf } }] });
  const bgBind = device.createBindGroup({ layout: bgPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bgBuf } }] });

  // オフスクリーン(色) + 深度 + post バインドグループ (サイズ変化で作り直す)
  let offscreen: GPUTexture | undefined;
  let depthTex: GPUTexture | undefined;
  let postBind: GPUBindGroup;
  function ensureTargets(device: GPUDevice) {
    const w = canvas.width, h = canvas.height;
    if (offscreen && offscreen.width === w && offscreen.height === h) return;
    offscreen?.destroy();
    depthTex?.destroy();
    offscreen = device.createTexture({
      size: [w, h], format: presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    depthTex = device.createTexture({ size: [w, h], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
    postBind = device.createBindGroup({
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: postBuf } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: offscreen.createView() },
      ],
    });
  }

  // ─────────────────── 行列 (01〜05 と同一) ───────────────────
  type Mat4 = number[];
  type Vec3 = [number, number, number];
  function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2); const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0];
  }
  function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let rl = 1 / Math.hypot(zx, zy, zz); zx *= rl; zy *= rl; zz *= rl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    rl = 1 / Math.hypot(xx, xy, xz); xx *= rl; xy *= rl; xz *= rl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
    ];
  }
  function multiply(a: Mat4, b: Mat4): Mat4 {
    const o = new Array<number>(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }

  function render(device: GPUDevice, time: number) {
    ensureTargets(device);

    const aspect = canvas.width / canvas.height;
    const proj = perspective((60 * Math.PI) / 180, aspect, 0.1, 120);
    const view = lookAt([0, 2.2, 7], [0, 1.2, -12], [0, 1, 0]);
    sceneU.set(multiply(proj, view), 0);
    sceneU[16] = time;
    device.queue.writeBuffer(sceneBuf, 0, sceneU);

    bgU[0] = canvas.width; bgU[1] = canvas.height; bgU[2] = time;
    device.queue.writeBuffer(bgBuf, 0, bgU);
    postU[0] = canvas.width; postU[1] = canvas.height; postU[2] = time;
    device.queue.writeBuffer(postBuf, 0, postU);

    const encoder = device.createCommandEncoder();

    // パス1: 背景 + 地形 → オフスクリーン
    const pass1 = encoder.beginRenderPass({
      colorAttachments: [{ view: offscreen!.createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depthTex!.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    pass1.setPipeline(bgPipeline);
    pass1.setBindGroup(0, bgBind);
    pass1.draw(3);
    pass1.setPipeline(terrainPipeline);
    pass1.setBindGroup(0, terrainBind);
    pass1.setVertexBuffer(0, vertexBuffer);
    pass1.setIndexBuffer(indexBuffer, "uint32");
    pass1.drawIndexed(indices.length);
    pass1.end();

    // パス2: オフスクリーンを RGBShift してキャンバスへ
    const pass2 = encoder.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
    });
    pass2.setPipeline(postPipeline);
    pass2.setBindGroup(0, postBind);
    pass2.draw(3);
    pass2.end();

    device.queue.submit([encoder.finish()]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
  });
  observer.observe(canvas);

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
