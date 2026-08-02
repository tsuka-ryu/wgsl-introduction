// 平面リピートパターン — 05 180度回転 (軸まわりの半回転で作る円板の鎖)
// 参考: 幾何学パターンの本 3.5「180度回転」の2枚目の図版
//
// ── ★配置が「半回転で生成される」 ─────────────────────────
//   縦の軸の上に等間隔 (SH) で半回転の中心を並べ、円をその中心まわりに 180度回して
//   次の円を置く、を繰り返す。すると円は軸の左右に振り分けられて★ジグザグの1列になる。
//   平行移動だけなら円は縦一直線に並ぶ。半回転を挟むと左右に振れるのがこの節の芯。
//   ★半回転2回 = 平行移動 なので、列の並進周期は自動的に「2段」になる。
//   その列を横に AX 間隔で何本も並べたのが全体。
//
// ── ★描いている形は「円」1種類だけ ──────────────────────────
//   月・ひょうたん・S字が並んで見えるが SDF は length(p - c) - R しか無い。
//   三日月は「円 − 円」で作ったのではなく、隣の円を後から上に描いた副産物。
//   同じ色の2枚は境目が見えないので融合し、色が違う2枚では三日月が現れる。
//   ★しかも鎖がジグザグなので、削られる向きが1段ごとに左右入れ替わる。
//   だから同色2枚のペアが S字/ひょうたんになる (まっすぐな鎖だと左右対称な弾丸形にしかならない)。
//
// ── ★近傍ループ (ペインタのアルゴリズムを画素ごとに) ────────
//   01〜04 は「座標を畳んで1セルの中だけ見る」だったが、円は自分のセルからはみ出すので
//   畳めない。代わりに 色(p) = 「p を含む円のうち一番後に描かれたものの色」 とする。
//   1点 → 色 の純関数のままで、ループが中に入っただけ。
//
// ── ★重ね順は段番号 j だけで決まる ────────────────────────
//   ★重なるのは「同じ列の上下の隣」だけになるように寸法を取ってある:
//     同じ列の1段違い |(±SW, SH)|     = 0.67 < 2R = 1   → 重なる
//     同じ列の2段違い |(0, 2*SH)|     = 1.00 = 2R       → 接するだけ
//     隣の列の一番近い組 |(AX-SW, SH)| = 1.03 > 2R      → 触れない
//   だから重ね順は j の大小だけでよく、同じ j (= 必ず別の列) どうしは重ならないので
//   順序を決めなくてよい。→ ループを j の降順で回せば (= 上の段ほど後に描けば)
//   それがそのまま正しい重ね順になる。接するだけの向きがあるおかげで、
//   3枚のすきまに小さな星形の地 (白) が残る。
//
// ── アンチエイリアス ──────────────────────────────────────
//   ★「一番後の円の色」を argmax でハードに選ぶと AA が掛けられない。
//   col = mix(col, 円の色, 被覆率) の形にして被覆率を smoothstep にすると、
//   重ね合わせの AA が各輪郭で正しく出る (= アルファ合成そのもの)。
//
// ── ★★今回は 180度回転が本当に入っている (色まで含めて) ────
//   1周期 10 段の配色は
//     左灰 / 右赤 / 左赤 / 右灰 / 左青 / 右黒 / 左灰 / 右灰 / 左黒 / 右青
//   で、これは m -> 3 - m (mod 10) で自分に写る:
//     0↔3 (灰-灰) / 1↔2 (赤-赤) / 4↔9 (青-青) / 5↔8 (黒-黒) / 6↔7 (灰-灰)
//   m -> 3-m は軸上の1点まわりの半回転そのもの。★青黒ペアが2組あって互いに逆向き
//   (青-黒 と 黒-青) なのはこのため = 半回転で移り合う関係。
//   ★01〜03 は「色を入れると対称群が p1 に落ちる」だったが、今回は初めて
//   色ごと 180度回転が保たれる。本の分類が実装にそのまま入る初の例。
//   ★ただし重ね順だけは保たれない: 順序は j の大小で向きを持つので、半回転で
//   j -> C-j と反転してしまう (青が黒に隠れる/黒が青に隠れるが入れ替わる)。
//   → 色は対称性を壊さない置き方ができるが、重ね順は原理的に向きを持つ。
//   DSL 的には over (重ね) は非可換で向きを持つコンビネータで、
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
    label: "repeat-patterns 05 - half turn crescent chain",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 10.0;  // 画面 (短辺) に並ぶ円の数。円の直径が 1 単位
      const R: f32 = 0.5;       // 円の半径

      const AX: f32 = 1.35;     // 軸 (列) の横間隔
      const SW: f32 = 0.45;     // 軸から左右へのふり幅 (半回転で振り分けられる幅)
      const SH: f32 = 0.50;     // 半回転の中心の間隔 = 1段ぶんの高さ
      const Q: i32 = 4;         // 隣の列へ行くと配色が何段ずれるか (偶数なら半回転が保たれる)

      const WHITE: vec3f = vec3f(1.0);
      const GRAY:  vec3f = vec3f(0.890, 0.898, 0.878);
      const BLUE:  vec3f = vec3f(0.090, 0.384, 0.612);
      const DARK:  vec3f = vec3f(0.196, 0.157, 0.141);
      const RED:   vec3f = vec3f(0.910, 0.306, 0.216);

      // i 列目・j 段目の円の中心。j の偶奇で軸の左右に振り分ける = 半回転で置いた結果
      fn siteCenter(i: i32, j: i32) -> vec2f {
        let side = select(-0.5, 0.5, (j & 1) == 1);
        return vec2f(f32(i) * AX + side * SW, f32(j) * SH);
      }

      // 1周期 10 段の配色:
      //   左灰 / 右赤 / 左赤 / 右灰 / 左青 / 右黒 / 左灰 / 右灰 / 左黒 / 右青
      // ★m -> 3-m (mod 10) で自分に写る = 軸上の1点まわりの半回転で色まで保たれる
      fn siteColor(i: i32, j: i32) -> vec3f {
        let m = (((j + Q * i) % 10) + 10) % 10;
        if (m == 1 || m == 2) { return RED; }
        if (m == 4 || m == 9) { return BLUE; }
        if (m == 5 || m == 8) { return DARK; }
        return GRAY;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let p = position.xy / min(res.x, res.y) * SCALE;

        // 一番近い列と段の番号。ここから ±1列 / ±2段 を見れば p を含む円は全部拾える
        let i0 = i32(round(p.x / AX));
        let j0 = i32(round(p.y / SH));

        // 1画素が p 単位でどれだけか。その半分を輪郭の前後に振ると遷移がちょうど1px
        let aa = 0.5 * SCALE / min(res.x, res.y);

        // ★地の白から始めて、j の降順 (= 上の段ほど後) にアルファ合成していく
        var col = WHITE;
        for (var dj = 2; dj >= -2; dj--) {
          for (var di = -1; di <= 1; di++) {
            let i = i0 + di;
            let j = j0 + dj;
            let cov = 1.0 - smoothstep(-aa, aa, length(p - siteCenter(i, j)) - R);
            col = mix(col, siteColor(i, j), cov);
          }
        }
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "half turn crescent chain pipeline",
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
