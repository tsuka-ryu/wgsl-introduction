// The Book of Shaders — 09 パターン: 番地回転を入れ子＋アニメに重ねる
// https://thebookofshaders.com/09/?lan=jp
//
// 09-rotate-tile-pattern (静止) の続き。最終画像は denotational に書くと
//   image = step(x,y) ∘ (座標変換の合成チェーン)
// で、ここでは「番地回転を逆向きの回転で挟む」だけのアニメ。細分化は 1 層に抑える
// (重ねすぎると密でごちゃつくため)。
//
// チェーン:
//   tile(st,3)                 … 3x3 に畳む
//   rotate2D(st, -a)           … ② ローカル座標を時間で回す  (a は sin で行って戻る)
//   rotateTilePattern(st)      … ③ 各マスを2x2に割り番地で回転
//   rotate2D(st, +a)           … ④ ②と逆向きに回し戻す
//
// なぜ ②④ で挟むと "揺らぐ" のか (ここが肝):
//   普通の回転だけなら rotate2D(-a) ∘ rotate2D(a) = 恒等 で何も起きない。だが間に
//   rotateTilePattern が挟まる。これは回転に対して非可換 — 番地 (どの小マスか) は
//   座標値から決まるので、回した座標で番地を取ると別マス扱いになり、内側の番地回転と
//   外側の回し戻しがズレる。その差分が時間で動き、模様がねじれ↔ほどけを繰り返す。
//
// 単調回転だと境界が毎フレーム飛んでチラつくので、角度は sin で行って戻る揺れにして
// 落ち着きを出す。形 step(x,y) は不変、動くのは座標の回し方の "合成" だけ。

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
    label: "book of shaders 09 - rotate tile pattern (nested + anim)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265358979323846;

      // GLSL の mod(x,y)=x-y*floor(x/y) (常に [0,y) の正の余り)。番地の偶奇判定に使う。
      fn modf2(x: f32, y: f32) -> f32 {
        return x - y * floor(x / y);
      }

      // 中心 0.5 を軸にローカル座標を回転 (08-rotate と同じ)。
      fn rotate2D(stIn: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (stIn - vec2f(0.5)) + vec2f(0.5);
      }

      // 拡大して fract で 0〜1 に畳むだけの素のタイル化。
      fn tile(stIn: vec2f, zoom: f32) -> vec2f {
        return fract(stIn * zoom);
      }

      // マスを 2x2 に割り、小マスの番地 (0..3) ごとに違う角度で回す。
      fn rotateTilePattern(stIn: vec2f) -> vec2f {
        var st = stIn * 2.0; // 1 マス → 2x2 の小マスへ

        // 番地: x 偶奇(0/1) + y 偶奇(0/2) = 0,1,2,3
        var index = 0.0;
        index += step(1.0, modf2(st.x, 2.0));
        index += step(1.0, modf2(st.y, 2.0)) * 2.0;

        st = fract(st); // 各小マスを 0〜1 に

        if (index == 1.0) {
          st = rotate2D(st, PI * 0.5);
        } else if (index == 2.0) {
          st = rotate2D(st, PI * -0.5);
        } else if (index == 3.0) {
          st = rotate2D(st, PI);
        }
        return st;
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        // 単調にずっと回すとチラついて汚いので、sin で「行って戻る」揺れに (ease)。
        let a = sin(u.time * 0.5) * PI * 0.5;

        st = tile(st, 3.0);          // 3x3 に畳む (細分化は 1 層だけ → 密になりすぎない)
        st = rotate2D(st, -a);       // ② 層を時間で回す
        st = tile(st, 3.0);          // 3x3 に畳む (細分化は 1 層だけ → 密になりすぎない)
        st = rotateTilePattern(st);  // ③ 番地回転 (回転と非可換)
        st = rotate2D(st, a);        // ④ 回し戻す → ②④は普通なら相殺だが③とズレて揺らぐ

        let color = vec3f(step(st.x, st.y)); // 対角線で割る三角形 (形は不変)

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rotate tile anim pipeline",
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
