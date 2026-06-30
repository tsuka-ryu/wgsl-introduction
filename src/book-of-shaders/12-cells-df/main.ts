// The Book of Shaders — 12 セルラーノイズ: 4 cells DF (距離場)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015)
//
// セルラーノイズの第一歩。やることは1つだけ:「画面にバラまいた何個かの特徴点(feature point)の
// うち、一番近い点までの距離」を各ピクセルで測り、その距離を明るさにする。これが距離場
// (distance field)。点に近いほど 0 (黒)、遠いほど明るい → 各点を中心にした暗い窪みが並ぶ。
// 後の回ではこの「最短距離」を入口に、セル(細胞)分割・ボロノイ・有機的な模様へ広げていく。
//
// この回で初めて u_mouse を配線する: 5個目の点をマウスに追従させ、距離場が動くのを体感する。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st = position/res, y反転              … 本(GLSL下origin)に合わせた 0〜1 座標。
//   point[0..3]                           … 固定の特徴点 4 個 (0〜1 空間に手で配置)。
//   point[4] = mouse                      … 5 個目はマウス追従。
//   m_dist = 1                            … 「ここまでで見つかった最短距離」。初期値は最大想定。
//   for p in points: m_dist = min(m_dist, distance(st, p))
//                                         … 全点との距離を測り、一番小さいものだけ残す。
//   color = m_dist                        … 最短距離をそのまま明るさに → 点の周りが暗い窪み。
//   (isoline はコメントアウト)             … 外すと sin で縞を作り等高線を重ねられる。
//
// この shader は時間ではなくマウスで動く。uniform は resolution と mouse の 2 つ (time なし)。

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
    label: "book of shaders 12 - 4 cells DF",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        mouse: vec2f,      // 0〜1 に正規化済み (y は反転して st と同じ向きに揃えてある)
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st.x *= u.resolution.x / u.resolution.y;  // 画面が正方形なら 1 倍 (縦横比補正)

        // 特徴点 (feature points)。最後の 1 個だけマウス追従。
        var point = array<vec2f, 5>(
          vec2f(0.83, 0.75),
          vec2f(0.60, 0.07),
          vec2f(0.28, 0.64),
          vec2f(0.31, 0.26),
          u.mouse
        );

        var color = vec3f(0.0);

        // ここまでで見つかった「一番近い点までの距離」。初期値は想定最大の 1。
        var m_dist = 1.0;
        for (var i = 0; i < 5; i = i + 1) {
          let dist = distance(st, point[i]);
          m_dist = min(m_dist, dist);   // より近ければ更新
        }

        // 最短距離をそのまま明るさに: 点に近い=暗い(0)、遠い=明るい。
        color += vec3f(m_dist);

        // 等高線 (isoline): m_dist を 50 倍して sin → 縞。|sin|>.7 の帯だけ少し暗くして輪郭線に。
        // ↓ この行のコメントを外すと距離場に等高線が乗る。
        // color -= vec3f(step(0.7, abs(sin(50.0 * m_dist))) * 0.3);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "4 cells DF pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト (resolution vec2f + mouse vec2f)
  const uniformValues = new Float32Array(uniformBufferSize / 4);
  const kResolutionOffset = 0;
  const kMouseOffset = 2;

  const uniformBuffer = device.createBuffer({
    label: "uniforms (resolution, mouse)",
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    label: "uniforms bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  // マウス位置 (0〜1 に正規化、y は反転して shader 側の st と同じ向きに)。初期値は中央。
  let mouseX = 0.5;
  let mouseY = 0.5;
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = (e.clientX - rect.left) / rect.width;
    mouseY = 1.0 - (e.clientY - rect.top) / rect.height;
  });

  function render(device: GPUDevice) {
    uniformValues.set([canvas.width, canvas.height], kResolutionOffset);
    uniformValues.set([mouseX, mouseY], kMouseOffset);
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

  const frame = () => {
    render(device);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main();
