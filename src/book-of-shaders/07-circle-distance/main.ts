// The Book of Shaders — 07 形について: 中心からの距離 (距離フィールドの素)
// https://thebookofshaders.com/07/?lan=jp
//
// 四角は「x と y を別々に step」で作った。円は発想が変わる:
//   「中心からの距離ひとつ」で内/外を決める。まずその距離そのものを色にして可視化する。
//
// 意味で言うと、これは距離フィールド (SDF: Signed Distance Field) の出発点:
//   pct(st) = |st - 中心|        … 各ピクセルに「中心までの距離」を割り当てる場
// この pct を step/smoothstep に通せば円になる (次の作例)。まずは場そのものを見る。
//
// 距離の出し方は 3 通りあるが、ぜんぶ同じ値:
//   a. distance(st, center)          … 2 点間の距離を一発で
//   b. length(center - st)           … ベクトル (中心→ピクセル) の長さ
//   c. sqrt(d.x*d.x + d.y*d.y)        … ピタゴラスの定理を手で (length の中身そのもの)
// 元コードは a を採用、b/c はコメントで等価だと示している。ここでも a を使う。
//
// ▼ 1 ピクセルを追ってみる (center = (0.5, 0.5)、距離を ×2 して縁を白に合わせる)
//   ・中心    st=(0.5, 0.5): 0.0   × 2 = 0.0          → vec3(0.0) = 黒
//   ・縁の中点 st=(1.0, 0.5): 0.5   × 2 = 1.0          → 真っ白 (ちょうど画面端で白に到達)
//   ・四隅    st=(0.0, 0.0): 0.707 × 2 ≈ 1.414        → 1.0 超 → 白に張り付く (クランプ)
//   → 中心が黒、外へ向かう放射グラデーションが画面の縁でちょうど白に届き、全体が収まる。
//     ×2 しない素の距離だと四隅でも約 0.707 までしか上がらず、真っ白にならない。

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
    label: "book of shaders 07 - distance field (circle source)",
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
        // 0〜1 に正規化。中心からの距離は上下対称なので y 反転は省略可 (結果は同じ)。
        let st = position.xy / u.resolution;

        // 中心 (0.5, 0.5) からこのピクセルまでの距離。これが「距離フィールド」の値。
        //   等価: length(vec2f(0.5) - st) や sqrt(d.x*d.x + d.y*d.y) でも同じ。
        // ×2 で縁 (中点 0.5) がちょうど 1.0(白) に届くよう引き伸ばす。
        //   こうすると放射グラデーション全体が画面内に収まる (四隅は 1.0 超で白に張り付く)。
        let pct = distance(st, vec2f(0.5));
        // let pct = distance(st, vec2f(0.5)) * 2.0;

        // 距離をそのまま明るさに (vec3f(pct) = グレースケール)。
        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "distance field pipeline",
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
