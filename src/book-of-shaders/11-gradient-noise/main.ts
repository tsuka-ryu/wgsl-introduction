// The Book of Shaders — 11 ノイズ: 勾配ノイズ (gradient noise / Perlin)
// https://thebookofshaders.com/11/?lan=jp
// Gradient Noise by Inigo Quilez - iq/2013  https://www.shadertoy.com/view/XdXGW8
//
// value noise (11-noise-2d) との違いは「格子点に何を置くか」だけ:
//   ・value noise    … 格子点に ランダムな "値" (高さ 0〜1) を置き、それを補間。
//   ・gradient noise … 格子点に ランダムな "勾配" (向きベクトル) を置く。値そのものは置かない。
//
// なぜ gradient の方がなめらかで自然に見えるか:
//   value noise は格子点で値が極大/極小になりやすく、縦横の格子に沿った癖 (ブロック感) が出る。
//   gradient noise は「格子点での値は必ず 0、そこからどっち向きに登る/下るか だけ乱数」。
//   山や谷が格子点とずれた所にできるので、軸に揃った癖が消えて有機的になる。
//
// 1ピクセル st でのトレース (denotational に):
//   各隅 corner について dot( gradient(corner), st - corner )
//     = 「その隅の傾きベクトル」と「隅から自分への変位」の内積
//     = その隅の斜面が、自分の位置までにどれだけ標高を稼ぐかの予測値。
//   隅 (0,0) では変位 f、隅 (1,0) では f-(1,0) … と4隅ぶん予測を出し、
//   それを smoothstep 重み u で双線形補間する。結果は -1〜1 (符号つき)。
//   格子点ちょうどでは変位が 0 ベクトル → 内積 0 → 値 0。これが gradient noise の肝。
//
// random2 は「座標 → 単位円内のランダムな2Dベクトル (-1〜1)」を返すハッシュ。これが各格子点の勾配。

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
    label: "book of shaders 11 - gradient noise",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 格子点 → ランダムな 2D ベクトル (-1〜1)。各格子点の "勾配 (斜面の向き)"。
      // 10章 random の 2出力版: 2本の内積でハッシュし、fract(sin(...)) を -1..1 に伸ばす。
      fn random2(p: vec2f) -> vec2f {
        let st = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(st) * 43758.5453123);
      }

      // Gradient Noise by Inigo Quilez - iq/2013
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);

        let u = f * f * (3.0 - 2.0 * f); // smoothstep 重み (角を丸める)

        // 4隅で dot(勾配, 隅から自分への変位) を出し、双線形補間する。戻り値は -1〜1。
        return mix(
          mix(dot(random2(i + vec2f(0.0, 0.0)), f - vec2f(0.0, 0.0)),
              dot(random2(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0)), u.x),
          mix(dot(random2(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0)),
              dot(random2(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0)), u.x),
          u.y
        );
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        // 縦横比の補正 (本では st.x *= u_resolution.x/u_resolution.y)。
        st.x *= u.resolution.x / u.resolution.y;

        let pos = st * 10.0; // 格子を画面に10マスぶん

        // noise は -1〜1 なので *0.5+0.5 で 0〜1 に直して明るさにする。
        let n = noise(pos) * 0.5 + 0.5;

        return vec4f(vec3f(n), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "gradient noise pipeline",
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
