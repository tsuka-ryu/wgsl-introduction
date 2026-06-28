// The Book of Shaders — 11 ノイズ: 2D value noise の場
// https://thebookofshaders.com/11/?lan=jp
//
// 本のお手本 (Morgan McGuire @morgan3d の noise) をそのまま WGSL に移植したもの。
// やっていることは 1D value noise (11-noise-1d) を xy 両方向に広げただけ:
//
//   value noise = 「整数格子点にだけ置いた乱数を、すきまを smoothstep 補間で埋めた関数」
//
// 1ピクセル st でのトレース:
//   floor(st) … 自分が乗っているマスの左下の格子点が決まる。その4隅 a,b,c,d の乱数を引く。
//                  c ─── d
//                  │     │     a=左下 b=右下 c=左上 d=右上 (それぞれ random)
//                  a ─── b
//   fract(st) … マス内のどこにいるか f=(fx,fy) 0〜1。
//   u = f*f*(3-2f) … f を S 字 (= smoothstep(0,1,f)) に通した混合比。格子をまたぐ角を消す。
//   双線形補間 … 下辺 a→b と上辺 c→d を u.x で混ぜ、その2本を u.y で混ぜる。
//
// 戻り値の式は本のまま、双線形補間を展開した等価形:
//   mix(a,b,u.x) + (c-a)*u.y*(1-u.x) + (d-b)*u.x*u.y
//   ↑ これは mix(mix(a,b,u.x), mix(c,d,u.x), u.y) を整理しただけで結果は同じ。
//
// st*5.0 で座標系を5倍に拡大 = noise の格子マスが画面に5個ぶん並ぶ。これで雲のような濃淡が見える。
// (拡大しないと 1 マスしか映らず、ほぼ単調なグラデーションにしか見えない)

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
    label: "book of shaders 11 - 2d value noise",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 2D Random (10章の random)。格子点の乱数源。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // 2D Noise based on Morgan McGuire @morgan3d
      // https://www.shadertoy.com/view/4dS3Wd
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);

        // マスの4隅の乱数
        let a = random(i);
        let b = random(i + vec2f(1.0, 0.0));
        let c = random(i + vec2f(0.0, 1.0));
        let d = random(i + vec2f(1.0, 1.0));

        // なめらか補間: 3次エルミート曲線 (= smoothstep(0,1,f))
        let u = f * f * (3.0 - 2.0 * f);

        // 4隅を双線形補間 (本の展開形)
        return mix(a, b, u.x) +
               (c - a) * u.y * (1.0 - u.x) +
               (d - b) * u.x * u.y;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 座標系を5倍に拡大して noise を見えるようにする
        let pos = st * 5.0;

        let n = noise(pos);

        return vec4f(vec3f(n), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "2d value noise pipeline",
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
