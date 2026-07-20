// 幾何学パターン — 03 ルーン文字ジェネレータ: 鏡映 (abs 軸折り) × タイリング
// 参考: 幾何学パターンの本 1.3「鏡映対称」/ 間隔+回転 (p32-33 のルーン群)
//
// ── 発想: 鏡映ペアを敷き詰めるだけ ────────────────────────
//   本の p33 のルーン記号は、1個の非対称な要素 (h みたいなの) を
//   ①ある角度に回して ②軸で鏡映して2つ並べた だけの創発物。
//   これをタイルごとにランダムな角度でやると、毎マス違うルーン文字になる。
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = 背景 と インク を、字画の濃度で混ぜたもの
//   字画(セル座標) = min( element(右の要素), element(左=鏡像の要素) )   … 鏡映ペア
//   element(q)     = q を回した先の「h 型ストローク」までの距離
//   セル座標       = fract(p·GRID) − 0.5                              … 並進タイリング
//   回転角 θ       = hash(セル番号) を 45°刻みに量子化                … マスごとに固定
//   時間には依らない純粋な座標の関数。
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   p がどのタイルの、タイル内どこ (local) かを fract で出す。そのタイルの
//   乱数から回転角 θ を1つ引く。local を軸から間隔 s ずらした「右の要素」と、
//   x を反転した「左の要素」の両方について、θ 回した h 型ストロークまでの距離を測り、
//   近い方を採用。x の反転 (鏡映) で必ず左右対称 = ルーンらしさが出る。

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

  const module = device.createShaderModule({
    label: "geometric-patterns 03 - rune generator",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const GRID: f32 = 6.0;    // 1辺あたりのタイル数 (= ルーン文字の個数)
      const STEPS: f32 = 8.0;   // 回転を何段階に量子化するか (8 = 45°刻み)
      const SPACING: f32 = 0.14;// 鏡映ペアが軸からどれだけ離れるか (間隔)
      const THICK: f32 = 0.028; // 字画ストロークの太さ (半分)
      const TAU: f32 = 6.2831853;

      // タイル番号 → [0,1) の擬似乱数
      fn hash21(p: vec2f) -> f32 {
        let h = dot(p, vec2f(127.1, 311.7));
        return fract(sin(h) * 43758.5453);
      }

      // 2D 回転行列 (座標を -a 回すと図形は +a 回る)
      fn rot(a: f32) -> mat2x2f {
        let c = cos(a); let s = sin(a);
        return mat2x2f(c, -s, s, c);
      }

      // 線分 a-b までの距離 (ストロークの素)
      fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
        let pa = p - a;
        let ba = b - a;
        let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }

      // 要素: 非対称な「h 型」ストローク (縦の軸 + 右上へ伸びる腕)
      fn element(q: vec2f) -> f32 {
        let stem = sdSeg(q, vec2f(0.0, -0.26), vec2f(0.0, 0.26));
        let arm  = sdSeg(q, vec2f(0.0, 0.02), vec2f(0.20, 0.22));
        return min(stem, arm);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // 短辺=1 の正規化座標 → GRID 倍してタイルへ
        let res = u.resolution;
        var st = position.xy / min(res.x, res.y);
        st.y = -st.y;
        let cellF = st * GRID;

        let cell = floor(cellF);
        var local = fract(cellF) - 0.5;  // タイル内 [-0.5, 0.5]

        // このタイルの回転角 (45°刻みに量子化してマスごとに固定)
        let ang = floor(hash21(cell) * STEPS) / STEPS * TAU;
        let R = rot(-ang);

        // 鏡映ペア: 右の要素と、x を反転した左の要素。両方 θ 回して近い方
        let qr = R * (local - vec2f(SPACING, 0.0));
        let ql = R * (vec2f(-local.x, local.y) - vec2f(SPACING, 0.0));
        let d = min(element(qr), element(ql));

        let ink = 1.0 - smoothstep(THICK, THICK + 0.006, d);

        let bg  = vec3f(0.96, 0.95, 0.91);  // クリーム地
        let red = vec3f(0.83, 0.20, 0.13);  // 赤の字画
        let col = mix(bg, red, ink);
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rune pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };
    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
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
