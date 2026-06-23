// The Book of Shaders — 06 演習: 日の出から日の入りまで (u_time で空をアニメ)
// https://thebookofshaders.com/06/?lan=jp
//
// 姉妹レッスン 06-sunset は静止画だった。これはそこに u_time を足して
// 「夜 → 日の出 → 昼 → 日の入り → 夜」を繰り返すアニメーションにしたもの。
// 05 で波に u.time を足して流したのと同じ「時間で値を動かす」発想。
//
// 仕組みは "太陽の高さ" を 1 つの数 (sunHeight) で表すこと:
//   sunHeight = sin(時間)        … +1 = 真昼 / 0 = 地平線 (朝・夕) / -1 = 真夜中
// この 1 つの値から空全体の色を決める:
//   ① 昼夜      : sunHeight が高いほど昼の青、低いほど夜の紺  (上空の色)
//   ② 朝夕の焼け : sunHeight が 0 付近 (地平線) のとき地平線がいちばん焼ける
//
// 「色を時間で差し替える」だけで時間帯が変わって見える、というのが体感できればOK。
//
// 【演習のヒント】
//   - daySpeed を上げると一日が速く回る。
//   - 夜の色 / 昼の色 / 焼けの色 を変えて自分の空を作ってみよう。
//   - sunHeight をそのまま画面に出す (return vec4f(vec3f(sunHeight*0.5+0.5),1.0)) と
//     太陽の高さがどう動いているか可視化できる。

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
    label: "book of shaders 06 - sunrise to sunset",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      // 06-colors と同じ resolution + time。vec2f(8B)+f32(4B) → 16B。
      struct Uniforms {
        resolution: vec2f,
        time: f32,
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
        // 下=0、上=1 になるよう y を反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 太陽の高さ: -1 (真夜中) 〜 +1 (真昼) を sin で行き来する。
        //   daySpeed を小さくするほど一日がゆっくり進む。
        let daySpeed = 0.05;
        let sunHeight = sin(u.time * daySpeed * PI * 2.0);

        // 使う色
        let dayBlue = vec3f(0.30, 0.60, 0.95); // 昼の空
        let night   = vec3f(0.02, 0.03, 0.12); // 夜の空
        let burn    = vec3f(1.00, 0.45, 0.20); // 朝夕の焼け (地平線)

        // ① 上空の色: 昼夜。sunHeight(0〜1 にクランプ) で青と紺を補間。
        //   太陽が地平線より下 (負) のときは 0 = 完全な夜。
        let dayAmount = clamp(sunHeight, 0.0, 1.0);
        var color = mix(night, dayBlue, dayAmount);

        // ② 朝夕の焼け: 太陽が地平線付近 (|sunHeight| が小) のとき最大。
        //   さらに画面の下ほど (1 - st.y) 強くして、地平線だけを焼く。
        let horizonGlow = 1.0 - abs(sunHeight); // 朝・夕で 1、真昼・真夜中で 0
        let glow = clamp(horizonGlow * (1.0 - st.y), 0.0, 1.0);
        color = mix(color, burn, glow);

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "sunrise-sunset pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32) — 06-colors と同じ
  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
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
  });
  observer.observe(canvas);

  // 毎フレーム u.time を更新して描き直す = 空が時間とともに変化する。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
