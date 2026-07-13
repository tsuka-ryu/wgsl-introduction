// レイマーチング — 08 シェーダ内でレイを定義する
// wgld.org GLSL 連載 第8回「シェーダ内でレイを定義する」を WGSL に忠実移植。
// https://wgld.org/d/glsl/g008.html
// 原典 GLSL:
//   vec2 p = (gl_FragCoord.xy*2 - resolution)/min(resolution.x, resolution.y);
//   vec3 cPos  = vec3(0,0, 3);   // カメラ位置
//   vec3 cDir  = vec3(0,0,-1);   // 視線(前)
//   vec3 cUp   = vec3(0,1, 0);   // 上
//   vec3 cSide = cross(cDir, cUp); // 横 = 外積
//   float targetDepth = 0.1;
//   vec3 ray = normalize(cSide*p.x + cUp*p.y + cDir*targetDepth);
//   gl_FragColor = vec4(ray.xy, -ray.z, 1.0);
//
// ここが 3D の入り口。まだ物体には当てない。各ピクセルから飛ぶ「レイの向き rd」を計算して、
// その向きを色として可視化するだけ(右向き=赤み・上向き=緑み・前向き=青み)。
// 09 でこの ray を距離関数に沿って進めると、初めて 3D の物体が出る。
//
// ● カメラ = 目 + 目の前の板 (第0回 notes「レイの向きの決まり方」の一般形):
//   - cPos  … 目の位置。レイの出発点 ro。08 では向きだけ見るので未使用、09 のマーチ開始点になる。
//   - cDir  … 視線(前方向)。ここでは -z。
//   - cUp   … 上方向。
//   - cSide … 横方向 = cross(cDir, cUp)。前と上に両方直交する向き = 右。外積の定番用途。
//   - targetDepth … 目から板までの距離。小さいほど画角が広い(ここは 0.1 = 広角)。
//
// ● レイの向き rd = 板上のピクセル位置を、カメラの基底で3Dベクトルに組む:
//     ray = normalize( cSide*p.x + cUp*p.y + cDir*targetDepth )
//   横に p.x、縦に p.y、前に targetDepth 進んだ点への向き。正規化して長さ1に。
//   → 中心ピクセル p=(0,0) は cDir(真っ直ぐ前)、端ほど横/上に傾く = 目から扇状に広がる。
//   ※ notes の normalize(vec3(uv,-1)) は cSide=(1,0,0)/cUp=(0,1,0)/cDir=(0,0,-1)/depth=1 の特殊形。
//     基底を外積で組む本形はカメラを回転・移動できる(cDir/cUp を変えるだけ)。
//
// ● 可視化 vec4(ray.xy, -ray.z, 1): rd の各成分を RGB に。ray.z は前が負なので -ray.z で青に。
//   中心(前向き)=青、右=赤、上=緑。負の成分は画面上 0 に潰れる(表示の都合)。
//
// 原典は time/mouse も宣言しているが 08 では未使用(カメラを動かす回で使う)。ここは resolution のみ。

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
    label: "raymarching 08 - ray definition (visualize rd)",
    code: /* wgsl */ `
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
        // 中心原点・アスペクト補正座標。WebGPU は y が上→下なので反転。
        var p = (position.xy * 2.0 - u.resolution) / min(u.resolution.x, u.resolution.y);
        p.y = -p.y;

        // カメラの基底。
        let cPos  = vec3f(0.0, 0.0,  3.0); // 目の位置(= 09 のレイ出発点 ro)。08 では未使用。
        let cDir  = vec3f(0.0, 0.0, -1.0); // 視線(前)
        let cUp   = vec3f(0.0, 1.0,  0.0); // 上
        let cSide = cross(cDir, cUp);      // 横 = 前×上 の外積 → (1,0,0)
        let targetDepth = 0.1;             // 目から板までの距離(小さいほど広角)

        // レイの向き rd: 板上のピクセル位置をカメラ基底で3Dベクトルに。
        let ray = normalize(cSide * p.x + cUp * p.y + cDir * targetDepth);

        // rd を色として可視化(前向きは -ray.z を青に)。
        return vec4f(ray.xy, -ray.z, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "raymarching 08 pipeline",
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
