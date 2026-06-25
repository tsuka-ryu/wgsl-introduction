// The Book of Shaders — 07 形について: step() で四角形を完成させる
// https://thebookofshaders.com/07/?lan=jp
//
// 前作 07-rect-step は「左端 10% と下端 10% を削る」だけで、左下の角を欠いた状態だった。
// 四角形にするには、残る「右端」と「上端」も同じやり方で削ればいい。
//
// コツは vec2 にまとめて x/y を一度に処理すること:
//
//   bl = step(vec2f(0.1), st)        … bl.x = (st.x >= 0.1)、bl.y = (st.y >= 0.1)
//                                       → 左下 2 辺の内側で 1
//   tr = step(vec2f(0.1), 1.0 - st)  … 座標を反転 (1.0 - st) してから同じ step。
//                                       右上から 0.1 内側で 1 = 右上 2 辺の内側
//
//   pct = bl.x * bl.y * tr.x * tr.y  … 4 つすべて 1 のときだけ 1 (= 4 辺すべての内側 = 中の四角)
//
// 0/1 の掛け算は AND なので、「左を超え かつ 下を超え かつ 右の手前 かつ 上の手前」=
// 中央の四角形だけが白くなる。周囲 0.1 ぶんの額縁が黒。
//
// ▼ なぜ 1.0 - st で右上が測れるか (st.x を例に)
//   ・右端 st.x = 0.95 → 1.0 - 0.95 = 0.05 → step(0.1, 0.05) = 0 → 削られる (黒)
//   ・中央 st.x = 0.50 → 1.0 - 0.50 = 0.50 → step(0.1, 0.50) = 1 → 残る   (白)
//   左下用の step が「小さすぎる側」を削るのに対し、反転すると「大きすぎる側」を削れる。
//
// ▼ 1 ピクセルを追ってみる (st は 0〜1 に正規化済み、額縁幅 0.1)
//   ・中央  (0.50, 0.50): bl=(1,1), tr=(1,1) → 1*1*1*1 = 1 → 白
//   ・左下角(0.05, 0.05): bl=(0,0)            → 0          → 黒
//   ・右上角(0.95, 0.95): tr=(0,0)            → 0          → 黒
//   ・右辺  (0.95, 0.50): bl=(1,1), tr=(0,1) → …*0*…    → 0 → 黒
//   → 周囲の額縁が黒、内側の四角が白。境界は step なのでカクッと切り替わる。

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
    label: "book of shaders 07 - rectangle (4 edges with step)",
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
        // 正規化座標 st: 左下 (0,0) 〜 右上 (1,1)。WebGPU は y が上なので反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 額縁の幅 (上下左右とも 0.1)。
        let border = vec2f(0.1);

        // 左下 2 辺: st が border 以上なら 1。bl.x, bl.y がそれぞれ x/y の判定。
        let bl = step(border, st);
        // 右上 2 辺: 座標を 1.0 - st に反転してから同じ判定 = 右上から内側で 1。
        let tr = step(border, 1.0 - st);

        // 4 つすべて 1 のときだけ 1 = 4 辺すべての内側 = 中央の四角形。
        let pct = bl.x * bl.y * tr.x * tr.y;

        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "rect (4 edges) pipeline",
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
