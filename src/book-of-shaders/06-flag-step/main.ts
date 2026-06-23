// The Book of Shaders — 06 演習: step() でカラフルな旗
// https://thebookofshaders.com/06/?lan=jp
//
// この回で唯一の「新しい関数」が step()。
//
//   step(edge, x)  =  x < edge なら 0.0 / x >= edge なら 1.0
//
// smoothstep が「なめらかに 0→1」だったのに対し、step は「カクッと 0→1」。
// 境界がくっきり切り替わるので、縞模様 = 旗を作るのにぴったり。
//
// 旗の作り方は 06 の mix の重ね塗りと全く同じ:
//   1. まず左端の色 (c1) で全面を塗る
//   2. step(0.33, st.x) = x が 0.33 を超えたら 1 → そこから先を c2 に差し替え
//   3. step(0.66, st.x) = x が 0.66 を超えたら 1 → そこから先を c3 に差し替え
//   → 縦 3 本の縞 (フランス国旗のような三色旗) になる。
//
// 【演習のヒント】
//   - st.x を st.y に変えると横縞になる。
//   - step を smoothstep に変えると境界がにじむ (旗 → グラデーション)。違いを体感しよう。
//   - 色や境界の位置 (0.33 / 0.66) を変えれば好きな旗が作れる。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  // 1. アダプタとデバイスの取得
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  // 2. キャンバスを WebGPU 用に設定
  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
  });

  // 3. シェーダモジュール
  const module = device.createShaderModule({
    label: "book of shaders 06 - flag with step()",
    code: /* wgsl */ `
      // この例は解像度だけ使う (静止画)。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f(-1.0,  3.0),
          vec2f( 3.0, -1.0),
          vec2f(-1.0, -1.0),
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(
        @builtin(position) position: vec4f
      ) -> @location(0) vec4f {
        // 正規化座標 st: 左下 (0,0) 〜 右上 (1,1)。WebGPU は y が上なので反転。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // 三色 (青 / 白 / 赤)。
        let c1 = vec3f(0.0, 0.21, 0.65); // 青
        let c2 = vec3f(1.0, 1.0, 1.0);   // 白
        let c3 = vec3f(0.85, 0.16, 0.18); // 赤

        // step(edge, st.x): st.x が edge を超えたら 1、手前は 0。
        //   mix の混合率に渡すと「edge を境にカクッと色が切り替わる」。
        var color = c1;                                // まず全面を青に
        color = mix(color, c2, step(0.333, st.x));     // 1/3 から先を白に
        color = mix(color, c3, step(0.666, st.x));     // 2/3 から先を赤に

        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "flag (step) pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 2 * 4; // 8 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice) {
    uniformValues.set([canvas.width, canvas.height], 0);
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

  // 静止画なので、リサイズ時に解像度を更新して描き直すだけ。
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
    }
    render(device);
  });
  observer.observe(canvas);
}

main();