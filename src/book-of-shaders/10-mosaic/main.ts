// The Book of Shaders — 10 ランダム: モザイク (floor で格子に丸めてから random)
// https://thebookofshaders.com/10/?lan=jp
//
// 10-random は連続座標をそのまま random に入れた → 隣どうし無相関の砂嵐。
// ここでは入力を floor で「マス番地」に丸めてから引く。すると 1 マスの中はどのピクセルも
// 同じ整数番地 → 同じ乱数値になり、マス単位の市松ならぬモザイクになる。
//
// 砂嵐との違いはたった 1 行 (random の引数):
//   random(st)         … st が連続 → ピクセルごとに別値 → 砂嵐
//   random(floor(st))  … floor で階段状 → マス内は一定 → モザイク
//
// 1 ピクセル p で:
//   st *= 10 で座標を 0〜10 に拡大。floor(st)=ipos はそのマスの整数番地 (例 (3,7))。
//   マス内のどこにいても ipos は同じなので random(ipos) も同じ = マス全体が一色。
//   fract(st)=fpos はマス内ローカル 0〜1 (ここでは色には使わず、格子確認用に残す)。
//
// これがノイズへの橋渡し: 「乱数は "格子点" でだけ引く」。10-random が無相関だったのは
// 連続入力だったから。格子に丸めると "同じマスは同じ値" という相関が生まれる。次の
// value noise は、この格子点の乱数を fract で補間して階段を滑らかな丘にする。

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
    label: "book of shaders 10 - mosaic",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 擬似乱数ハッシュ (10-random と同じ): 座標 → 0〜1 の決定的な "乱数っぽい" 値。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標

        st = st * 10.0;            // 座標系を 10 倍 (0〜10 に)
        let ipos = floor(st);      // マスの整数番地 (マス内で一定)
        let fpos = fract(st);      // マス内ローカル 0〜1 (今回は格子確認用)

        // ▼ どちらか有効に ▼
        let color = vec3f(random(ipos)); // 番地で乱数を引く → 1 マス 1 色のモザイク
        // let color = vec3f(fpos, 0.0); // マス内ローカル座標を可視化 (格子が見える)
        // ▲ ここまで ▲

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "mosaic pipeline",
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
