// The Book of Shaders — 11 ノイズ: 木目 (wood grain)
// https://thebookofshaders.com/11/?lan=jp  ("Use noise" の練習・@patriciogv 2015)
//
// アイデアは一行で言える:「等間隔のしましま (lines) を、座標ごとに少しずつ回して (rotate2d)、
// その回転角を value noise で決める」。まっすぐな縞が場所ごとにゆらいで、年輪/木目になる。
//
// 1ピクセル st でのトレース (denotational に):
//   pos          … st を縦長 (10 x 3) に伸ばした座標。縞の "材料" になる場。
//   noise(pos)   … その場所のなめらかな乱数 (0〜1)。これを回転角ラジアンとして使う。
//   rotate2d(角) * pos … pos を場所ごとに回す。隣り合うピクセルでは角がほぼ同じなので、
//                        縞が急に折れず、ゆるやかにうねる。
//   lines(pos,.5) … 回したあとの x を sin に通して縞模様にする。abs(sin)+smoothstep で
//                   黒い線 / 白い間 のコントラストを作る。
//
// なぜ value noise なのか: 角度が場所ごとに "なめらかに" 変わってほしいから。
// 砂嵐 (純 random) で回したら縞がバラバラに千切れて木目にならない。隣と相関した
// なめらかな乱数 = noise だからこそ、繊維が流れるような連続したうねりになる。

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
    label: "book of shaders 11 - wood grain",
    code: /* wgsl */ `
      const PI = 3.14159265359;

      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 10章 random: 座標 → 0〜1 の乱数。整数格子点に置く "高さ" の元。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // value noise (11-noise-2d と同じ): 格子点の乱数値を smoothstep 重みで双線形補間。
      // 戻り値 0〜1 のなめらかな乱数。木目では「回転角」として使う。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(random(i + vec2f(0.0, 0.0)), random(i + vec2f(1.0, 0.0)), u.x),
          mix(random(i + vec2f(0.0, 1.0)), random(i + vec2f(1.0, 1.0)), u.x),
          u.y
        );
      }

      // 角 angle だけ回す 2x2 回転行列。WGSL の mat2x2f は列ベクトル指定 (GLSL の mat2 と同じ並び)。
      fn rotate2d(angle: f32) -> mat2x2f {
        return mat2x2f(cos(angle), -sin(angle),
                       sin(angle),  cos(angle));
      }

      // 等間隔のしましまを作る関数。pos.x を sin に通して縞にし、smoothstep で黒線/白間に整える。
      // b は線の太さ・コントラストのつまみ (本では b=0.5)。
      fn lines(pos: vec2f, b: f32) -> f32 {
        let p = pos * 10.0; // 縞の本数を増やす
        return smoothstep(0.0, 0.5 + b * 0.5, abs(sin(p.x * PI) + b * 2.0) * 0.5);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        // 本の縦横比補正 (st.y *= u_resolution.y/u_resolution.x)。
        st.y *= u.resolution.y / u.resolution.x;

        // st.yx で x/y を入れ替えつつ (10, 3) に伸ばす → 縦に細長い場。木目の "幹方向" を作る。
        var pos = st.yx * vec2f(10.0, 3.0);

        // この場所のなめらかな乱数を回転角にして pos を回す。場所ごとに縞の向きがゆらぐ。
        pos = rotate2d(noise(pos)) * pos;

        // 回したあとの座標で縞を描く。うねった縞 = 木目。
        let pattern = lines(pos, 0.5);

        return vec4f(vec3f(pattern), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "wood grain pipeline",
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
