// 頂点シェーダー編 — 03 Blob (法線方向へノイズ変位する球)
// 参考: Maxime Heckel "The Study of Shaders with React Three Fiber" の Blob
//       (R3F + GLSL) を WGSL へ移植。cnoise は Stefan Gustavson の Classic Perlin 3D。
//
// ── 肝: 頂点を「法線方向」へノイズ分だけ押し出す ──────────────
//   vDisplacement = cnoise(position + 2*time)      … 各頂点でのノイズ値
//   newPosition   = position + normal * intensity * vDisplacement
//   球の各点を外向き(法線)に膨らませ/へこませる。表面全体で起きるので blob がうねる。
//   ・01 は平面の y、02 は平面の y をノイズで。ここは「法線方向」への変位＝任意形状に効く一般形。
//   ・normal を頂点データで受け取り、変位量 vDisplacement を Varying で fs へ渡す点も新しい。
//
// ── 01/02 からの追加点 ────────────────────────────────────
//   ・平面の格子でなく UV 球を生成 (position / normal / uv の3属性)
//   ・頂点属性が3つ (@location 0,1,2)、Varying も2つ (vUv, vDisplacement)
//   ・hover で intensity を lerp して膨らませる (原典の onPointerOver 相当。簡易にキャンバス全体)

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

  // ── UV 球を生成 (position, normal, uv をインターリーブ) ──
  // 原点中心の球なので normal = normalize(position) = position/R。
  const R = 1.4;
  const STACKS = 128; // 緯度
  const SLICES = 128; // 経度
  const rowLen = SLICES + 1;
  const vertData: number[] = [];
  for (let i = 0; i <= STACKS; i++) {
    const phi = (i / STACKS) * Math.PI; // 0..π (上→下)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let j = 0; j <= SLICES; j++) {
      const theta = (j / SLICES) * Math.PI * 2; // 0..2π
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);
      // position(=R*normal), normal, uv
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
    label: "vertex-mesh 03 - blob",
    code: /* wgsl */ `
      struct Uniforms {
        mvp: mat4x4f,
        time: f32,
        intensity: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      struct VSOut {
        @builtin(position) clip: vec4f,
        @location(0) vUv: vec2f,
        @location(1) vDisplacement: f32,   // 変位量を fs へ (色に使う)
      };

      // ── Classic Perlin 3D noise (cnoise) — Stefan Gustavson, MIT ──
      // WGSL は関数オーバーロード不可なので mod289 を型ごとに分ける
      fn mod289v3(x: vec3f) -> vec3f { return x - floor(x / 289.0) * 289.0; }
      fn mod289v4(x: vec4f) -> vec4f { return x - floor(x / 289.0) * 289.0; }
      fn permute4(x: vec4f) -> vec4f { return mod289v4(((x * 34.0) + 1.0) * x); }
      fn taylorInvSqrt4(r: vec4f) -> vec4f { return 1.79284291400159 - 0.85373472095314 * r; }
      fn fade3(t: vec3f) -> vec3f { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

      fn cnoise(P: vec3f) -> f32 {
        var Pi0 = floor(P);
        var Pi1 = Pi0 + vec3f(1.0);
        Pi0 = mod289v3(Pi0);
        Pi1 = mod289v3(Pi1);
        let Pf0 = fract(P);
        let Pf1 = Pf0 - vec3f(1.0);
        let ix = vec4f(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
        let iy = vec4f(Pi0.yy, Pi1.yy);
        let iz0 = Pi0.zzzz;
        let iz1 = Pi1.zzzz;

        let ixy = permute4(permute4(ix) + iy);
        let ixy0 = permute4(ixy + iz0);
        let ixy1 = permute4(ixy + iz1);

        var gx0 = ixy0 / 7.0;
        var gy0 = fract(floor(gx0) / 7.0) - 0.5;
        gx0 = fract(gx0);
        let gz0 = vec4f(0.5) - abs(gx0) - abs(gy0);
        let sz0 = step(gz0, vec4f(0.0));
        gx0 = gx0 - sz0 * (step(vec4f(0.0), gx0) - 0.5);
        gy0 = gy0 - sz0 * (step(vec4f(0.0), gy0) - 0.5);

        var gx1 = ixy1 / 7.0;
        var gy1 = fract(floor(gx1) / 7.0) - 0.5;
        gx1 = fract(gx1);
        let gz1 = vec4f(0.5) - abs(gx1) - abs(gy1);
        let sz1 = step(gz1, vec4f(0.0));
        gx1 = gx1 - sz1 * (step(vec4f(0.0), gx1) - 0.5);
        gy1 = gy1 - sz1 * (step(vec4f(0.0), gy1) - 0.5);

        var g000 = vec3f(gx0.x, gy0.x, gz0.x);
        var g100 = vec3f(gx0.y, gy0.y, gz0.y);
        var g010 = vec3f(gx0.z, gy0.z, gz0.z);
        var g110 = vec3f(gx0.w, gy0.w, gz0.w);
        var g001 = vec3f(gx1.x, gy1.x, gz1.x);
        var g101 = vec3f(gx1.y, gy1.y, gz1.y);
        var g011 = vec3f(gx1.z, gy1.z, gz1.z);
        var g111 = vec3f(gx1.w, gy1.w, gz1.w);

        let norm0 = taylorInvSqrt4(vec4f(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
        g000 = g000 * norm0.x;
        g010 = g010 * norm0.y;
        g100 = g100 * norm0.z;
        g110 = g110 * norm0.w;
        let norm1 = taylorInvSqrt4(vec4f(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
        g001 = g001 * norm1.x;
        g011 = g011 * norm1.y;
        g101 = g101 * norm1.z;
        g111 = g111 * norm1.w;

        let n000 = dot(g000, Pf0);
        let n100 = dot(g100, vec3f(Pf1.x, Pf0.y, Pf0.z));
        let n010 = dot(g010, vec3f(Pf0.x, Pf1.y, Pf0.z));
        let n110 = dot(g110, vec3f(Pf1.x, Pf1.y, Pf0.z));
        let n001 = dot(g001, vec3f(Pf0.x, Pf0.y, Pf1.z));
        let n101 = dot(g101, vec3f(Pf1.x, Pf0.y, Pf1.z));
        let n011 = dot(g011, vec3f(Pf0.x, Pf1.y, Pf1.z));
        let n111 = dot(g111, Pf1);

        let fade_xyz = fade3(Pf0);
        let n_z = mix(vec4f(n000, n100, n010, n110), vec4f(n001, n101, n011, n111), fade_xyz.z);
        let n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
        let n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
        return 2.2 * n_xyz;
      }

      @vertex fn vs(
        @location(0) position: vec3f,
        @location(1) normal: vec3f,
        @location(2) uv: vec2f,
      ) -> VSOut {
        let displacement = cnoise(position + vec3f(2.0 * u.time));
        // 法線方向へ intensity*displacement だけ押し出す ← blob の肝
        let newPosition = position + normal * (u.intensity * displacement);

        var out: VSOut;
        out.clip = u.mvp * vec4f(newPosition, 1.0);
        out.vUv = uv;
        out.vDisplacement = displacement;
        return out;
      }

      @fragment fn fs(in: VSOut) -> @location(0) vec4f {
        let distort = 2.0 * in.vDisplacement * u.intensity;
        let color = vec3f(abs(in.vUv - vec2f(0.5)) * 2.0 * (1.0 - distort), 1.0);
        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "blob pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: 32, // 8 float × 4 byte (pos3 + normal3 + uv2)
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" }, // position
            { shaderLocation: 1, offset: 12, format: "float32x3" }, // normal
            { shaderLocation: 2, offset: 24, format: "float32x2" }, // uv
          ],
        },
      ],
    },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
    depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
  });

  // Uniforms: mat4x4f(64B) + f32 + f32 → 80B
  const uniformValues = new Float32Array(20);
  const kTimeOffset = 16;
  const kIntensityOffset = 17;
  const uniformBuffer = device.createBuffer({
    label: "uniforms (mvp, time, intensity)",
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // ── 4x4 行列ヘルパ (01/02 と同一・すべて列優先) ──
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

  // hover で膨らむ (簡易: キャンバス上にポインタがあるか)
  let hover = false;
  canvas.addEventListener("pointerenter", () => (hover = true));
  canvas.addEventListener("pointerleave", () => (hover = false));
  let intensity = 0.15;

  function render(device: GPUDevice, time: number) {
    ensureDepth(device);

    // intensity を目標値へなめらかに寄せる (原典の MathUtils.lerp 相当)
    intensity += ((hover ? 0.6 : 0.15) - intensity) * 0.05;

    const aspect = canvas.width / canvas.height;
    const proj = perspective((80 * Math.PI) / 180, aspect, 0.1, 40);
    const view = lookAt([0, 0, 4.0], [0, 0, 0], [0, 1, 0]);
    const mvp = multiply(proj, view);

    uniformValues.set(mvp, 0);
    uniformValues[kTimeOffset] = time * 0.4; // 原典の 0.4 * elapsed
    uniformValues[kIntensityOffset] = intensity;
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
