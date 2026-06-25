// The Book of Shaders — 07 形について: floor() でグラデーションを階段状に区切る
// https://thebookofshaders.com/07/?lan=jp
//
// step は「段差ひとつ (0→1 が1回)」だった。floor を使うと「段差をいくつも並べた階段」が作れる。
//
//   floor(x) … x 以下で一番大きい整数 (= 小数点以下を切り捨て)
//     floor(0.0)=0, floor(0.9)=0, floor(1.0)=1, floor(1.7)=1, floor(2.3)=2 …
//
// なめらかなグラデーション (0〜1) を「カクカクの段々」に変える定番テク:
//
//   floor(x * N) / N
//     1. x を N 倍して引き伸ばす     … 0〜1 → 0〜N
//     2. floor で整数に切り捨て       … 0,1,2,…,N-1 の段々に
//     3. N で割って元の 0〜1 に戻す    … 0, 1/N, 2/N, … の N 段の階段
//
// これで連続値が N 段の「とびとびの値」になる (色なら N 色のポスタリゼーション)。
//
// ▼ 1 ピクセルを追ってみる (segments N = 5、横グラデーション color = st.x)
//   ・st.x = 0.05: floor(0.05*5)/5 = floor(0.25)/5 = 0/5 = 0.00 → 黒
//   ・st.x = 0.30: floor(0.30*5)/5 = floor(1.50)/5 = 1/5 = 0.20 → 暗いグレー
//   ・st.x = 0.55: floor(0.55*5)/5 = floor(2.75)/5 = 2/5 = 0.40 → グレー
//   ・st.x = 0.95: floor(0.95*5)/5 = floor(4.75)/5 = 4/5 = 0.80 → 明るいグレー
//   → 左から右へ「黒→0.2→0.4→0.6→0.8」の 5 段の縦縞 (なめらかさが消えて階段に)。
//
// ▼ segments をいじるとどうなるか (今回の主役)
//   ・N = 2  … 黒と 0.5 の 2 段だけ (ほぼ step の旗)
//   ・N = 5  … 5 段のグラデ階段
//   ・N = 50 … 段が細かすぎて、ほぼ元のなめらかグラデーションに見える
//   floor を外す (= step も floor もなし) と完全に連続したグラデーション。floor が段々の正体。

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
    label: "book of shaders 07 - posterized gradient (floor)",
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

        // 段の数。大きいほど段が細かく、元のグラデに近づく。
        let segments = 5.0;

        // まずは普通の横グラデーション (左 0 → 右 1)。これを階段化する。
        let gradient = st.x;

        // floor(x * N) / N で N 段の階段に切り捨てる。
        let stepped = floor(gradient * segments) / segments;

        let color = vec3f(stepped);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "floor steps pipeline",
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