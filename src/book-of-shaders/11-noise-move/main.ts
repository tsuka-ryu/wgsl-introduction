// The Book of Shaders — 11 ノイズ: noise を「動き」に使う
// https://thebookofshaders.com/11/?lan=jp
//
// これまで noise は「色・濃淡 (場の値)」として使ってきた。今回は noise の出力を
// 形の "位置" に流し込む。08 二次元行列の「空間を引いて形を動かす」サンプルを土台に、
// 十字の中心 offset を time の関数にする:
//
//   offset : 時間 → 位置        中心 = base + offset(time)
//   crossShape(st - center + 0.5)   ……  十字の中心を center に置く (08 の平行移動の式)
//
// ここでの主役は「offset を何で作るか」で動きの質がまるごと変わる、という対比:
//
//   ● random で作る  →  毎ステップ無相関な値が出る。前の値と今の値に何の関係もないので
//                       十字は瞬間移動 (テレポート) する。カクカク・神経質な動き。
//   ● noise で作る   →  noise は連続関数。time をほんの少し進めると出力もほんの少しだけ
//                       変わる。だから十字はぬるりと滑る。生き物のような有機的な動き。
//
// 同じ「乱数っぽさ」でも、random=点の列 / noise=なめらかな曲線、という違いがそのまま
// 動きの質感になる。これがこの章の "Use noise to move things" の肝。
//
// 1ピクセル st でのトレース (なぜ 2 つの十字が別々に動くか):
//   各フラグメントは offsetRandom と offsetNoise の両方を計算し、
//   「st が赤い十字の内側か」「st が水色の十字の内側か」をそれぞれ判定して色を足す。
//   offset は st に依存しない (全ピクセル共通の時間の関数) ので、十字は剛体のまま動く。

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
    label: "book of shaders 11 - use noise to move a cross",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // --- 形 (08-translate から流用) ---------------------------------------

      // 中心 0.5 まわりの軸ぞろえの長方形 (full width = size)。中=1 / 外=0。
      fn boxMask(st: vec2f, size: vec2f) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;
        let lower = smoothstep(margin, margin + vec2f(0.001), st);
        let upper = smoothstep(margin, margin + vec2f(0.001), vec2f(1.0) - st);
        let uv = lower * upper;
        return uv.x * uv.y;
      }

      // 十字 = 横長の帯 ∪ 縦長の帯。
      fn crossShape(st: vec2f, size: f32) -> f32 {
        let horizontal = boxMask(st, vec2f(size, size / 4.0));
        let vertical   = boxMask(st, vec2f(size / 4.0, size));
        return horizontal + vertical;
      }

      // 中心 0.5 固定の crossShape を、好きな中心 center に置き直すヘルパ。
      // st' = st - center + 0.5 とすると、st==center のとき st'==0.5 (形の中心) になる。
      fn crossAt(st: vec2f, center: vec2f, size: f32) -> f32 {
        return crossShape(st - center + vec2f(0.5), size);
      }

      // --- 乱数源 (10章 random / 11章 noise から流用) -----------------------

      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 2D value noise (Morgan McGuire)。整数格子点の乱数を smoothstep 補間で埋めた連続関数。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let a = random(i);
        let b = random(i + vec2f(1.0, 0.0));
        let c = random(i + vec2f(0.0, 1.0));
        let d = random(i + vec2f(1.0, 1.0));
        let w = f * f * (3.0 - 2.0 * f);
        return mix(a, b, w.x) +
               (c - a) * w.y * (1.0 - w.x) +
               (d - b) * w.x * w.y;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;                   // y を上向きに (本と合わせる)

        let amp = 0.18;                      // ふらつく振幅 (中心からのずれの最大)

        // ● random 駆動: floor(time) で時間を 0.5 秒刻みの "ステップ番号" に量子化し、
        //   そのステップ番号を種に乱数を引く。番号が変わった瞬間に値が無相関にジャンプ
        //   → 十字はテレポートする。(連続な time をそのまま種にすると毎フレーム別の
        //     乱数になり激しく震えるだけなので、floor で踏み板状に止めて "跳ね" を見せる)
        let step = floor(u.time * 2.0);
        let offsetRandom = vec2f(
          random(vec2f(step, 0.0)),
          random(vec2f(step, 17.0)),         // x と別の種にして 2 軸を無相関に
        ) * 2.0 - 1.0;                        // 0〜1 → -1〜1 (中心ゼロに)

        // ● noise 駆動: time を連続のまま noise に通す。time をゆっくり進めると noise も
        //   なめらかに変化 → 十字は滑らかにさまよう。x と y で格子の別の行を読んで
        //   2 軸を無相関にしている (vec2(0,t) と vec2(7,t))。
        let t = u.time * 0.4;
        let offsetNoise = vec2f(
          noise(vec2f(0.0, t)),
          noise(vec2f(7.0, t)),
        ) * 2.0 - 1.0;                        // noise は 0〜1 → -1〜1

        // 上半分に random の十字 (赤)、下半分に noise の十字 (水色) を置いて動かす。
        let centerRandom = vec2f(0.5, 0.72) + offsetRandom * amp;
        let centerNoise  = vec2f(0.5, 0.28) + offsetNoise  * amp;

        var color = vec3f(0.0);
        color += vec3f(1.0, 0.25, 0.2) * crossAt(st, centerRandom, 0.14); // 跳ねる
        color += vec3f(0.3, 0.75, 1.0) * crossAt(st, centerNoise,  0.14); // 滑る

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "noise-move pipeline",
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
