// The Book of Shaders — 07 形について: dot() で円 (距離の2乗・sqrt なし)
// https://thebookofshaders.com/07/?lan=jp
//
// これまでの circle() は distance()/length() を使った。中身は sqrt(x*x+y*y) で、
// sqrt は地味に重い。実は円の内外判定に sqrt は要らない:
//
//   dot(dist, dist) = dist.x*dist.x + dist.y*dist.y = 距離の2乗 (sqrt の中身そのもの)
//
// 「距離 < 半径」と「距離の2乗 < 半径の2乗」は同じ判定なので、sqrt を省ける。
// 本家はこれを使い、しきい値も 2 乗側の世界で比べている。
//
//   float circle(_st, _radius){
//     vec2 dist = _st - vec2(0.5);
//     return 1.0 - smoothstep(_radius - _radius*0.01,
//                             _radius + _radius*0.01,
//                             dot(dist, dist) * 4.0);
//   }
//
// ・dot(dist,dist)*4.0: 距離の2乗を ×4。中心=0、画面の端(中点 dist=0.5)で 0.25*4=1.0、
//   四隅(dist=(0.5,0.5))で 0.5*4=2.0。これで「0〜1 くらい」のスケールに正規化される。
// ・blur = _radius*0.01: ぼかし幅を半径の 1% にし、円の大小に比例させる (常に同じ見え方)。
// ・1.0 - smoothstep(...): 反転して中を白に。
//   ※ _radius は「2乗側のしきい値」なので、見た目の半径とは一致しない (0.9 でほぼ全面)。
//
// ▼ 1 ピクセルを追ってみる (radius = 0.9)
//   ・中心   st=(0.5,0.5): dist=(0,0) → dot*4=0    → smoothstep(.., 0)=0   → 1-0=1 → 白
//   ・端中点 st=(1.0,0.5): dist=(0.5,0)→ dot*4=1.0  → 0.9 を超える → 1     → 1-1=0 → 黒
//   ・しきい上 dot*4=0.9 のリングが円周。radius=0.9 だと円周は端(1.0)の少し内側。

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
    label: "book of shaders 07 - circle via dot()",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 円のマスク。距離の2乗 (dot) で判定するので sqrt が要らない。
      //   radius は「2乗×4 の世界」でのしきい値 (見た目の半径とは別物)。
      fn circle(st: vec2f, radius: f32) -> f32 {
        let dist = st - vec2f(0.5);
        return 1.0 - smoothstep(
          radius - radius * 0.01,
          radius + radius * 0.01,
          dot(dist, dist) * 4.0
        );
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution;

        let color = vec3f(circle(st, 0.9));
        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "circle dot pipeline",
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
