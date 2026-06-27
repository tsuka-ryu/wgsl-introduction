// The Book of Shaders — 08 二次元行列: mat3 で色空間変換 (YUV→RGB)
// https://thebookofshaders.com/08/?lan=jp
//
// 行列は幾何変換だけの道具ではない。3x3 行列 (mat3x3f) は「3 成分ベクトル → 3 成分
// ベクトル」の線形写像なので、色 (R,G,B) や (Y,U,V) の変換にも使える。
// ここでは色を YUV 空間で組み立て、行列 1 発で RGB に変換して表示する。
//
// YUV: Y=明るさ(輝度) / U,V=色味(色差)。テレビ放送などで使われる色の表し方。
//   この例では Y=0.5 に固定し、画面の x,y を U,V に割り当てて「色味の平面」を見る。
//
// 次元合わせ (2D を 3D に持ち上げる):
//   st は 2 成分だが、3x3 行列に食わせるには 3 成分が要る。そこで
//   vec3f(0.5, st.x, st.y) と組む = (Y, U, V)。st を 3 次元ベクトルの y,z に埋め込む。
//
// ★ 列優先の罠 (今回の肝):
//   mat3x3f も GLSL の mat3 も「列優先」。コンストラクタに渡す 9 個の数は
//   "行ごと" ではなく "列ごと" に詰まる。つまりソース上で 3 行に見える並びは、
//   実際には行列の 3 つの "列"。本家のコードはこの数値を教科書の YUV→RGB 行列の
//   並びで書いているので、ロード結果はその "転置" になる (= 厳密には正しい YUV
//   変換ではない)。だが本の目的は「色も行列で変換できる」を見せる例示なので、
//   ここでも本家と同じ絵が出るよう、同じ並び・同じ列優先で忠実に再現する。

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
    label: "book of shaders 08 - color space conversion with mat3 (YUV)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // YUV → RGB 行列。9 個の数は列優先で詰まる (下の 3 行 = 3 つの "列")。
      // 本家 GLSL の mat3(...) と同じ並び。
      const yuv2rgb = mat3x3f(
        1.0,  0.0,      1.13983,   // 列0
        1.0, -0.39465, -0.58060,   // 列1
        1.0,  2.03211,  0.0        // 列2
      );

      // RGB → YUV 行列 (逆変換の参考。今回は未使用)。
      const rgb2yuv = mat3x3f(
        0.2126,   0.7152,   0.0722,    // 列0
       -0.09991, -0.33609,  0.43600,   // 列1
        0.615,   -0.5586,  -0.05639    // 列2
      );

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        // U,V は -1〜1。st(0〜1) を中心ずらし→2倍でリマップ。
        st = st - 0.5;   // -0.5〜0.5
        st = st * 2.0;   // -1〜1

        // st を 3 成分に持ち上げ (Y=0.5 固定, U=st.x, V=st.y) → 行列で RGB に。
        let color = yuv2rgb * vec3f(0.5, st.x, st.y);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "yuv color pipeline",
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