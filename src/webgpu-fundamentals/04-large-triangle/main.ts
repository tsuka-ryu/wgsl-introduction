// WebGPU Fundamentals — 大きなクリップ空間の三角形
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-large-triangle-to-cover-clip-space.html
//
// これからの「うねうね」は、画面いっぱいを 1 枚の面として塗り、
// その面の上でピクセルごとに色を計算する (= フラグメントシェーダで絵を描く)。
// そのための「舞台」= 画面全体を覆うポリゴンを用意するレッスン。
//
// 画面全体を覆うには 2 つの三角形 (=四角形, 6 頂点) でもよいが、
// このレッスンでは「クリップ空間を覆うのに十分大きい 1 つの三角形」(3 頂点) を使う。
//
//   クリップ空間は x,y とも -1〜+1。下の 3 頂点が作る三角形は
//   その -1〜+1 の正方形をすっぽり内側に含む大きさになっている:
//
//     (-1, 3) *
//             |\
//             | \
//             |  \           ← この三角形の左下の一角だけで
//             |   \             クリップ空間 (点線の正方形) を覆える
//             | ・・・\
//        +1   |・   ・\
//             |・   ・ \
//     (-1,-1) *・・・・・* (3, -1)
//
// 利点:
//   - 頂点が 3 つで済む (四角形の 6 つより入力が少しシンプル)
//   - 2 つの三角形が接する対角線上で起きる「2x2 ピクセル単位の二重処理」が無い
//     (※効果はごくわずか。実用上は気にしなくてよいレベル)
// クリップ空間の外にはみ出した部分は GPU が自動でクリップ (切り落とし) する。

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
  //   頂点シェーダ : 画面全体を覆う大きな三角形を出す。ユニフォームも頂点バッファも要らない。
  //   フラグメント : @builtin(position) = 描いているピクセルの座標 を使い、
  //                  画面全面に市松模様を敷く。三角形が本当に画面を覆っているか一目で分かる。
  const module = device.createShaderModule({
    label: "fullscreen big triangle",
    code: /* wgsl */ `
      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        // クリップ空間 (-1〜+1) をすっぽり覆う大きな三角形
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
        // position.xy は「今塗っているピクセル」の座標 (左上が 0,0)。
        // 32px ごとのマス目に分け、市松模様に塗る。
        let grid = vec2u(position.xy) / 32;
        let checker = (grid.x + grid.y) % 2 == 1;

        let dark = vec4f(0.13, 0.14, 0.20, 1.0);
        let light = vec4f(0.20, 0.22, 0.30, 1.0);
        return select(dark, light, checker);
      }
    `,
  });

  // 4. パイプライン (頂点バッファもバインドグループも無いので一番シンプルな形)
  const pipeline = device.createRenderPipeline({
    label: "fullscreen triangle pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
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
          // 三角形が画面を覆えていれば、このクリア色 (赤) は一切見えないはず。
          // もし赤い隙間が出たら三角形が小さすぎる、というデバッグの目印にもなる。
          clearValue: [1, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const encoder = device.createCommandEncoder({ label: "our encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.draw(3); // 頂点 3 つ = 大きな三角形 1 枚
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