// The Book of Shaders — 07 形について: シェイピング関数を組み合わせて穴を開ける
// https://thebookofshaders.com/07/?lan=jp
//
// 極座標の形 (07-polar-shapes) を 2 つ作り、「外側マスク × (1 - 内側マスク)」で
// 内側をくり抜く = 穴を開ける。これで輪っか・雪の結晶・歯車の枠が作れる。
//
//   outer = 外の形のマスク (大きい)
//   inner = 内の形のマスク (小さい = 穴の形)
//   ring  = outer * (1.0 - inner)   … 外にいて かつ 内ではない = 縁のリングだけ残る
//                                       (SDF でいう subtract / AND NOT)
//
// 外と内で違うシェイピング関数 (cos の周期や形) を使うと、複雑な結晶になる。
// 下の例は 6 回対称の雪の結晶風:
//   外: abs(cos(a*3)) ベースの 6 本腕の星
//   内: 小さな六角形っぽい穴
// さらに細い放射スポーク (角度の cos を細く閉じる) を重ねて結晶らしさを足す。
//
// ▼ 用語 (a, r, f の意味 — 忘れがちなので)
//   r = 中心からの距離 (radius)。length(pos)。測られる側。
//   a = 角度 (angle)。atan2(pos.y, pos.x)。中心から見た方角 (-π〜π)。
//   f = その角度での「縁の半径」= 形そのもの。r < f なら図形の中 (polarShape が判定)。
//       cos(a*N) の N が出っ張りの数。fOuter / fInner / fSpoke で外・穴・スポークを作り分け。
//
// ▼ 1 ピクセルの気持ち
//   ・腕の中で穴の外 → outer=1, inner=0 → 1*(1-0)=1 → 結晶の本体 (白)
//   ・中心の穴の中   → outer=1, inner=1 → 1*(1-1)=0 → くり抜かれて黒
//   ・腕と腕の谷     → outer=0          → 0          → 背景

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
    label: "book of shaders 07 - polar shape with holes (snowflake)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 極座標の形マスク: 角度ごとの縁の半径 f より内側 (r<f) なら 1。
      fn polarShape(r: f32, f: f32) -> f32 {
        return 1.0 - smoothstep(f, f + 0.02, r);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution;
        let pos = vec2f(0.5) - st;
        let r = length(pos) * 2.0;
        let a = atan2(pos.y, pos.x);

        // 外側の星 (6 本腕): abs(cos(a*3)) で 6 山、下駄を足して谷も少し残す。
        let fOuter = abs(cos(a * 3.0)) * 0.45 + 0.25;
        let outer  = polarShape(r, fOuter);

        // 内側の穴 (小さい六角形っぽい形)。外と同じ周期で一回り小さく。
        let fInner = abs(cos(a * 3.0)) * 0.18 + 0.18;
        let inner  = polarShape(r, fInner);

        // 細い放射スポーク (12 本): cos を鋭く閉じて細い線にし、本体に重ねる。
        let fSpoke = smoothstep(0.96, 1.0, cos(a * 6.0)) * 0.6 + 0.1;
        let spoke  = polarShape(r, fSpoke);

        // 合成: 外をくり抜き (穴) して、スポークを足す。
        let body = outer * (1.0 - inner);   // 外 AND NOT 内 = リング状の本体
        let mask = clamp(body + spoke, 0.0, 1.0);

        // 配色: 氷の青。背景は濃紺。
        let bg    = vec3f(0.04, 0.06, 0.12);
        let ice   = vec3f(0.75, 0.92, 1.0);
        let color = mix(bg, ice, mask);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "polar hole pipeline",
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