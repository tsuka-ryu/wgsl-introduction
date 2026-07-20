// 幾何学パターン — 06 シェブロン (平面の映進): 三角波でジグザグに折る
// 参考: 幾何学パターンの本 3.2「平面対称・映進」
//
// ── 映進 = 並進してから鏡映。シェブロン(矢羽)がその典型 ────
//   上り坂の帯と下り坂の帯は、互いに鏡像を横にずらしたもの = 映進。
//   目がザワつく(図地反転・斜めグルーピング)のは平面映進の性質そのもの。
//
// ── 全体を関数合成で読む ──────────────────────────────────
//   色(p) = 帯の色(帯番号)
//   帯番号 = floor( y + ジグザグ(x) )               … 横方向に折れた縞
//   ジグザグ(x) = 三角波(x) · 振幅                    … 上り下りを交互に繰り返す鏡映
//   帯の色 = 帯番号 を4色巡回                          … 時間に依らない座標の純関数
//
// ── 1ピクセルのトレース ──────────────────────────────────
//   ピクセルの x から三角波で上下オフセットを作り、y に足す。折れた y を
//   floor して何番目の帯か決め、その帯の色で塗る。三角波の山と谷で縞が V 字に
//   折れ、上り区間と下り区間が鏡像ペア = 映進のシェブロンになる。

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
    label: "geometric-patterns 06 - chevron glide",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const SCALE: f32 = 11.0;   // 画面短辺あたりの帯の数めやす
      const PERIOD: f32 = 2.0;   // ジグザグ1往復の横幅 (小さいほど細かい矢羽)
      const AMP: f32 = 1.0;      // 折れの振幅 (帯の傾き。1 で約45°)

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let res = u.resolution;
        let st = position.xy / min(res.x, res.y) * SCALE;

        // 三角波: 0→1→0 を PERIOD ごとに繰り返す (上り区間と下り区間が鏡像=映進)
        let tri = abs(fract(st.x / PERIOD) - 0.5) * 2.0;
        let yy = st.y + tri * AMP;      // y をジグザグに折る

        // 折れた y を floor → 何番目の帯か。4色を巡回
        let band = i32(floor(yy));
        let k = ((band % 4) + 4) % 4;

        let red    = vec3f(0.85, 0.22, 0.16);
        let blue   = vec3f(0.13, 0.34, 0.55);
        let purple = vec3f(0.48, 0.45, 0.72);
        let gray   = vec3f(0.86, 0.86, 0.83);

        var col = red;
        if (k == 1) { col = blue; }
        if (k == 2) { col = purple; }
        if (k == 3) { col = gray; }
        return vec4f(col, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "chevron pipeline",
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
