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
  // 頂点シェーダは共通で 3 枚分の三角形を出力する。
  //   頂点 0-2 : 中央上の三角形  -> 市松模様で塗る
  //   頂点 3-5 : 左下の三角形    -> グラデーションで塗る
  //   頂点 6-8 : 右下の三角形    -> グラデーションで塗る
  // フラグメントシェーダを 2 つ用意し、パイプラインを分けて塗り分ける。
  const module = device.createShaderModule({
    label: "checkerboard + rgb triangles",
    code: /* wgsl */ `
      struct OurVertexShaderOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec4f,
      };

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> OurVertexShaderOutput {
        let pos = array(
          // 0-2: 中央上 (市松模様)
          vec2f( 0.0,  0.9),
          vec2f(-0.4,  0.1),
          vec2f( 0.4,  0.1),
          // 3-5: 左下 (グラデーション)
          vec2f(-0.5, -0.1),
          vec2f(-0.9, -0.9),
          vec2f(-0.1, -0.9),
          // 6-8: 右下 (グラデーション)
          vec2f( 0.5, -0.1),
          vec2f( 0.1, -0.9),
          vec2f( 0.9, -0.9)
        );
        var color = array<vec4f, 9>(
          // 市松模様の三角形では color は使わないのでダミー
          vec4f(0, 0, 0, 1),
          vec4f(0, 0, 0, 1),
          vec4f(0, 0, 0, 1),
          // 左下: 赤・緑・青
          vec4f(1, 0, 0, 1),
          vec4f(0, 1, 0, 1),
          vec4f(0, 0, 1, 1),
          // 右下: 黄・シアン・マゼンタ
          vec4f(1, 1, 0, 1),
          vec4f(0, 1, 1, 1),
          vec4f(1, 0, 1, 1),
        );

        var vsOutput: OurVertexShaderOutput;
        vsOutput.position = vec4f(pos[vertexIndex], 0.0, 1.0);
        vsOutput.color = color[vertexIndex];
        return vsOutput;
      }

      // 補間された color をそのまま出力 -> グラデーション
      @fragment fn fsGradient(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
        return fsInput.color;
      }

      // ピクセル座標から市松模様を作る (color は使わない)
      @fragment fn fsCheckerboard(fsInput: OurVertexShaderOutput) -> @location(0) vec4f {
        let red = vec4f(1, 0, 0, 1);
        let cyan = vec4f(0, 1, 1, 1);

        let grid = vec2u(fsInput.position.xy) / 16;
        let checker = (grid.x + grid.y) % 2 == 1;

        return select(red, cyan, checker);
      }
    `,
  });

  // 4. パイプライン (頂点シェーダは共通、フラグメントシェーダだけ差し替える)
  const gradientPipeline = device.createRenderPipeline({
    label: "gradient pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fsGradient",
      targets: [{ format: presentationFormat }],
    },
  });

  const checkerboardPipeline = device.createRenderPipeline({
    label: "checkerboard pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fsCheckerboard",
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

    // 中央上の三角形 (頂点 0-2) を市松模様で描く
    pass.setPipeline(checkerboardPipeline);
    pass.draw(3, 1, 0); // vertexCount=3, instanceCount=1, firstVertex=0

    // 左下・右下の三角形 (頂点 3-8) をグラデーションで描く
    pass.setPipeline(gradientPipeline);
    pass.draw(6, 1, 3); // vertexCount=6, instanceCount=1, firstVertex=3

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
