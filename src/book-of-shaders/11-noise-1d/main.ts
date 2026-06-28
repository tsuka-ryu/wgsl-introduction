// The Book of Shaders — 11 ノイズ: 自分の noise(x) を作る (1D)
// https://thebookofshaders.com/11/?lan=jp
//
// 10 章の random は「隣どうしが無相関に飛び散る」値だった (砂嵐)。ノイズはその逆で、
// 「隣どうしが相関する = なめらかにつながった乱数」。自然のゆらぎ (波・煙・地形) は
// 完全な乱数ではなく "近いところは似ている" から、ノイズが要る。
//
// 11 章の課題は「自分の float noise(float x) を作る」。考え方は denotational に一行:
//
//   noise: ℝ → [0,1]  を、こう定義したい関数として読む。
//     ・整数点 i では noise(i) = random(i)      … 格子の上では乱数そのもの
//     ・i と i+1 の あいだ では その2値を補間   … すきまをなめらかに埋める
//
//   つまり noise(x) = mix( random(floor x), random(floor x + 1), 補間カーブ(fract x) )
//
// このデモは x を横軸にとって、補間カーブを変えた 3 段階を重ねて描く。下から:
//   ① 赤  : 補間しない          → random(floor x)            … 階段 (10章のマス1色と同じ)
//   ② 黄  : 直線で補間 (f)       → mix(a, b, f)               … カクカクの折れ線 (角が尖る)
//   ③ 緑  : S字で補間 (smooth)   → mix(a, b, smoothstep(f))   … なめらかな波 = これがノイズ
//
// ①→②→③ は「すきまをどう埋めるか」だけの違い。格子点の値はどれも同じ random(i)。
// ②の折れ線は角 (微分が不連続) でカクつくので、③で f を S 字に通して角を丸める。
// これが 1D value noise。次の 11/12/13 章はこれを 2D・重ね合わせへ広げる。

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
    label: "book of shaders 11 - noise 1d",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 1D ハッシュ: 1 本の数 x → 0〜1 の "乱数っぽい" 決定的な値 (10章の random の 1次元版)。
      // 同じ x なら必ず同じ値を返す純粋関数。これを「格子点での乱数」として使う。
      fn random(x: f32) -> f32 {
        return fract(sin(x * 12.9898) * 43758.5453123);
      }

      // ── 自分の noise(x): 整数点では random、すきまは補間カーブで埋める ──
      // i = floor(x) は左どなりの格子点、f = fract(x) は格子内の進み具合 0〜1。
      // 左の値 random(i) と 右の値 random(i+1) を、carve(f) の割合で混ぜる。

      // ① 補間なし: f を捨てて左の値だけ返す → 格子内は一定 = 階段
      fn noiseStep(x: f32) -> f32 {
        return random(floor(x));
      }

      // ② 直線補間: f をそのまま混合比に使う → 折れ線 (格子点で角が尖る)
      fn noiseLinear(x: f32) -> f32 {
        let i = floor(x);
        let f = fract(x);
        return mix(random(i), random(i + 1.0), f);
      }

      // ③ なめらか補間: f を S 字 (smoothstep) に通してから混ぜる → 角が丸まり波になる
      //    smoothstep(0,1,f) は両端で傾き 0 の 3f²−2f³。これが value noise の肝。
      fn noise(x: f32) -> f32 {
        let i = floor(x);
        let f = fract(x);
        let u = smoothstep(0.0, 1.0, f);
        return mix(random(i), random(i + 1.0), u);
      }

      // plot: 曲線 y = curveY のすぐ近くだけ 1 を返す = その曲線が線として見える。
      fn plot(st: vec2f, curveY: f32) -> f32 {
        return smoothstep(0.012, 0.0, abs(st.y - curveY));
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // 正規化座標 st: 左下 (0,0)〜右上 (1,1)。WebGPU は y が上向きなので反転して合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 横軸 st.x (0〜1) を 5 格子ぶんに引き伸ばし、時間でゆっくり横スクロール。
        // これで画面に整数点が 5 個ぶん並び、すきまの埋め方の違いが見える。
        let x = st.x * 5.0 + u.time * 0.5;

        // この 1 ピクセルの横位置 x について、3 通りの noise を評価する。
        let yStep   = noiseStep(x);   // ①
        let yLinear = noiseLinear(x); // ②
        let ySmooth = noise(x);       // ③ = 完成版

        // 背景: 整数点に薄い縦線を引いて「格子」を見えるようにする。
        // fract(x) が 0 付近 (= 格子のへり) で明るく。
        let grid = smoothstep(0.04, 0.0, fract(x)) * 0.15;
        var color = vec3f(0.05 + grid);

        // 3 本の曲線を上から重ねる (後の plot ほど手前)。
        color = mix(color, vec3f(1.0, 0.3, 0.3), plot(st, yStep));   // ① 赤 = 階段
        color = mix(color, vec3f(1.0, 0.9, 0.2), plot(st, yLinear)); // ② 黄 = 折れ線
        color = mix(color, vec3f(0.3, 1.0, 0.5), plot(st, ySmooth)); // ③ 緑 = なめらか

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "noise 1d pipeline",
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