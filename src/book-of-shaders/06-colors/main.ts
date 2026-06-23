// The Book of Shaders — 06 色について (波を「色」に変換する)
// https://thebookofshaders.com/06/?lan=jp
//
// 05 では sin の波を「線の高さ (y)」として緑 1 色で描いた。
// 06 ではその同じ波を「色そのもの」に変換する。波 = うねうね を色で見せる回。
//
// 色は vec3f = (R, G, B)。各成分は 0〜1。
//   vec3f(1, 0, 0) = 赤 / vec3f(1, 1, 1) = 白 / vec3f(0, 0, 0) = 黒
//
// この作例では「波 → 色」の代表的な 2 つの方法を画面の上下に並べて見比べる:
//
//   [上半分] mix で 2 色を混ぜる (本の基本)
//     mix(colorA, colorB, t) は t=0 で colorA、t=1 で colorB、間はなめらかに補間。
//     混合率 t に 0〜1 の sin 波を渡すと、波の高さがそのまま「2 色の混ざり具合」になる。
//
//   [下半分] RGB を位相ずらしの sin 波にする (虹)
//     R, G, B それぞれを sin 波にし、位相を 2π/3 ずつずらすと
//     R→G→B の山が順番にやってきて、なめらかな虹のグラデーションになる。
//     「波を 3 本束ねると色になる」感覚をつかむのが狙い。
//
// 05 と同じく u_time を x に足して波を左→右へ流す = 色が流れて見える。
//
// WGSL メモ:
//   mix(a, b, t)            : GLSL と同名。vec3f 同士でも各成分を補間してくれる
//   sin(vec3f)              : ベクトルを渡すと各成分に sin が適用される (まとめて 3 本計算)
//   select(f, t, cond)      : GLSL の三項演算子 cond ? t : f に相当 (引数順が逆なので注意)

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
  //   フラグメント : 各ピクセルで sin の波を計算し、その波を「色」に変換して塗る。
  const module = device.createShaderModule({
    label: "book of shaders 06 - colors (wave to color)",
    code: /* wgsl */ `
      const PI = 3.14159265359;
      // 1 周 (2π) を 3 等分した位相のズレ。R/G/B をこれだけずらすと虹になる。
      const TAU3 = 2.0 * PI / 3.0;

      // 05 と同じユニフォーム。resolution で st を作り、time で波を流す。
      // メモリ配置: vec2f (8B) + f32 (4B) = 12B → 16B に切り上げ。
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

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

        // 波を流すための位相。05 と同じ作り。
        //   x に時間を足すと位相がずれ、波 (= 色) が左→右へ流れる。
        let phase = (st.x + u.time * 0.15) * PI * 2.0;

        // --- [上半分] mix で 2 色を混ぜる ---
        // 0〜1 にリマップした 1 本の sin 波を「混合率」として使う。
        let wave = 0.5 + 0.5 * sin(phase);
        let colorA = vec3f(0.149, 0.141, 0.912); // 青
        let colorB = vec3f(1.000, 0.833, 0.224); // 黄
        let mixed = mix(colorA, colorB, wave);    // 波の高さ = 青↔黄の混ざり具合

        // --- [下半分] RGB を位相ずらしの sin 波にする (虹) ---
        // 3 成分まとめて sin。位相を 0, 2π/3, 4π/3 ずらすと R→G→B が順に山になる。
        let rainbow = 0.5 + 0.5 * sin(
          vec3f(phase) + vec3f(0.0, TAU3, 2.0 * TAU3)
        );

        // 画面の上半分は mix 版、下半分は虹版。境目に細い黒線を入れて区切る。
        // select(falseValue, trueValue, condition) = condition ? trueValue : falseValue
        var color = select(mixed, rainbow, st.y < 0.5);
        if (abs(st.y - 0.5) < 0.002) {
          color = vec3f(0.0);
        }

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン (頂点バッファ無し。バインドグループはユニフォーム 1 つ)
  const pipeline = device.createRenderPipeline({
    label: "colors (wave to color) pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f, time: f32) — 05 と同じ
  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0; // [0],[1]
  const kTimeOffset = 2; // [2] (resolution の直後)

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
    pass.draw(3); // 大きな三角形 1 枚
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // リサイズ時はキャンバスの解像度だけ更新する (描画はループ側が毎フレーム行う)。
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

  // 毎フレーム u_time を更新して描き直す = 色が x 方向に流れるアニメーション。
  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();