// The Book of Shaders — 10 ランダム: 擬似乱数ハッシュ (なぜランダムに見えるか)
// https://thebookofshaders.com/10/?lan=jp
//
// GPU には乱数生成器がない (各ピクセルは並列・独立で状態を持てない)。そこで「座標を
// 入れたら毎回同じだが、隣の座標とは無相関に散らばる値」を返す純粋関数で代用する。
// これがハッシュ。本の定番:
//
//   random(st) = fract( sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453 )
//
// なぜランダムに見えるか (1 ピクセル p で分解):
//   ① dot(st, k) … 2 次元座標を 1 本の数直線に潰す。k=(12.9898,78.233) は傾き。
//      隣の p どうしでも、この内積は少しずつ違う値になる。
//   ② sin(...)   … -1〜1 に折り返す滑らかな波。ここまでは "連続" で滑らか。
//   ③ ×43758.5  … 巨大な数を掛ける。sin の値が 0.001 違うだけで結果は数十ずれる。
//      = 入力の超微小な差が出力の整数部を大きく変える「引き伸ばし」。
//   ④ fract(...) … 整数部を捨てて小数部だけ残す。③で大きくずれた値の小数部は、
//      もとの座標の連続性を完全に失って 0〜1 に飛び散る。
//
//   キモは ③×④: 滑らかな sin を巨大倍して fract で折り畳むと、決定的な計算なのに
//   隣どうしの相関が壊れて "乱数のように" 見える。同じ st なら必ず同じ値 = 純粋関数。
//
// 注意: これは数学的にちゃんとした乱数ではなく、見た目が乱数っぽいだけの hack。
// sin の実装精度が GPU ごとに違うと模様が変わることもある。10 章はここから
// ノイズ (隣どうしを相関させた "滑らかな乱数") へ進む、その前段。

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
    label: "book of shaders 10 - random hash",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 擬似乱数ハッシュ: 座標 → 0〜1 の "乱数っぽい" 決定的な値。
      // dot で 1 次元に潰し → sin で波に → 巨大倍 → fract で折り畳む。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution; // 0〜1 の画面座標

        // 連続な座標をそのまま入れると、③×④ で隣どうしの相関が壊れて砂嵐になる。
        let rnd = random(st);

        return vec4f(vec3f(rnd), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "random pipeline",
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
