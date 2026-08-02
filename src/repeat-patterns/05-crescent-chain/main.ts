// 平面リピートパターン — 05 重ね順で出る三日月 (円板の鎖)
// 参考: 幾何学パターンの本 3.5「180度回転」の2枚目の図版
//
// ── ★描いている形は「円」1種類だけ ──────────────────────────
//   月・ひょうたん・S字が並んで見えるが、SDF は length(p - c) - R しか無い。
//   三日月は「円 − 円」で作ったのではなく、隣の円板を後から上に描いた結果
//   勝手に出てくる。同じ色の2枚は境目が見えないので融合してひょうたんになり、
//   1枚だけ色を変えると三日月が現れる。★形を定義せずに形を出す = 重ね順が形を作る。
//
// ── ★これまでと違うもの: 近傍ループ (ペインタのアルゴリズムを画素ごとに) ──
//   01〜04 は「座標を畳んで1セルの中だけ見る」だったが、円板は自分のセルからはみ出すので
//   畳めない。代わりに 色(p) = 「p を含む円板のうち一番後に描かれたものの色」 とする。
//   実装は p の周りの格子番号を round で出し、5×5 の近傍を重ね順に合成するだけ。
//   1点 → 色 の純関数のままなのは変わらない (ループが中に入っただけ)。
//
// ── ★重ね順は格子番号の1次式でよい ────────────────────────
//   格子は 2本のベクトル A (鎖の向き) と B (隣の鎖へ) で張る。長さを
//     |A| = 0.68 < 2R = 1     (よく重なる = 鎖になる)
//     |B| = |B - A| = 1.0     (ちょうど接するだけ = 重ならない)
//   に取ってあるので、★重なるのは A 方向の隣だけ。だから重ね順は i (A 方向の番号) の
//   大小だけで決まり、同じ i の円板どうしは重ならないので順序を決めなくてよい。
//   → ループを di 昇順で回せばそれがそのまま正しい重ね順になる。
//   接するだけの向きが2つあるので、3枚のすきまに小さな星形の地 (白) が残る。
//
// ── アンチエイリアス ──────────────────────────────────────
//   ★「一番後の円板の色」を argmax でハードに選ぶと AA が掛けられない。
//   合成 col = mix(col, 円の色, 被覆率) の形にして被覆率を smoothstep にすると、
//   重ね合わせの AA が各輪郭で正しく出る (= アルファ合成そのもの)。
//
// ── ★★180度回転は「原理的に」入らない ─────────────────────
//   重ね順は方向を持つ (dot(中心, A) の大小)。180度回転すると符号が反転するので、
//   ★重なりが見えている限り 2回対称は絶対に成立しない。
//   ただし同色どうしの重なりは順序が見えないので、赤2枚のペアの内部だけは 180度回転が生きる。
//   01〜03 の「色を入れると対称性が p1 に落ちる」に続いて、
//   ★重ね順という「絵に直接は写らない情報」も対称性を壊す、が今回の結論。
//   裏返すと DSL 的には over (重ね) は非可換で向きを持つコンビネータで、
//   fract/abs のような「座標の畳み方」とは別の軸のコンビネータになる。

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
    label: "repeat-patterns 05 - crescent chain",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 11.0;  // 画面 (短辺) に並ぶ円板の数。円板の直径が 1 単位
      const R: f32 = 0.5;       // 円板の半径

      // 格子ベクトル (y は下向き)。A は右上へ 48度・長さ 0.68 = 直径より短いので重なる。
      // B = A/2 + (A に垂直な方向) * h で、|B| = |B - A| = 1.0 = 直径ちょうど → 接するだけ。
      const A: vec2f = vec2f(0.4550, -0.5053);
      const B: vec2f = vec2f(0.9263,  0.3766);

      const WHITE: vec3f = vec3f(1.0);
      const GRAY:  vec3f = vec3f(0.890, 0.898, 0.878);
      const BLUE:  vec3f = vec3f(0.090, 0.384, 0.612);
      const DARK:  vec3f = vec3f(0.196, 0.157, 0.141);
      const RED:   vec3f = vec3f(0.910, 0.306, 0.216);

      fn wrap(x: i32, n: i32) -> i32 { return ((x % n) + n) % n; }

      // 格子点ごとの色。鎖 (i) 方向に 5 周期、鎖をまたぐ (j) 方向に 2 周期。
      // ★モチーフは「隣り合う2枚」でしかない: (青, 黒) なら青が三日月として残り、
      //   (赤, 赤) なら融合してひょうたん / S になる。形の違いは色の置き方だけ。
      fn siteColor(i: i32, j: i32) -> vec3f {
        let a = wrap(i, 5);
        if (wrap(j, 2) == 0) {
          if (a == 0) { return BLUE; }
          if (a == 1) { return DARK; }
        } else {
          if (a == 3 || a == 4) { return RED; }
        }
        return GRAY;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let p = position.xy / min(res.x, res.y) * SCALE;

        // p = i*A + j*B を i, j について解いて四捨五入 = 一番近い格子点の番号
        let det = A.x * B.y - A.y * B.x;
        let i0 = i32(round((p.x * B.y - p.y * B.x) / det));
        let j0 = i32(round((A.x * p.y - A.y * p.x) / det));

        // 1画素が p 単位でどれだけか。その半分を輪郭の前後に振ると遷移がちょうど1px
        let aa = 0.5 * SCALE / min(res.x, res.y);

        // ★地の白から始めて、近傍の円板を重ね順 (= di 昇順) にアルファ合成していく
        var col = WHITE;
        for (var di = -2; di <= 2; di++) {
          for (var dj = -2; dj <= 2; dj++) {
            let i = i0 + di;
            let j = j0 + dj;
            let c = f32(i) * A + f32(j) * B;
            let cov = 1.0 - smoothstep(-aa, aa, length(p - c) - R);
            col = mix(col, siteColor(i, j), cov);
          }
        }
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "crescent chain pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  // uniform は resolution だけ (vec2f = 8 バイト)
  const uniformValues = new Float32Array(2);
  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution)",
    size: uniformValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const render = () => {
    uniformValues.set([canvas.width, canvas.height]);
    device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

    const encoder = device.createCommandEncoder({ label: "encoder" });
    const pass = encoder.beginRenderPass({
      label: "canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      // CSS ピクセルではなく実ピクセルで描く (Retina で半分の解像度になってボケるのを防ぐ)
      const box = entry.devicePixelContentBoxSize?.[0];
      const dpr = window.devicePixelRatio || 1;
      const width = box ? box.inlineSize : entry.contentBoxSize[0].inlineSize * dpr;
      const height = box ? box.blockSize : entry.contentBoxSize[0].blockSize * dpr;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
    render();
  });
  observer.observe(canvas, { box: "device-pixel-content-box" });
}

main();
