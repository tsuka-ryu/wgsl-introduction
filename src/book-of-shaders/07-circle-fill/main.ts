// The Book of Shaders — 07 形について: 反転して「黒地に白い円」
// https://thebookofshaders.com/07/?lan=jp
//
// 前作 07-circle-step は step(0.5, 距離) で「白地に黒い円」(0.5 以上を白) になった。
// 中を白・外を黒にしたい (= 反転) には 2 通り。どちらも同じ絵になる:
//
//   ① 1.0 - step(0.5, 距離)   … 出てきた 0/1 をひっくり返す (1→0, 0→1)
//   ② step(距離, 0.5)         … 引数を入れ替えて不等号を逆に (距離 <= 0.5 で 1)
//
// ここは ① を採用。「マスクを作ってから反転」は汎用的でわかりやすい。
// しきい値 0.5 がそのまま円の半径。
//
// ▼ 1 ピクセルを追ってみる (center = (0.5, 0.5)、距離は素のまま)
//   ・中心   st=(0.5,0.5): 距離0.0  → step(0.5,0.0)=0 → 1.0-0 = 1 → 白 (円の内)
//   ・半径上 st=(1.0,0.5): 距離0.5  → step(0.5,0.5)=1 → 1.0-1 = 0 → 黒 (円周のすぐ外)
//   ・四隅   st=(0.0,0.0): 距離0.707→ step(0.5,..)=1  → 1.0-1 = 0 → 黒 (円の外)
//   → 半径 0.5 の白い円が中央に、まわりが黒。前作とちょうど白黒逆。

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
    label: "book of shaders 07 - filled circle (inverted step)",
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

        // step(0.5, 距離) は「0.5 以上で 1」= 外が白。1.0 - で反転 → 中が白。
        //   等価: step(distance(st, vec2f(0.5)), 0.5) (引数を入れ替え)。
        let pct = 1.0 - step(0.5, distance(st, vec2f(0.5)));

        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "filled circle pipeline",
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