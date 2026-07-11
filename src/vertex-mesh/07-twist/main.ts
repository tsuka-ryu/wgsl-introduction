// 頂点シェーダー編 — 07 ツイスト (高さで xz を回す領域変形)
// 参考: Inigo Quilez の domain deformation。README §4 の「ツイスト」。
//
// ── 肝: 高さ y に応じて (x, z) を回転させる ──────────────────
//   角度 a = TWIST * y (+ 時間)。下(y小)はほぼ0°、上(y大)ほど大きく回る。
//   各水平スライスが少しずつ回るので、まっすぐな稜線がらせんに化ける = 捻れ。
//   変形 = 座標への関数適用 p ↦ rot(a(y))·p。回転は 2x2 行列 (BoS 08 の回転行列)。
//   ・法線も同じ角度で回す (近似。厳密には dθ/dy のせん断項が入るが、見た目は十分)。

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

  // ── 四角柱を生成 (position, normal, uv)。捻れを滑らかにするため縦分割を多く ──
  // 4 面をそれぞれ縦帯 (2 × (VSEG+1)) で作る。角ごとに法線を分けて稜線をシャープに。
  const W = 0.7;    // 断面の半幅
  const H = 1.5;    // 高さ
  const VSEG = 200; // 縦分割 (捻れの滑らかさ)
  const vertData: number[] = [];
  const idx: number[] = [];
  function addFace(ax: number, az: number, bx: number, bz: number, nx: number, nz: number) {
    const start = vertData.length / 8;
    for (let j = 0; j <= VSEG; j++) {
      const y = -H + 2 * H * (j / VSEG);
      vertData.push(ax, y, az, nx, 0, nz, 0, j / VSEG); // 面の左端
      vertData.push(bx, y, bz, nx, 0, nz, 1, j / VSEG); // 面の右端
    }
    for (let j = 0; j < VSEG; j++) {
      const a = start + j * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  //       角A →  角B     法線
  addFace( W,  W,  W, -W,  1,  0); // +x 面
  addFace( W, -W, -W, -W,  0, -1); // -z 面
  addFace(-W, -W, -W,  W, -1,  0); // -x 面
  addFace(-W,  W,  W,  W,  0,  1); // +z 面
  const vertexData = new Float32Array(vertData);
  const indices = new Uint32Array(idx);

  const vertexBuffer = device.createBuffer({
    label: "box vertices",
    size: vertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexData);
  const indexBuffer = device.createBuffer({
    label: "box indices",
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  const module = device.createShaderModule({
    label: "vertex-mesh 07 - twist",
    code: /* wgsl */ `
      struct U { mvp: mat4x4f, time: f32 };
      @group(0) @binding(0) var<uniform> u: U;

      const TWIST = 2.2;   // ねじれの強さ (rad / 高さ1)
      const LIGHT_DIR = normalize(vec3f(0.4, 0.5, 0.7));
      const MAGENTA = vec3f(1.0, 0.15, 0.6);
      const CYAN    = vec3f(0.1, 0.85, 1.0);

      struct VOut {
        @builtin(position) clip: vec4f,
        @location(0) n: vec3f,
        @location(1) uv: vec2f,
      };

      // 2D 回転行列 (BoS 08)。列優先: 列0=(c,s) 列1=(-s,c) → 角度 a の回転
      fn rot2(a: f32) -> mat2x2f {
        let c = cos(a); let s = sin(a);
        return mat2x2f(c, s, -s, c);
      }

      @vertex fn vs(
        @location(0) pos: vec3f,
        @location(1) nor: vec3f,
        @location(2) uv: vec2f,
      ) -> VOut {
        let a = TWIST * pos.y + u.time * 0.5;   // ← 高さ y に応じた回転角 (+時間で回す)
        let m = rot2(a);
        let xz  = m * pos.xz;   // (x,z) を回す = ツイスト
        let nxz = m * nor.xz;   // 法線も同じ角度で回す (近似)

        var o: VOut;
        o.clip = u.mvp * vec4f(xz.x, pos.y, xz.y, 1.0);
        o.n = normalize(vec3f(nxz.x, nor.y, nxz.y));
        o.uv = uv;
        return o;
      }

      @fragment fn fs(in: VOut) -> @location(0) vec4f {
        let N = normalize(in.n);
        let diff = max(dot(N, LIGHT_DIR), 0.0);
        // 高さでグラデ。捻れは稜線のらせんと、4面の陰影の変化で見える
        let base = mix(MAGENTA, CYAN, in.uv.y);
        return vec4f(base * (0.20 + diff * 0.9), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "twist pipeline",
    layout: "auto",
    vertex: {
      module, entryPoint: "vs",
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
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  const uniformValues = new Float32Array(20);
  const kTimeOffset = 16;
  const uniformBuffer = device.createBuffer({
    label: "uniforms (mvp, time)",
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // ── 4x4 行列ヘルパ (01〜06 と同一) ──
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

  let depthTexture: GPUTexture | undefined;
  function ensureDepth(device: GPUDevice) {
    if (!depthTexture || depthTexture.width !== canvas.width || depthTexture.height !== canvas.height) {
      depthTexture?.destroy();
      depthTexture = device.createTexture({
        size: [canvas.width, canvas.height], format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    }
  }

  function render(device: GPUDevice, time: number) {
    ensureDepth(device);
    const aspect = canvas.width / canvas.height;
    const proj = perspective((45 * Math.PI) / 180, aspect, 0.1, 40);
    const view = lookAt([0, 0.4, 4], [0, 0, 0], [0, 1, 0]);
    uniformValues.set(multiply(proj, view), 0);
    uniformValues[kTimeOffset] = time;
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const pass = device.createCommandEncoder();
    const rp = pass.beginRenderPass({
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0.02, 0.02, 0.06, 1], loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depthTexture!.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    rp.setPipeline(pipeline);
    rp.setBindGroup(0, bindGroup);
    rp.setVertexBuffer(0, vertexBuffer);
    rp.setIndexBuffer(indexBuffer, "uint32");
    rp.drawIndexed(indices.length);
    rp.end();
    device.queue.submit([pass.finish()]);
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
