// The Book of Shaders — 13 fBm: フラクタルブラウン運動 (Fractal Brownian Motion)
// https://thebookofshaders.com/13/?lan=jp
//
// お手本 (patriciogv 2015) をそのまま WGSL へ移植したもの。
// 土台は 11-noise-2d の value noise。それを「周波数を上げ・振幅を下げながら足す」だけ。
//
// ── fBm の定義(和のかたち) ──────────────────────────────
//   fbm(x) = Σ_{i=0}^{N} g^i · noise(l^i · x)         g=gain=0.5, l=lacunarity=2
//   octave を1枚足すたび:  座標を l 倍 (波が細かく)、振幅を g 倍 (小さく)
//   for ループの中身がまさにこれ:
//       value     += amplitude * noise(st);  // 今の層を足す
//       st        *= 2.0;                     // 次の層は2倍細かい周波数で
//       amplitude *= 0.5;                     // 次の層は半分の振幅で
//
// ── なぜ octave を足すと自己相似(フラクタル)になるのか ───────
//   和の i=0 だけ外に出して番号を振り直すと、こう畳める:
//       fbm(x) = noise(x) + g · fbm(l·x)
//   「自分自身を l 倍ズームして g 倍に縮めたコピーを内側に含む」= 不動点的な再帰構造。
//   だから曲線を l 倍拡大すると (fbm(l·x) を見ると)、粗い層 noise(x) を引いて 1/g 倍した
//   だけの、元と同じ規則で並ぶディテールが現れる → どのスケールでも同じ手触り。
//   このループは無限再帰を OCTAVES 段で unfold して打ち切った有限近似。
//   g<1 なので振幅和は等比級数で収束 (絵は破綻しない) が、l^N より細かい detail は無い
//   = 数段で止めた「なんちゃってフラクタル」。N→∞ が本物のフラクタル。
//
// 1ピクセル st のトレース (OCTAVES=6):
//   noise(st)         … 一番粗い、大きなうねり (振幅 0.5)
//   noise(2·st)       … 半分のサイズの起伏を 0.25 で重ねる
//   noise(4·st)       … さらに半分を 0.125 で …
//   … 6枚重ねると、大うねりの上に細かなザラつきが乗った雲/山肌のような濃淡になる。

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
    label: "book of shaders 13 - fBm",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const OCTAVES = 6;

      // 2D Random (10章)。格子点の乱数源。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 2D value noise (11-noise-2d と同じ、Morgan McGuire @morgan3d)
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);

        // マスの4隅の乱数
        let a = random(i);
        let b = random(i + vec2f(1.0, 0.0));
        let c = random(i + vec2f(0.0, 1.0));
        let d = random(i + vec2f(1.0, 1.0));

        // なめらか補間 (= smoothstep(0,1,f))
        let u = f * f * (3.0 - 2.0 * f);

        return mix(a, b, u.x) +
               (c - a) * u.y * (1.0 - u.x) +
               (d - b) * u.x * u.y;
      }

      // fBm 本体: octave を積む。fbm(x) = noise(x) + g·fbm(l·x) の有限 unfold。
      fn fbm(p: vec2f) -> f32 {
        var value = 0.0;
        var amplitude = 0.5;
        var st = p; // ループで座標を破壊するのでコピー
        for (var i = 0; i < OCTAVES; i = i + 1) {
          value += amplitude * noise(st);
          st *= 2.0;        // lacunarity=2: 次の層は2倍細かく
          amplitude *= 0.5; // gain=0.5:      次の層は半分の振幅
        }
        return value;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // アスペクト比補正 (本の st.x *= u_resolution.x/u_resolution.y に相当)
        st.x *= u.resolution.x / u.resolution.y;

        // st*3.0 で座標系を3倍に拡大 → 一番粗い層のうねりが画面に数個ぶん見える
        let color = vec3f(fbm(st * 3.0));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "fbm pipeline",
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
