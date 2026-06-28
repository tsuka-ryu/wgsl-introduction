// The Book of Shaders — 10 ランダム: 時間で明滅するマス (固有の位相でまたたく)
// https://thebookofshaders.com/10/?lan=jp
//
// 10-random は連続座標を入れた砂嵐 (隣と無相関)。それをそのまま時間で動かすと毎フレーム
// 総入れ替えのチラチラした砂嵐になって汚い。ここでは "ランダムを空間に固定" して、
// 時間は決定的な sin で回すだけにする。すると各マスが自分のペースで明滅する。
//
// 構造 (denotational):
//   image = twinkle(time) ∘ (random ∘ floor)
//   - floor(st*grid)   … マスの整数番地 ipos (マス内では一定)
//   - random(ipos)     … マス固有の種 r (0〜1)。時間に依らず凍結 → 各マスは不変の個性を持つ
//   - twinkle(time)    … 明るさ = 0.5 + 0.5*sin(time*速度 + r*2π)
//                        位相 r*2π がマスごとにバラバラ → 同時に光らず、散らばって明滅
//
// なぜ滑らかか (1 ピクセル p で):
//   p の属するマスの r は時間によらず一定。動くのは sin(time + 位相) の部分だけなので、
//   そのマスの明るさは滑らかな波で上下する。砂嵐のように毎フレーム値が飛ばない。
//   "乱数は位置で 1 回引いて固定し、動きは連続関数に任せる" がアニメの定石。

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
    label: "book of shaders 10 - random twinkle (anim)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const TAU = 6.28318530718;

      // 擬似乱数ハッシュ (10-random と同じ): 座標 → 0〜1 の決定的な "乱数っぽい" 値。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution; // 0〜1 の画面座標

        let ipos = floor(st * 316.0);   // 316x316 の細かいマス番地 (マス内で一定)
        let r = random(ipos);          // マス固有の種 (時間に依らず凍結)

        // マスごとに位相 (r*TAU) と速度 (種で少し散らす) を変えて明滅。
        let speed = 1.0 + r * 2.0;
        let bri = 0.5 + 0.5 * sin(u.time * speed + r * TAU);

        return vec4f(vec3f(bri), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "random twinkle pipeline",
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
