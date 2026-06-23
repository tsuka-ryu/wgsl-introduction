// The Book of Shaders — 06 演習: ターナーの夕日グラデーション
// https://thebookofshaders.com/06/?lan=jp
//
// やることは 06 の mix そのまま。違いは「横 (st.x) ではなく縦 (st.y) で混ぜる」だけ。
// 縦に混ぜると、上=空・下=地平線 の空模様になる。
//
// ウィリアム・ターナーの夕焼けは、地平線の燃える黄 → オレンジ → 上空の青紫へと
// "かすんで" つながるのが特徴。だから境界には step ではなく smoothstep を使い、
// 色と色の間を広くにじませる。
//
// 重ね方 (06 と同じ「上書き」パターン):
//   1. 地平線の色 (horizon) で全面を塗る
//   2. st.y が上がるにつれ mid (オレンジ) を混ぜる
//   3. さらに上では sky (青紫) を混ぜる
// smoothstep の 2 つの引数 (開始高さ, 終了高さ) を重ねてずらすと、3 色がなめらかに溶ける。
//
// 【演習のヒント】
//   - horizon / mid / sky の色を変えて、自分好みの夕焼けを作ってみよう。
//   - smoothstep の範囲 (0.0,0.45) などを動かすと、色の境目の高さと"にじみ幅"が変わる。
//   - この静止画に時間変化を足したのが姉妹レッスン 06-sunrise-sunset。

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
    label: "book of shaders 06 - turner sunset",
    code: /* wgsl */ `
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
        // 正規化座標 st。下=0、上=1 になるよう y を反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 夕焼けの 3 色 (下 → 上)
        let horizon = vec3f(1.00, 0.80, 0.40); // 地平線: 燃える黄
        let mid     = vec3f(0.92, 0.42, 0.22); // 中段  : オレンジ
        let sky     = vec3f(0.20, 0.22, 0.45); // 上空  : 青紫

        // 縦方向 (st.y) のグラデーション。
        //   smoothstep(a, b, st.y): st.y が a→b の間でなめらかに 0→1。
        //   範囲を重ねてずらすことで 3 色がにじみながらつながる (ターナーらしい霞)。
        var color = horizon;
        color = mix(color, mid, smoothstep(0.0, 0.45, st.y));
        color = mix(color, sky, smoothstep(0.35, 1.0, st.y));

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "turner sunset pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 2 * 4;
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
