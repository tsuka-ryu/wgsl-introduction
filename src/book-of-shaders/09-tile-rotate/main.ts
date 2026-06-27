// The Book of Shaders — 09 パターン: タイルごとに回転 (tile ∘ rotate)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-tiling の「空間を fract で繰り返す」と、08 の「rotate2d で空間を回す」を合成する。
// 順番が肝:
//
//   st = tile(st, 4.0);          // 1. 4x4=16 マスに畳む。各マスが 0〜1 のローカル座標
//   st = rotate2d(st, PI*0.25);  // 2. その "マス内ローカル座標" を 0.5 中心に 45° 回す
//   color = box(st, ...);        // 3. 回ったローカル座標に四角 → 各マスで四角が傾く
//
// なぜ「全マス同じだけ傾く」か (1 ピクセル p で追う):
//   tile の後、各マスはみな同じ 0〜1 座標系を持つ (fract で番地は消え、中身だけ残る)。
//   rotate2d はその 0〜1 を 0.5 まわりに回すので、どのマスでも同じ回転がかかる。
//   = タイリングで「形を 16 個に複製」してから、回転で「複製を一斉に傾けた」。
//
// 08 で見た合成の発想 (空間に変換を順に効かせる) が、繰り返し空間でもそのまま効く。
// tile → rotate の順なので回転はマス内ローカルに効く。逆順 (先に回して tile) だと
// 画面全体を回してから刻むことになり、結果が変わる (08 の非可換と同じ話)。

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
    label: "book of shaders 09 - rotate each tile",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 空間を zoom 倍に拡大して fract で畳む = zoom x zoom マスのタイリング。
      fn tile(st: vec2f, zoom: f32) -> vec2f {
        return fract(st * zoom);
      }

      // 0.5 中心に angle 回す。中心を原点へ→回転→戻す (08-rotate と同じ)。
      fn rotate2d(st: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (st - vec2f(0.5)) + vec2f(0.5);
      }

      // 中心 0.5 の正方形マスク。size=full width、smoothEdges で縁ぼかし幅。
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
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        st = tile(st, 4.0);            // 1. 4x4=16 マスに畳む (各マス 0〜1)
        st = rotate2d(st, PI * 0.25);  // 2. マス内ローカル座標を 45° 回す

        var color = vec3f(0.0);

        // ▼ どちらか有効に ▼
        color = vec3f(box(st, vec2f(0.7), 0.01)); // 3. 回った座標に四角 → 傾いた四角が16個
        // color = vec3f(st, 0.0);                   // 回った後のローカル座標を可視化
        // ▲ ここまで ▲

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tile-rotate pipeline",
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
