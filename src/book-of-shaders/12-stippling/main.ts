// The Book of Shaders — 12 セルラーノイズ: 点描 (Stippling)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015)
//
// これまで (12-cellular-noise 系) は random2 ハッシュで自前のセルラーノイズを組んでいた。
// 今回は同じ Worley ノイズを、高速版の決定的アルゴリズムで一気に求める:
//   cellular2x2() ── Stefan Gustavson 作の WebGL 実装の WGSL 移植。3×3 ではなく 2×2 の
//   探索窓で最近傍点(F1)・次近傍点(F2)を vec4 並列で一発計算する。速い代わりに F2 は
//   ときどき不正確で不連続が出る (本作は F1 しか使わないので問題なし)。
//   ※ permute = 多項式ハッシュ。同じ整数セルには必ず同じ乱数 → 全画面で一貫した点配置。
//
// 「点描 (stippling)」= 濃淡を "点の粗密" で表現する技法。Worley の距離場 F1 を、同心円の
// 縞しきい値で AND して、リング状に黒点をばらまく。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st          … 0〜1 の画面座標。0.75 倍ズーム + 正方形になるよう縦横比補正。
//   F = cellular2x2(st*20)                … F.x = 最寄りの特徴点までの距離 (20倍密の格子)。
//                                            点の真上で 0、点から離れるほど大きい谷地形。
//   pos = st - .5                         … 画面中心からのベクトル。
//   a   = dot(pos,pos) - time*0.1         … 中心からの距離² (お椀型) を時間で外へ流す。
//   ring = abs(sin(a*π*5))               … a に対して 5 周期の波 → 同心円の縞。abs で 0〜1。
//                                            リングの山で 1 (黒くなりやすい)、谷で 0 (白)。
//   n   = step(ring, F.x*2)               … F.x*2 ≥ ring なら白(1)、未満なら黒(0)。
//                                            特徴点の近く(F.x 小)ほど黒くなり、リングの山ほど
//                                            黒が増える → 黒点が同心円バンド状に粗密を作る = 点描。
//   color = vec3(n)
//
// ★ ポイント: 「滑らかなリング縞」を「ランダムな距離場」で切ると、縞が点の集まりに砕ける。
//   濃淡を点の密度に変換する = ハーフトーン/点描の最小原理。
//
// uniform は resolution と time の 2 つ。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  const module = device.createShaderModule({
    label: "book of shaders 12 - stippling",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // ── Cellular noise ("Worley noise") in 2D ────────────────────────────────
      // Copyright (c) Stefan Gustavson 2011-04-19. All rights reserved.
      // This code is released under the conditions of the MIT license.
      // (WGSL への移植。元は GLSL)

      // 並べ替え多項式 (34x^2 + x) mod 289。整数→決定的な擬似乱数。
      fn permute4(x: vec4f) -> vec4f {
        return ((34.0 * x + 1.0) * x) % vec4f(289.0);
      }

      // セルラーノイズ。F1(最寄り)・F2(次点) を vec2 で返す。
      // 2×2 探索窓で高速化 (3×3 版より速いが F2 は不正確になりがち)。
      fn cellular2x2(P: vec2f) -> vec2f {
        let K = 0.142857142857;     // 1/7
        let K2 = 0.0714285714285;   // K/2
        let jitter = 0.8;           // 1.0 にすると F1 が外れやすい

        let Pi = floor(P) % vec2f(289.0);
        let Pf = fract(P);
        let Pfx = Pf.x + vec4f(-0.5, -1.5, -0.5, -1.5);
        let Pfy = Pf.y + vec4f(-0.5, -0.5, -1.5, -1.5);
        var p = permute4(Pi.x + vec4f(0.0, 1.0, 0.0, 1.0));
        p = permute4(p + Pi.y + vec4f(0.0, 0.0, 1.0, 1.0));
        let ox = (p % vec4f(7.0)) * K + K2;
        let oy = (floor(p * K) % vec4f(7.0)) * K + K2;
        let dx = Pfx + jitter * ox;
        let dy = Pfy + jitter * oy;
        var d = dx * dx + dy * dy;   // 4 マスの点までの距離² (d11,d12,d21,d22)

        // 最小2つ (F1, F2) を選り分ける。スワップで一番小さいのを d.x に集める。
        if (d.x >= d.y) { let t = d.x; d.x = d.y; d.y = t; }
        if (d.x >= d.z) { let t = d.x; d.x = d.z; d.z = t; }
        if (d.x >= d.w) { let t = d.x; d.x = d.w; d.w = t; }
        d.y = min(d.y, d.z);
        d.y = min(d.y, d.w);
        return sqrt(d.xy);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 中心基準で 0.75 倍ズーム。
        st = (st - 0.5) * 0.75 + 0.5;
        // 正方形になるよう縦横比補正 (canvas が正方形なら実質そのまま)。
        if (u.resolution.y > u.resolution.x) {
          st.y *= u.resolution.y / u.resolution.x;
          st.y -= (u.resolution.y * 0.5 - u.resolution.x * 0.5) / u.resolution.x;
        } else {
          st.x *= u.resolution.x / u.resolution.y;
          st.x -= (u.resolution.x * 0.5 - u.resolution.y * 0.5) / u.resolution.y;
        }

        let F = cellular2x2(st * 20.0);          // F.x = 最寄りの特徴点までの距離

        let pos = st - 0.5;
        let a = dot(pos, pos) - u.time * 0.1;    // 中心からの距離²を外へ流す
        let ring = abs(sin(a * 3.1415 * 5.0));   // 同心円の縞しきい値 (0〜1)
        let n = step(ring, F.x * 2.0);           // 縞を距離場で切る → 点描

        return vec4f(n, n, n, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "stippling pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト (resolution vec2f + time f32 + padding)
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

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
  });
  observer.observe(canvas);

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
