// The Book of Shaders — 07 形について: 円を circle() 関数化して色をつける
// https://thebookofshaders.com/07/?lan=jp
//
// 07-circle-smoothstep でできた「なめらかな円」を、四角の box() と同じように
// 関数 circle() に切り出して再利用できるようにする。あとは mix で色を塗るだけ。
//
//   fn circle(st, center, radius, blur) -> f32
//     中心 center / 半径 radius の円のマスクを返す (中=1, 外=0, 縁は blur 幅でなめらか)。
//     中身は 07-circle-smoothstep と同じ: 1.0 - smoothstep(r-blur, r+blur, 距離)。
//
// 色のつけ方は box() のモンドリアンと同じ「下の色に mix で塗り重ね」:
//   var color = 背景色;
//   color = mix(color, 円の色, circle(...));   // マスク 1 の所だけ円の色に
//
// 意味で言うと circle は Point -> Coverage (被覆率) を返す純粋関数。これを mix で
// 合成して画像 (Point -> Color) を組み立てる。box() と全く同じ骨格で、形だけ円。
//
// ▼ 1 ピクセルを追ってみる (center=(0.5,0.5), radius=0.3, blur=0.01)
//   ・中心  st=(0.5,0.5): 距離0.0 → circle=1 → mix(bg, 円色, 1) = 円の色
//   ・外    st=(0.9,0.5): 距離0.4 → circle=0 → mix(bg, 円色, 0) = 背景のまま
//   → 背景の上に、指定色の円が 1 つ浮かぶ。circle() を別座標で何度も呼べば複数置ける。

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
    label: "book of shaders 07 - circle() function + color",
    code: /* wgsl */ `
      // この例は解像度だけ使う (静止画)。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 円のマスク。中心 center / 半径 radius の円の中なら 1、外なら 0、縁は blur 幅でなめらか。
      // = Point -> Coverage (被覆率 0〜1)。box() の円バージョン。
      fn circle(st: vec2f, center: vec2f, radius: f32, blur: f32) -> f32 {
        let d = distance(st, center);
        return 1.0 - smoothstep(radius - blur, radius + blur, d);
      }

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

        // 背景色と円の色。
        let bg          = vec3f(0.10, 0.11, 0.16); // 暗い紺
        let circleColor = vec3f(1.00, 0.40, 0.20); // 朱色

        // 円のマスクを作り、その所だけ円色に塗る。
        let mask = circle(st, vec2f(0.5), 0.3, 0.01);
        let color = mix(bg, circleColor, mask);

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "circle function pipeline",
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
