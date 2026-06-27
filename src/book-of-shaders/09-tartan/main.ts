// The Book of Shaders — 09 パターン: オリジナル タータンチェック
// https://thebookofshaders.com/09/?lan=jp
//
// タータンは「異なるパターンのレイヤーを重ねる」典型。4 層を重ねて作る:
//
//   レイヤー1: 縦糸 (warp) の縞   … 色配列 sett を x 方向に並べる
//   レイヤー2: 横糸 (weft) の縞   … 同じ sett を y 方向に並べる
//   レイヤー3: 織り (twill)       … どちらの糸が上に出るかを 2/2 綾織りで切替
//   レイヤー4: 糸の陰影           … 上に出た糸を明るく/下を暗く して織物の立体感
//
// なぜ "チェック" に見えるか (1 ピクセルで):
//   warp は x だけ、weft は y だけで決まる縞。重ねると格子になる。さらに各点で
//   twill マスクが「warp か weft か」を選ぶので、色違いの糸が交差する所は細かく
//   混じり合い、中間色のブロックに見える = タータン特有の "にじんだ格子"。
//
// sett (色と幅の並び) はパレットの心臓。ここでは左右対称な独自配色を定義する。

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
    label: "book of shaders 09 - original tartan plaid",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // sett: 1 リピート (0〜1) の中の "色の帯" を返す。左右対称な独自配色。
      // edges = 各帯の右端 (累積)、cols = その帯の色。t の属する帯の色を返す。
      fn settColor(t: f32) -> vec3f {
        let x = fract(t);
        let green  = vec3f(0.07, 0.30, 0.16);
        let black  = vec3f(0.03, 0.03, 0.04);
        let red    = vec3f(0.62, 0.10, 0.12);
        let navy   = vec3f(0.10, 0.16, 0.40);
        let yellow = vec3f(0.90, 0.78, 0.28);

        var edges = array<f32, 9>(0.25, 0.29, 0.34, 0.48, 0.52, 0.66, 0.71, 0.75, 1.0);
        var cols  = array<vec3f, 9>(green, black, red, navy, yellow, navy, red, black, green);

        for (var i = 0; i < 9; i = i + 1) {
          if (x < edges[i]) { return cols[i]; }
        }
        return green;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        let repeats = 3.0; // 画面に sett を 3 回くり返す

        // レイヤー1 & 2: 同じ sett を x と y に並べる (縦糸・横糸の縞)。
        let warp = settColor(st.x * repeats); // 縦糸: x だけで決まる
        let weft = settColor(st.y * repeats); // 横糸: y だけで決まる

        // レイヤー3: 2/2 綾織り。糸の格子を作り、対角の位相でどちらが上かを切替。
        let threads = 90.0;
        let cx = i32(floor(st.x * threads));
        let cy = i32(floor(st.y * threads));
        let d = cx - cy;
        let phase = ((d % 4) + 4) % 4;       // 0..3 (対角に進む)
        let warpOnTop = phase < 2;           // 2 本上→2 本下 の綾織り

        var color = select(weft, warp, warpOnTop); // 上に出た糸の色

        // レイヤー4: 織りの陰影。上の糸を明るく、下を少し暗くして立体感。
        color = color * select(0.82, 1.0, warpOnTop);

        // 仕上げ: 糸の隙間にうっすら影を入れて織物らしく。
        let g = fract(st * threads);
        let groove = smoothstep(0.0, 0.5, g.x) * smoothstep(1.0, 0.5, g.x)
                   * smoothstep(0.0, 0.5, g.y) * smoothstep(1.0, 0.5, g.y);
        color = color * (0.88 + 0.12 * groove);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tartan pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4;
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