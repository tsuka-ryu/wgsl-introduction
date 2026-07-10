// 頂点シェーダー編 — 01 波打つ板 + 高さでグラデ (Varying)
// 参考: Maxime Heckel "The Study of Shaders with React Three Fiber"
//       (R3F+GLSL の内容を、バニラ WebGPU + WGSL に読み替えて自作)
//
// ── これまでとの違い ──────────────────────────────────────
//   2D では頂点シェーダーは「画面いっぱいの三角形」を出すだけの置物で、
//   面白さは全部フラグメント側 (色 = f(uv)) にあった。
//   今回は初めて頂点シェーダーが主役になる:
//     位置 = g(頂点, t)        … 板の各頂点を高さ方向へ持ち上げる純関数
//   そして「頂点で計算した値」を Varying でフラグメントへ渡す。
//
// ── 1頂点のトレース ──────────────────────────────────────
//   板 (xz 平面) の格子点 (x, z) を1つ考える。高さを
//     y = waveHeight(x, z, t) = Σ sin(…)          … 進行波の重ね合わせ
//   で決め、クリップ座標へは MVP 行列で射影する:
//     clip = 射影 ∘ カメラ ∘ モデル (= MVP) · (x, y, z, 1)
//   このとき y (変位量) を @location(0) に載せて出力する。
//
// ── Varying = 頂点→ラスタライザ→フラグメント の自動補間 ────
//   三角形の3頂点それぞれが持つ height を、ラスタライザが三角形の
//   内側のピクセルへ「重心座標で線形補間」して配ってくれる。
//   フラグメントは補間済みの height を受け取り、色に変換するだけ:
//     色 = mix(谷の色, 山の色, height を [0,1] に畳んだもの)
//   2D フルスクリーンでは全く使わなかった、この「頂点で計算 → 面で補間」
//   の流れを体で覚えるのが今回の狙い。
//
// ── 3D で初登場する三点セット ──────────────────────────────
//   ・MVP 行列   … 3D の点を画面へ射影する (下の perspective/lookAt/multiply)
//   ・深度バッファ … 手前の面が奥の面を隠す (depth24plus)
//   ・頂点/インデックスバッファ … 板の格子と三角形の繋ぎ方を GPU へ

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

  // ── 板の格子 (xz 平面) をつくる ────────────────────────────
  // (N+1)×(N+1) 個の頂点を [-HALF, HALF]² に並べ、各マスを2枚の三角形に割る。
  const N = 120;
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
    label: "vertex-mesh 01 - wave + varying",
    code: /* wgsl */ `
      struct Uniforms {
        mvp: mat4x4f,   // 射影 ∘ カメラ ∘ モデル をまとめた行列
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      struct VSOut {
        @builtin(position) clip: vec4f,
        // 頂点で出した値。三角形の内部でラスタライザが自動補間して fs に渡す = Varying
        @location(0) height: f32,
      };

      // 変位: 板の各点 (x, z) を高さ y に持ち上げる純関数 (進行波の重ね合わせ)
      fn waveHeight(x: f32, z: f32, t: f32) -> f32 {
        return 0.22 * sin(2.5 * x + t)
             + 0.14 * sin(1.7 * z + t * 0.8)
             + 0.08 * sin(3.3 * (x + z) - t * 1.2);
      }

      @vertex fn vs(@location(0) grid: vec2f) -> VSOut {
        let x = grid.x;
        let z = grid.y;
        let y = waveHeight(x, z, u.time);   // ← ここが頂点シェーダーの主役の仕事

        var out: VSOut;
        out.clip = u.mvp * vec4f(x, y, z, 1.0);
        out.height = y;                     // 変位量を Varying に載せる
        return out;
      }

      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        // in.height は「頂点の値」ではなく「三角形内で補間された値」で届いている
        let h = clamp(in.height * 1.6 + 0.5, 0.0, 1.0);
        let valley = vec3f(0.85, 0.10, 0.55);  // 谷 = マゼンタ
        let peak   = vec3f(0.10, 0.85, 1.00);  // 山 = シアン
        return vec4f(mix(valley, peak, h), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "wave plane pipeline",
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

  // Uniforms: mat4x4f (64B) + f32、struct サイズは 16 の倍数に丸めて 80B
  const uniformValues = new Float32Array(20);
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

  // ── 最小限の 4x4 行列ヘルパ (すべて列優先。WGSL の mat4x4f と同じ並び) ──
  type Mat4 = number[];
  type Vec3 = [number, number, number];

  // 透視投影 (WebGPU の深度 z ∈ [0,1] 版)
  function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, far * nf, -1,
      0, 0, far * near * nf, 0,
    ];
  }

  // カメラ行列: eye から center を見る (up は上向き)
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

  // a · b (列優先どうしの積 = 変換の合成)
  function multiply(a: Mat4, b: Mat4): Mat4 {
    const o = new Array<number>(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  // ── 深度テクスチャ (キャンバスと同サイズ。リサイズで作り直す) ──
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
    const proj = perspective((50 * Math.PI) / 180, aspect, 0.1, 20);
    const view = lookAt([0, 1.4, 3.0], [0, 0, 0], [0, 1, 0]);
    const mvp = multiply(proj, view); // モデルは単位行列なので MVP = proj · view

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
