// The Book of Shaders — 12 セルラーノイズ: 点を円軌道で動かす (animation 別解)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015 / 改変)
//
// 12-cellular-noise と本体は同じ。違うのは「点の動かし方」1 か所だけ。
// もとは point = 0.5 + 0.5*sin(t + 2π·p) で、x と y を独立に振動させていた (リサジュー図形を
// 描く動き)。ここでは各点を「セル中心のまわりの円軌道」で回す。x,y を 1 つの角度 θ=t+φ で
// 連動させると cos/sin が円になる。位相 φ と半径 r をセル乱数からもらうと、点ごとに出発位置と
// 軌道の大きさが変わる。動きの質感: sin版=各点が小さな8の字/楕円、orbit版=定速のかっちりした回転。
//
// ★ 動かす点が必ずセル内 [0,1]² に収まるよう r ≤ 0.45 に制限 (中心0.5 ± 0.45 = [0.05,0.95])。
//   これを破ると「最短点は 3×3 のどれか」という保証が崩れ、境界に裂け目が出る。
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
    label: "book of shaders 12 - cellular noise (orbit animation)",
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

        var color = vec3f(0.0);

        st *= 3.0;
        let i_st = floor(st);
        let f_st = fract(st);

        var m_dist = 1.0;
        for (var y = -1; y <= 1; y = y + 1) {
          for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));
            let rnd = random2(i_st + neighbor);    // セル固有の乱数 (出発角と半径の種)

            // ★ ここが唯一の違い: sin の独立振動でなく、セル中心まわりの円軌道。
            let phase  = 6.2831 * rnd.x;           // 出発角度をセルごとにずらす
            let radius = 0.2 + 0.25 * rnd.y;       // 半径もセルごと (最大 0.45 → セル内に収まる)
            let point  = vec2f(0.5) + radius * vec2f(cos(u.time + phase), sin(u.time + phase));

            let diff = neighbor + point - f_st;
            m_dist = min(m_dist, length(diff));
          }
        }

        color += vec3f(m_dist);
        color += vec3f(1.0 - step(0.02, m_dist));
        color.r += step(0.98, f_st.x) + step(0.98, f_st.y);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "cellular orbit pipeline",
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
