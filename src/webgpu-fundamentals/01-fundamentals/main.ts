// WebGPU Fundamentals — 基本
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-fundamentals.html
//
// すべての出発点。キャンバスを単色でクリアするだけの最小構成のレンダーパス。

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
  console.log({ device, presentationFormat });

  // 3. レンダーパスの記述子 (どこに・どうやって描くか)
  const module = device.createShaderModule({
    label: "our hardcoded red triangle shaders", // labelをつけるのはベストプラクティス
    code: /* wgsl */ `
      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32 // ループカウンタ的なやつ
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f( 0.0,  0.5),  // top center
          vec2f(-0.5, -0.5),  // bottom left
          vec2f( 0.5, -0.5)   // bottom right
        );
 
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }
 
      @fragment fn fs() -> @location(0) vec4f {
        return vec4f(1.0, 0.0, 0.0, 1.0);
      }
    `,
  });

  // パイプラインを作成
  const pipeline = device.createRenderPipeline({
    label: "our hardcoded red triangle pipeline",
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
    // 描画先とするテクスチャの指定とどう扱うか。
    // view（描画対象）はカレントテクスチャごとに変わるので、毎フレームここで組み立てる。
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "our basic canvas renderPass",
      colorAttachments: [
        {
          // canvasのコンテキストからカレントテクスチャを得て、描画対象に指定する
          view: context.getCurrentTexture().createView(),
          clearValue: [0.3, 0.3, 0.3, 1], // 背景を灰色で塗りつぶす
          loadOp: "clear", // ロード時に背景色でクリア
          storeOp: "store", // 描画内容をテクスチャに保存する
        },
      ],
    };

    // コマンドエンコーダを生成する。コマンドのエンコードができる状態にする。
    const encoder = device.createCommandEncoder({ label: "our encoder" });

    // レンダーパスのエンコーダを生成する。そこへコマンドを並べて、描画手順をエンコードする。
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);
    pass.draw(3); // 頂点シェーダを３回呼び出す
    pass.end();

    const commandBuffer = encoder.finish();
    // 実際に描画する
    device.queue.submit([commandBuffer]);
  }

  render(device);
}

function fail(msg: string) {
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:1rem;color:#c00">${msg}</p>`;
}

main();
