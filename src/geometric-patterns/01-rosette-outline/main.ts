// 幾何学パターン — 01 ロゼット (ステップ1): 同じ円の輪郭を n 個リング状に並べる
// 参考: 幾何学パターンの本 1.1「回転対称」/ 高い次数のバリエーション
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = 背景 と ストローク を、ストローク濃度で混ぜたもの
//   ストローク濃度(p) = max_k stroke_k(p)          … n 個の円のどれかに乗っていれば描く
//   stroke_k(p)      = 円 k の輪郭にどれだけ近いか   … 近い=1 遠い=0
//   円 k の中心 c_k  = D · (cos θ_k, sin θ_k),  θ_k = 2πk/n
//   ここは時間に依らない純粋な座標の関数。回るのは全体の位相だけ。
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   あるピクセル p を見る。n 個の円それぞれについて「輪郭までの距離」
//     d_k = | |p − c_k| − R |          （中心から R 離れた輪に、どれだけ近いか）
//   を測り、一番近い円で塗るか決める。中心 c_k はすべて原点まわりに
//   半径 D の円環上に等間隔で置かれているので、同じ大きさ R の円が
//   n 個かぶさり、重なりが花びらになる = ロゼット。
//   ※「角度で折りたたむ」ではなく中心を n 個ループで置くのは、花びらが
//     隣のクサビに食い込んで重なるため。折りたたむと境界で切れてしまう。

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
    label: "geometric-patterns 01 - rosette outline",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const N: i32 = 6;         // 次数: 円を何個リングに並べるか (この数だけ花びらが増える)
      const D: f32 = 0.30;      // 中心リングの半径 (円の中心を原点からどれだけ離すか)
      const R: f32 = 0.30;      // 各円の半径 (D と近いほど中心で深く重なる)
      const THICK: f32 = 0.018; // 輪郭ストロークの太さ (半分)
      const TAU: f32 = 6.2831853;

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // 短辺=1 の正規化座標。中心を原点に、上下反転して数学の向きに揃える
        let res = u.resolution;
        var p = (position.xy - res * 0.5) / min(res.x, res.y);
        p.y = -p.y;

        // 位相 phase = 全体の回転角。固定値なので回らず静止する。
        // 回したいときは u.time を使う: let phase = u.time * 0.15;
        let phase = 0.0;

        // n 個の円の輪郭のうち「一番近い距離」を集める
        var nearest = 1e9;
        for (var k: i32 = 0; k < N; k = k + 1) {
          let theta = TAU * f32(k) / f32(N) + phase;
          let c = D * vec2f(cos(theta), sin(theta));   // 円 k の中心
          let d = abs(length(p - c) - R);              // 輪郭までの距離
          nearest = min(nearest, d);
        }

        // 距離を [0,1] の濃度へ。THICK 以内なら 1、外へ smoothstep で減衰
        let stroke = 1.0 - smoothstep(THICK, THICK + 0.004, nearest);

        let bg   = vec3f(0.85, 0.20, 0.13);  // 赤の背景
        let ink  = vec3f(0.05, 0.05, 0.06);  // 黒のリング
        let col  = mix(bg, ink, stroke);
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rosette pipeline",
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
