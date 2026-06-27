// The Book of Shaders — 07 形について: 極座標の形 (Polar shapes)
// https://thebookofshaders.com/07/?lan=jp
//
// これまでの円は「中心からの距離 r がしきい値より小さければ中」だった。
// しきい値を定数でなく「角度 a で変化させる」と、輪郭が角度ごとに伸び縮みして
// 花・星・歯車みたいな形になる。これが極座標で形を作るやり方。
//
// ▼ 用語 (a, r, f の意味 — 忘れがちなので)
//   r = 中心からの距離 (radius)。length(pos)。測られる側。
//   a = 角度 (angle)。atan2(pos.y, pos.x)。中心から見た方角 (-π〜π)。
//   f = その角度での「縁の半径」= 形そのもの。r < f なら図形の中。
//       cos(a*N) の N が花びらの数。f を差し替える = 形を差し替える (draw は共通)。
//
// ▼ 下ごしらえ (デカルト座標 → 極座標)
//   pos = 中心(0.5) - st        … 中心からこのピクセルへのベクトル
//   r   = length(pos) * 2.0     … 中心からの距離 (×2 で縁を 1 付近に)
//   a   = atan2(pos.y, pos.x)   … 角度 (-π〜π)。06 のカラーホイールと同じ atan2
//
// ▼ しきい半径 f を角度 a の関数にする (ここが主役。1 行だけ有効に)
//   f = cos(a*3.0)        … cos(角度×N)。N 個の出っ張り。cos が負の所は描かれない → 3 枚花
//   f = abs(cos(a*3.0))   … abs で負を折り返す → 出っ張りが 6 枚に (花びら倍増)
//   f = abs(cos(a*2.5))*.5+.3      … 非整数倍&スケール → ねじれた非対称の花
//   f = abs(cos(a*12.)*sin(a*3.))*.8+.1 … 2 波の積 → 細かいギザギザの歯車/星
//   f = smoothstep(-.5,1.,cos(a*10.))*.2+.5 … なめらかな波打ち → 丸い 10 角の歯車
//
// ▼ 形にする
//   1.0 - smoothstep(f, f+0.02, r)
//     r < f なら 1 (内側=白)、r > f なら 0 (外側=黒)。f が「角度ごとの縁の半径」。
//     ※ f が負の角度では r(正)が必ず上回るので描かれない (花びらの隙間)。
//
// ▼ 1 ピクセルを追ってみる (a=0 方向, f = cos(a*3))
//   a=0     → f = cos(0)   = 1   → r<1 まで白 (この向きは長く伸びる = 花びらの先)
//   a=π/3   → f = cos(π)   = -1  → 負 → 描かれない (花びらの谷)
//   a=2π/3  → f = cos(2π)  = 1   → また白 (次の花びら) … 3 回対称の花

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
    label: "book of shaders 07 - polar shapes",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution;

        // デカルト → 極座標。
        let pos = vec2f(0.5) - st;          // 中心からこのピクセルへのベクトル
        let r = length(pos) * 2.0;          // 距離 (×2 で縁を 1 付近に)
        let a = atan2(pos.y, pos.x);        // 角度 (-π〜π)

        // ▼ しきい半径 f を角度の関数に: 1 行だけ有効に ▼
        let f = cos(a * 3.0);                                  // 3 枚花
        // let f = abs(cos(a * 3.0));                          // 6 枚花
        // let f = abs(cos(a * 2.5)) * 0.5 + 0.3;              // ねじれた花
        // let f = abs(cos(a * 12.0) * sin(a * 3.0)) * 0.8 + 0.1; // ギザギザの歯車
        // let f = smoothstep(-0.5, 1.0, cos(a * 10.0)) * 0.2 + 0.5; // 丸い 10 角歯車
        // ▲ ここまで ▲

        // r < f を白に (f = 角度ごとの縁の半径)。
        let color = vec3f(1.0 - smoothstep(f, f + 0.02, r));
        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "polar shapes pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 2 * 4; // 8 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);

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
    uniformValues.set([canvas.width, canvas.height], 0);
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
    render(device);
  });
  observer.observe(canvas);
}

main();
