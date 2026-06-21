// WebGPU Fundamentals — ユニフォーム
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-uniforms.html
//
// ユニフォーム = シェーダに渡す「グローバル変数」。1 回の draw の間ずっと同じ値になる。
// ここでは color / scale / offset を 1 つのユニフォームバッファにまとめて渡し、
// 同じシェーダで 1 つの三角形を描く。

import { fail } from "../util";

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
  // ユニフォームを struct でまとめ、@group(0) @binding(0) として宣言する。
  const module = device.createShaderModule({
    label: "triangle shader with uniforms",
    code: /* wgsl */ `
      struct OurStruct {
        color: vec4f,
        scale: vec2f,
        offset: vec2f,
      };

      @group(0) @binding(0) var<uniform> ourStruct: OurStruct;

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f( 0.0,  0.5),
          vec2f(-0.5, -0.5),
          vec2f( 0.5, -0.5),
        );

        return vec4f(
          pos[vertexIndex] * ourStruct.scale + ourStruct.offset, 0.0, 1.0);
      }

      @fragment fn fs() -> @location(0) vec4f {
        return ourStruct.color;
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "uniforms pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファを用意する
  // struct のメモリレイアウト (各 f32 = 4 バイト):
  //   color  : vec4f -> オフセット 0  (4 個)
  //   scale  : vec2f -> オフセット 16 (2 個)
  //   offset : vec2f -> オフセット 24 (2 個)
  // 合計 32 バイト = f32 8 個分。
  const uniformBufferSize = 8 * 4; // 32 バイト
  const uniformBuffer = device.createBuffer({
    label: "uniforms for triangle",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // CPU 側で値を組み立てるための TypedArray
  const uniformValues = new Float32Array(uniformBufferSize / 4);

  // struct 内の各メンバの先頭インデックス (f32 単位)
  const kColorOffset = 0;
  const kScaleOffset = 4;
  const kOffsetOffset = 6;

  uniformValues.set([0, 1, 0, 1], kColorOffset); // color = 緑
  uniformValues.set([-0.5, -0.25], kOffsetOffset); // offset

  // 6. バインドグループでバッファをシェーダに結びつける
  const bindGroup = device.createBindGroup({
    label: "bind group for triangle",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice) {
    // アスペクト比を打ち消して三角形を正方形に保つ
    const aspect = canvas.width / canvas.height;
    uniformValues.set([0.5 / aspect, 0.5], kScaleOffset); // scale
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "our basic canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0.3, 0.3, 0.3, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const encoder = device.createCommandEncoder({ label: "our encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // 頂点 3 つ
    pass.end();

    device.queue.submit([encoder.finish()]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
      render(device);
    }
  });
  observer.observe(canvas);
}

main();