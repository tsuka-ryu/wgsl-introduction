// The Book of Shaders — 09 パターン: ダイヤモンドタイル
// https://thebookofshaders.com/09/?lan=jp
//
// タイルを「半マスずらした座標」と「45°回した座標」の 2 種類用意し、それぞれに
// 四角を描いて足し引きする。継ぎ目に菱形が浮かぶ模様。部品は今までと同じ:
//
//   ・tile(st, 10)          … 10x10 マスに畳む (各マス 0〜1)
//   ・offset(st)            … 半マスずらす = fract(st + 0.5)。マスの "継ぎ目" を中央に
//   ・rotate2d(st, 45°)     … マス内ローカルを回す → 軸ぞろえの box が菱形に見える
//
// 合成 (3 つの box の足し引き):
//   box(offsetSt, 0.95)        … 継ぎ目中央に大きな四角 (タイルの縁取り枠)
//   - box(st, 0.3)             … 回した座標の中くらいの菱形を "くり抜く" (引き算)
//   + 2 * box(st, 0.2)         … さらに小さい菱形を強めに足す (中心の芯)
//   足し引きで重なりが増減し、白黒の濃淡で菱形の入れ子模様になる。
//
// なぜ offset で菱形位置がずれるか (1 ピクセルで): fract(st+0.5) は各マスの座標を
// 半マスずらす = 4 マスの "角が集まる点" が新しいマスの中央に来る。そこに大きな枠を、
// 元のマス中央に回した菱形を描くので、枠と菱形が互い違いに並ぶ。

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
    label: "book of shaders 09 - diamond tiles",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      fn tile(st: vec2f, zoom: f32) -> vec2f {
        return fract(st * zoom);
      }

      // 半マスずらす。原文の if 分岐 (>0.5 なら -0.5, else +0.5) は fract(st+0.5) と同じ。
      fn offset(st: vec2f) -> vec2f {
        return fract(st + vec2f(0.5));
      }

      fn rotate2d(st: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (st - vec2f(0.5)) + vec2f(0.5);
      }

      fn box(st: vec2f, size: vec2f, smoothEdges: f32) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;
        let aa = vec2f(smoothEdges * 0.5);
        let lower = smoothstep(margin, margin + aa, st);
        let upper = smoothstep(margin, margin + aa, vec2f(1.0) - st);
        let uv = lower * upper;
        return uv.x * uv.y;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        // (キャンバスは正方形なのでアスペクト補正は不要。長方形なら st.x *= res.x/res.y)

        st = tile(st, 10.0);            // 10x10 マスに畳む

        let offsetSt = offset(st);      // 半マスずらした座標 (継ぎ目が中央)
        st = rotate2d(st, PI * 0.25);   // 元の座標を 45° 回す (box → 菱形)

        // 3 つの四角を足し引きして入れ子の菱形に。
        let v = box(offsetSt, vec2f(0.95), 0.01)   // 枠
              - box(st, vec2f(0.3), 0.01)          // 中くらいをくり抜く
              + 2.0 * box(st, vec2f(0.2), 0.01);   // 芯を強調
        let color = vec3f(v);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "diamond tiles pipeline",
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