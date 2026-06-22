// The Book of Shaders — 05 シェイピング関数 (最小版 / 直線 + plot)
// https://thebookofshaders.com/05/?lan=jp
//
// 本のいちばん最初の例をそのまま WGSL へ移植したもの。
//   y = st.x            … x をそのまま y にした「直線」
//   plot(st)            … その線を緑で描く
// アニメーションも無く、関数も sin ではなく直線。
// 「シェイピング関数とは何か」を一枚絵で確かめるための最小構成。
// (sin で波を動かす発展版は ../05-shaping-functions/ にある)
//
// 元の GLSL を WGSL に読み替えた対応:
//   gl_FragCoord.xy        -> @builtin(position).xy
//   u_resolution           -> ユニフォーム (struct Uniforms) で渡す
//   st = gl_FragCoord/u_res -> position.xy / u.resolution
//   GLSL は y が下から上、WebGPU は y が上から下 -> st.y を反転して合わせる
//   smoothstep / abs / vec3 はほぼ同名 (vec3f など f が付く)

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
  //   フラグメント : 各ピクセルで y = st.x を計算し、その直線を緑で描く。
  const module = device.createShaderModule({
    label: "book of shaders 05 - shaping functions (basic)",
    code: /* wgsl */ `
      // 元の GLSL の u_resolution に相当。st を作るために幅・高さを渡す。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // plot: 直線 y = st.x のすぐ近くだけ 1 を返す = 線になる。
      //   abs(st.y - st.x) が 0 (= 線の上) で 1、0.02 離れると 0。
      //   smoothstep の edge を 0.02 -> 0.0 の順に渡すと「近いほど 1」になる。
      fn plot(st: vec2f) -> f32 {
        return smoothstep(0.02, 0.0, abs(st.y - st.x));
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

        // シェイピング関数: x をそのまま y にした「直線」
        let y = st.x;

        // 背景は y を明るさにしたグラデーション
        var color = vec3f(y);

        // その上に y = x の直線を緑で重ねる
        //   pct(線の上=1, 外=0, 境目は smoothstep でなめらかな小数) の割合で
        //   背景色と緑を混ぜる = 線形補間。次の 1 行は組み込みの mix でも同じ:
        //     color = mix(color, vec3f(0.0, 1.0, 0.0), pct);
        //   (pct が中間値を持つので、select の 2 択では線のフチがギザつく)
        let pct = plot(st);
        color = (1.0 - pct) * color + pct * vec3f(0.0, 1.0, 0.0);

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン (頂点バッファ無し。バインドグループはユニフォーム 1 つ)
  const pipeline = device.createRenderPipeline({
    label: "shaping functions (basic) pipeline",
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
