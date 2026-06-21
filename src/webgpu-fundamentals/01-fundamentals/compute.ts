// WebGPU Fundamentals — GPU 上で計算を実行する (compute)
// https://webgpufundamentals.org/webgpu/lessons/ja/webgpu-fundamentals.html#a-run-computations-on-the-gpu
//
// 描画ではなく「計算」。キャンバスは使わず、バッファに対して計算した結果を
// CPU 側に読み戻す。レンダリングとの共通点は device 取得・encoder・submit のみ。

async function computeMain() {
  // 1. アダプタとデバイスの取得 (描画と同じ。canvas/context は不要)
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail2("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  // 2. コンピュートシェーダ (@compute)
  //    @workgroup_size(n) = 1 ワークグループあたりのスレッド数
  const module = device.createShaderModule({
    label: "compute module",
    code: /* wgsl */ `
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;

      @compute @workgroup_size(1) fn computeSomething(
        @builtin(global_invocation_id) id: vec3u
      ) {
        let i = id.x;
        data[i] = data[i] * 2.0;
        // マンション で例えると:
        // dispatchWorkgroups = 建物(ワークグループ)を何棟建てるか
        // @workgroup_size = 1棟あたり何部屋あるか
        // local_invocation_id = 棟の中の部屋番号
        // workgroup_id = 何棟目か
        // global_invocation_id = 全部屋に振った通し番号(部屋の総数 = 棟数 × 部屋数)
      }
    `,
  });

  // 3. コンピュートパイプライン (createRenderPipeline の compute 版)
  const pipeline = device.createComputePipeline({
    label: "compute pipeline",
    layout: "auto",
    compute: {
      module,
      entryPoint: "computeSomething",
    },
  });

  // 4. 入力データと GPU バッファ
  const input = new Float32Array([1, 3, 5]);

  // 計算の入出力に使うバッファを、GPU上に用意する。
  const workBuffer = device.createBuffer({
    label: "work buffer",
    size: input.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  // JavaScript側で用意した入力データを、GPU上のバッファへコピーする。
  device.queue.writeBuffer(workBuffer, 0, input);

  // 5. バインドグループ (シェーダの @binding とバッファを結びつける)
  // GPUの外から見えるように、計算結果をコピーする新たなバッファを、GPU上に用意する
  const resultBuffer = device.createBuffer({
    label: "result buffer",
    size: input.byteLength,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });

  // 計算をする際にどのバッファを使えばよいかシェーダに指示するため、
  // bindGroupを設定する。
  const bindGroup = device.createBindGroup({
    label: "bindGroup for work buffer",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: workBuffer }],
  });

  // 6. コマンドをエンコードして実行
  const encoder = device.createCommandEncoder({
    label: "doubling encoder",
  });
  const pass = encoder.beginComputePass({
    label: "doubling compute pass",
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(input.length);
  pass.end();

  // 7. 結果の読み戻し
  //    GPU バッファは直接読めないので、MAP_READ 可能な resultBuffer に
  //    コピー → mapAsync → getMappedRange で CPU から覗く。
  // 「得られた結果をマップ可能なバッファへコピーするコマンド」をエンコードする。
  encoder.copyBufferToBuffer(workBuffer, 0, resultBuffer, 0, resultBuffer.size);

  device.queue.submit([encoder.finish()]);

  // 計算結果を読み出す。
  await resultBuffer.mapAsync(GPUMapMode.READ);
  // getMappedRange() は GPU バッファを直接指すビューなので、unmap() すると
  // 中身が切り離される。slice(0) で複製を取っておくと unmap 後も値が残る。
  const result = new Float32Array(resultBuffer.getMappedRange().slice(0));

  console.log("input", input);
  console.log("result", result);

  resultBuffer.unmap();
}

function fail2(msg: string) {
  document.body.innerHTML = `<p style="font-family:sans-serif;padding:1rem;color:#c00">${msg}</p>`;
}

computeMain();
