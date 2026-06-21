// WebGPU Fundamentals — ユニフォーム
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-uniforms.html
//
// ユニフォーム = シェーダに渡す「グローバル変数」。1 回の draw の間ずっと同じ値になる。
// ここでは color / scale / offset を 1 つのユニフォームバッファにまとめて渡す。
//
// 段階1: 三角形を 1 個ではなく 100 個描く。
//   ユニフォームは「1 回の draw の間ずっと同じ値」なので、
//   違う色・位置・大きさの三角形を出したいなら draw を 100 回呼び、
//   それぞれに別のユニフォーム (バッファ + バインドグループ) を割り当てる。

import { fail } from "../util";

// min 以上 max 未満の乱数。引数の渡し方で 3 通りに使える。
//   rand()        -> 0..1
//   rand(max)     -> 0..max
//   rand(min,max) -> min..max
function rand(min?: number, max?: number): number {
  if (min === undefined) {
    min = 0;
    max = 1;
  } else if (max === undefined) {
    max = min;
    min = 0;
  }
  return min + Math.random() * (max - min);
}

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
  // ユニフォームを struct でまとめ、@group(0) @binding(0) として宣言する。
  const module = device.createShaderModule({
    label: "triangle shader with uniforms",
    code: /* wgsl */ `
      struct OurStruct {
        color: vec4f,
        scale: vec2f,
        offset: vec2f,
      };

      @group(0) @binding(0) var<uniform> ourStruct: OurStruct;

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f( 0.0,  0.5),
          vec2f(-0.5, -0.5),
          vec2f( 0.5, -0.5),
        );

        return vec4f(
          pos[vertexIndex] * ourStruct.scale + ourStruct.offset, 0.0, 1.0);
      }

      @fragment fn fs() -> @location(0) vec4f {
        return ourStruct.color;
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "uniforms pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. オブジェクト (三角形) ごとにユニフォームバッファを用意する
  // struct のメモリレイアウト (各 f32 = 4 バイト):
  //   color  : vec4f -> オフセット 0  (4 個)
  //   scale  : vec2f -> オフセット 16 (2 個)
  //   offset : vec2f -> オフセット 24 (2 個)
  // 合計 32 バイト = f32 8 個分。
  const uniformBufferSize = 8 * 4; // 32 バイト

  // struct 内の各メンバの先頭インデックス (f32 単位)
  const kColorOffset = 0;
  const kScaleOffset = 4;
  const kOffsetOffset = 6;

  // 三角形 1 個ぶんに必要な情報をまとめた型
  type ObjectInfo = {
    scale: number; // この三角形の基準スケール (アスペクト比補正前)
    uniformBuffer: GPUBuffer; // この三角形専用の GPU 上のバッファ
    uniformValues: Float32Array<ArrayBuffer>; // この三角形専用の CPU 側 下書き配列
    bindGroup: GPUBindGroup; // バッファとシェーダを結ぶバインドグループ
  };

  const kNumObjects = 100;
  const objectInfos: ObjectInfo[] = [];

  for (let i = 0; i < kNumObjects; ++i) {
    // この三角形専用のバッファ (1 個版と同じものを 100 個作る)
    const uniformBuffer = device.createBuffer({
      label: `uniforms for obj ${i}`,
      size: uniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // この三角形専用の下書き配列
    const uniformValues = new Float32Array(uniformBufferSize / 4);

    // color と offset は最初に決めたら変わらないので、ここで詰めておく
    uniformValues.set([rand(), rand(), rand(), 1], kColorOffset); // ランダムな色
    uniformValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset); // ランダムな位置

    // この三角形専用のバインドグループ
    const bindGroup = device.createBindGroup({
      label: `bind group for obj ${i}`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // scale は毎フレーム計算し直すので、基準値だけ覚えておく
    objectInfos.push({
      scale: rand(0.2, 0.5),
      uniformBuffer,
      uniformValues,
      bindGroup,
    });
  }

  function render(device: GPUDevice) {
    const renderPassDescriptor: GPURenderPassDescriptor = {
      label: "our basic canvas renderPass",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: [0.3, 0.3, 0.3, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const encoder = device.createCommandEncoder({ label: "our encoder" });
    const pass = encoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipeline);

    // アスペクト比を打ち消して三角形の形を保つ
    const aspect = canvas.width / canvas.height;

    // 100 個ぶんループして、バインドグループを差し替えながら draw する
    for (const { scale, bindGroup, uniformBuffer, uniformValues } of objectInfos) {
      // scale だけ毎フレーム計算して詰める (アスペクト比が変わるから)
      uniformValues.set([scale / aspect, scale], kScaleOffset);
      device.queue.writeBuffer(uniformBuffer, 0, uniformValues);

      pass.setBindGroup(0, bindGroup); // この三角形のバッファに切り替え
      pass.draw(3); // 頂点 3 つ
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const canvas = entry.target as HTMLCanvasElement;
      const width = entry.contentBoxSize[0].inlineSize;
      const height = entry.contentBoxSize[0].blockSize;
      canvas.width = Math.max(1, Math.min(width, device.limits.maxTextureDimension2D));
      canvas.height = Math.max(1, Math.min(height, device.limits.maxTextureDimension2D));
      render(device);
    }
  });
  observer.observe(canvas);
}

main();
