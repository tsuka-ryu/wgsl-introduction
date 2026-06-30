// The Book of Shaders — 12 セルラーノイズ: F2−F1 (ひび割れ / accumulator を組に)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015 / 改変)
//
// 12-cellular-noise との違いは accumulator (畳み込みの持ち物) の "型" を広げた所だけ。
//   min版:   m_dist                 … スカラー1個 = 最短距離だけ (これを F1 と呼ぶ)。
//   F2版:    (f1, f2)               … スカラー2個 = 最短 F1 と 2番目に近い F2 を同時に保つ。
// 更新規則も「min」から「上位2件を保つ挿入」に変わる:
//   dist < f1 なら  f2 ← f1, f1 ← dist   (新王者。前の王者は2位へ繰り下げ)
//   else dist < f2 なら f2 ← dist        (2位だけ更新)
//
// 何が見えるか: F2 - F1 は「最寄りと次点が同じくらい近い所」= ちょうど2セルの境界線で 0 に近づき、
// セルの内側 (中心に近い) ほど大きくなる。だから F2-F1 を明るさにすると、セルの "ひび割れ/壁"
// が暗い線で浮かぶ結晶質の模様になる。F1 単体 (12-cellular-noise) の丸い窪みとは別物。
//
// ★「型を1個→2個に広げると新しい模様が解禁される」の最小例。F3 まで持てばまた別の柄。
//
// uniform は resolution と time の 2 つ。

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
    label: "book of shaders 12 - F2 minus F1",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      fn random2(p: vec2f) -> vec2f {
        return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)),
                               dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st.x *= u.resolution.x / u.resolution.y;

        st *= 3.0;
        let i_st = floor(st);
        let f_st = fract(st);

        // ★ スカラー1個でなく、最短 f1 と次点 f2 の "組" を保つ。
        var f1 = 1.0;
        var f2 = 1.0;
        for (var y = -1; y <= 1; y = y + 1) {
          for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));
            var point = random2(i_st + neighbor);
            point = 0.5 + 0.5 * sin(u.time + 6.2831 * point);
            let diff = neighbor + point - f_st;
            let dist = length(diff);

            // ★ min の代わりに「上位2件を保つ挿入」。
            if (dist < f1) {
              f2 = f1;        // 前の王者は2位へ繰り下げ
              f1 = dist;      // 新しい最短
            } else if (dist < f2) {
              f2 = dist;      // 2位だけ更新
            }
          }
        }

        // F2 - F1: 境界で 0 (暗い線=ひび割れ)、セル内側で大きい (明るい)。
        var color = vec3f(f2 - f1);
        color.r += step(0.98, f_st.x) + step(0.98, f_st.y);

        // ↓コメントを外すと F1(min版)・F2 そのものも見比べられる:
        // color = vec3f(f1);   // = 12-cellular-noise と同じ丸い窪み
        // color = vec3f(f2);   // 次点までの距離の場

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "F2-F1 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4;
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
