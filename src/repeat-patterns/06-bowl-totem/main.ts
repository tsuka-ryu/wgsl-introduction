// 平面リピートパターン — 06 180度回転 (お椀3個のだるま落とし)
// 参考: 幾何学パターンの本 3.5「180度回転」の3枚目の図版
//
// ── ★基本系は「お椀∪ 3個」のユニット1種類 ─────────────────
//   お椀 (下半円: フラットな縁が上、丸い底が下) を 小→中→大 と下へ連ねた
//   「だるま落とし」が基本系。パターンに出てくる形はこれと、
//   これを 180度回転したもの (∩ が上を向き、大→小 と下へ並ぶ) の2つだけ。
//
// ── ★★今回は 180度回転が幾何に本当に入る ──────────────────
//   点対称 p → 2c - p は、この実装では
//     ・半平面の向き dir の符号反転 (∪ → ∩)
//     ・フラット縁の位置 t[m] の符号反転 (小→大 の並びが逆順に)
//   という「符号の反転2つ」に落ちる。回転行列は出てこない。
//   04 = セル内の2円が半回転で移り合う / 05 = 配置が半回転で生成される、ときて
//   06 = ★モチーフ自体を半回転で複製する。同じ節の3つの顔。
//
// ── ★回転で形は重なるが、色は2色ペアを入れ替える ─────────────
//   ペアの真ん中 (∩小 と ∪小 のすき間の中点) まわりの半回転で
//   上のユニットと下のユニットは形として完全に重なる。ただし色が
//     列A: 赤 ↔ 青   列B: 灰 ↔ 黒
//   と入れ替わる = 04 で出た「色を入れ替える対称操作 (白黒対称)」の再来。
//   04 は青↔赤の1ペアだったが、今回は2色ペア×列2種で、列は半段ずらしの平行配置。
//
// ── 半円と合成は全部これまでの道具 ─────────────────────────
//   半円 = 円 ∩ 半平面 (04 の max)。AA は円と半平面それぞれの被覆率の積。
//   ★今回はどの半円も重ならない配置なので、05 で効いた「塗り順」が初めて不問になる
//   = ただの和集合。mix で順に合成しても順序が絵に影響しない。

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
    label: "repeat-patterns 06 - bowl totem",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 16.0;  // 画面 (短辺) に入る格子単位の数。大きいほど引きで見える

      const AX: f32 = 1.06;     // 列の横間隔
      const T: f32 = 2.30;      // ペア (∩ユニット + ∪ユニット) の縦周期。奇数列は半周期ずらす
      const GAP: f32 = 0.06;    // ∩小 と ∪小 のすき間 (ペアの真ん中 = 半回転の中心)

      // 基本系: お椀 小→中→大。R = 半径、TT = フラット縁の y 位置 (小椀 = 0)
      const R = array(0.20, 0.29, 0.42);
      const TT = array(0.0, 0.24, 0.57);

      const WHITE: vec3f = vec3f(1.0);
      const GRAY:  vec3f = vec3f(0.824, 0.827, 0.804);
      const BLUE:  vec3f = vec3f(0.090, 0.384, 0.612);
      const DARK:  vec3f = vec3f(0.196, 0.157, 0.141);
      const RED:   vec3f = vec3f(0.910, 0.306, 0.216);

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let p = position.xy / min(res.x, res.y) * SCALE;

        // 1画素が p 単位でどれだけか。その半分を輪郭の前後に振ると遷移がちょうど1px
        let aa = 0.5 * SCALE / min(res.x, res.y);

        let i0 = i32(round(p.x / AX));

        var col = WHITE;
        for (var di = -1; di <= 1; di++) {
          let i = i0 + di;
          let odd = (((i % 2) + 2) % 2) == 1;
          let cx = f32(i) * AX;
          let phase = select(0.0, 0.5 * T, odd);
          // 列A: 上=赤 / 下=青、列B: 上=灰 / 下=黒 (縦に半周期ずれ)
          let cUp = select(RED, GRAY, odd);
          let cDn = select(BLUE, DARK, odd);
          let k0 = i32(round((p.y - phase) / T));
          for (var dk = -1; dk <= 1; dk++) {
            let base = phase + f32(k0 + dk) * T;
            for (var m = 0; m < 3; m++) {
              // ∪ユニット (下、色 cDn): フラット縁 base + TT[m]、下に膨らむ
              var cy = base + TT[m];
              var cov = (1.0 - smoothstep(-aa, aa, length(p - vec2f(cx, cy)) - R[m]))
                      * (1.0 - smoothstep(-aa, aa, -(p.y - cy)));
              col = mix(col, cDn, cov);
              // ∩ユニット (上、色 cUp): ★点対称 = TT と 半平面の向き の符号反転だけ
              cy = base - GAP - TT[m];
              cov = (1.0 - smoothstep(-aa, aa, length(p - vec2f(cx, cy)) - R[m]))
                  * (1.0 - smoothstep(-aa, aa, (p.y - cy)));
              col = mix(col, cUp, cov);
            }
          }
        }
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "bowl totem pipeline",
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
