// 幾何学パターン — 06 タンブリングブロック: 菱形格子×3色で立方体の錯覚
// 参考: 幾何学パターンの本 3.3「二重鏡映」フルページ (寄木/キルトの定番柄)
//
// ── 形ではなく「3色シェーディング」が立体を作る ────────────
//   同じ菱形を3枚、明・中・暗の3色で並べると、脳が「光の当たった箱」と解釈して
//   立方体が積み上がって見える。菱形格子 (rhombille tiling) = 六角形を中心から
//   3枚の菱形に割ったもの。前バージョン(三角波チェブロン)は二重鏡映ではあったが
//   平ら2色で立体にならなかったので、こちらへ修正。
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = 面の色(菱形の向き)
//   菱形の向き = 最寄り六角の中心から見た角度を 120°ごとに3分割
//   最寄り六角 = 六角タイリング (2つの候補中心の近い方)
//   面の色 = 上面/左面/右面 の3色。時間に依らない座標の純関数。
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   p が属する六角セルの中心を求め、中心からの角度を測る。角度を 120°ずつ
//   3つの菱形(=立方体の3面)に振り分け、面ごとの色で塗る。六角がびっしり
//   並ぶことで、3面セットの立方体が空間充填して見える。

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
    label: "geometric-patterns 06 - tumbling blocks",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 5.0;        // 画面短辺あたりの六角(立方体)の数めやす
      const TAU: f32 = 6.2831853;
      // 3色の境界を回して、菱形の割れ目を六角の頂点に合わせる調整 (立方体に見えないとき触る)
      const ANGLE_OFF: f32 = 1.5707963;  // = π/2 (頂点が上の pointy-top 六角に合わせる)

      // 六角タイリング: p の最寄り六角中心からの局所座標 (.xy) と中心id (.zw)
      // (Shane の getHex、pointy-top。s=(1,√3))
      fn getHex(p: vec2f) -> vec4f {
        let s = vec2f(1.0, 1.7320508);
        let hC = floor(vec4f(p, p - vec2f(0.5, 1.0)) / vec4f(s, s)) + 0.5;
        let a = p - hC.xy * s;
        let b = p - (hC.zw + 0.5) * s;
        if (dot(a, a) < dot(b, b)) {
          return vec4f(a, hC.xy);
        }
        return vec4f(b, hC.zw + 0.5);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let st = position.xy / min(res.x, res.y) * SCALE;

        let hex = getHex(st);
        let local = hex.xy;                        // 六角中心からの位置

        // 中心からの角度を 120°ずつ3分割 = 3枚の菱形(立方体の3面)
        let ang = atan2(local.y, local.x);
        let sector = ((i32(floor((ang - ANGLE_OFF) / (TAU / 3.0))) % 3) + 3) % 3;

        // 上面=明, 左面=中, 右面=暗 で立体に見せる (色は本の赤/青/紫寄り)
        let topFace   = vec3f(0.86, 0.86, 0.83);  // 明 (上面)
        let leftFace  = vec3f(0.13, 0.34, 0.55);  // 中 (青)
        let rightFace = vec3f(0.85, 0.22, 0.16);  // 暗め (赤)

        var col = topFace;
        if (sector == 1) { col = leftFace; }
        if (sector == 2) { col = rightFace; }
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tumbling blocks pipeline",
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
