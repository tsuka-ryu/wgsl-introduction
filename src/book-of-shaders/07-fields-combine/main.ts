// The Book of Shaders — 07 形について: 距離フィールドを演算で組み合わせる
// https://thebookofshaders.com/07/?lan=jp
//
// 「2 つの距離フィールドを色々な演算でつなぐと何が起きる?」を 1 ファイルで試す。
// 下の fs 内「▼ 試す組み合わせ ▼」の pct を 1 行だけ有効にして、他をコメントアウトする
// (本家 GLSL のスタイル)。2 つの中心 c1, c2 は time で少し動かしてアニメにしてある。
//
//   d1 = distance(st, c1)   d2 = distance(st, c2)   … 2 点への距離の場
//
//   pct = d1 + d2   … 和。和が一定 = 楕円 (c1,c2 が焦点)。なめらかな谷が 2 つ
//   pct = d1 * d2   … 積。積が一定 = カッシーニ卵形線 (∞ 字)。中央がくびれる
//   pct = min(d1,d2)… 近いほうの点までの距離 = 2 円の「和集合 (合体)」の場
//   pct = max(d1,d2)… 遠いほうの点までの距離 = 2 円の「共通部分 (レンズ)」の場
//   pct = pow(d1,d2)… べき乗。d2 が指数。非対称でゆがんだ場 (実験的)
//
// 可視化は「等高線リングを time で流す + 配色」。pct (場) の形そのものが模様に出るので、
// 演算を切り替えると模様がガラッと変わる。素の確認をしたいなら color = vec3f(pct) でもOK。
//
// ▼ 1 ピクセルを追ってみる (c1≈(0.4,0.4), c2≈(0.6,0.6), st=中心(0.5,0.5))
//   d1 ≈ 0.14, d2 ≈ 0.14。
//     和   : 0.28 / 積: 0.02 / min: 0.14 / max: 0.14 / pow: 0.14^0.14 ≈ 0.76
//   → 同じピクセルでも演算で pct が全然違う = 模様が変わる。

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
    label: "book of shaders 07 - combine distance fields",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // v(0〜1) を「クリーム → ピーチ → コーラル → ローズ」の 4 色でつなぐ暖色パレット。
      //   2 色ベタ往復だと毒々しいので、調和した 4 色を順に補間して上品なグラデにする。
      //   abs(v-0.5)*2 で 0→1→0 の三角波にし、fract の継ぎ目(0/1の段差)を消す。
      fn palette(v: f32) -> vec3f {
        let cream = vec3f(0.99, 0.91, 0.78); // クリーム
        let peach = vec3f(0.98, 0.72, 0.52); // ピーチ
        let coral = vec3f(0.94, 0.45, 0.42); // コーラル
        let rose  = vec3f(0.74, 0.27, 0.46); // ローズ
        let t = abs(v - 0.5) * 2.0;          // 0→1→0 の三角波
        var c = mix(cream, peach, smoothstep(0.00, 0.34, t));
        c = mix(c, coral, smoothstep(0.34, 0.67, t));
        c = mix(c, rose,  smoothstep(0.67, 1.00, t));
        return c;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        let st = position.xy / u.resolution;

        // 2 つの中心。本家の vec2(0.4)/vec2(0.6) を time で少し動かしてアニメに。
        let t = u.time * 0.2;
        let c1 = vec2f(0.4) + 0.08 * vec2f(cos(t), sin(t));
        let c2 = vec2f(0.6) - 0.08 * vec2f(cos(t), sin(t));

        let d1 = distance(st, c1);
        let d2 = distance(st, c2);

        // ▼ 試す組み合わせ: 1 行だけ有効に、他はコメントアウト ▼
        // let pct = d1 + d2;        // 和   → 楕円 (共焦点の輪)
        // let pct = d1 * d2;     // 積   → カッシーニ卵形線 (∞ 字)
        // let pct = min(d1, d2); // 近い → 2 円の和集合 (合体)
        // let pct = max(d1, d2); // 遠い → 2 円の共通部分 (レンズ)
        let pct = pow(d1, d2); // べき → 非対称なゆがみ (実験的)
        // ▲ ここまで ▲

        // 可視化: 場を等高線で輪切りにして time で流す → 配色。
        let v = fract(pct * 10.0 - u.time * 0.3);
        let color = palette(v);

        // 素の場を見たいときは上 2 行を消してこれ ↓ に:
        // let color = vec3f(pct);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "combine fields pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4;
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kTimeOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, time)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  function render(device: GPUDevice, time: number) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues[kTimeOffset] = time;
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
  });
  observer.observe(canvas);

  const frame = (timeMs: number) => {
    render(device, timeMs * 0.001);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
