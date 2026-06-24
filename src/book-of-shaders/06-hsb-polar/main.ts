// The Book of Shaders — 06 色について: HSB と極座標 (カラーホイール)
// https://thebookofshaders.com/06/?lan=jp
//
// 前作 06-hsb は HSB を「横=色相 / 縦=明るさ」のデカルト座標 (x, y) で並べた。
// でも HSB はもともと極座標 (中心からの「角度」と「距離」) で色を示す仕組み。
//   - 角度 (一周ぐるっと) → 色相 H … 虹が円周にそって並ぶ
//   - 中心からの距離       → 彩度 S … 真ん中が白っぽく、外へ行くほど鮮やか
// これを描くと「カラーホイール (色相環)」になる。
//
// 核心は、ピクセルの位置を「角度」と「距離」に変換すること。そのために:
//   atan(y, x) … 原点から見た方向 (角度) を返す。GLSL の atan2 にあたる。
//                戻り値は -π 〜 +π (ラジアン)。
//   length(v)  … ベクトル v の長さ。中心からの距離を測るのに使う。
//
// ここで大事な考え方: vec2/vec3/vec4 は「色」を表していても中身はただのベクトル。
// 色とベクトルを同等に扱えるので、座標計算と色計算を地続きに書ける。
//
// ▼ 1 ピクセルを追ってみる (画面が 600x600、注目するピクセルが右上 (450, 150) のとき)
//   st        = (450/600, 150/600) = (0.75, 0.25)        … 0〜1 に正規化
//   st.y 反転後 = (0.75, 0.75)                            … 上を 1 にする
//   toCenter  = (0.75, 0.75) - (0.5, 0.5) = (0.25, 0.25) … 中心からこのピクセルへ向くベクトル
//   angle     = atan(0.25, 0.25) = +π/4 (45°)            … 右上方向
//   radius    = length((0.25,0.25)) * 2 ≈ 0.707          … 中心からの距離 (×2 で端を 1 付近に)
//   H = angle/2π + 0.5 ≈ 0.625, S = radius ≈ 0.707, B = 1.0
//   → 右上は「水色〜青っぽい、そこそこ鮮やか」な色になる。中心に近いほど白く薄まる。

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
    label: "book of shaders 06 - hsb polar (color wheel)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265359;
      const TWO_PI = 6.28318530718;

      // HSB (色相, 彩度, 明るさ) を RGB に変換する。Iñigo Quiles 版 (06-hsb と同じ)。
      //   c.x = H, c.y = S, c.z = B
      fn hsb2rgb(c: vec3f) -> vec3f {
        var rgb = clamp(
          abs((c.x * 6.0 + vec3f(0.0, 4.0, 2.0)) % 6.0 - 3.0) - 1.0,
          vec3f(0.0),
          vec3f(1.0)
        );
        rgb = rgb * rgb * (3.0 - 2.0 * rgb);
        return c.z * mix(vec3f(1.0), rgb, c.y);
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
        // 0〜1 に正規化。下=0/上=1 になるよう y を反転 (atan の角度を数学どおり反時計回りにするため)。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 画面中心 (0.5, 0.5) から、このピクセルへ向かうベクトル。
        // ※ "中心 → ピクセル" の向きにしたいので (st - 0.5)。本家は (0.5 - st) で
        //    左右が反転するだけ。ここでは虹が反時計回りに並ぶこちらを採用。
        let toCenter = st - vec2f(0.5);

        // 角度: -π 〜 +π。これがこのピクセルの「方向」= 色相のもと。
        let angle = atan2(toCenter.y, toCenter.x);
        // 距離: 中心で 0、四隅で最大。×2 で円の縁あたりを 1 (＝最大彩度) に合わせる。
        let radius = length(toCenter) * 2.0;

        // 角度 (-π〜π) を H (0〜1) に変換: /2π で -0.5〜0.5、+0.5 で 0〜1 に。
        // 彩度 S = radius (中心ほど白)、明るさ B = 1.0 固定。
        let color = hsb2rgb(vec3f(angle / TWO_PI + 0.5, radius, 1.0));

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "hsb polar pipeline",
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
