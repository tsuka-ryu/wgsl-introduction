// The Book of Shaders — 08 二次元行列: 空間を平行移動して形を動かす (translate)
// https://thebookofshaders.com/08/?lan=jp
//
// 形を動かすのに「形の座標」を動かすのではなく、「空間そのもの」を動かす、という発想。
// ピクセル p (画面の座標) を 1 つ固定して考えると:
//
//   形は常に原点 0.5 のまわりに固定で描かれる関数 crossShape(st) でしかない。
//   そこで st = p - offset と引いてから渡すと、p から見た形の中心が offset だけ
//   ずれて見える。つまり「offset 引き算」= 形を +offset に動かす、と読める。
//
//   crossShape(p - offset)   ……  形を offset だけ平行移動した、と同じ意味
//
// なぜ「引く」と「進む」になるか (1 ピクセル p で追う):
//   offset を右に増やすと、p に渡る座標 st=p-offset は左にずれる。
//   形の関数から見れば p は形の左側を指すことになり、結果として形が右へ動く。
//   → 自分(空間)を後ろに引くと、相手(形)が前に出てくる。相対運動。
//
// この章は本来「行列」だが、平行移動だけは行列を使わずベクトルの引き算で書ける。
// ここでは offset を時間で円を描かせ、十字を円軌道で動かす。

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
    label: "book of shaders 08 - translate space to move a shape",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 中心 0.5 まわりの軸ぞろえの長方形 (full width = size)。
      // 戻り値は 0〜1 のマスク: 中=1 / 外=0、縁は smoothstep で 1px ぼかす。
      // 各軸で「左下の縁を超えたか」×「右上の縁を手前か」を掛ける = 帯の積。
      fn boxMask(st: vec2f, size: vec2f) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;          // 縁までの余白
        let lower = smoothstep(margin, margin + vec2f(0.001), st);        // 左下の縁
        let upper = smoothstep(margin, margin + vec2f(0.001), vec2f(1.0) - st); // 右上の縁
        let uv = lower * upper;                          // 各軸: 帯の内側で 1
        return uv.x * uv.y;                              // 横帯 ∩ 縦帯 = 長方形
      }

      // 十字 = 横長の帯 ∪ 縦長の帯。重なりは max でなく和でよい (どちらも 0/1 マスク)。
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

        // 空間を動かす: offset 分だけ st を引くと、形は +offset に動いて見える。
        let offset = vec2f(cos(u.time), sin(u.time)) * 0.35; // 円軌道
        st = st - offset;

        var color = vec3f(0.0);

        // デバッグ: 十字の代わりに変形後の座標を色で可視化 (R=st.x / G=st.y)。
        // 有効にすると、色のグラデが offset 分ずれて流れる = 空間が動いている証拠。
        // color = vec3f(st.x, st.y, 0.0);

        color = color + vec3f(crossShape(st, 0.25)); // 動かした空間の上に十字を描く

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "translate pipeline",
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
