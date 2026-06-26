// The Book of Shaders — 07 形について: step() で距離フィールドを白黒に割る (円)
// https://thebookofshaders.com/07/?lan=jp
//
// 前作 07-circle-distance は「中心からの距離」をそのまま明るさにした放射グラデ。
// その距離フィールドを step に通すと、なめらかな場が「内/外」の 2 値にカクッと割れる。
//
//   pct = step(0.5, distance(st, center))
//     distance < 0.5 → step は 0 → 黒   (中心まわり = 半径 0.5 の円の内側)
//     distance >= 0.5 → step は 1 → 白   (円の外側)
//
// 結果: 画面中央に「黒い円」、まわりが白。
//   ※ 「0.5 以上を白」にしたので 円の中が黒・外が白 (反転した見た目) になる。
//     白い円を黒地に出したいときは 1.0 - pct、または step(distance, 0.5) と引数を逆に。
//
// これが四角との発想の違い: 四角は x/y を別々に step したが、円は
//   「距離ひとつ」を step するだけ。しきい値 0.5 がそのまま円の半径になる。
//
// ▼ 1 ピクセルを追ってみる (center = (0.5, 0.5)、距離は素のまま 最大 ≈0.707)
//   ・中心     st=(0.5, 0.5): distance=0.0   → step(0.5, 0.0)=0 → 黒 (円の内)
//   ・半径上   st=(1.0, 0.5): distance=0.5   → step(0.5, 0.5)=1 → 白 (ちょうど境界=円周)
//   ・四隅     st=(0.0, 0.0): distance≈0.707 → step(0.5, 0.707)=1 → 白 (円の外)
//   → 半径 0.5 の黒い円が中央に、その外側 (四隅含む) が白。境界は step なのでカクッ。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  // 1. アダプタとデバイスの取得
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  // 2. キャンバスを WebGPU 用に設定
  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
  });

  // 3. シェーダモジュール
  const module = device.createShaderModule({
    label: "book of shaders 07 - circle by step(0.5, distance)",
    code: /* wgsl */ `
      // この例は解像度だけ使う (静止画)。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f(-1.0,  3.0),
          vec2f( 3.0, -1.0),
          vec2f(-1.0, -1.0),
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(
        @builtin(position) position: vec4f
      ) -> @location(0) vec4f {
        // 0〜1 に正規化。中心からの距離は上下対称なので y 反転は省略可。
        let st = position.xy / u.resolution;

        // 中心からの距離を 0.5 で 2 値化: 0.5 以上 → 白(1)、未満 → 黒(0)。
        // しきい値 0.5 がそのまま円の半径になる。
        let pct = step(0.5, distance(st, vec2f(0.5)));

        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "circle step pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 2 * 4; // 8 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice) {
    uniformValues.set([canvas.width, canvas.height], 0);
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

  // 静止画なので、リサイズ時に解像度を更新して描き直すだけ。
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
    render(device);
  });
  observer.observe(canvas);
}

main();