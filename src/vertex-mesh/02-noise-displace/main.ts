// 頂点シェーダー編 — 02 ノイズ変位 (その場でうねうねする板)
// 参考: Varun Vachhar "Noise in Creative Coding" https://varun.ca/noise/
//       simplex noise は Ashima/McEwan の 3D 実装 (BoS 11 の 2D 版の 3D 拡張) を WGSL へ移植
//
// ── 01 との違いは waveHeight → ノイズ変位、それだけ ──────────
//   01 は y = Σ sin(…) で規則的な波。ここは y = fBm(3D simplex noise) で有機的なうねり。
//   MVP・深度・頂点/インデックスバッファ・Varying は 01 とまったく同じ。
//
// ── 「その場でうねうね」の肝 = 3D ノイズの3つ目の軸に時間を入れる ──
//   板は平面なので位置は (x, z) の2次元。これに時間 t を足して 3D ノイズにする:
//     y = snoise3(x, z, t)
//   ・snoise2(x + t, z) だと模様が横に「流れる」(スクロール)
//   ・snoise3(x, z, t) は xz を固定して時間軸だけ進むので、模様が
//     その場で morph する = うねうね変形。これが欲しかった動き。
//   (球など表面がすでに 3D の場合は snoise4(x,y,z,t) と 4D が要る)

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

  // ── 板の格子 (xz 平面) をつくる (01 と同一) ──
  const N = 160;
  const HALF = 1.5;
  const positions = new Float32Array((N + 1) * (N + 1) * 2);
  let p = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      positions[p++] = (i / N) * 2 * HALF - HALF; // x
      positions[p++] = (j / N) * 2 * HALF - HALF; // z
    }
  }
  const indices = new Uint32Array(N * N * 6);
  let q = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + (N + 1);
      const d = c + 1;
      indices[q++] = a; indices[q++] = c; indices[q++] = b;
      indices[q++] = b; indices[q++] = c; indices[q++] = d;
    }
  }

  const vertexBuffer = device.createBuffer({
    label: "grid vertices (x, z)",
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, positions);

  const indexBuffer = device.createBuffer({
    label: "grid indices",
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const module = device.createShaderModule({
    label: "vertex-mesh 02 - noise displace",
    code: /* wgsl */ `
      struct Uniforms {
        mvp: mat4x4f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      struct VSOut {
        @builtin(position) clip: vec4f,
        @location(0) height: f32,   // 変位量を Varying で fs へ
      };

      // ── 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) を WGSL へ移植 ──
      // WGSL は関数オーバーロード不可なので mod289 を型ごとに分ける
      fn mod289_3(x: vec3f) -> vec3f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod289_4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn permute4(x: vec4f) -> vec4f { return mod289_4(((x * 34.0) + 1.0) * x); }
      fn taylorInvSqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }

      fn snoise3(v: vec3f) -> f32 {
        let C = vec2f(1.0 / 6.0, 1.0 / 3.0);
        let D = vec4f(0.0, 0.5, 1.0, 2.0);

        // 第1頂点 (skew で三角格子=四面体格子へ)
        var i  = floor(v + dot(v, C.yyy));
        let x0 = v - i + dot(i, C.xxx);

        // 四面体の他の頂点
        let g = step(x0.yzx, x0.xyz);
        let l = 1.0 - g;
        let i1 = min(g.xyz, l.zxy);
        let i2 = max(g.xyz, l.zxy);

        let x1 = x0 - i1 + C.xxx;
        let x2 = x0 - i2 + C.yyy;
        let x3 = x0 - D.yyy;

        // 格子点ハッシュ
        i = mod289_3(i);
        let pp = permute4(permute4(permute4(
            i.z + vec4f(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4f(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4f(0.0, i1.x, i2.x, 1.0));

        // 勾配 (7x7 点を球面に散らす)
        let n_ = 1.0 / 7.0;
        let ns = n_ * D.wyz - D.xzx;
        let j = pp - 49.0 * floor(pp * ns.z * ns.z);
        let x_ = floor(j * ns.z);
        let y_ = floor(j - 7.0 * x_);
        let gx = x_ * ns.x + ns.yyyy;
        let gy = y_ * ns.x + ns.yyyy;
        let gh = 1.0 - abs(gx) - abs(gy);

        let b0 = vec4f(gx.xy, gy.xy);
        let b1 = vec4f(gx.zw, gy.zw);
        let s0 = floor(b0) * 2.0 + 1.0;
        let s1 = floor(b1) * 2.0 + 1.0;
        let sh = -step(gh, vec4f(0.0));
        let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
        let a1 = b1.xzyw + s1.xzyw * sh.zzww;

        var p0 = vec3f(a0.xy, gh.x);
        var p1 = vec3f(a0.zw, gh.y);
        var p2 = vec3f(a1.xy, gh.z);
        var p3 = vec3f(a1.zw, gh.w);

        // 勾配を正規化
        let norm = taylorInvSqrt4(vec4f(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
        p0 = p0 * norm.x;
        p1 = p1 * norm.y;
        p2 = p2 * norm.z;
        p3 = p3 * norm.w;

        // 距離で減衰する丸い窓で重み付けして合計
        var m = max(0.6 - vec4f(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4f(0.0));
        m = m * m;
        return 42.0 * dot(m * m, vec4f(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
      }

      // 変位: 3D ノイズを数オクターブ重ねた fBm。3つ目の軸に時間を入れて「その場でうねうね」
      fn displace(x: f32, z: f32, t: f32) -> f32 {
        var y = 0.0;
        var amp = 0.30;
        var freq = 1.1;
        for (var o = 0; o < 4; o++) {
          // ↓ 3引数目が時間。xz は freq で細かくするだけ、時間軸だけ進むので流れずに変形する
          y += amp * snoise3(vec3f(x * freq, z * freq, t * 0.35));
          freq *= 2.0;
          amp *= 0.5;
        }
        return y;
      }

      @vertex fn vs(@location(0) grid: vec2f) -> VSOut {
        let x = grid.x;
        let z = grid.y;
        let y = displace(x, z, u.time);   // ← 01 の waveHeight がノイズに変わっただけ

        var out: VSOut;
        out.clip = u.mvp * vec4f(x, y, z, 1.0);
        out.height = y;
        return out;
      }

      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        let h = clamp(in.height * 1.6 + 0.5, 0.0, 1.0);
        let valley = vec3f(0.85, 0.10, 0.55);  // 谷 = マゼンタ
        let peak   = vec3f(0.10, 0.85, 1.00);  // 山 = シアン
        return vec4f(mix(valley, peak, h), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "noise displace pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }] },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const uniformValues = new Float32Array(20); // mat4x4f(64B) + f32 → 80B
  const kTimeOffset = 16;
  const uniformBuffer = device.createBuffer({
    label: "uniforms (mvp, time)",
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // ── 4x4 行列ヘルパ (01 と同一・すべて列優先) ──
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

  function render(device: GPUDevice, time: number) {
    ensureDepth(device);

    const aspect = canvas.width / canvas.height;
    const proj = perspective((55 * Math.PI) / 180, aspect, 0.1, 40);
    const view = lookAt([0, 1.4, 3.0], [0, 0, 0], [0, 1, 0]);
    const mvp = multiply(proj, view);

    uniformValues.set(mvp, 0);
    uniformValues[kTimeOffset] = time;
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0.02, 0.02, 0.06, 1],
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
