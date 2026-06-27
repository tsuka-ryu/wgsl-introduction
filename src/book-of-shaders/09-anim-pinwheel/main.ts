// The Book of Shaders — 09 パターン アニメ A: 逆回転する風車タイル (動き + 色)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-tile-rotate の回転角を time にして回し続ける。さらに「マスの番地の偶奇」で
// 回転の向きを反転させ、隣り合うタイルが逆回りする市松模様の風車にする。
// 色は回転の位相 (角度) を色相にマップして虹色に変化させる。
//
//   ・floor(stS) でマスの番地 → 偶奇 (cell.x+cell.y) % 2 で回転方向 ±1
//   ・fract(stS) でマス内ローカル座標 → time で回す
//   ・角度を hue にして hsb2rgb で色付け。形 (box) を明るさ(brightness)に使う

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
    label: "book of shaders 09 anim - counter-rotating pinwheel tiles",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // HSB(色相,彩度,明度) → RGB。06-hsb と同じ定番式。
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

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        let stS = st * 4.0;            // 4x4 マス
        let cell = floor(stS);         // マスの番地
        var f = fract(stS);            // マス内ローカル座標

        // 番地の偶奇で回転方向を反転 (隣どうし逆回り)。
        let idx = i32(cell.x) + i32(cell.y);
        let dir = select(-1.0, 1.0, (idx % 2) == 0);
        let angle = u.time * 1.2 * dir;

        f = rotate2d(f, angle);
        let shape = box(f, vec2f(0.6), 0.03);

        // 角度を色相に。マスごとに少し色をずらして賑やかに。
        let hue = fract(angle / (2.0 * PI) + (cell.x + cell.y) * 0.05);
        let color = hsb2rgb(vec3f(hue, 0.65, shape)); // shape=0 の所は黒

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "pinwheel pipeline",
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