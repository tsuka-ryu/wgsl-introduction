// The Book of Shaders — 08 二次元行列: 回転 × 拡大縮小の合成 (rotate ∘ scale)
// https://thebookofshaders.com/08/?lan=jp
//
// 08-rotate と 08-scale を 1 つにまとめる。複数の変形は「行列の掛け算」で 1 枚の
// 行列に合成できる。これが行列を使う最大のうまみ:
//
//   M = R(a) * S(k)          … 2 つの変形を 1 つの行列に畳む
//   st' = M * (st - 0.5) + 0.5
//
// なぜ「掛け算 = 合成」か (1 ピクセル p で右から読む):
//   M * st = R * (S * st)。ベクトルに近い (右) 側が先に効く。つまり
//     1. まず S * st   … 座標を伸縮
//     2. その結果を R で回転
//   crossShape はこの二段変形後の座標を“基準の十字”として読むので、
//   見た目の十字は「縮んで回った」ように見える (各段の逆向きが重なる)。
//
// ★ 順序が結果を変える (行列の掛け算は非可換):
//   R * S … 先に伸縮 → あとで回転。十字の腕の比率は保たれて全体が回る。
//   S * R … 先に回転 → あとで伸縮。回した後に縦横を別倍率で潰すと、
//           斜めの腕が歪む (k.x≠k.y のとき顕著)。下で順序を切替できる。
//   (k.x == k.y の一様スケールなら R と S は可換で見た目は同じ)
//
// アニメ: 倍率は強い静的異方性 (横に伸ばし縦に潰す) で固定し、角度をゆっくり回す。
// こうすると順序の差が見える: R*S は潰れが十字に貼り付いて回り、S*R は潰れ向きが
// 画面の縦横に固定されたまま十字だけスピンする。下の行で順序を切り替えて見比べる。

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
    label: "book of shaders 08 - compose rotate and scale matrices",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 角度 a の回転行列。列優先: 1列目=(cos,-sin), 2列目=(sin,cos)。
      fn rotate2d(a: f32) -> mat2x2f {
        let c = cos(a);
        let s = sin(a);
        return mat2x2f(c, -s, s, c);
      }

      // スケール行列。対角に k.x, k.y。S(k)*st = (k.x*st.x, k.y*st.y)。
      fn scale2d(k: vec2f) -> mat2x2f {
        return mat2x2f(k.x, 0.0, 0.0, k.y);
      }

      // 中心 0.5 まわりの軸ぞろえの長方形。各軸で帯の内側=1 を掛ける。
      fn boxMask(st: vec2f, size: vec2f) -> f32 {
        let margin = vec2f(0.5) - size * 0.5;
        let lower = smoothstep(margin, margin + vec2f(0.001), st);
        let upper = smoothstep(margin, margin + vec2f(0.001), vec2f(1.0) - st);
        let uv = lower * upper;
        return uv.x * uv.y;
      }

      // 十字 = 横長の帯 ∪ 縦長の帯。
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

        let angle = u.time * 0.4;        // ゆっくり回す (差を観察しやすく)
        let k = vec2f(1.8, 0.45);        // 強い静的異方性: 横に伸ばし縦に潰す (固定軸)

        // 2 つの行列を 1 枚に合成。掛ける順序で結果が変わる ▼ 1 行だけ有効に ▼
        // ・R*S: 伸縮軸が十字と一緒に回る → 潰れ方が「形に貼り付いて」回る
        // ・S*R: 伸縮軸は画面に固定 → 十字がスピンしても潰れ向きは画面の縦横のまま
        let M = rotate2d(angle) * scale2d(k); // 先に伸縮→あとで回転 (形基準で潰れる)
        // let M = scale2d(k) * rotate2d(angle); // 先に回転→あとで伸縮 (画面基準で潰れる)
        // ▲ ここまで ▲

        // 中心 0.5 まわりに合成変形を効かせる。
        st = st - vec2f(0.5);
        st = M * st;
        st = st + vec2f(0.5);

        var color = vec3f(0.0);

        // デバッグ: 変形後の座標を色で可視化 (R=st.x / G=st.y)。
        // 有効にすると、色の格子が回りながら伸縮する = 合成変形が見える。
        // color = vec3f(st.x, st.y, 0.0);

        color = color + vec3f(crossShape(st, 0.2)); // 合成変形した空間の上に十字

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rotate-scale pipeline",
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
