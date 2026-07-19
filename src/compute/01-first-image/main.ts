// compute 編 — 01 いきなり絵を出す (compute が直接 canvas に書く)
//
// ── fragment との「主体の入れ替わり」を見る ─────────────────────
//   これまで: @fragment fn fs(pos) -> vec4f
//     GPU が三角形を塗るために「各ピクセルを勝手に呼ぶ」。こちらは
//     1ピクセル ぶんの色を return するだけの純関数で、呼ぶ側は GPU。
//   今回: @compute fn cs(id)
//     「どのグリッドを・何回呼ぶか」を自分で dispatch して決める。
//     色は return せず、textureStore で自分でテクスチャに書き込む。
//     → 描く主体が GPU(ラスタライザ) から こちら側 に移る。これが compute。
//
// ── 1 invocation のトレース ────────────────────────────────────
//   dispatch で W×H 個の呼び出しをばらまく。ある1つの呼び出しは
//   自分の global_invocation_id.xy = (px, py) だけを見て、
//     色 = f(px, py, t)
//   を計算し、textureStore(tex, (px,py), 色) で「その1ピクセルだけ」書く。
//   fragment の fs(gl_FragCoord) と中身は同じ純関数。違うのは
//   「呼ばれる」のでなく「自分の番地 id を見て自分で書く」ところだけ。
//
// ── 今回の新概念は 1 個だけ: 呼び出しグリッドを自分で切る ──────
//   @workgroup_size(8, 8) … 1 ワークグループ = 8×8 = 64 スレッド
//   dispatchWorkgroups(⌈W/8⌉, ⌈H/8⌉) … 画面を 8×8 のタイルで敷き詰める
//   → 呼び出し総数 = ⌈W/8⌉·8 × ⌈H/8⌉·8 ≧ W×H。端は余るので id で捨てる。
//
// ── canvas に直接書く仕掛け ────────────────────────────────────
//   context.configure に STORAGE_BINDING を足すと、canvas の現在テクスチャ
//   そのものを compute の書き込み先 (texture_storage_2d) にできる。
//   → fragment shader も render pass も無し。compute パスを submit するだけ。
//   bgra8unorm を storage として書くには "bgra8unorm-storage" 機能が要る。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();

  // canvas のフォーマット (macOS/Chrome では通常 bgra8unorm) を storage として
  // 書きたい。その許可 = "bgra8unorm-storage" 機能を要求する。
  const canWriteBgra = adapter?.features.has("bgra8unorm-storage") ?? false;
  const device = await adapter?.requestDevice({
    requiredFeatures: canWriteBgra ? ["bgra8unorm-storage"] : [],
  });
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }
  if (!canWriteBgra) {
    fail("この環境は canvas への直接書き込み (bgra8unorm-storage) に非対応です。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    // ★ここがミソ: canvas のテクスチャを compute の書き込み先にも使う許可
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  });

  const module = device.createShaderModule({
    label: "compute 01 - first image",
    code: /* wgsl */ `
      // 書き込み専用の storage テクスチャ。format は canvas に合わせる。
      @group(0) @binding(0) var tex: texture_storage_2d<bgra8unorm, write>;
      @group(0) @binding(1) var<uniform> time: f32;

      @compute @workgroup_size(8, 8) fn cs(
        @builtin(global_invocation_id) id: vec3u
      ) {
        let dims = textureDimensions(tex);        // = (W, H)
        // 端のタイルは W×H をはみ出す。その呼び出しは何も書かず帰る。
        if (id.x >= dims.x || id.y >= dims.y) { return; }

        // 自分の番地を [0,1] の正規化座標へ (fragment の gl_FragCoord/res と同じ)
        let uv = vec2f(f32(id.x), f32(id.y)) / vec2f(dims);

        // 色 = f(番地, 時間)。ここは fragment の fs と全く同じ純関数でよい。
        var color = vec3f(uv, 0.5);               // 左右=赤, 上下=緑 のグラデ

        // 時間で泳ぐ白い円 (compute でも普通に描ける、という確認)
        let center = vec2f(0.5) + 0.3 * vec2f(cos(time), sin(time * 1.3));
        let d = distance(uv, center);
        color += vec3f(smoothstep(0.12, 0.02, d));

        // その1ピクセルだけ書き込む。return ではなく自分で store。
        textureStore(tex, id.xy, vec4f(color, 1.0));
      }
    `,
  });

  const pipeline = device.createComputePipeline({
    label: "first image pipeline",
    layout: "auto",
    compute: { module, entryPoint: "cs" },
  });

  const timeBuffer = device.createBuffer({
    label: "time uniform",
    size: 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const timeValues = new Float32Array(1);

  function render(device: GPUDevice, time: number) {
    timeValues[0] = time;
    device.queue.writeBuffer(timeBuffer, 0, timeValues);

    const view = context.getCurrentTexture().createView();
    // bindGroup は「今フレームの canvas テクスチャ」を指すので毎フレーム作る
    const bindGroup = device.createBindGroup({
      label: "first image bind group",
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: view },
        { binding: 1, resource: { buffer: timeBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder({ label: "compute encoder" });
    const pass = encoder.beginComputePass({ label: "first image pass" });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    // 画面を 8×8 のタイルで覆う。⌈W/8⌉ × ⌈H/8⌉ 個のワークグループを起動。
    pass.dispatchWorkgroups(Math.ceil(canvas.width / 8), Math.ceil(canvas.height / 8));
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
