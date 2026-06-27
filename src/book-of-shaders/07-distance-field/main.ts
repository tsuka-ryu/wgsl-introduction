// The Book of Shaders — 07 形について: 距離フィールドの便利な性質
// https://thebookofshaders.com/07/?lan=jp
//
// 「距離フィールド (= 各点に最寄りの形までの距離を入れた地形) を作って、
//  それを可視化したり描画したりする」回。下の 2 か所を 1 行ずつ切り替えて遊ぶ:
//   ① 距離フィールドの作り方 (d = ...)        … 形を変える
//   ② 出力の仕方 (let out = ...)              … 同じ場の見せ方を変える
//
// ▼ 下ごしらえ
//   st.x *= aspect            … 横長画面でも形がゆがまないようアスペクト比補正
//   st = st*2 - 1             … 0〜1 を -1〜+1 にリマップ (中心が原点、四隅が ±1)
//
// ▼ 距離フィールドの作り方 (abs で空間を折りたたむのが肝)
//   abs(st)            … 4 つの象限を右上の 1 つに「折り返す」(鏡像化)。原点対称の形になる
//   abs(st) - 0.3      … 折りたたんだ座標を 0.3 ずらす → 中心から 0.3 離れた基準点へ
//
//   d = length(abs(st) - 0.3)               … 基準点までの距離。角ばった 4 回対称の場
//   d = length(min(abs(st) - 0.3, 0.0))     … 負側だけ残す → 角丸四角の「内側」の距離場
//   d = length(max(abs(st) - 0.3, 0.0))     … 正側だけ残す → 角丸四角の「外側」の距離場 (box SDF)
//   ※ min/max の第 2 引数はベクトルにする (WGSL は型を揃える): vec2f(0.0)。
//
// ▼ 出力の仕方
//   fract(d*10.0)                       … 距離を 10 等分で輪切り → 等高線の縞 (場の可視化)
//   step(0.3, d)                        … d>=0.3 を白 (しきい値で塗り分け)
//   step(0.3,d) * step(d,0.4)           … 0.3<=d<=0.4 の帯だけ白 = 輪郭リング (AND)
//   smoothstep(0.3,0.4,d)*smoothstep(0.6,0.5,d) … なめらかな帯 (アンチエイリアスのリング)
//
// ▼ 1 ピクセルを追ってみる (st=原点(0,0)、d = length(abs(st)-0.3))
//   abs((0,0)) = (0,0) → -0.3 → (-0.3,-0.3) → length ≈ 0.42。
//   fract(0.42*10)=fract(4.2)=0.2 → 暗いグレー。原点は縞のどこか中間。

import { fail } from "../../webgpu-fundamentals/util";

async function main() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) {
    fail("このブラウザは WebGPU に対応していません (Chrome / Edge 113+ など)。");
    return;
  }

  const canvas = document.querySelector("canvas")!;
  const context = canvas.getContext("webgpu")!;
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat });

  const module = device.createShaderModule({
    label: "book of shaders 07 - distance field properties",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.x *= u.resolution.x / u.resolution.y; // アスペクト比補正 (形をゆがませない)
        st = st * 2.0 - 1.0;                      // 0〜1 → -1〜+1 にリマップ

        // ▼① 距離フィールドの作り方: 1 行だけ有効に ▼
        let d = length(abs(st) - 0.3);            // 角ばった 4 回対称の場
        // let d = length(min(abs(st) - 0.3, vec2f(0.0))); // 角丸四角の内側
        // let d = length(max(abs(st) - 0.3, vec2f(0.0))); // 角丸四角の外側 (box SDF)
        // ▲ ここまで ▲

        // ▼② 出力の仕方: 1 行だけ有効に ▼
        let out = fract(d * 10.0);                          // 等高線の縞 (場の可視化)
        // let out = step(0.3, d);                          // しきい値で塗り分け
        // let out = step(0.3, d) * step(d, 0.4);           // 0.3〜0.4 の輪郭リング
        // let out = smoothstep(0.3, 0.4, d) * smoothstep(0.6, 0.5, d); // なめらかなリング
        // ▲ ここまで ▲

        return vec4f(vec3f(out), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "distance field pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

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
