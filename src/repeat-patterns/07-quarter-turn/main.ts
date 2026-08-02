// 平面リピートパターン — 07 90度回転 (割り円のロゼットと黒円の2格子)
// 参考: 幾何学パターンの本 3章 (3.5 の次の節、90度回転)
//
// ── 絵の構造 ─────────────────────────────────────────────
//   白地に2つの square 格子が入れ子:
//     ・整数格子点 = ベタの黒円
//     ・セル中心のまわり = 割り円4つのロゼット (上下左右、距離 D)
//   割り円は「中心を通る放射方向の線」で半分に割られ、赤/灰に塗られる。
//   4つは同じモチーフの 90度回転コピー (N の縦線カットが E では横線になる)。
//
// ── ★90度回転に sin/cos は要らない ───────────────────────
//   rot90: (x, y) → (y, -x)。つまり ★swap + 符号反転1つ。
//   06 の 180度 (符号反転2つ) に続き、正方格子の対称操作はまだ回転行列なしで書ける。
//   180度 = 90度の2乗であることも (swap+反転) を2回合成すると符号反転2つに
//   なることから見える。
//
// ── ★キラルな畳み込み (逆回転で標準扇形へ) ──────────────────
//   万華鏡 (geometric-patterns 02) は abs で基本領域に畳んだが、あれは鏡が
//   できてしまう。ここは鏡のない4回対称なので、★セル中心からの相対座標を
//   対角線で区切った4つの扇形 (N/E/S/W) に分類し、扇形番号 k のぶんだけ
//   逆回転を掛けて全部 N に畳む。「鏡ありは abs で畳む / 鏡なしはキラルに
//   回転コピー」の分かれ目 (本で得た芯) の正方格子版。
//   畳んだあとのモチーフ関数 (円 + 縦線で赤|灰) は1回書くだけでよい。
//
// ── ★★色込みで4回対称が本当に生きる (p4) ──────────────────
//   赤/灰の割り方ごと回転コピーしているので、セル中心まわりの 90度回転は
//   色を保ったまま絵を自分に重ねる。01〜03「塗ると p1 に落ちる」→
//   05「色の並びが対称を復活させる」→ 06「色ペアを入れ替える半回転」ときて、
//   ★ついに塗った色まで保つ回転対称に到達。
//   ★p4 の「4回中心は2種類」が絵にそのまま見える: ロゼットの中心 (セル中心) と
//   黒円の中心 (格子点)。黒円はベタなのでそれ自身どう回しても不変。
//
// ── モチーフは 04/06 の道具だけ ──────────────────────────
//   円 = 距離場、割り線 = 半平面の符号で赤/灰を mix、地は白。
//   AA は円の輪郭と割り線の両方に掛かる。

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
    label: "repeat-patterns 07 - quarter turn",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 8.0;   // 画面 (短辺) に並ぶ正方セルの数。大きいほど引きで見える
      const RD: f32 = 0.16;     // 割り円の半径
      const RB: f32 = 0.17;     // 黒円 (格子点) の半径
      const D: f32 = 0.26;      // セル中心からロゼットの円までの距離

      const WHITE: vec3f = vec3f(1.0);
      const GRAY: vec3f  = vec3f(0.824, 0.827, 0.804);
      const DARK: vec3f  = vec3f(0.196, 0.157, 0.141);
      const RED: vec3f   = vec3f(0.910, 0.306, 0.216);

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let st = position.xy / min(res.x, res.y) * SCALE;

        // 1画素が st 単位でどれだけか。その半分を境界の前後に振ると遷移がちょうど1px
        let aa = 0.5 * SCALE / min(res.x, res.y);

        var col = WHITE;

        // ── 黒円: 一番近い整数格子点からの相対座標で描く ──
        let g = st - round(st);
        col = mix(col, DARK, 1.0 - smoothstep(-aa, aa, length(g) - RB));

        // ── ロゼット: セル中心からの相対座標 c を扇形番号 k で N に畳む ──
        var c = fract(st) - 0.5;
        // 対角線で区切った扇形: N (上) = 0, E = 1, S = 2, W = 3
        var k = 3;
        if (-c.y >= abs(c.x)) { k = 0; }
        else if (c.x >= abs(c.y)) { k = 1; }
        else if (c.y >= abs(c.x)) { k = 2; }
        // ★逆回転を k 回掛けて標準扇形 (N) に畳む。rot90⁻¹ = swap + 符号反転1つ
        for (var n = 0; n < k; n++) {
          c = vec2f(c.y, -c.x);
        }

        // 標準モチーフ (N): 中心 (0, -D) の円を縦線 (l.x = 0) で割り、左 = 赤 / 右 = 灰
        let l = c - vec2f(0.0, -D);
        let half = mix(RED, GRAY, smoothstep(-aa, aa, l.x));
        col = mix(col, half, 1.0 - smoothstep(-aa, aa, length(l) - RD));

        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "quarter turn pipeline",
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
