// The Book of Shaders — 07 形について: 長方形のサイズと縦横比を変える
// https://thebookofshaders.com/07/?lan=jp
//
// 前作 07-rect は「周囲 0.1 の額縁を削る」方式だった。これだと上下左右が同じ幅なので
// 「中央の正方形」しか作れない。サイズや縦横比を自由に変えたいので、考え方を変える:
//
//   四角形 = 「中心 center」と「サイズ size (幅, 高さ)」で決める
//
//   halfSize = size * 0.5         … 中心から各辺までの距離 (半分)
//   minB = center - halfSize      … 左下の角の座標
//   maxB = center + halfSize      … 右上の角の座標
//
// あるピクセル st が四角の中にいる条件は「左下の角より右上 かつ 右上の角より左下」:
//
//   bl = step(minB, st)   … st >= minB なら 1 (左辺・下辺の内側)
//   tr = step(st, maxB)   … st <= maxB なら 1 (右辺・上辺の内側)
//                           ※ step(a, b) は b >= a で 1。引数の順を入れ替えると不等号が逆になる。
//   pct = bl.x * bl.y * tr.x * tr.y   … 4 つすべて 1 = 4 辺の内側 = 四角の中
//
// ▼ size をいじるとどうなるか
//   ・size = (0.6, 0.3) → 幅 0.6 / 高さ 0.3 の「横長」長方形 (縦横比 2:1)
//   ・size = (0.3, 0.6) → 「縦長」長方形 (縦横比 1:2)
//   ・size = (0.5, 0.5) → 正方形。size を大きくすれば四角も大きくなる。
//   縦横比 = size.x : size.y。size 全体を 2 倍すれば形はそのままで大きさだけ 2 倍。
//
// ▼ 1 ピクセルを追ってみる (center=(0.5,0.5), size=(0.6,0.3) のとき)
//   halfSize=(0.3,0.15), minB=(0.2,0.35), maxB=(0.8,0.65)
//   ・中央 st=(0.50,0.50): bl=step((0.2,0.35),(0.5,0.5))=(1,1)
//                          tr=step((0.5,0.5),(0.8,0.65))=(1,1) → 1*1*1*1 = 1 → 白
//   ・上寄り st=(0.50,0.80): bl=(1,1), tr.y=step(0.80,0.65)=0  → …*0 = 0 → 黒 (高さ外)
//   ・左寄り st=(0.10,0.50): bl.x=step(0.2,0.10)=0             → 0    = 0 → 黒 (幅外)
//   → 画面中央に、横長の白い長方形が浮かぶ。

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
    label: "book of shaders 07 - rectangle size & aspect ratio",
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
        let size   = vec2f(0.6, 0.3);  // 幅 × 高さ。縦横比 = x : y、全体を拡大で大きさ変更

        let halfSize = size * 0.5;
        let minB = center - halfSize;  // 左下の角
        let maxB = center + halfSize;  // 右上の角

        // bl: st が左下の角より内側 (右上側) なら 1。
        let bl = step(minB, st);
        // tr: st が右上の角より内側 (左下側) なら 1。step の引数を入れ替えて不等号を逆に。
        let tr = step(st, maxB);

        // 4 辺すべての内側のときだけ 1 = 四角の中。
        let pct = bl.x * bl.y * tr.x * tr.y;

        let color = vec3f(pct);
        return vec4f(color, 1.0);
      }
    `,
  });

  // 4. パイプライン
  const pipeline = device.createRenderPipeline({
    label: "rect (size & aspect) pipeline",
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