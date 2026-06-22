// The Book of Shaders — 05 シェイピング関数 (三角関数 / sin 波)
// https://thebookofshaders.com/05/?lan=jp  「三角関数」の節
//
// basic(直線) / expo(pow 曲線) に続く三角関数の作例。
// sin は波を作る関数で、これがこのリポジトリの目標「うねうね」の本体。
//
//   y = sin(st.x * PI * 2.0)   … 画面の左→右で sin が 1 周 = 山と谷が 1 つずつ
//
// 注意: sin は -1〜+1 を返すが、色も座標も 0〜1 で扱いたいので
//       0.5 + 0.5 * sin(...) で -1〜1 を 0〜1 に変換 (リマップ) してから使う。
//       (この変換をしないと波の下半分が画面外 = 黒に潰れて見えなくなる)
//
// plot は expo と同じ汎用版。アニメーションは付けず静止画。
// (u_time を足して波を流すと「動くうねうね」になるが、それは別レッスンで)
//
// 元の GLSL を WGSL に読み替えた対応:
//   gl_FragCoord.xy        -> @builtin(position).xy
//   u_resolution           -> ユニフォーム (struct Uniforms) で渡す
//   st = gl_FragCoord/u_res -> position.xy / u.resolution
//   GLSL は y が下から上、WebGPU は y が上から下 -> st.y を反転して合わせる
//   #define PI 3.14159...  -> const PI = 3.14159...  (WGSL の定数)
//   sin / smoothstep / vec3 はほぼ同名 (vec3f など f が付く)

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
  //   頂点   : 04 と同じ画面全体を覆う大きな三角形。
  //   フラグメント : 各ピクセルで sin の波を計算し、その曲線を緑で描く。
  const module = device.createShaderModule({
    label: "book of shaders 05 - shaping functions (sin)",
    code: /* wgsl */ `
      // GLSL の #define PI 3.14159265359 に相当 (WGSL は const)
      const PI = 3.14159265359;

      // 元の GLSL の u_resolution に相当。st を作るために幅・高さを渡す。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // plot: 高さ pct のところに太さ ±0.02 の帯 (= 線) を引く。
      //   smoothstep を 2 枚使い、pct のすぐ下〜すぐ上だけ 1 になる帯を作る。
      //   pct に好きな曲線の値を渡せるので、直線でも pow でも sin でも同じ plot で描ける。
      fn plot(st: vec2f, pct: f32) -> f32 {
        return smoothstep(pct - 0.02, pct, st.y)
             - smoothstep(pct, pct + 0.02, st.y);
      }

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        // クリップ空間 (-1〜+1) をすっぽり覆う大きな三角形 (04 と同じ)
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
        // 正規化座標 st: 画面左下が (0,0)、右上が (1,1)。
        // WebGPU の position.y は上が 0 なので、GLSL に合わせて上下反転する。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // シェイピング関数: sin の波。
        //   st.x * PI * 2.0 : 画面左→右で 0〜2π = sin がちょうど 1 周
        //   sin(...)        : -1〜+1 の波
        //   0.5 + 0.5 *     : それを 0〜1 にリマップ (中央 0.5 を基準に上下へ揺れる)
        let y = 0.5 + 0.5 * sin(st.x * PI * 2.0);

        // 背景は y を明るさにしたグラデーション
        var color = vec3f(y);

        // その上に sin の波を緑で重ねる
        //   pct(線の上=1, 外=0, 境目は smoothstep でなめらかな小数) の割合で
        //   背景色と緑を混ぜる = 線形補間。次の 1 行は組み込みの mix でも同じ:
        //     color = mix(color, vec3f(0.0, 1.0, 0.0), pct);
        let pct = plot(st, y);
        color = (1.0 - pct) * color + pct * vec3f(0.0, 1.0, 0.0);

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン (頂点バッファ無し。バインドグループはユニフォーム 1 つ)
  const pipeline = device.createRenderPipeline({
    label: "shaping functions (sin) pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  //   vec2f は 8 バイトだが、struct は 16 バイト境界に揃うので 16 バイト確保する。
  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0; // [0],[1]

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
    // 現在のキャンバスサイズを resolution として送る
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
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
    pass.draw(3); // 大きな三角形 1 枚
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // アニメーションしないので、リサイズ時だけ描き直せばよい。
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
      render(device);
    }
  });
  observer.observe(canvas);
}

main();
