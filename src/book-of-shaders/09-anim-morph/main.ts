// The Book of Shaders — 09 パターン アニメ C: 四角⇄円モーフ + 回転 + 虹 (色+形+動き)
// https://thebookofshaders.com/09/?lan=jp
//
// 3 つの変化を 1 枚に重ねる:
//   ・形: box と circle の 2 つのマスクを mix(b, c, t) で連続変形 (t を sin で往復)
//   ・動き: マス内ローカル座標を time で回転
//   ・色: hsb の色相を time + 番地でスクロール → タイルごとに位相のずれた虹
//
// マスの番地 (cell) を位相オフセットに使うのが共通テク。これで全マスが同時でなく
// 少しずつずれて変化し、波打つように見える。形は「2 つの形の補間」= 形も mix できる。

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
    label: "book of shaders 09 anim - morph square<->circle with rainbow",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      fn hsb2rgb(c: vec3f) -> vec3f {
        let rgb = clamp(
          abs(((c.x * 6.0 + vec3f(0.0, 4.0, 2.0)) % 6.0) - 3.0) - 1.0,
          vec3f(0.0), vec3f(1.0));
        return c.z * mix(vec3f(1.0), rgb, c.y);
      }

      fn rotate2d(st: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (st - vec2f(0.5)) + vec2f(0.5);
      }

      fn box(st: vec2f, size: vec2f, smoothEdges: f32) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;
        let aa = vec2f(smoothEdges * 0.5);
        let lower = smoothstep(margin, margin + aa, st);
        let upper = smoothstep(margin, margin + aa, vec2f(1.0) - st);
        let uv = lower * upper;
        return uv.x * uv.y;
      }

      // 中心 0.5 の塗りつぶし円。radius は full diameter 換算 (box の size とそろえる)。
      fn circle(st: vec2f, radius: f32) -> f32 {
        let d = distance(st, vec2f(0.5));
        return 1.0 - smoothstep(radius * 0.5 - 0.01, radius * 0.5 + 0.01, d);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        let stS = st * 5.0;            // 5x5 マス
        let cell = floor(stS);         // マスの番地
        var f = fract(stS);            // マス内ローカル座標

        // 番地を位相オフセットに → 変化がタイルごとにずれて波打つ。
        let ph = u.time + (cell.x - cell.y) * 0.5;

        // 動き: ローカル座標を回す。
        f = rotate2d(f, ph * 0.6);

        // 形: box と circle を補間。t を 0〜1 で往復させ四角⇄円。
        let b = box(f, vec2f(0.7), 0.03);
        let c = circle(f, 0.7);
        let t = 0.5 + 0.5 * sin(ph);
        let shape = mix(b, c, t);

        // 色: 色相を time + 番地でスクロール。
        let hue = fract(u.time * 0.08 + (cell.x + cell.y) * 0.08);
        let color = hsb2rgb(vec3f(hue, 0.6, shape)); // shape=0 → 黒

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "morph pipeline",
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