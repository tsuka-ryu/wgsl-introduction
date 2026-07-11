// 頂点シェーダー編 — 04 Layered Planet (Lamina 風レイヤー合成)
// 参考: Maxime Heckel 記事の Lamina 版 Planet を WGSL へ移植。
//       Lamina は「レイヤーを重ねてマテリアルを作る」ライブラリ。ここでは
//       その合成を 1 つのフラグメントシェーダーで手書きする (= マテリアル = レイヤーの畳み込み)。
//
// ── 4 レイヤーの合成 ──────────────────────────────────────
//   ① 雲 (CustomLayer) … fbm ドメインワープ (BoS 13 fbm-warp の 2D 版そのもの) を球の uv に
//   ② Depth          … カメラからの距離でグラデ (青→水色) を add
//   ③ Lambert 照明    … dot(法線, 光) の陰影 (§4「法線→ライティング」の中身)
//   ④ Fresnel        … 縁が光る pow(1 - dot(法線, 視線), p) を add
//   final = ④ ∘ ③ ∘ ② ∘ ①  (Lamina の LayerMaterial を手合成した形)
//
// ── この Planet は頂点を変位しない ────────────────────────
//   03 blob は法線方向へ変位したが、こちらは球のまま。面白さは全部フラグメント側。
//   ただしライティングと Fresnel のために「法線」と「視線方向」を fs へ渡すのが新しい。
//   ・法線 vNormal … dot(N, 光) と dot(N, 視線) に使う
//   ・世界位置 vWorldPos … 視線方向 = cameraPos - worldPos を作るのに使う

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

  // ── UV 球を生成 (position, normal, uv) 03 と同じ。今回は変位しない ──
  const R = 1.5;
  const STACKS = 128;
  const SLICES = 128;
  const rowLen = SLICES + 1;
  const vertData: number[] = [];
  for (let i = 0; i <= STACKS; i++) {
    const phi = (i / STACKS) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let j = 0; j <= SLICES; j++) {
      const theta = (j / SLICES) * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);
      vertData.push(R * nx, R * ny, R * nz, nx, ny, nz, j / SLICES, i / STACKS);
    }
  }
  const vertexData = new Float32Array(vertData);

  const idx: number[] = [];
  for (let i = 0; i < STACKS; i++) {
    for (let j = 0; j < SLICES; j++) {
      const a = i * rowLen + j;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const indices = new Uint32Array(idx);

  const vertexBuffer = device.createBuffer({
    label: "sphere vertices (pos, normal, uv)",
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);

  const indexBuffer = device.createBuffer({
    label: "sphere indices",
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const module = device.createShaderModule({
    label: "vertex-mesh 04 - layered planet",
    code: /* wgsl */ `
      struct Uniforms {
        mvp: mat4x4f,        // 64B
        cameraPos: vec3f,    // + f32 で 16B に収まる (視線方向に使う)
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      struct VSOut {
        @builtin(position) clip: vec4f,
        @location(0) vUv: vec2f,
        @location(1) vNormal: vec3f,    // 世界法線 (model=単位なので頂点法線そのまま)
        @location(2) vWorldPos: vec3f,  // 世界位置 (視線 = cameraPos - これ)
      };

      // ── レイヤーの色定数 (Lamina では prop。ここは const。いじると惑星の色が変わる) ──
      const COLOR_A     = vec3f(0.071, 0.302, 0.847); // #124dd8 濃青
      const COLOR_B     = vec3f(0.169, 1.000, 0.906); // #2bffe7 アクア
      const CLOUD_TINT  = vec3f(0.000, 0.090, 0.255); // #001741 影の藍
      const DEPTH_A     = vec3f(0.0, 0.0, 1.0);        // 手前=青
      const DEPTH_B     = vec3f(0.0, 1.0, 1.0);        // 奥=水色
      const FRESNEL_COL = vec3f(0.996, 0.702, 0.851);  // #FEB3D9 ピンク
      const LIGHT_DIR   = normalize(vec3f(0.4, 0.3, 0.6));
      const AMBIENT     = 0.30;
      const LIGHT_INT   = 0.85;
      const FRESNEL_POW = 3.0;
      const LACUNARITY  = 2.3;
      const GAIN        = 0.5;
      // Depth の near/far (camera z=4.2, R=1.5 に合わせた)
      const NEAR = 2.7;
      const FAR  = 5.7;

      // ── Classic Perlin 2D noise (cnoise) — Stefan Gustavson, MIT ──
      fn mod289v4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn permute4(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 1.0) * x); }
      fn taylorInvSqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
      fn fade2(t: vec2f) -> vec2f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

      fn cnoise2(P: vec2f) -> f32 {
        var Pi = floor(P.xyxy) + vec4f(0.0, 0.0, 1.0, 1.0);
        let Pf = fract(P.xyxy) - vec4f(0.0, 0.0, 1.0, 1.0);
        Pi = mod289v4(Pi);
        let ix = Pi.xzxz;
        let iy = Pi.yyww;
        let fx = Pf.xzxz;
        let fy = Pf.yyww;
        let i = permute4(permute4(ix) + iy);
        var gx = fract(i * (1.0 / 41.0)) * 2.0 - 1.0;
        let gy = abs(gx) - 0.5;
        let tx = floor(gx + 0.5);
        gx = gx - tx;
        var g00 = vec2f(gx.x, gy.x);
        var g10 = vec2f(gx.y, gy.y);
        var g01 = vec2f(gx.z, gy.z);
        var g11 = vec2f(gx.w, gy.w);
        let norm = taylorInvSqrt4(vec4f(dot(g00, g00), dot(g01, g01), dot(g10, g10), dot(g11, g11)));
        g00 = g00 * norm.x;
        g01 = g01 * norm.y;
        g10 = g10 * norm.z;
        g11 = g11 * norm.w;
        let n00 = dot(g00, vec2f(fx.x, fy.x));
        let n10 = dot(g10, vec2f(fx.y, fy.y));
        let n01 = dot(g01, vec2f(fx.z, fy.z));
        let n11 = dot(g11, vec2f(fx.w, fy.w));
        let fade_xy = fade2(Pf.xy);
        let n_x = mix(vec2f(n00, n01), vec2f(n10, n11), fade_xy.x);
        let n_xy = mix(n_x.x, n_x.y, fade_xy.y);
        return 2.3 * n_xy;
      }

      // fBm: abs(cnoise) を 5 オクターブ (turbulence 型)。BoS 13 と同型
      fn fbm(st0: vec2f) -> f32 {
        var st = st0;
        var value = 0.0;
        var amplitude = 0.6;
        for (var i = 0; i < 5; i++) {
          value += amplitude * abs(cnoise2(st));
          st = st * LACUNARITY;
          amplitude *= GAIN;
        }
        return value;
      }

      // ── ① 雲レイヤー: fbm を fbm の座標に注ぐ domain warp (BoS 13 fbm-warp) ──
      fn layerClouds(uv: vec2f, t: f32) -> vec3f {
        let st = uv * 0.25;
        let f_time = t * 0.1;

        var q = vec2f(0.0);
        q.x = fbm(st);
        q.y = fbm(st + vec2f(1.0));

        var r = vec2f(0.0);
        r.x = fbm(st + q + vec2f(1.7, 9.2) + 0.15 * f_time);
        r.y = fbm(st + q + vec2f(8.3, 2.8) + 0.126 * f_time);

        let f = fbm(st + r);

        var col = mix(COLOR_A, COLOR_B, clamp((f * f) * 4.0, 0.0, 1.0));
        col = mix(col, CLOUD_TINT, clamp(length(q), 0.0, 1.0));
        col = col * mix(col, COLOR_A, clamp(abs(r.x), 0.0, 1.0));
        return col;
      }

      @vertex fn vs(
        @location(0) position: vec3f,
        @location(1) normal: vec3f,
        @location(2) uv: vec2f,
      ) -> VSOut {
        var out: VSOut;
        out.clip = u.mvp * vec4f(position, 1.0);  // 変位なし: 球のまま射影
        out.vUv = uv;
        out.vNormal = normal;
        out.vWorldPos = position;
        return out;
      }

      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        let N = normalize(in.vNormal);
        let viewDir = normalize(u.cameraPos - in.vWorldPos);

        // ① 雲 (下地)
        var col = layerClouds(in.vUv, u.time);

        // ② Depth: 距離でグラデを add
        let dist = length(u.cameraPos - in.vWorldPos);
        let dt = clamp((dist - NEAR) / (FAR - NEAR), 0.0, 1.0);
        col += mix(DEPTH_A, DEPTH_B, dt) * 0.4;

        // ③ Lambert 照明: ここまでの色に陰影 (光と反対側が暗く)
        let diffuse = max(dot(N, LIGHT_DIR), 0.0);
        col *= AMBIENT + diffuse * LIGHT_INT;

        // ④ Fresnel: 縁が光る。照明後に emissive として add (暗い側でも縁は光る)
        let fres = pow(1.0 - max(dot(N, viewDir), 0.0), FRESNEL_POW);
        col += FRESNEL_COL * fres;

        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "layered planet pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: 32,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32x2" },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list", cullMode: "back" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  // Uniforms: mat4x4f(64B) + vec3f + f32 → 80B
  const uniformValues = new Float32Array(20);
  const kCameraOffset = 16;
  const kTimeOffset = 19;
  const uniformBuffer = device.createBuffer({
    label: "uniforms (mvp, cameraPos, time)",
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // ── 4x4 行列ヘルパ (01〜03 と同一・列優先) ──
  type Mat4 = number[];
  type Vec3 = [number, number, number];

  function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0];
  }

  function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let rl = 1 / Math.hypot(zx, zy, zz); zx *= rl; zy *= rl; zz *= rl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    rl = 1 / Math.hypot(xx, xy, xz); xx *= rl; xy *= rl; xz *= rl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1,
    ];
  }

  function multiply(a: Mat4, b: Mat4): Mat4 {
    const o = new Array<number>(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  let depthTexture: GPUTexture | undefined;
  function ensureDepth(device: GPUDevice) {
    if (
      !depthTexture ||
      depthTexture.width !== canvas.width ||
      depthTexture.height !== canvas.height
    ) {
      depthTexture?.destroy();
      depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  const EYE: Vec3 = [0, 0, 4.2];

  function render(device: GPUDevice, time: number) {
    ensureDepth(device);

    const aspect = canvas.width / canvas.height;
    const proj = perspective((45 * Math.PI) / 180, aspect, 0.1, 40);
    const view = lookAt(EYE, [0, 0, 0], [0, 1, 0]);
    const mvp = multiply(proj, view);

    uniformValues.set(mvp, 0);
    uniformValues[kCameraOffset] = EYE[0];
    uniformValues[kCameraOffset + 1] = EYE[1];
    uniformValues[kCameraOffset + 2] = EYE[2];
    uniformValues[kTimeOffset] = time;
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0.01, 0.01, 0.03, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthTexture!.createView(),
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    };
    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.setIndexBuffer(indexBuffer, "uint32");
    pass.drawIndexed(indices.length);
    pass.end();
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
