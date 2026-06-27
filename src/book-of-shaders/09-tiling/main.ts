// The Book of Shaders — 09 パターン: fract でタイリング (空間を繰り返す)
// https://thebookofshaders.com/09/?lan=jp
//
// 08 で「形は 0〜1 のローカル座標を受け取って、そこに描かれる関数」と分かった。
// なら座標の方を「0〜1 の繰り返し」にすれば、同じ形が格子状に複製される。
//
//   st = st * 3.0;   // 空間を 3 倍に拡大 (座標が 0〜3 になる)
//   st = fract(st);  // 小数部だけ残す → 各マスがまた 0〜1 に戻る
//
// なぜタイルになるか (1 ピクセル p で追う):
//   fract(x) = x - floor(x) は「整数部を捨てて 0〜1 を繰り返すノコギリ波」。
//   p の座標が 1.7 なら fract で 0.7、2.3 なら 0.3。つまり 3x3=9 個のマスが
//   それぞれ独立に 0〜1 の座標系を持つ。形の関数 circle(st) はその "マスの中の
//   座標" を読むので、9 マスすべてに同じ円が描かれる。
//   = タイリングは「座標を fract で畳む」だけ。形側は何も変えなくていい。

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
    label: "book of shaders 09 - tiling with fract",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 円: 中心 0.5 からの距離の2乗を smoothstep で 2 値化 (07-circle-dot と同じ)。
      // dot(l,l)*4.0 で半径を 0〜1 スケールに合わせる。
      fn circle(st: vec2f, radius: f32) -> f32 {
        let l = st - vec2f(0.5);
        return 1.0 - smoothstep(radius - radius * 0.01,
                                radius + radius * 0.01,
                                dot(l, l) * 4.0);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        st = st * 3.0;    // 空間を 3 倍に拡大 (座標が 0〜3 に)
        st = fract(st);   // 小数部だけ → 3x3=9 マスがそれぞれ 0〜1 を持つ

        var color = vec3f(0.0);

        // ▼ どちらか有効に ▼
        // color = vec3f(st, 0.0);          // 各マスのローカル座標を色で可視化 (R=x/G=y)
        color = vec3f(circle(st, 0.5)); // 各マスに同じ円を描く → タイル状に複製
        // ▲ ここまで ▲

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tiling pipeline",
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
