// 幾何学パターン — 04 フリーズ群ジェネレータ: 7つの線形対称を1本で切替
// 参考: 幾何学パターンの本 Part 2「線形対称」2.1〜2.7
//
// ── 7群 = 横 fract(x) を背骨に、何を足すかの違い ──────────
//   すべて「横並進 = セルに fract で畳む」が土台。そこにモードごとに
//   縦鏡 abs(x) / 横鏡 abs(y) / 180°回転(点対称 -p) / 映進(交互に上下反転) を足す。
//   モチーフは非対称な大文字 F (左右にも上下にも非対称なので群の差が見える)。
//
//   MODE | 群 (本の節)        | セル座標 (c,y) への操作
//   -----+--------------------+-------------------------------
//    0   | 2.1 並進           | そのまま
//    1   | 2.2 +垂直鏡映      | abs(c)               (左右折り)
//    2   | 2.3 +180°回転      | 奇数セルは (-c,-y)   (点対称)
//    3   | 2.4 +映進          | 奇数セルは (c,-y)    (交互に上下反転)
//    4   | 2.5 水平鏡映       | abs(y)               (上下折り)
//    5   | 2.6 両鏡映+回転    | abs(c), abs(y)       (両方折り = 最も秩序)
//    6   | 2.7 垂直鏡+映進+回転| abs(c), 交互 -y     (縦鏡に映進)
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   p がどのセル i の、セル内どこ (c,y) かを fract で出す。MODE に応じて
//   (c,y) を折る/反転してモチーフ基準座標 q を作り、F までの距離を測って塗る。
//   abs は2枚を1回の評価に畳む (鏡像が自動)。回転/映進はセルの偶奇で1枚ずつ反転。

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
    label: "geometric-patterns 04 - frieze groups",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const CELLS: f32 = 8.0;   // 横に並ぶセル数
      const OX: f32 = 0.22;     // 鏡映ペアの左右オフセット (垂直鏡のとき軸から離す)
      const OY: f32 = 0.16;     // 鏡映ペアの上下オフセット (水平鏡のとき軸から離す)
      const THICK: f32 = 0.05;  // 字画の太さ (半分)

      // 表示モード: -1 で全7群を time で自動巡回。0..6 で固定 (上の表)
      const MODE: i32 = -1;

      // 2点間 (線分) までの距離
      fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
        let pa = p - a;
        let ba = b - a;
        let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }

      // 非対称な大文字 F (原点まわり、セル単位)
      fn fSDF(p: vec2f) -> f32 {
        let stem = sdSeg(p, vec2f(-0.06, -0.33), vec2f(-0.06, 0.33));
        let top  = sdSeg(p, vec2f(-0.06,  0.33), vec2f( 0.20, 0.33));
        let mid  = sdSeg(p, vec2f(-0.06,  0.04), vec2f( 0.12, 0.04));
        return min(stem, min(top, mid));
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let unit = res.x / CELLS;              // 1セルのピクセル幅

        let ux = position.x / unit;            // 0..CELLS
        let i = floor(ux);
        let c = fract(ux) - 0.5;               // セル内 x [-0.5, 0.5]
        let y = (res.y * 0.5 - position.y) / unit;  // 帯中心=0, 上が正

        let odd = (i32(i) & 1) == 1;

        // モード決定 (-1 は自動巡回)
        var mode = MODE;
        if (mode < 0) { mode = i32(u.time / 1.8) % 7; }

        // MODE に応じて (c,y) を折る/反転してモチーフ基準座標 q へ
        var q = vec2f(c, y);
        if (mode == 1) {
          q = vec2f(abs(c) - OX, y);                    // 2.2 垂直鏡
        } else if (mode == 2) {
          if (odd) { q = vec2f(-c, -y); }               // 2.3 180°回転
        } else if (mode == 3) {
          if (odd) { q = vec2f(c, -y); }                // 2.4 映進
        } else if (mode == 4) {
          q = vec2f(c, abs(y) - OY);                    // 2.5 水平鏡
        } else if (mode == 5) {
          q = vec2f(abs(c) - OX, abs(y) - OY);          // 2.6 両鏡映+回転
        } else if (mode == 6) {
          let s = select(1.0, -1.0, odd);
          q = vec2f(abs(c) - OX, s * y);                // 2.7 垂直鏡+映進
        }

        let d = fSDF(q);
        let ink = 1.0 - smoothstep(THICK, THICK + 0.008, d);

        let bg   = vec3f(0.93, 0.92, 0.87);  // クリーム地
        let navy = vec3f(0.22, 0.28, 0.45);  // 紺の字画
        let col = mix(bg, navy, ink);
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "frieze pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
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
