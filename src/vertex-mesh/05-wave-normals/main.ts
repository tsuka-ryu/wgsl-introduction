// 頂点シェーダー編 — 05 法線の再計算 (波打つ板を陰影で立体的に)
// 01 の波打つ板に「変位後の法線」を足して Lambert 照明を乗せる。
// 法線の出し方を2通り実装し、USE_ANALYTIC で切り替えて比較できる。
//
// ── なぜ要るか ────────────────────────────────────────────
//   板を波打たせても、法線が真上 (0,1,0) のままだと照明が平坦で凹凸が見えない。
//   面の「傾き」に合わせて法線を傾ける = 高さ関数 f(x,z) の微分から作る。
//
// ── 高さ場 y=f(x,z) の法線の公式 ──────────────────────────
//   曲面 S(x,z) = (x, f, z) の接ベクトルは
//     ∂S/∂x = (1, ∂f/∂x, 0),  ∂S/∂z = (0, ∂f/∂z, 1)
//   その外積 (上向きになる順) が法線:
//     N = normalize(cross(∂S/∂z, ∂S/∂x)) = normalize(-∂f/∂x, 1, -∂f/∂z)
//
//   ・解析的 … ∂f/∂x, ∂f/∂z を手で微分 (sin→cos)。正確・追加サンプリング不要・FP向き
//   ・数値的 … f を x+ε, z+ε でも計算し差分で接ベクトル→外積 (Ronja/Cyanilux の手法)。
//             どんな f でも効くが f を3回計算・ε 依存の近似

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

  // ── 板の格子 (01 と同一) ──
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
      indices[q++] = a;
      indices[q++] = c;
      indices[q++] = b;
      indices[q++] = b;
      indices[q++] = c;
      indices[q++] = d;
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
    label: "vertex-mesh 05 - wave normals",
    code: /* wgsl */ `
      struct Uniforms {
        mvp: mat4x4f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // true=解析的(微分) / false=数値的(隣接サンプリング)。切り替えても見た目ほぼ同じ
      const USE_ANALYTIC = true;
      const LIGHT_DIR = normalize(vec3f(0.4, 0.7, 0.5)); // 上・手前から

      struct VSOut {
        @builtin(position) clip: vec4f,
        @location(0) vNormal: vec3f,   // 変位後の法線を fs へ (ライティング用)
        @location(1) height: f32,
      };

      // 高さ場 f(x,z) = 進行波の重ね合わせ (01 と同一)
      fn waveHeight(x: f32, z: f32, t: f32) -> f32 {
        return 0.22 * sin(2.5 * x + t)
             + 0.14 * sin(1.7 * z + t * 0.8)
             + 0.08 * sin(3.3 * (x + z) - t * 1.2);
      }

      // 解析的: f を x, z で手で微分 (sin→cos)。返すのは (∂f/∂x, ∂f/∂z)
      // 各項「係数 × 中身の微分係数 × cos(中身)」。z を含まない項は ∂/∂x で消える等に注意
      fn waveDeriv(x: f32, z: f32, t: f32) -> vec2f {
        let dfdx = 0.22 * 2.5 * cos(2.5 * x + t)
                 + 0.08 * 3.3 * cos(3.3 * (x + z) - t * 1.2);
        let dfdz = 0.14 * 1.7 * cos(1.7 * z + t * 0.8)
                 + 0.08 * 3.3 * cos(3.3 * (x + z) - t * 1.2);
        return vec2f(dfdx, dfdz);
      }

      // 数値的: f を x+ε, z+ε でも計算し、差分で接ベクトル2本 → 外積
      fn waveNormalNumeric(x: f32, z: f32, t: f32) -> vec3f {
        let eps = 0.01;
        let h  = waveHeight(x, z, t);
        let hx = waveHeight(x + eps, z, t);
        let hz = waveHeight(x, z + eps, t);
        let tx = vec3f(eps, hx - h, 0.0);  // x 方向の接ベクトル (中心→隣)
        let tz = vec3f(0.0, hz - h, eps);  // z 方向の接ベクトル
        return normalize(cross(tz, tx));   // 上向きになる順で外積
      }

      @vertex fn vs(@location(0) grid: vec2f) -> VSOut {
        let x = grid.x;
        let z = grid.y;
        let y = waveHeight(x, z, u.time);

        var n: vec3f;
        if (USE_ANALYTIC) {
          let d = waveDeriv(x, z, u.time);        // (∂f/∂x, ∂f/∂z)
          n = normalize(vec3f(-d.x, 1.0, -d.y));  // 高さ場の法線公式
        } else {
          n = waveNormalNumeric(x, z, u.time);
        }

        var out: VSOut;
        out.clip = u.mvp * vec4f(x, y, z, 1.0);
        out.vNormal = n;
        out.height = y;
        return out;
      }

      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        let Nrm = normalize(in.vNormal);
        let diffuse = max(dot(Nrm, LIGHT_DIR), 0.0);   // 面が光をどれだけ向くか
        let h = clamp(in.height * 1.6 + 0.5, 0.0, 1.0);
        let base = mix(vec3f(0.15, 0.10, 0.45), vec3f(0.30, 0.85, 1.00), h);
        let col = base * (0.15 + diffuse * 1.0);        // 環境光 + 拡散
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "wave normals pipeline",
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

  // ── 4x4 行列ヘルパ (01 と同一・列優先) ──
  type Mat4 = number[];
  type Vec3 = [number, number, number];

  function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far * nf, -1, 0, 0, far * near * nf, 0];
  }

  function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    let zx = eye[0] - center[0],
      zy = eye[1] - center[1],
      zz = eye[2] - center[2];
    let rl = 1 / Math.hypot(zx, zy, zz);
    zx *= rl;
    zy *= rl;
    zz *= rl;
    let xx = up[1] * zz - up[2] * zy,
      xy = up[2] * zx - up[0] * zz,
      xz = up[0] * zy - up[1] * zx;
    rl = 1 / Math.hypot(xx, xy, xz);
    xx *= rl;
    xy *= rl;
    xz *= rl;
    const yx = zy * xz - zz * xy,
      yy = zz * xx - zx * xz,
      yz = zx * xy - zy * xx;
    return [
      xx,
      yx,
      zx,
      0,
      xy,
      yy,
      zy,
      0,
      xz,
      yz,
      zz,
      0,
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
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
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
    const proj = perspective((50 * Math.PI) / 180, aspect, 0.1, 40);
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
