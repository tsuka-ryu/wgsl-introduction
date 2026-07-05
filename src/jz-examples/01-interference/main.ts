// jz examples — 01 interference: 2波源の干渉 (場の重ね合わせ)
// 参考: https://github.com/dy/jz/tree/main/examples/interference (CPU 版を WGSL へ移植)
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   image(p, t) = 色付け(場(p, t))
//   場(p, t)    = Σᵢ wave(|p − sᵢ(t)|)          … 2波源の「場の重ね合わせ」
//   wave(d)     = sin(K·d − ω·t)                 … 距離 d の同心円状の進行波
//   色付け(v)   = |v| · 0.5                      … [-2,2] の振幅を [0,1] の明度へ
//   波源の位置 sᵢ(t) だけが時間の関数で、あとはすべて座標の純関数。
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   あるピクセル p を考える。2つの波源までの距離 d1, d2 を測り、
//     sin(K·d1 − ωt) + sin(K·d2 − ωt)
//   を足す。積和公式で畳むと
//     = 2 · sin(K·(d1+d2)/2 − ωt) · cos(K·(d1−d2)/2)
//   前半は時間で流れる搬送波、後半は時間によらない包絡。つまり
//   このピクセルの「明るさの上限」は経路差 |d1−d2| だけで決まる:
//     |d1−d2| = n·λ       → cos = ±1 で強め合い (明)   λ = 2π/K
//     |d1−d2| = (n+½)·λ   → cos = 0  で打ち消し合い (暗)
//   「2点からの距離の差が一定」の曲線は双曲線なので、暗い縞は
//   2波源を焦点とする双曲線の族になる。これが干渉縞の正体。
//
// ── jz 版との差分 ────────────────────────────────────────
//   ・CPU の二重ループ → fragment shader (ループは GPU が並列に消してくれる)
//   ・ピクセル座標 + res=48/max(w,h) → 正規化座標 + 波数 K=48 (同じ意味)
//   ・jz は Int32 バッファに書くので sRGB 変換を手計算していた。
//     こちらは canvas の unorm フォーマットに任せてそのまま出す。

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
    label: "jz 01 - interference",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const K: f32 = 48.0;     // 波数 (画面短辺に波が 48/2π ≈ 7.6 周期)
      const OMEGA: f32 = 8.0;  // 位相速度: −ωt で輪が外向きに進む

      // 距離 d の点に届く波。距離が K ぶん進むごとに 1 周期、時間で外向きに流れる。
      fn wave(d: f32, t: f32) -> f32 {
        return sin(d * K - t * OMEGA);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // 短辺=1 の正規化座標 (アスペクト補正込み。円が円のまま描ける)
        let st = position.xy / min(u.resolution.x, u.resolution.y);
        let center = u.resolution / min(u.resolution.x, u.resolution.y) * 0.5;
        let t = u.time * 0.3;

        // 2つの波源はリサージュ風の軌道で泳ぎ回る (jz 版の orbit を正規化座標に写した)
        let s1 = center + vec2f(sin(t * 2.0) + sin(t), cos(t)) * 0.15;
        let s2 = center + vec2f(sin(t * 4.0) + sin(t + 1.2), sin(t * 3.0) + cos(t + 0.1)) * 0.15;

        // 場の重ね合わせ: 各波源からの進行波を足すだけ。和は [-2, 2]
        let field = wave(distance(st, s1), t) + wave(distance(st, s2), t);

        // 色付け: 振幅の絶対値を [0,1] の明度に。腹 (強め合い) が白、節 (打ち消し) が黒
        let a = abs(field) * 0.5;

        return vec4f(vec3f(a), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "interference pipeline",
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
