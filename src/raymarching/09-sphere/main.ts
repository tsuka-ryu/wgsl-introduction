// レイマーチング — 09 レイマーチングで球体を描く
// wgld.org GLSL 連載 第9回「レイマーチングで球体を描く」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g009.html
//
// ★ ここが 3D の初出。08 の ro/rd + 05 の fold + 第0回の距離関数(SDF)が全部合流する回。
//   08 の「色=向きのデバッグ印刷」を捨て、「色=レイが物体に当たったか」の本番描画に置き換わる。
//   結果: 黒背景に白い円(球のシルエット)。陰影はまだ無い(10 で法線を足す)。
//
// ● 距離関数(SDF): シーン = vec3 → float。原点中心・半径 1 の球は length(p) - r。
//     p が表面上なら 0、外なら正、内なら負。「点 p から一番近い表面までの距離」。
//
// ● マーチのループ(スフィアトレーシング。第0回スライド36-42 / notes「マーチのアルゴリズム」):
//     rPos = cPos(目) から出発。毎ステップ:
//       dist = distanceFunc(rPos)   … 今の先端から表面までの安全に進める距離を聞く
//       rLen += dist                … その分だけレイの全長を伸ばす
//       rPos = cPos + ray * rLen    … 先端を新しい位置へ(ro + rd*進んだ長さ)
//     を 16 回。表面へ近づくほど dist→0 になり、rLen が伸びなくなって先端が表面に貼り付く。
//     = 05 マンデルブロの fold と同型(状態 rPos/rLen を畳み込み、当たり判定 dist≈0 を収穫)。
//     escape条件 |z|>2 ↔ hit条件 |dist|<0.001、反復上限 360 ↔ 16。
//
// ● 当たり判定: 16 回後に dist が十分小さければ「表面に着いた=当たり」→ 白。届いてなければ黒。
//
// ● 「進みたい方向でなく一番近い物体までの距離で歩幅を決める」= 突き抜けない安全な進み方(保守的)。
//
// WGSL メモ: 原典の変数名 distance は WGSL 組み込み関数 distance() と衝突するので dist に改名。
//   原典は time/mouse も宣言するが 09 では未使用。ここは resolution のみ。

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

  // 3. シェーダモジュール (頂点は 01 と同じフルスクリーン三角形)
  const module = device.createShaderModule({
    label: "raymarching 09 - sphere",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const sphereSize = 1.0; // 球の半径

      // 距離関数: シーン = 原点中心・半径 sphereSize の球。
      fn distanceFunc(p: vec3f) -> f32 {
        return length(p) - sphereSize;
      }

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
        // 中心原点・アスペクト補正座標 (WebGPU は y 反転)。
        var p = (position.xy * 2.0 - u.resolution) / min(u.resolution.x, u.resolution.y);
        p.y = -p.y;

        // カメラ (08 と同じ)。targetDepth=1 でやや望遠。
        let cPos  = vec3f(0.0, 0.0,  2.0); // 目の位置 = レイ出発点 ro
        let cDir  = vec3f(0.0, 0.0, -1.0);
        let cUp   = vec3f(0.0, 1.0,  0.0);
        let cSide = cross(cDir, cUp);
        let targetDepth = 1.0;
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth); // rd

        // マーチのループ (スフィアトレーシング)。
        var dist = 0.0;        // レイ先端から球表面までの最短距離
        var rLen = 0.0;        // レイに継ぎ足した長さの合計
        var rPos = cPos;       // レイの先端位置 (= ro + rd*rLen)
        for (var i = 0; i < 16; i++) {
          dist = distanceFunc(rPos);   // 今の先端から表面までの安全な距離を聞く
          rLen += dist;                // その分だけ進む
          rPos = cPos + ray * rLen;    // 先端を更新
        }

        // 当たり判定: 十分表面に近づけたら白、届かなければ黒。
        if (abs(dist) < 0.001) {
          return vec4f(vec3f(1.0), 1.0); // 球のシルエット(白)
        }
        return vec4f(vec3f(0.0), 1.0);   // 背景(黒)
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 09 pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{ format: presentationFormat }],
    },
  });

  // 5. ユニフォームバッファ (resolution: vec2f)
  const uniformBufferSize = 4 * 4; // 16 バイト
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;

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
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // 静止画。リサイズ時だけ描き直す。
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
