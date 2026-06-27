// The Book of Shaders — 08 二次元行列: 回転行列で空間を回す (rotate)
// https://thebookofshaders.com/08/?lan=jp
//
// 08-translate では「空間を引き算でずらす」と形が動いた。回転も同じ発想で、
// 形そのものではなく「空間 (各ピクセルが渡す座標)」を回す。回転は引き算では
// 書けないので、ここで初めて 2x2 行列 (mat2x2f) が出てくる。
//
// 回転行列 R(a) を 1 ピクセル p で追う:
//
//   R(a) = | cos a   sin a |     (列で見る: 1列目=(cos,-sin), 2列目=(sin,cos))
//          |-sin a   cos a |
//
//   R(a) * st = ( cos a * st.x + sin a * st.y,
//                -sin a * st.x + cos a * st.y )
//
//   これは「ベクトル st を角度 -a だけ回したもの」。形の関数 crossShape は
//   渡された座標を“まっすぐな十字”として読むので、座標を -a 回して渡すと、
//   見た目の十字は +a 回って見える。空間を後ろに回すと形が前に回る、と同じ相対運動。
//
// なぜ 0.5 を引いて戻すか (1 ピクセルで):
//   R は必ず原点(0,0)まわりの回転。だが描きたいのは画面中心 0.5 まわりの回転。
//   そこで st-0.5 で中心を原点へ持ってきて回し、+0.5 で戻す。
//   = 「原点でしか回せない道具」を、座標をずらして中心に効かせる定石。
//
// ここでは angle = sin(time)*PI で左右に振り、十字を首振りさせる。

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
    label: "book of shaders 08 - rotate space with a 2x2 matrix",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 角度 a の回転行列。mat2x2f は列優先: 1列目=(cos,-sin), 2列目=(sin,cos)。
      // GLSL の mat2(cos,-sin,sin,cos) と同じ並び (どちらも列優先なので一致)。
      fn rotate2d(a: f32) -> mat2x2f {
        let c = cos(a);
        let s = sin(a);
        return mat2x2f(c, -s, s, c);
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

        // 空間を中心 0.5 まわりに回す。
        st = st - vec2f(0.5);                 // 中心を原点へ
        st = rotate2d(sin(u.time) * PI) * st; // 原点まわりに回転 (首振り)
        st = st + vec2f(0.5);                 // 元の位置へ戻す

        var color = vec3f(0.0);

        // デバッグ: 十字の代わりに変形後の座標を色で可視化 (R=st.x / G=st.y)。
        // 有効にすると、色の格子が中心まわりに回る = 空間が回っている証拠。
        // color = vec3f(st.x, st.y, 0.0);

        color = color + vec3f(crossShape(st, 0.4)); // 回した空間の上に十字を描く

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rotate pipeline",
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
