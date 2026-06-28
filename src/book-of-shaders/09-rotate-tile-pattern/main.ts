// The Book of Shaders — 09 パターン: マスの番地で回転を変える (2x2 で向きを散らす)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-tile-rotate は「全マスを同じ角度で回す」だった。今度はマスの "番地" を見て
// マスごとに違う角度で回す。2x2 の塊に 0〜3 の番号を振り、その番号で回転を選ぶ。
// 同じ三角形でも向きが散らばり、組み合わさって大きな模様が立ち上がる。
//
// 番地 (index) の作り方 (これが肝):
//   st *= 2 で 1 マスを 2x2 に割る。x の整数部の偶奇 (0/1)、y の整数部の偶奇 (0/2) を
//   足すと、4 つの小マスに 0,1,2,3 の通し番号がつく:
//       2 | 3
//       --+--
//       0 | 1
//   index = step(1, mod(x,2)) + step(1, mod(y,2))*2
//
// なぜ番地ごとに向きが変わるか (1 ピクセル p で追う):
//   右上の小マス (x も y も奇数側) は index=3 → 180°回転。右下 (x 奇/y 偶) は index=1
//   → 90°回転。p がどの小マスに属すかで分岐し、fract で 0〜1 に畳んだローカル座標を
//   その角だけ回す。最後に step(st.x, st.y) が「対角線で 2 分割した三角形」を描くので、
//   回転の向き違いで三角形が四方に散り、風車・市松のような模様になる。
//
// 形 (三角形) は不変。動かしているのは "マスごとにローカル座標をどう回すか" の選択。

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
    label: "book of shaders 09 - rotate tile pattern",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265358979323846;

      // GLSL の mod(x,y)=x-y*floor(x/y) (常に [0,y) の正の余り)。番地の偶奇判定に使う。
      fn modf2(x: f32, y: f32) -> f32 {
        return x - y * floor(x / y);
      }

      // 中心 0.5 を軸にローカル座標を回転 (08-rotate と同じ)。
      fn rotate2D(stIn: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (stIn - vec2f(0.5)) + vec2f(0.5);
      }

      // 拡大して fract で 0〜1 に畳むだけの素のタイル化。
      fn tile(stIn: vec2f, zoom: f32) -> vec2f {
        return fract(stIn * zoom);
      }

      // マスを 2x2 に割り、小マスの番地 (0..3) ごとに違う角度で回す。
      fn rotateTilePattern(stIn: vec2f) -> vec2f {
        var st = stIn * 2.0; // 1 マス → 2x2 の小マスへ

        // 番地: x 偶奇(0/1) + y 偶奇(0/2) = 0,1,2,3
        var index = 0.0;
        index += step(1.0, modf2(st.x, 2.0));
        index += step(1.0, modf2(st.y, 2.0)) * 2.0;

        st = fract(st); // 各小マスを 0〜1 に

        // 番地で回転を選ぶ (0 はそのまま)
        if (index == 1.0) {
          st = rotate2D(st, PI * 0.5);   // 右下: 90°
        } else if (index == 2.0) {
          st = rotate2D(st, PI * -0.5);  // 左上: -90°
        } else if (index == 3.0) {
          st = rotate2D(st, PI);         // 右上: 180°
        }
        return st;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        st = tile(st, 3.0);            // 3x3 に畳む
        st = rotateTilePattern(st);    // 各マスを 2x2 に割って番地ごとに回転

        // step(st.x, st.y): 対角線で白黒に分けた三角形。回転で向きが散る。
        let color = vec3f(step(st.x, st.y));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rotate tile pattern pipeline",
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