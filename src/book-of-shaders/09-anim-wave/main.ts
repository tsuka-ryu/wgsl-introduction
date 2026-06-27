// The Book of Shaders — 09 パターン アニメ B: 斜めに伝わるサイズの波 (形 + 動き)
// https://thebookofshaders.com/09/?lan=jp
//
// 各タイルの四角の "大きさ" を time で脈動させる。ただし全マス同時ではなく、
// マスの番地に応じて位相をずらす → 拡大縮小が画面を斜めに伝わる「さざ波」になる。
//
//   phase = time*speed - (cell.x + cell.y) * spread
//   size  = base + amp * sin(phase)      // マスごとに膨らむタイミングがずれる
//
// なぜ斜めに進むか (1 ピクセルで): cell.x+cell.y が等しいマス (左上→右下の対角線)
// は同じ位相で同時に膨らむ。対角線が1段ずれると位相が spread だけ遅れる。
// → 膨張の山が対角線に沿って次々と移動 = 斜めの波。色は大きさに連動させる。

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
    label: "book of shaders 09 anim - diagonal wave of tile sizes",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      fn box(st: vec2f, size: vec2f, smoothEdges: f32) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;
        let aa = vec2f(smoothEdges * 0.5);
        let lower = smoothstep(margin, margin + aa, st);
        let upper = smoothstep(margin, margin + aa, vec2f(1.0) - st);
        let uv = lower * upper;
        return uv.x * uv.y;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        let stS = st * 6.0;            // 6x6 マス
        let cell = floor(stS);         // マスの番地
        let f = fract(stS);            // マス内ローカル座標

        // 位相を番地でずらす → 斜めに伝わる波。
        let phase = u.time * 2.0 - (cell.x + cell.y) * 0.7;
        let size = 0.15 + 0.55 * (0.5 + 0.5 * sin(phase)); // 0.15〜0.7 で脈動

        let shape = box(f, vec2f(size), 0.02);

        // 色も大きさに連動 (小=濃い藍 → 大=明るいシアン)。
        let small = vec3f(0.10, 0.12, 0.35);
        let big   = vec3f(0.40, 0.95, 0.95);
        let tone  = (size - 0.15) / 0.55;          // 0〜1 に正規化
        let color = mix(vec3f(0.03, 0.03, 0.06), mix(small, big, tone), shape);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "wave pipeline",
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
