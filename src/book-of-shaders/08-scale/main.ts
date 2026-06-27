// The Book of Shaders — 08 二次元行列: スケール行列で空間を伸縮 (scale)
// https://thebookofshaders.com/08/?lan=jp
//
// 平行移動 (08-translate) / 回転 (08-rotate) と同じく、形ではなく空間を変形する。
// スケールも 2x2 行列で書ける。対角だけに係数を置いた行列:
//
//   S(k) = | k.x   0  |     S(k) * st = (k.x * st.x, k.y * st.y)
//          |  0   k.y |     = 各軸を k 倍に引き伸ばした座標
//
// なぜ「k 倍すると形は 1/k に縮む」か (1 ピクセル p で追う):
//   形の関数 crossShape は、渡された座標を“基準サイズの十字”として読む。
//   k>1 にすると p に渡る座標 st が原点から k 倍遠くへ飛ぶ。
//   → 形の関数から見れば p は十字のより外側を指す → 早く縁の外に出る
//   → 結果として十字は小さく見える。座標を広げる = 形を縮める、の相対関係。
//   (逆に k<1 なら座標が縮まり、形は大きく見える)
//
// なぜ 0.5 を引いて戻すか (1 ピクセルで):
//   S も原点(0,0)が中心。0.5 を引いて中心を原点へ運び、伸縮し、0.5 で戻すと
//   画面中心 0.5 を固定したまま伸縮する。回転と全く同じ定石。
//
// ここでは k = sin(time)+1.0 (0〜2) を x/y 共通で往復させ、十字を呼吸させる。
// k を vec2f(sin(time), sin(time+1.57)) のように x/y 別位相にすると、縦横が
// 交互に伸びて“ぐにゃり”と歪むのも試せる。

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
    label: "book of shaders 08 - scale space with a 2x2 matrix",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // スケール行列。対角に k.x, k.y を置くだけ (列優先だが対角なので並びは自明)。
      // S(k) * st = (k.x*st.x, k.y*st.y)。
      fn scale2d(k: vec2f) -> mat2x2f {
        return mat2x2f(k.x, 0.0, 0.0, k.y);
      }

      // 中心 0.5 まわりの軸ぞろえの長方形 (full width = size)。
      // 各軸で「左下の縁を超えたか」×「右上の縁を手前か」を掛ける = 帯の積。
      fn boxMask(st: vec2f, size: vec2f) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;          // 縁までの余白
        let lower = smoothstep(margin, margin + vec2f(0.001), st);        // 左下の縁
        let upper = smoothstep(margin, margin + vec2f(0.001), vec2f(1.0) - st); // 右上の縁
        let uv = lower * upper;
        return uv.x * uv.y;                            // 横帯 ∩ 縦帯 = 長方形
      }

      // 十字 = 横長の帯 ∪ 縦長の帯。どちらも 0/1 マスクなので和でよい。
      fn crossShape(st: vec2f, size: f32) -> f32 {
        let horizontal = boxMask(st, vec2f(size, size / 4.0));
        let vertical   = boxMask(st, vec2f(size / 4.0, size));
        return horizontal + vertical;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        // 空間を中心 0.5 まわりに伸縮する。
        // 倍率は x/y 共通で sin(time)+1.0 → 0〜2 を往復 (本家と同じ)。
        // k=0 付近で座標がつぶれて十字は巨大化、k=2 で座標が広がり 1/2 に縮む。
        let k = vec2f(sin(u.time) + 1.0);
        st = st - vec2f(0.5);          // 中心を原点へ
        st = scale2d(k) * st;          // 原点まわりに伸縮 (k 倍で形は 1/k)
        st = st + vec2f(0.5);          // 元の位置へ戻す

        var color = vec3f(0.0);

        // デバッグ: 十字の代わりに変形後の座標を色で可視化 (R=st.x / G=st.y)。
        // 有効にすると、色のグラデが伸び縮みする = 空間が伸縮している証拠。
        // color = vec3f(st.x, st.y, 0.0);

        color = color + vec3f(crossShape(st, 0.2)); // 伸縮した空間の上に十字を描く

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "scale pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト
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
