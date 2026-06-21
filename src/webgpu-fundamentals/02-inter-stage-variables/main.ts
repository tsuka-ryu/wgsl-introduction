// WebGPU Fundamentals — inter-stage 変数
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-inter-stage-variables.html
//
// 頂点シェーダの出力を @location(n) に置くと、フラグメントシェーダで同じ @location(n) の
// 入力として受け取れる (= inter-stage 変数)。各頂点で置いた値はピクセルごとに補間される。

import { fail } from "../util";

async function main() {
  // 1. アダプタとデバイスの取得 (デバイス = 特定の GPU の表現)
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
    label: "inter-stage variables",
    code: /* wgsl */ `
      // TODO: ここに WGSL を書く
      // - struct で頂点シェーダの出力 (@builtin(position) + @location(0)) を定義
      // - @vertex fn vs(...) で頂点位置と色を返す
      // - @fragment fn fs(...) で補間された色を @location(0) に出力
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "inter-stage variables pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vs",
    },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  function render(device: GPUDevice) {
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
    pass.draw(3); // 頂点シェーダを 3 回呼び出す
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