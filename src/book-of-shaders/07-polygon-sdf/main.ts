// The Book of Shaders — 07 形について: 正N角形の距離フィールド (角度を floor で畳む)
// https://thebookofshaders.com/07/?lan=jp   (参考: http://thndl.com/square-shaped-shaders.html)
//
// 花は「cos(a*N) で縁を波打たせる」やり方だった。正多角形はもっと幾何学的:
//   「角度を N 等分のくさびに畳んで、1 本の辺までの距離を測る」。
//   前に話した『角度を mod で N 等分に折りたたむ』の floor 版がこれ。
//
// ▼ 用語 (a, r, d)
//   a = atan2(st.x, st.y) + PI   … 角度 0〜2π (atan の引数を x,y の順にして向きを調整)
//   r = TWO_PI / N               … くさび 1 枚の角度幅 (N 角形なら 2π/N)
//   d = 多角形の距離フィールド (中心 0、辺で大きくなる)
//
// ▼ 肝の 1 行
//   d = cos( floor(0.5 + a/r) * r - a ) * length(st)
//     ① a/r           … 角度が「何番目のくさび」か (小数)
//     ② floor(0.5+…)  … 四捨五入 → 一番近いくさびの中心番号
//     ③ ×r            … その中心の角度に戻す = 最寄りの「辺の正面方向」
//     ④ - a           … 自分の角度との差 (辺の正面からどれだけズレてるか)
//     ⑤ cos(…)*length … その差の cos × 距離 = 辺の面までの最短距離 (点と直線の距離)
//   → どの方向でも「一番近い辺までの距離」になり、等高線が N 角形になる。
//
// ▼ 出力
//   1.0 - smoothstep(0.4, 0.41, d)  … d<0.4 を白 = 一辺 0.4 の正 N 角形 (塗り)
//   color = vec3f(d)                … 距離フィールドそのものを可視化 (コメント切替)
//
// N を変えると角の数が変わる: 3=三角, 4=四角, 5=五角, 6=六角 …

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
    label: "book of shaders 07 - regular polygon SDF",
    code: /* wgsl */ `
      const PI = 3.14159265359;
      const TWO_PI = 6.28318530718;

      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;                        // WebGPU は y が下向き → GLSL と同じ上向きに
        st = st * 2.0 - 1.0;                      // 先に -1〜+1 にリマップ (中心を原点に)
        st.x *= u.resolution.x / u.resolution.y; // そのあとアスペクト比補正 (中心はずらさず横だけ伸縮)

        // 角の数。3=三角, 4=四角, 5=五角, 6=六角 …
        let N = 3.0;

        // 角度と、くさび 1 枚の角度幅。
        let a = atan2(st.x, st.y) + PI;   // 0〜2π
        let r = TWO_PI / N;               // 2π/N

        // 角度を最寄りのくさび中心に丸め、その辺までの最短距離を測る。
        let d = cos(floor(0.5 + a / r) * r - a) * length(st);

        // d < 0.4 を白 = 一辺 0.4 の正 N 角形。
        let color = vec3f(1.0 - smoothstep(0.4, 0.41, d));
        // 距離フィールドを見たいときは ↓ に差し替え:
        // let color = vec3f(d);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "polygon sdf pipeline",
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
