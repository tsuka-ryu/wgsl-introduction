// 平面リピートパターン — 04 180度回転 (2円の交差でできる葉)
// 参考: 幾何学パターンの本 3.5「180度回転」
//
// ── 1ピクセルの気持ちで追う ────────────────────────────────
//   ある画素 p が来る。まず正方セルの何番目にいるかを捨てて (色に使わないので floor は要らない)、
//   セル内座標 f = fract(st) ∈ [0,1]² だけを見る。判定はたった2つ:
//     ・左上の角 (0,0) から 1 以内か?   → d0 = length(f) - 1
//     ・右下の角 (1,1) から 1 以内か?   → d1 = length(f - vec2(1,1)) - 1
//   この2つの符号で色が決まる。三角関数も角度も出てこない。
//     d0 < 0 かつ d1 < 0 → 白 (葉)      = 2つの円板の「交差」
//     d1 > 0            → 青           = (1,1) の円板の外 = 左上寄り
//     d0 > 0            → 赤           = (0,0) の円板の外 = 右下寄り
//
// ── ★新しい道具: SDF の集合演算 (max = 積集合) ─────────────
//   これまでは「1つの距離場を太らせる/縮める」だけだったが、ここでは
//     葉 = 円板A ∩ 円板B  ⇔  d_葉 = max(dA, dB)
//   max が「両方の内側」= 積集合になる (∪ は min)。距離場が集合の言葉で書けて、
//   しかも合成が max/min という代数になるのが要点 — DSL のコンビネータそのもの。
//   ちなみに葉の形 (vesica) は「半径=1辺、中心=対角の2隅」で決まるので、
//   先端の角度は必ず 90 度になる (円の接線が中心方向と直交 → 各接線が縦と横)。
//
// ── ★3択が排他になる理由 (すきまが出ない証明) ──────────────
//   「両方の円板の外」= |f|>1 かつ |f-(1,1)|>1 は起こらない。
//     |f|² + |f-(1,1)|² = (x² + (1-x)²) + (y² + (1-y)²)
//   で x² + (1-x)² は [0,1] 上で最大 1 (端点 x=0,1)。だから左辺は最大でも 2 で、
//   2 を超えられない = 両方 >1 は不可能 (等号は4隅のみ)。
//   → 2つの円板はセルを覆い尽くす。だから「白/青/赤」の3択で穴が開かない。
//   4隅では両方ちょうど 1 = 葉の先端。格子点のまわりは
//   [葉の先端 / 対角にもう1つの葉の先端 / 青 / 赤] の4象限で埋まる (本の図版どおり)。
//
// ── ★180度回転は「生きているが色を入れ替える」 ─────────────
//   セル中心まわりの 180 度回転は、左上の角 (0,0) を右下の角 (1,1) に移す。
//   実装がその2隅の円だけでできている以上、この回転で図形は完全に自分に重なる。
//   ただし移った先は 青 ↔ 赤。つまり
//     「形は保つが2色を入れ替える対称操作」= 白黒対称群 (反対称) p2'。
//   01〜03 では「色を入れると全部 p1 に落ちる」と結論したが、今回は
//   ★色を入れ替える操作まで許すと対称性が復活する、が新しい。
//   色は対称性を壊すだけでなく、群を「色の置換つきの群」に持ち上げる方向にも効く。
//   (本の 3.5 が青と赤の2色なのはたぶんこれを見せるため。全部同じ色なら
//    対角線の鏡映まで生きて cmm、全部違う色なら p1 に落ちる)
//
// ── アンチエイリアス ──────────────────────────────────────
//   円弧は曲線なので必須。d0/d1 はセル内座標での本物の距離なので aa は 03 と同じ
//   「1画素が st 単位でいくつか」で作る (fract 由来でセル境界を跨ぐと飛ぶので fwidth は使わない)。
//   一方 青|赤 が接する直線 (セルの縦横の境界) には AA を掛けていない。
//   ★その境界は画面の x軸/y軸 と完全に平行なので、ズレても「どの画素に線が乗るか」が
//     半画素動くだけでギザギザにならない。AA が要るのは斜め or 曲線のときだけ。

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
    label: "repeat-patterns 04 - half turn leaf",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 8.0;   // 画面 (短辺) に並ぶ正方セルの数

      const BG: vec3f  = vec3f(1.0);                   // 地 (白) = 葉
      const BLUE: vec3f = vec3f(0.118, 0.357, 0.557);  // 青 (左上の角側)
      const RED: vec3f  = vec3f(0.910, 0.271, 0.184);  // 赤 (右下の角側)

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        // position.y は下向き。セル内座標もそのまま下向きで扱うので、
        // f=(0,0) が画面の「左上」、f=(1,1) が「右下」の角になる。
        // 円の中心をこの対角ペアに置くと、残り2隅 (左下と右上) が葉の先端 = 葉は「/」向き。
        let st = position.xy / min(res.x, res.y) * SCALE;
        let f = fract(st);   // ★セル番号 (floor) は今回いっさい使わない = 全セルが同じ絵

        // 半径 1 (= セル1辺) の円を、セルの対角の2隅に置く
        let d0 = length(f) - 1.0;                  // 左上の角の円。外 (>0) なら右下寄り
        let d1 = length(f - vec2f(1.0, 1.0)) - 1.0; // 右下の角の円。外 (>0) なら左上寄り
        // ★葉 = 2つの円板の積集合 = max。これ自体が葉のちゃんとした距離場になる
        let leaf = max(d0, d1);

        // 1画素が st 単位でどれだけか。その半分を境界の前後に振ると遷移がちょうど1px
        let aa = 0.5 * SCALE / min(res.x, res.y);

        // 葉の外なら「はみ出している方の円」で色が決まる。d0>0 なら必ず d1<0 (上の証明) なので
        // 「大きい方はどっちか」だけで青/赤が決まる。境界 (d≈0) の側でも正しい相手を選ぶ
        let side = select(RED, BLUE, d1 > d0);
        let c = mix(side, BG, 1.0 - smoothstep(-aa, aa, leaf));
        return vec4f(c, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "half turn leaf pipeline",
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
