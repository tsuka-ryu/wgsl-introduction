// レイマーチング — 01 フラグメントだけでレンダリングする
// wgld.org GLSL 連載 第1回「GLSL だけでレンダリングする」を WGSL に読み替え。
// https://wgld.org/d/glsl/g001.html
//
// レイマーチング編の第0歩。まだレイもマーチも出てこない。
// 目的は「頂点データを一切使わず、フラグメントシェーダ 1 本で画面を塗る器」を作ること。
// = これまでのフルスクリーン路線 (BoS) と全く同じ `色 = f(uv)`。3D はこの器の中で始まる。
//
// 今回やること: 各ピクセルの正規化座標 uv (画面左下 0,0 〜 右上 1,1) を、
// そのまま色 vec3(uv.x, uv.y, 0) にする。
//   → 右へ行くほど赤 (R=uv.x)、上へ行くほど緑 (G=uv.y)。左下が黒、右上が黄。
//   これは「各ピクセルが自分の座標を知っていて、色 = 座標の関数」を目で確かめる hello world。
//
// GLSL(wgld) → WGSL(この実装) の読み替え:
//   gl_FragCoord.xy / resolution   →  position.xy / u.resolution
//   ※ WebGPU の position.y は上が 0。GLSL(下が 0)に合わせて uv.y を反転する。
//   gl_FragColor = vec4(...)        →  return vec4f(...)  (@location(0) 出力)
//   uniform vec2 resolution         →  struct Uniforms { resolution: vec2f } + @group/@binding
//
// 時間・マウス座標は次回 02 で足す。今回は静止画 (uniform は resolution だけ)。

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
  context.configure({ device, format: presentationFormat });

  // 3. シェーダモジュール
  //   頂点   : 画面全体を覆う大きな三角形 (BoS と同じ)。頂点バッファは使わない。
  //   フラグメント : 各ピクセルの uv をそのまま色にする。
  const module = device.createShaderModule({
    label: "raymarching 01 - fragment-only rendering (color = f(uv))",
    code: /* wgsl */ `
      // resolution だけ。vec2f (8B) → 16B に切り上げ。
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        // クリップ空間 (-1〜+1) をすっぽり覆う大きな三角形。
        // 画面外まではみ出す 1 枚で全ピクセルを塗れる (フルスクリーンの定番)。
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
        // 正規化座標 uv: 画面左下が (0,0)、右上が (1,1)。
        var uv = position.xy / u.resolution;
        uv.y = 1.0 - uv.y; // WebGPU は上が 0。GLSL(下が 0)に合わせて反転。

        // 色 = f(uv)。右へ赤 (R=uv.x)、上へ緑 (G=uv.y)、青は 0。
        return vec4f(uv, 0.0, 1.0);
      }
    `,
  });

  // 4. パイプライン (頂点バッファ無し。バインドグループはユニフォーム 1 つ)
  const pipeline = device.createRenderPipeline({
    label: "raymarching 01 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 4 * 4; // 16 バイト (vec2f を 16B に切り上げ)
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0; // [0],[1]

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
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
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
    pass.draw(3); // 大きな三角形 1 枚
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // リサイズ時にキャンバス解像度を更新して描き直す (静止画なのでループは不要)。
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const c = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      c.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      c.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
      render(device);
    }
  });
  observer.observe(canvas);
}

main();
