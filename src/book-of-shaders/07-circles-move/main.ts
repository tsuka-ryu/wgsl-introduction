// The Book of Shaders — 07 形について: 円を動かす + もう 1 つ別の場所に描く
// https://thebookofshaders.com/07/?lan=jp
//
// 円の「場所」は circle() の center 引数で決まる。だから:
//   ・動かす   … center を time の関数にする (毎フレーム位置が変わる = 移動)
//   ・複数置く … circle() を別の center でもう一度呼ぶ (box() を並べたのと同じ)
//
// 形 (circle 関数) は固定。前作は radius を time で動かした。今回は center を time で動かす。
//
// ▼ 円 A: 画面中心のまわりを円軌道で回す (cos/sin で 2D の動き)
//   centerA = (0.5, 0.5) + 0.25 * (cos(t), sin(t))
//     cos/sin は (-1〜1) を返すので、中心から半径 0.25 の円を描いて回る。
//     ・t=0     → (0.5+0.25, 0.5)      = 右
//     ・t=π/2   → (0.5, 0.5+0.25)      = 上
//     ・t=π     → (0.5-0.25, 0.5)      = 左   … ぐるっと一周
//
// ▼ 円 B: 動かさず、別の場所 (右上 0.8, 0.8) に固定で描く。
//
// 描き方は box() のモンドリアンと同じレイヤー合成:
//   var color = 背景;
//   color = mix(color, A の色, circle(st, centerA, ...));  // 動く円
//   color = mix(color, B の色, circle(st, centerB, ...));  // もう 1 つの円
//
// ▼ 1 ピクセルを追ってみる (st=(0.8,0.8) のピクセル、ある瞬間)
//   ・A が遠くにいるフレーム: circle(st, centerA,..)=0 → 背景のまま
//   ・B は常にそこにあるので: circle(st, (0.8,0.8),..)=1 → B の色
//   → 各ピクセルは「いまその位置に円があるか」をフレームごとに判定するだけ。

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
    label: "book of shaders 07 - moving circle + second circle",
    code: /* wgsl */ `
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

        let bg     = vec3f(0.09, 0.10, 0.14); // 背景
        let colorA = vec3f(0.95, 0.45, 0.20); // 動く円 = 橙
        let colorB = vec3f(0.30, 0.75, 0.95); // 固定の円 = 水色

        var color = bg;

        // 円 A: 中心のまわりを円軌道で回す (center を time の関数にする = 移動)。
        let t = u.time * 1.5; // 回る速さ
        let centerA = vec2f(0.5) + 0.25 * vec2f(cos(t), sin(t));
        color = mix(color, colorA, circle(st, centerA, 0.15, 0.01));

        // 円 B: 別の場所に固定でもう 1 つ描く。
        let centerB = vec2f(0.8, 0.8);
        color = mix(color, colorB, circle(st, centerB, 0.12, 0.01));

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "moving circles pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32)
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

  // 毎フレーム u.time を更新して描き直す = 円 A が動き続ける。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
