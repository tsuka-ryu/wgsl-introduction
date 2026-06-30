// The Book of Shaders — 12 セルラーノイズ: production版 cellular2x2 (permute整数ハッシュ)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015 / Cell)
//
// ここまでの 12 章 (cells-df 〜 cellular-f2) は全部「自前の hash = fract(sin(...)) で各セルに点を置き、
// 近傍を for ループで回って距離を測る」教育用の素朴版だった。今回は実戦で使われる Stefan Gustavson の
// 高速版 cellular2x2 を移植する。違いは大きく 3 つ:
//
//   1. ハッシュ … fract(sin(dot(...))) を捨て、permute = mod((34x+1)x, 289) という多項式ハッシュに。
//                 整数格子上で均一に散り、周期 289 でタイリングする (GPU で破綻しにくい本物の乱数)。
//   2. 近傍   … 3×3 (9マス) の for ループをやめ、2×2 (4マス) を vec4 1本で「分岐なし並列」に評価。
//                 9→4 で速いが、F1/F2 がたまに不正確になる。それを jitter=0.8 (<1) で目立たなくする取引。
//   3. 出力   … F1 そのもの (丸い窪み) でなく facets=F2−F1 (=壁) と dots=smoothstep(F1) (=中心の穴) を
//                掛け合わせ、step で固い縁を切る → ひび割れた石畳・細胞壁のような質感。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st = pos/res, y反転              … 本(下origin)に合わせた 0〜1 座標。
//   アスペクト補正 → st-=.5 → *.7    … 正方形領域を中央に。st は概ね [-0.35, 0.35]。
//   warp = 1.1 - 5*dot(st,st)        … ★定義域ゆがめ: 中心は ~1.1 倍、外周ほど小さく、さらに
//                                      ある半径で 0 を跨いで負へ反転 → セルが外側で潰れ裏返る放射模様。
//   P = st * 40 * warp               … cellular2x2 に渡す座標 (40倍してセルを多数敷く)。
//   (F1, F2) = cellular2x2(P)        … 最寄り点までの距離 F1 と 2番目 F2 (sqrt 済み)。
//   facets = 0.1 + (F2 - F1)         … セル境界で小、内側で大 = 「壁の高さ」。
//   dots   = smoothstep(.05,.1,F1)   … 点のごく近く(F1<.05)だけ 0 = 中心に黒い穴。
//   n = step(.2, facets) * dots      … facets を .2 で二値化(固い縁)し、穴を掛けて抜く → 石畳。
//   color = vec3(n)                  … 白黒。
//
// ── cellular2x2 の中身 (なぜ for が要らないか) ─────────────────────────────────
//   Pi = floor(P) (mod 289), Pf = fract(P)。隣接 2×2 = 4 セルを vec4 の 4 レーンに割り当てる。
//   permute を 2 段かけて 4 セルそれぞれの乱数 p を得る → 各セル内の点の位置 (ox,oy) を jitter で決める。
//   d = dx²+dy² で 4 つの二乗距離を一括計算。あとは「最小2つ」を分岐スワップ 3 回で前に集めて返す。
//   ※ WGSL は d.xy=... のような複数成分スウィズル代入を許さないので、GLSL の三項スワップは
//      if で 1 成分ずつ入れ替える形に直してある (意味は同じ: d.x に最小、d.y に次点)。
//
// この shader は静止画 (uniform は resolution のみ)。時間で warp を揺らせばアニメにもできる。

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
    label: "book of shaders 12 - cellular2x2 (permute)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // GLSL の mod(x, n) = x - n*floor(x/n) (床関数版)。WGSL の % は切り捨て版で
      // 負の入力で符号が違うため、permute 等で使う床版 mod を自前で定義する。
      fn mod289_4(x: vec4f) -> vec4f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod289_2(x: vec2f) -> vec2f { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      fn mod7_4(x: vec4f)   -> vec4f { return x - floor(x * (1.0 / 7.0))   * 7.0; }

      // permute: 整数格子点を均一に散らす多項式ハッシュ。周期 289 でタイリングする。
      fn permute4(x: vec4f) -> vec4f { return mod289_4((34.0 * x + 1.0) * x); }

      // 2×2 (4セル) を vec4 1本で並列評価し、(F1, F2) = (最寄り距離, 次点距離) を返す。
      fn cellular2x2(P: vec2f) -> vec2f {
        let K: f32  = 0.142857142857;   // 1/7
        let K2: f32 = 0.0714285714285;  // K/2
        let jitter: f32 = 0.8;          // 1.0 だと F1 が外れやすいので少し控える

        let Pi = mod289_2(floor(P));
        let Pf = fract(P);
        // 4 セルそれぞれへの x/y 方向のオフセット (vec4 の 4 レーン = 4 セル)。
        let Pfx = Pf.x + vec4f(-0.5, -1.5, -0.5, -1.5);
        let Pfy = Pf.y + vec4f(-0.5, -0.5, -1.5, -1.5);

        var p = permute4(Pi.x + vec4f(0.0, 1.0, 0.0, 1.0));
        p = permute4(p + Pi.y + vec4f(0.0, 0.0, 1.0, 1.0));

        // 各セル内の特徴点の位置 (jitter で散らす)。
        let ox = mod7_4(p) * K + K2;
        let oy = mod7_4(floor(p * K)) * K + K2;
        let dx = Pfx + jitter * ox;
        let dy = Pfy + jitter * oy;
        var d = dx * dx + dy * dy;   // 4 つの二乗距離 (d11, d12, d21, d22)

        // 最小2つを d.x, d.y に集める。GLSL の三項スワップ d.xy=(d.x<d.y)?d.xy:d.yx を
        // WGSL では 1 成分ずつの if スワップに展開 (複数成分スウィズル代入は不可)。
        if (d.x >= d.y) { let t = d.x; d.x = d.y; d.y = t; }
        if (d.x >= d.z) { let t = d.x; d.x = d.z; d.z = t; }
        if (d.x >= d.w) { let t = d.x; d.x = d.w; d.w = t; }
        d.y = min(d.y, d.z);
        d.y = min(d.y, d.w);
        return sqrt(vec2f(d.x, d.y));   // (F1, F2)
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;   // 本(下origin)に合わせて y 反転

        // 正方形領域を中央に収めるアスペクト補正 (canvas が正方形なら実質恒等)。
        if (u.resolution.y > u.resolution.x) {
          st.y = st.y * (u.resolution.y / u.resolution.x);
          st.y = st.y - (u.resolution.y * 0.5 - u.resolution.x * 0.5) / u.resolution.x;
        } else {
          st.x = st.x * (u.resolution.x / u.resolution.y);
          st.x = st.x - (u.resolution.x * 0.5 - u.resolution.y * 0.5) / u.resolution.y;
        }
        st = st - 0.5;
        st = st * 0.7;

        // ★放射状の定義域ゆがめ: 中心は拡大、外周で縮小→反転。セルが外側で潰れて裏返る。
        let warp = 1.1 - dot(st, st) * 5.0;
        let F = cellular2x2(st * 40.0 * warp);

        let facets = 0.1 + (F.y - F.x);              // 壁の高さ (境界で小、内側で大)
        let dots = smoothstep(0.05, 0.1, F.x);       // 中心のごく近くだけ 0 = 黒い穴
        let n = step(0.2, facets) * dots;            // 固い縁 × 穴 → 石畳/細胞壁

        return vec4f(n, n, n, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "cellular2x2 permute pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト (resolution vec2f + padding)
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
      render(device);
    }
  });
  observer.observe(canvas);

  render(device);
}

main();
