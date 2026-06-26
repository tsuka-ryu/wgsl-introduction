// The Book of Shaders — 07 形について: smoothstep() で円の縁をなめらかに
// https://thebookofshaders.com/07/?lan=jp
//
// 前作 07-circle-fill は step で「カクッとした白い円」。step を smoothstep に変えると
// 縁が blur 幅でじわっと溶け、ギザギザ (ジャギー) の取れた円になる (アンチエイリアス)。
//
//   pct = 1.0 - smoothstep(radius - blur, radius + blur, distance(st, center))
//     distance < radius-blur → smoothstep=0 → 1-0=1 → 白 (円の内側)
//     distance ≈ radius      → smoothstep≈0.5 → 1-0.5=0.5 → 縁のグレー (にじみ)
//     distance > radius+blur → smoothstep=1 → 1-1=0 → 黒 (円の外側)
//   step のしきい値 1 点が、smoothstep では radius±blur の「帯」に広がる。
//   1.0 - で反転しているのは円の中を白にするため (07-circle-fill と同じ)。
//
// ▼ いろいろ試す (今回の主役)
//   ・blur = 0.005 … ほぼ step。でも 1px ぶん滑らかでジャギーが消える (実用的なアンチエイリアス)
//   ・blur = 0.05  … 縁がふわっとぼけた円
//   ・blur = 0.3   … 中心だけ白く外へフェードする「光の玉」みたいな円
//   ・radius を変えれば円の大きさが変わる (0.5 で画面の縁に内接)
//
// ▼ 1 ピクセルを追ってみる (center=(0.5,0.5), radius=0.5, blur=0.05)
//   ・中心   st=(0.5,0.5): 距離0.0  → smoothstep(0.45,0.55,0.0)=0   → 1-0=1   → 白
//   ・縁上   st=(1.0,0.5): 距離0.5  → smoothstep(0.45,0.55,0.5)=0.5 → 1-0.5=0.5 → グレー (にじみ中央)
//   ・少し外 st=(1.0,0.6): 距離≈0.51→ smoothstepはまだ途中       → うっすらグレー
//   → 半径 0.5 の白い円。縁が blur 幅でなめらかにグレーへ溶ける。

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
    label: "book of shaders 07 - smooth circle (smoothstep)",
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

        // ▼ ここを変えて遊ぶ ▼
        let radius = 0.5;    // 円の半径 (= 縁の位置)
        let blur   = 0.05;   // にじみ幅。小さく→くっきり / 大きく→ふわっと

        let d = distance(st, vec2f(0.5));

        // radius-blur(内) で 0 → radius+blur(外) で 1。1.0 - で反転して中を白に。
        let pct = 1.0 - smoothstep(radius - blur, radius + blur, d);

        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "smooth circle pipeline",
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
