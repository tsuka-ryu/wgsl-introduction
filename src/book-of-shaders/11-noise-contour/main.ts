// The Book of Shaders — 11 ノイズ: 等高線マップ (noise を距離場として扱う)
// https://thebookofshaders.com/11/?lan=jp
//
// 11章の練習: 「ノイズのグラデーションをディスタンスフィールド (距離場) として扱うと
// どうなる?」。距離場とは「各点に1つのスカラー値が貼られた場」のこと。noise(p) は
// まさにそれ (各点に 0〜1 の値を返す関数) なので、その値を "高さ" や "距離" とみなせる。
//
// 距離場でいちばん素直な遊びは「等しい値の場所に線を引く」= 等高線 (地形図)。
//   等高線 = { 点 p | n(p) が k/N の倍数 }   … 値が一定のレベルにある点の集合 (level set)
//
// denotational に読むと、このシェーダは noise という関数の "地形" を可視化している:
//   ・floor(n*N)/N … その点の高さを N 段に量子化 → 標高ごとに色を塗る (色の帯)
//   ・fract(n*N)   … レベルからのはみ出し。0 に近い = ちょうど等高線の上 → そこに線を引く
//
// 1ピクセル p でのトレース:
//   1. q = n*N        … 高さを N 倍。整数部=何段目か、小数部=段内の位置。
//   2. dist = min(fract q, 1-fract q)  … 最寄りの等高線までの距離 (0〜0.5)。これが距離場。
//   3. fwidth(q)      … 隣ピクセルとの q の変化量 = 画面上での線の太さ。これで太さを一定に保つ
//                       (傾斜が緩い所は線が太く滲みがちなので、勾配で割ってアンチエイリアス)。
//   4. dist が fwidth より小さければ線、そうでなければ標高色。
//
// time で noise 空間をスクロールすると、地形がうねうね変形して等高線が生き物のように動く。

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
    label: "book of shaders 11 - noise contour map",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 2D value noise (11-noise-2d と同じ)。各点に 0〜1 の値を返す = これが距離場。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let a = random(i);
        let b = random(i + vec2f(1.0, 0.0));
        let c = random(i + vec2f(0.0, 1.0));
        let d = random(i + vec2f(1.0, 1.0));
        let w = f * f * (3.0 - 2.0 * f);
        return mix(a, b, w.x) + (c - a) * w.y * (1.0 - w.x) + (d - b) * w.x * w.y;
      }

      // 標高ごとの色 (Inigo Quilez の余弦パレット: a + b·cos(2π(c·t + d)))。
      // t=0〜1 をなめらかな虹色の帯に変換する。海(青)→緑→黄→赤 のような連続色。
      fn palette(t: f32) -> vec3f {
        let a = vec3f(0.5, 0.5, 0.5);
        let b = vec3f(0.5, 0.5, 0.5);
        let c = vec3f(1.0, 1.0, 1.0);
        let d = vec3f(0.0, 0.33, 0.67);
        return a + b * cos(6.28318 * (c * t + d));
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // noise を引く座標。時間で noise 空間をスクロール → 地形がうねって変形する。
        let p = st * 3.0 + vec2f(u.time * 0.08, u.time * 0.05);

        // この点の "高さ" = 距離場の値。
        let n = noise(p);

        const N = 14.0;     // 等高線の本数 (高さを何段に区切るか)
        let q = n * N;

        // 標高色: 何段目か (floor) で色を決め、段ごとにベタ塗りする。
        let level = floor(q) / N;
        var color = palette(level);

        // 等高線: 最寄りのレベルまでの距離 dist。0 に近いほど線の上。
        let dist = min(fract(q), 1.0 - fract(q));
        // fwidth(q) = 画面1px あたりの q の変化 = 勾配。これで線幅を画面上一定に保つ。
        let aa = fwidth(q);
        let line = 1.0 - smoothstep(0.0, aa * 1.5, dist);

        // 段の境目に暗い等高線を重ねる。
        color = mix(color, color * 0.15, line);

        // ちょっとした陰影: 高い所を明るく。地形図っぽさを足す。
        color *= 0.7 + 0.3 * n;

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "noise contour pipeline",
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