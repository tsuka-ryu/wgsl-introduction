// The Book of Shaders — 06 色について (本家の作例: チャンネルごとの曲線 + plot)
// https://thebookofshaders.com/06/?lan=jp
//
// 本のページに載っている例そのものを WGSL に移植したもの。
// 06-colors が「波を色に変換する」入口だったのに対し、こちらは本家の核心:
//
//   color = mix(colorA, colorB, pct)
//
// ポイントは pct が「スカラーではなく vec3」だということ。
//   pct.r で R チャンネルの混合率
//   pct.g で G チャンネルの混合率
//   pct.b で B チャンネルの混合率
// を別々に指定できる。R/G/B それぞれに違う曲線 (補間カーブ) を割り当てると、
// 色が st.x に沿ってどう変化するかをチャンネル単位でデザインできる。
//
// 下半分のコメントアウト (pct.r / pct.g / pct.b) を有効にすると、
//   R = smoothstep カーブ / G = sin カーブ / B = pow カーブ
// のように各チャンネルが別々のカーブで動く本来の例になる。まずは pct = vec3f(st.x)
// (= 3 本とも同じ直線) で動かし、1 本ずつコメントを外して変化を見るのがおすすめ。
//
// plot は 05 と同じ「指定した高さに帯 (線) を引く」関数。
// R/G/B それぞれの曲線を、赤・緑・青の線として背景の上に重ねて可視化する。
//
// 元の GLSL -> WGSL 対応:
//   gl_FragCoord.xy            -> @builtin(position).xy
//   u_resolution               -> ユニフォーム (struct Uniforms)
//   GLSL は y が下から上、WebGPU は上から下 -> st.y を反転
//   mix / smoothstep / sin / pow -> ほぼ同名 (vec3f など f が付く)
//   vec3 pct = vec3(st.x)      -> let / var pct = vec3f(st.x)

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
  //   頂点   : 04 / 05 と同じ画面全体を覆う大きな三角形。
  //   フラグメント : 2 色を pct で mix し、各チャンネルの曲線を plot で線として描く。
  const module = device.createShaderModule({
    label: "book of shaders 06 - colors (per-channel curves + plot)",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      // この例は解像度だけ使う (時間アニメーションは無し)。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 混ぜる 2 色 (本家と同じ値)。青 ↔ 黄。
      const colorA = vec3f(0.149, 0.141, 0.912);
      const colorB = vec3f(1.000, 0.833, 0.224);

      // plot: 高さ pct のところに太さ ±0.01 の帯 (= 線) を引く。05 と同じ発想。
      fn plot(st: vec2f, pct: f32) -> f32 {
        return smoothstep(pct - 0.01, pct, st.y)
             - smoothstep(pct, pct + 0.01, st.y);
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

        // 各チャンネルの混合率。まずは 3 本とも st.x (= 直線) にしておく。
        var pct = vec3f(st.x);

        // ↓ 1 本ずつコメントを外すと、R/G/B が別々のカーブで動く本家の例になる。
        pct.r = smoothstep(0.0, 1.0, st.x); // R: なめらかな S 字
        pct.g = sin(st.x * PI);             // G: sin の山 (中央でピーク)
        pct.b = pow(st.x, 0.5);             // B: 平方根カーブ (序盤で急に立つ)

        // pct (vec3) を混合率にして 2 色を補間。
        // mix はチャンネルごとに別々の pct で補間してくれる = 色を細かくデザインできる。
        var color = mix(colorA, colorB, pct);

        // 各チャンネルの曲線を、赤・緑・青の線として背景の上に重ねて可視化する。
        color = mix(color, vec3f(0.0, 0.0, 1.0), plot(st, pct.b));
        color = mix(color, vec3f(1.0, 0.0, 0.0), plot(st, pct.r));
        color = mix(color, vec3f(0.0, 1.0, 0.0), plot(st, pct.g));

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン (頂点バッファ無し。バインドグループはユニフォーム 1 つ)
  const pipeline = device.createRenderPipeline({
    label: "colors (per-channel curves) pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 2 * 4; // 8 バイト (vec2f)
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;

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

  // 静止画なので、リサイズ時に解像度を更新してそのつど描き直すだけ。
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
