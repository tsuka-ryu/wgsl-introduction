// The Book of Shaders — 09 パターン: レンガ積み (1 行おきに半マスずらす)
// https://thebookofshaders.com/09/?lan=jp
//
// 直前の 09-tiling は「st を拡大して fract で畳む」だけの "整列したタイル"。
// レンガ塀はそれを崩す: 奇数段だけ横に半マスずらす。これがパターンを "ずらす" の核。
//
// ずらしの式 (これ 1 行がレンガの正体):
//   st.x += step(1.0, mod(st.y, 2.0)) * 0.5;
//
// なぜレンガになるか (1 ピクセル p で追う):
//   拡大後の座標 st は「何段目・何列目か」を整数部に、「マス内の位置」を小数部に持つ。
//   - mod(st.y, 2.0) は段番号を 2 で畳む → 偶数段で [0,1)、奇数段で [1,2)。
//   - step(1.0, それ) は 1 未満で 0、1 以上で 1 → 偶数段=0、奇数段=1 を返す "段の偶奇"。
//   - ×0.5 して st.x に足す → 奇数段だけ x が 0.5 ずれる。
//   最後に fract(st) で各マスをまた 0〜1 に畳むと、偶数段と奇数段で目地が半マスずれる
//   = レンガ積み。形 (box) 側は 0〜1 のローカル座標を読むだけで何も変えていない。
//
// ポイント: "ずらし" は座標 st を fract で畳む前に手を入れるだけ。畳んだ後の世界
// (マス内ローカル) は無傷なので、box はどのマスでも同じ顔で並ぶ。

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
    label: "book of shaders 09 - brick tiling",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // GLSL の mod(x, y) = x - y*floor(x/y) (常に [0,y) の正の余り)。
      // WGSL の % は負になりうるので、段の偶奇判定はこの正の mod で行う。
      fn modf2(x: f32, y: f32) -> f32 {
        return x - y * floor(x / y);
      }

      // レンガのタイル化: 拡大 → 奇数段だけ x を半マスずらす → fract で 0〜1 に畳む。
      fn brickTile(stIn: vec2f, zoom: f32) -> vec2f {
        var st = stIn * zoom;
        // ここがずらしの 1 行。偶数段=0 / 奇数段=1 を x に 0.5 倍して足す。
        st.x += step(1.0, modf2(st.y, 2.0)) * 0.5;
        return fract(st);
      }

      // 四角: 中心に size×size の塗り。smoothstep を両側から掛けて縁をわずかにぼかす。
      // size を 1.0 に近づけるほど目地 (隙間) が細くなる。
      fn box(st: vec2f, size: vec2f) -> f32 {
        let s = vec2f(0.5) - size * 0.5;
        var uv = smoothstep(s, s + vec2f(1e-4), st);
        uv *= smoothstep(s, s + vec2f(1e-4), vec2f(1.0) - st);
        return uv.x * uv.y;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        // レンガ塀の比率に寄せたいなら横長マスに (任意): st /= vec2f(2.15, 0.65) / 1.5;

        st = brickTile(st, 5.0); // 5x5 に畳み、奇数段を半マスずらす

        var color = vec3f(0.0);

        // ▼ どちらか有効に ▼
        // color = vec3f(st, 0.0);        // 各マスのローカル座標を可視化 (ずれが見える)
        color = vec3f(box(st, vec2f(0.9))); // ずれたマスに同じ四角 → レンガ積み
        // ▲ ここまで ▲

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "brick pipeline",
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
