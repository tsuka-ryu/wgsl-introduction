// The Book of Shaders — 07 形について: 極座標の花をアニメーション
// https://thebookofshaders.com/07/?lan=jp
//
// 07-polar-shapes の花を u_time で動かす。極座標なので動かし方が直感的:
//   ・回転   … 角度 a に time を足す (a + time) → 図形がくるくる回る
//   ・脈動   … しきい半径 f に sin(time) を掛ける → 花が開いたり閉じたり
//   ・色変化 … 時間で色相を回す
// 形 (cos(a*N) の花) は固定。動かすのは a と f のスケールだけ。
//
// ▼ 用語 (a, r, f の意味 — 忘れがちなので)
//   r = 中心からの距離 (radius)。length(pos)。測られる側。
//   a = 角度 (angle)。atan2(pos.y, pos.x)。中心から見た方角。ここでは +time で回転。
//   f = その角度での「縁の半径」= 形そのもの。r < f なら図形の中。
//       cos(a*N) の N が花びらの数。f を差し替える = 形を差し替える。
//
// ▼ 1 ピクセルの気持ち
//   ある向き a のピクセルは、毎フレーム f = (脈動)*cos((a+回転)*N) が変わる。
//   → 自分が「花びらの中か外か」がフレームごとに変わる = 回って咲く。

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
    label: "book of shaders 07 - animated polar flower",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 落ち着いた暖色パレット (07-fields-combine と同じ手法)。
      fn palette(v: f32) -> vec3f {
        let cream = vec3f(0.99, 0.91, 0.78);
        let peach = vec3f(0.98, 0.62, 0.45);
        let rose  = vec3f(0.86, 0.30, 0.45);
        let t = abs(v - 0.5) * 2.0;
        return mix(mix(cream, peach, smoothstep(0.0, 0.5, t)),
                   rose, smoothstep(0.5, 1.0, t));
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution;
        let pos = vec2f(0.5) - st;
        let r = length(pos) * 2.0;

        // 角度に time を足す = 花が回転する。
        let a = atan2(pos.y, pos.x) + u.time * 0.5;

        // 花びらの数。
        let petals = 5.0;
        // 脈動: 全体スケールを sin で開閉 (0.45〜0.65 を往復)。
        let pulse = 0.55 + 0.1 * sin(u.time * 2.0);
        // 角度ごとの縁の半径。cos(a*N) で N 枚花、谷 (負) は隙間になる。
        let f = cos(a * petals) * pulse;

        // r < f を「花の中」とするマスク (縁は smoothstep でなめらか)。
        let mask = 1.0 - smoothstep(f, f + 0.02, r);

        // 配色: 中心(r=0)を明るく外を濃く + 背景は暗い。色は時間でゆっくり変化。
        let bg = vec3f(0.05, 0.04, 0.08);
        let petalColor = palette(r * 1.2 + u.time * 0.1);
        let color = mix(bg, petalColor, mask);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "polar anim pipeline",
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
