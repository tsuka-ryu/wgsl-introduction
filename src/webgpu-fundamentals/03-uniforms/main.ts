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
//
// 段階2: ユニフォームバッファを「変わらない値」と「変わる値」で 2 つに分ける最適化。
//   color / offset は最初に決めたら二度と変わらない -> static バッファ (初期化時に 1 回だけ書く)
//   scale はアスペクト比に応じて毎フレーム変わる       -> changing バッファ (毎フレーム書く)
//   毎フレーム writeBuffer するデータが 32 バイト -> 8 バイトに減る。

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
  // ユニフォームを 2 つの struct に分け、binding 0 / binding 1 として宣言する。
  //   OurStruct   (binding 0) = 変わらない値 (color / offset)
  //   OtherStruct (binding 1) = 変わる値   (scale)
  const module = device.createShaderModule({
    label: "triangle shader with uniforms",
    code: /* wgsl */ `
      struct OurStruct {
        color: vec4f,
        offset: vec2f,
      };

      struct OtherStruct {
        scale: vec2f,
      };

      @group(0) @binding(0) var<uniform> ourStruct: OurStruct;
      @group(0) @binding(1) var<uniform> otherStruct: OtherStruct;

      @vertex fn vs(
        @builtin(vertex_index) vertexIndex : u32
      ) -> @builtin(position) vec4f {
        let pos = array(
          vec2f( 0.0,  0.5),
          vec2f(-0.5, -0.5),
          vec2f( 0.5, -0.5),
        );

        return vec4f(
          pos[vertexIndex] * otherStruct.scale + ourStruct.offset, 0.0, 1.0);
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

  // 5. オブジェクト (三角形) ごとに 2 つのユニフォームバッファを用意する
  //
  // static バッファ = OurStruct (binding 0) のメモリレイアウト (各 f32 = 4 バイト):
  //   color  : vec4f -> オフセット 0  (4 個)
  //   offset : vec2f -> オフセット 16 (2 個)
  //   padding         -> オフセット 24 (2 個)  ← struct は 16 バイト境界に切り上げ
  // 合計 32 バイト。
  const staticUniformBufferSize = 8 * 4; // 32 バイト
  const kColorOffset = 0;
  const kOffsetOffset = 4;

  // changing バッファ = OtherStruct (binding 1):
  //   scale : vec2f -> オフセット 0 (2 個)
  // 合計 8 バイト。
  const changingUniformBufferSize = 2 * 4; // 8 バイト
  const kScaleOffset = 0;

  // 三角形 1 個ぶんに必要な情報をまとめた型
  type ObjectInfo = {
    scale: number; // この三角形の基準スケール (アスペクト比補正前)
    uniformBuffer: GPUBuffer; // 毎フレーム scale を書き込む changing バッファ
    uniformValues: Float32Array<ArrayBuffer>; // scale 用の下書き配列 (要素 2 個)
    bindGroup: GPUBindGroup; // static + changing の 2 バッファをシェーダに結ぶ
  };

  const kNumObjects = 100;
  const objectInfos: ObjectInfo[] = [];

  for (let i = 0; i < kNumObjects; ++i) {
    // --- static バッファ: color / offset を初期化時に 1 回だけ書く ---
    const staticUniformBuffer = device.createBuffer({
      label: `static uniforms for obj ${i}`,
      size: staticUniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    {
      // この下書きはここで書き込んだら捨ててよい (二度と変わらないので保持不要)
      const staticValues = new Float32Array(staticUniformBufferSize / 4);
      staticValues.set([rand(), rand(), rand(), 1], kColorOffset); // ランダムな色
      staticValues.set([rand(-0.9, 0.9), rand(-0.9, 0.9)], kOffsetOffset); // ランダムな位置
      device.queue.writeBuffer(staticUniformBuffer, 0, staticValues);
    }

    // --- changing バッファ: scale を毎フレーム書く。下書きは保持しておく ---
    const uniformValues = new Float32Array(changingUniformBufferSize / 4);
    const uniformBuffer = device.createBuffer({
      label: `changing uniforms for obj ${i}`,
      size: changingUniformBufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // バインドグループは 2 バッファ ぶんの entries を持つ
    const bindGroup = device.createBindGroup({
      label: `bind group for obj ${i}`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: staticUniformBuffer } },
        { binding: 1, resource: { buffer: uniformBuffer } },
      ],
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
