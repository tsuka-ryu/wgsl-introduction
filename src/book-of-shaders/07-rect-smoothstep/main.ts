// The Book of Shaders — 07 形について: smoothstep() で長方形の縁をぼかす
// https://thebookofshaders.com/07/?lan=jp
//
// 前作 07-rect-size と中身は同じ「中心 + サイズで角を出して内/外を判定」。
// 違いは step を smoothstep に変えただけ。これで縁がカクッ→じわっに変わる。
//
//   step(edge, x)               … x >= edge で 1。0 か 1 だけ (境界がくっきり)
//   smoothstep(edge0, edge1, x) … x<=edge0 で 0、x>=edge1 で 1、その間はなめらかに 0→1
//                                  → edge0〜edge1 の「にじみ幅」の中だけ中間値 (グレー) が出る
//
// やり方: 各辺で「角の座標」から blur ぶん内側に向かってグラデーションさせる。
//
//   bl = smoothstep(minB, minB + blur, st)  … 左下: minB(外)で 0 → minB+blur(内)で 1
//   tr = smoothstep(maxB, maxB - blur, st)  … 右上: maxB(外)で 0 → maxB-blur(内)で 1
//                                             ※ edge0>edge1 にすると向きが反転し「内ほど 1」になる
//   pct = bl.x * bl.y * tr.x * tr.y         … 4 辺ぶんを掛ける (前作と同じ AND)
//
// 0/1 ではなく 0〜1 の連続値を掛け合わせるので、四隅は二重ににじんで暗くなる。
//
// ▼ blur をいじるとどうなるか (これが今回の主役)
//   ・blur = (0.001) … にじみ幅ほぼゼロ → step と同じくくっきりした四角
//   ・blur = (0.05)  … 縁が少しぼやけた四角
//   ・blur = (0.3)   … 中心だけ明るく外へフェードする「ぼんやり光る四角 (ソフトな枠)」
//
// ▼ 1 ピクセルを追ってみる (center=(0.5,0.5), size=(0.6,0.3), blur=(0.05))
//   minB=(0.2,0.35), maxB=(0.8,0.65)
//   ・中央    st=(0.500,0.50): どの辺からも blur より深く内側 → 全部 1 → pct=1 → 白
//   ・縁の途中 st=(0.775,0.50): tr.x=smoothstep(0.8,0.75,0.775)
//        t = (0.775-0.8)/(0.75-0.8) = (-0.025)/(-0.05) = 0.5 → なめらか化で 0.5
//        → pct = 1*1*0.5*1 = 0.5 → 中間のグレー (にじみ帯の真ん中)
//   ・外側    st=(0.900,0.50): tr.x=smoothstep(0.8,0.75,0.9)=0 → pct=0 → 黒
//   → 縁が blur 幅でグレーに溶ける。step と違い「0.5」のような途中の色が現れるのがポイント。

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
    label: "book of shaders 07 - rectangle blurred edges (smoothstep)",
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

        // ▼ ここを変えると四角が変わる ▼
        let center = vec2f(0.5, 0.5);  // 四角の中心
        let size   = vec2f(0.6, 0.3);  // 幅 × 高さ
        let blur   = vec2f(0.05);      // にじみ幅。小さく→くっきり / 大きく→ぼんやり

        let halfSize = size * 0.5;
        let minB = center - halfSize;  // 左下の角
        let maxB = center + halfSize;  // 右上の角

        // 左下 2 辺: minB(外) で 0 → minB+blur(内) で 1 になめらかに立ち上がる。
        let bl = smoothstep(minB, minB + blur, st);
        // 右上 2 辺: edge0>edge1 にして向きを反転。maxB(外) で 0 → maxB-blur(内) で 1。
        let tr = smoothstep(maxB, maxB - blur, st);

        // 4 辺ぶんを掛ける。今回は 0〜1 の連続値なので縁がグレーに溶ける。
        let pct = bl.x * bl.y * tr.x * tr.y;

        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "rect (smoothstep) pipeline",
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
