// The Book of Shaders — 07 形について: 鼓動のように伸縮する円 (u_time アニメ)
// https://thebookofshaders.com/07/?lan=jp
//
// 07-circle-function の color つき円に、前章 (06-sunrise-sunset) と同じ u_time を足して
// 「半径を時間で動かす」だけで、心臓の鼓動のように脈打つ円になる。
// 形 (circle 関数) は固定。動かすのは radius という 1 つの数だけ。
//
// 鼓動の作り方 (ドク…ドク… を 1 つの数で):
//   beat  = sin(time * speed)           … -1〜+1 を行き来する波
//   pulse = pow(max(beat, 0.0), 0.4)    … 波の上半分だけ採用し、鋭く立ち上げる
//                                          → 「ふくらむ → しぼんで休む → ふくらむ」= 拍動
//   radius = baseRadius + amp * pulse   … 拍動を半径の増分にする
//
//   ・max(beat, 0.0): 波の負の部分 (しぼみすぎ) を 0 にして「休み」を作る。
//   ・pow(x, 0.4): 立ち上がりを鋭く。心臓のドクッという急な膨張っぽくなる。
//                  (pow を外して pulse=max(beat,0) でも、ゆるい拍動として成立する)
//
// 各ピクセルの計算は 07-circle-function と同じ。違いは radius が毎フレーム変わること。
//
// ▼ 時間で radius がどう動くか (baseRadius=0.18, amp=0.12, speed=7.0)
//   ・拍の谷 (pulse=0): radius = 0.18            … 小さくしぼんだ円
//   ・拍の山 (pulse=1): radius = 0.18+0.12 = 0.30 … ふくらんだ円
//   → 0.18〜0.30 を鼓動のリズムで往復。中心のピクセルは常に円の中なので赤、
//     縁あたりのピクセルは radius が伸び縮みするたびに「円に入ったり出たり」する。

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
    label: "book of shaders 07 - heartbeat circle (animated radius)",
    code: /* wgsl */ `
      // 06 のアニメと同じ resolution + time。vec2f(8B)+f32(4B) → 16B。
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 円のマスク。中心 center / 半径 radius の円の中なら 1、外なら 0、縁は blur 幅でなめらか。
      fn circle(st: vec2f, center: vec2f, radius: f32, blur: f32) -> f32 {
        let d = distance(st, center);
        return 1.0 - smoothstep(radius - blur, radius + blur, d);
      }

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
        let st = position.xy / u.resolution;

        let bg          = vec3f(0.08, 0.05, 0.07); // 暗い背景
        let circleColor = vec3f(0.90, 0.15, 0.25); // 心臓っぽい赤

        // 鼓動: time から拍動 (0〜1) を作り、半径の増分にする。
        let speed = 7.0;                              // 拍の速さ (大きいほど速い鼓動)
        let beat  = sin(u.time * speed);              // -1〜+1 の波
        let pulse = pow(max(beat, 0.0), 0.4);         // 上半分だけ・鋭く → ドクッ…休み…ドクッ
        let radius = 0.18 + 0.12 * pulse;             // 0.18 (しぼむ) 〜 0.30 (ふくらむ)

        // 形は固定。radius だけが毎フレーム変わる。
        let mask = circle(st, vec2f(0.5), radius, 0.01);
        let color = mix(bg, circleColor, mask);

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "heartbeat circle pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32) — 06 のアニメと同じ
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

  // 毎フレーム u.time を更新して描き直す = 円が鼓動し続ける。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
