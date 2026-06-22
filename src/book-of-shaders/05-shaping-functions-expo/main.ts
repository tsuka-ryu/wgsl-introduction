// The Book of Shaders — 05 シェイピング関数 (pow 曲線 / Inigo Quiles "Expo")
// https://thebookofshaders.com/05/?lan=jp
//
// basic 版 (y = st.x の直線) からの続き。直線を数学関数に差し替えると
// 線が曲がる、という話の最初の例。
//   y = pow(st.x, 5.0)   … x を 5 乗。序盤はほぼ平らで、終盤に急上昇する曲線。
//
// もう 1 つの違いは plot。basic は「直線 y=x からの距離」で線を描いていたが、
// こちらは plot に y(= 描きたい高さ) を pct として渡し、
// 「st.y が pct のすぐ近くか」を 2 枚の smoothstep の差で帯にして線を引く。
// この plot なら直線以外の任意の曲線にも使える (汎用版)。
//
// 元の GLSL を WGSL に読み替えた対応:
//   gl_FragCoord.xy        -> @builtin(position).xy
//   u_resolution           -> ユニフォーム (struct Uniforms) で渡す
//   st = gl_FragCoord/u_res -> position.xy / u.resolution
//   GLSL は y が下から上、WebGPU は y が上から下 -> st.y を反転して合わせる
//   pow / smoothstep / vec3 はほぼ同名 (vec3f など f が付く)

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
  //   フラグメント : 各ピクセルで y = pow(st.x, 5.0) を計算し、その曲線を緑で描く。
  const module = device.createShaderModule({
    label: "book of shaders 05 - shaping functions (pow)",
    code: /* wgsl */ `
      // 元の GLSL の u_resolution に相当。st を作るために幅・高さを渡す。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // plot: 高さ pct のところに太さ ±0.02 の帯 (= 線) を引く。
      //   smoothstep を 2 枚使い、pct のすぐ下〜すぐ上だけ 1 になる帯を作る。
      //   pct に好きな曲線の値を渡せるので、直線でも pow でも同じ plot で描ける。
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

        // シェイピング関数: x の 5 乗。序盤ほぼ平ら、終盤で急上昇する曲線。
        let y = pow(st.x, 5.0);
        // let y = exp(st.x) - 1;
        // let y = log(st.x - 1.0);
        // let y = sqrt(st.x);

        // 背景は y を明るさにしたグラデーション
        var color = vec3f(y);

        // その上に y = pow(x,5) の曲線を緑で重ねる
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
    label: "shaping functions (pow) pipeline",
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
