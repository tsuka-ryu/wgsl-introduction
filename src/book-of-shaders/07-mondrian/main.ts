// The Book of Shaders — 07 形について: 四角を関数化して複数配置 → モンドリアン風
// https://thebookofshaders.com/07/?lan=jp
//
// 【問い】1 つの描画領域の別々の場所に、四角を複数置くには?
// 【答え】四角の内/外を返す処理を関数 box() に切り出し、位置を変えて何度も呼ぶ。
//        返ってくるのは 0/1 のマスクなので、mix(下の色, 四角の色, マスク) で上から塗り重ねる。
//
//   fn box(st, bl, tr) -> f32   … st が左下 bl 〜 右上 tr の四角の中なら 1、外なら 0
//        中身は今までと同じ: step(bl, st) (= st>=bl) と step(st, tr) (= st<=tr) を 4 つ掛ける。
//
// これさえあれば「描く = mix で塗る」を並べるだけ。レイヤーを重ねる感覚:
//
//   var color = 背景色;
//   color = mix(color, 赤,   box(st, …));  // 赤い四角を置く
//   color = mix(color, 黒線, box(st, …));  // 細い四角 = 線を上に重ねる
//   …
//
// mix(a, b, t) は t=0 で a、t=1 で b。box が 1 のところだけ新しい色に差し替わる。
//
// ▼ モンドリアンの作り (ピート・モンドリアン「赤・青・黄のコンポジション」風)
//   1. 生成り色 (オフホワイト) で全面を塗る
//   2. 色ブロック (青/赤/黄) を、格子の「マス」の中に置く ← 線とぶつからない位置に
//   3. 黒い太線 (縦2本・横2本) を最後に上から重ねる
//
// ▼ 1 ピクセルを追ってみる (st = (0.85, 0.85): 右上のあたり)
//   ・背景で生成り → 赤ブロック box(st,(0.72,0.74),(1,1)) が 1 → 赤に差し替え
//   ・黒線はどれも 0 (線の帯の外) → 赤のまま → このピクセルは赤

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
    label: "book of shaders 07 - mondrian (box function)",
    code: /* wgsl */ `
      // この例は解像度だけ使う (静止画)。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 四角の内/外マスク。st が 左下 bl 〜 右上 tr の中なら 1、外なら 0。
      // 中身は 07-rect-size と同じ「下限以上 かつ 上限以下」を 4 つ掛ける AND。
      fn box(st: vec2f, bl: vec2f, tr: vec2f) -> f32 {
        let lo = step(bl, st);   // st >= bl (左辺・下辺の内側)
        let hi = step(st, tr);   // st <= tr (右辺・上辺の内側)
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
        // 正規化座標 st: 左下 (0,0) 〜 右上 (1,1)。WebGPU は y が上なので反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // モンドリアンの配色。
        let cream  = vec3f(0.96, 0.95, 0.90); // 生成りの背景
        let red    = vec3f(0.85, 0.16, 0.13);
        let blue   = vec3f(0.10, 0.22, 0.55);
        let yellow = vec3f(0.95, 0.80, 0.10);
        let black  = vec3f(0.07, 0.07, 0.07);

        // 1. 背景を生成りで塗る。
        var color = cream;

        // 2. 色ブロックを「格子のマス」の中に配置 (黒線とぶつからない座標)。
        //    線は縦 x≈0.32 / 0.70、横 y≈0.30 / 0.72 に引く前提でマスを決めている。
        color = mix(color, blue,   box(st, vec2f(0.00, 0.00), vec2f(0.30, 0.28))); // 左下: 青
        color = mix(color, yellow, box(st, vec2f(0.72, 0.32), vec2f(1.00, 0.70))); // 右中: 黄
        color = mix(color, red,    box(st, vec2f(0.72, 0.74), vec2f(1.00, 1.00))); // 右上: 赤

        // 3. 黒い太線を最後に上から重ねる (細長い box = 線)。
        color = mix(color, black, box(st, vec2f(0.30, 0.00), vec2f(0.34, 1.00))); // 縦線 左
        color = mix(color, black, box(st, vec2f(0.70, 0.00), vec2f(0.74, 1.00))); // 縦線 右
        color = mix(color, black, box(st, vec2f(0.00, 0.28), vec2f(1.00, 0.32))); // 横線 下
        color = mix(color, black, box(st, vec2f(0.00, 0.70), vec2f(1.00, 0.74))); // 横線 上

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "mondrian pipeline",
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
