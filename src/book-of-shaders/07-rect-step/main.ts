// The Book of Shaders — 07 形について: step() の論理積で「角」を切り出す
// https://thebookofshaders.com/07/?lan=jp
//
// 07 章のテーマは「形を数式で描く」。最初の一歩がこれ。
// 四角形を描くには、まず「ある範囲の中か外か」を 0/1 で判定したい。
//
//   step(edge, x)  =  x < edge なら 0.0 / x >= edge なら 1.0   (06 の旗で使った関数)
//
// これを x と y それぞれに使い、掛け算でつなぐのがポイント:
//
//   left   = step(0.1, st.x)   …  x が 0.1 以上なら 1、手前は 0
//   bottom = step(0.1, st.y)   …  y が 0.1 以上なら 1、手前は 0
//   mask   = left * bottom     …  両方 1 のときだけ 1 = 論理積 (AND)
//
// 0/1 同士の掛け算は「両方 1 のときだけ 1」なので、AND ゲートそのもの。
// よって「画面左 10% を除き、かつ 下 10% を除いた」右上の広い領域だけが白くなる。
// (この例はまだ左下の角を欠いただけ。四隅を全部削れば四角形になる ── 次の作例で完成させる)
//
// ▼ 1 ピクセルを追ってみる (画面 600x600、st は 0〜1 に正規化済み)
//   ・左下 (st = 0.05, 0.05): left=step(0.1,0.05)=0, bottom=0 → 0*0=0 → 黒
//   ・左帯 (st = 0.05, 0.50): left=0,                bottom=1 → 0*1=0 → 黒
//   ・下帯 (st = 0.50, 0.05): left=1,                bottom=0 → 1*0=0 → 黒
//   ・中央 (st = 0.50, 0.50): left=1,                bottom=1 → 1*1=1 → 白
//   → 左端と下端の細い帯だけ黒、それ以外は白。境界は step なのでカクッと切り替わる。
//
// 色は vec3(mask) と書くと (mask, mask, mask) になり、0=黒 / 1=白 のグレースケール。

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
    label: "book of shaders 07 - rectangle with step() AND",
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

        // それぞれ 0.0 か 1.0 を返す。
        let left   = step(0.1, st.x); // x が 0.1 以上か (左端 10% を超えたか)
        let bottom = step(0.1, st.y); // y が 0.1 以上か (下端 10% を超えたか)

        // 掛け算 = 論理積。両方 1 のときだけ 1 (= 白) になる。
        let color = vec3f(left * bottom);

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "rect (step AND) pipeline",
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