// The Book of Shaders — 07 形について: box() で本物に寄せたモンドリアン
// https://thebookofshaders.com/07/?lan=jp
//
// 07-mondrian の発展版。考え方 (四角を box() 関数化して mix で塗り重ねる) は同じ。
// こんどは実在の絵「赤・黄・青のコンポジション」(モンドリアン, 1937-42) に寄せて、
// 大きさバラバラの長方形を非対称に並べる:
//   ・左上 … 赤のかたまり (縦線 + 横線で 4 分割されて見える)
//   ・右端 … 黄色を 2 か所 (右上の角 + その下)
//   ・右下 … 青の小さな長方形
//   ・残りは生成りの余白。黒い太線が画面いっぱいに走る。
//
// 描く順番がそのまま重ね順: 背景 → 色ブロック → 黒線 (最後 = 一番上)。
// 色ブロックを大きめに置き、上から黒線を重ねると、線が色を分割した見た目になる
// (左上の赤が 4 マスに割れて見えるのはこの仕組み)。
//
// 座標はすべて 0〜1 (左下が原点、y は上向きに直してある)。
// box(st, bl, tr): 左下 bl 〜 右上 tr の長方形の中なら 1。

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
    label: "book of shaders 07 - mondrian 1942 (box function)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 四角の内/外マスク。st が 左下 bl 〜 右上 tr の中なら 1、外なら 0。
      fn box(st: vec2f, bl: vec2f, tr: vec2f) -> f32 {
        let lo = step(bl, st);   // st >= bl
        let hi = step(st, tr);   // st <= tr
        return lo.x * lo.y * hi.x * hi.y;
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
        // 0〜1 正規化。下=0 / 上=1 にするため y を反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 配色 (少しくすませてキャンバスの古さを出す)。
        let cream  = vec3f(0.93, 0.92, 0.85);
        let red    = vec3f(0.79, 0.12, 0.13);
        let yellow = vec3f(0.96, 0.79, 0.09);
        let blue   = vec3f(0.13, 0.31, 0.62);
        let black  = vec3f(0.08, 0.08, 0.08);

        // ① 背景 = 生成り。
        var color = cream;

        // ② 色ブロック (大きさバラバラ・非対称に配置)。
        // 左上の赤いかたまり (あとで縦線 x≈0.09 と横線 y≈0.85 が重なって 4 分割に見える)。
        color = mix(color, red,    box(st, vec2f(0.00, 0.60), vec2f(0.20, 1.00)));
        // 右端の黄色 2 か所: 右上の角 と その下。
        color = mix(color, yellow, box(st, vec2f(0.915, 0.865), vec2f(1.00, 1.00)));
        color = mix(color, yellow, box(st, vec2f(0.915, 0.615), vec2f(1.00, 0.840)));
        // 右下の青。
        color = mix(color, blue,   box(st, vec2f(0.715, 0.00), vec2f(1.00, 0.09)));

        // ③ 黒い太線を最後に上から重ねる (細長い box = 線)。
        // 縦線。
        color = mix(color, black, box(st, vec2f(0.190, 0.00), vec2f(0.215, 1.00))); // 主縦線
        color = mix(color, black, box(st, vec2f(0.080, 0.60), vec2f(0.105, 1.00))); // 赤の中の縦線
        color = mix(color, black, box(st, vec2f(0.690, 0.00), vec2f(0.715, 1.00))); // 右より縦線
        color = mix(color, black, box(st, vec2f(0.890, 0.00), vec2f(0.915, 1.00))); // 右端縦線
        // 横線。
        color = mix(color, black, box(st, vec2f(0.00, 0.840), vec2f(1.00, 0.865))); // 上の横線
        color = mix(color, black, box(st, vec2f(0.00, 0.590), vec2f(1.00, 0.615))); // 中の横線
        color = mix(color, black, box(st, vec2f(0.00, 0.090), vec2f(1.00, 0.115))); // 下の横線

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "mondrian 1942 pipeline",
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
