// The Book of Shaders — 12 ボロノイ: 4 cells voronoi (最近傍点で平面を分割)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015)
//
// 前回 (12-cells-df) は「一番近い点までの距離」だけを残した = min による畳み込みで、結果はスカラ。
// この回はそこに一歩足す:「どの点が一番近かったか」= その点そのものを覚えておく。min ではなく
// argmin。各ピクセルを "勝った点の色" で塗ると、平面が「ここはこの点の縄張り」という領域に分割
// される。これがボロノイ図(Voronoi)。距離場が見せていた窪みの「集水域」を可視化したもの、と思うと
// 繋がりがよい。隣り合う2点の真ん中で縄張りが切り替わるので、境界は必ず直線(垂直二等分線)になる。
//
// FP 的に言うと: 点の集合を畳み込むのは前回と同じだが、アキュムレータが「最短距離」から
// 「(最短距離, その点)」のペアに太った。だから min (距離だけ畳む) では足りず、if で両方を同時に
// 更新する。color.rg = m_point は「勝者の座標を identity (id 札) として色に焼く」操作。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st = position/res, y反転              … 本(GLSL下origin)に合わせた 0〜1 座標。
//   point[0..3]                           … 固定の特徴点 4 個。point[4] = mouse (追従)。
//   m_dist = 1 ; m_point = (?)            … アキュムレータ:「最短距離」と「その勝者点」。
//   for p in points:                      … 全点を畳み込む。
//     d = distance(st, p)
//     if d < m_dist: m_dist = d ; m_point = p   … より近ければ距離も勝者も更新 (argmin)。
//   color  = m_dist * 2                    … 距離場 (点に近いほど暗い窪み)。×2 で明るめに。
//   color.rg = m_point                     … 勝者の座標 (x,y) を R,G に → 縄張りごとに色が変わる。
//   color -= |sin(80·m_dist)| * 0.07       … 等高線 (前回はコメントアウトだったのを今回は常時ON)。
//   color += 1 - step(.02, m_dist)         … 距離<0.02 だけ白 → 各点の中心に白ドット。
//
// 時間ではなくマウスで動く。uniform は resolution と mouse の 2 つ (time なし)。

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
    label: "book of shaders 12 - 4 cells voronoi",
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

        // アキュムレータ: 最短距離と、その距離を出した勝者点。前回(min)と違い「点」も覚える=argmin。
        var m_dist = 1.0;
        var m_point = vec2f(0.0);
        for (var i = 0; i < 5; i = i + 1) {
          let dist = distance(st, point[i]);
          if (dist < m_dist) {
            m_dist = dist;        // より近ければ最短距離を更新
            m_point = point[i];   // 同時に「誰が勝ったか」も更新
          }
        }

        // 最短距離を明るさに (×2 で明るめ): 点に近い=暗い窪み。
        color += vec3f(m_dist * 2.0);

        // 勝者点の座標 (x,y) を R,G に焼く。縄張りごとに色が一定 → ボロノイ領域が見える。
        color.r = m_point.x;
        color.g = m_point.y;

        // 等高線 (isoline): m_dist を 80 倍して sin → 縞。前回はコメントアウトだった行を今回は常時 ON。
        color -= vec3f(abs(sin(80.0 * m_dist)) * 0.07);

        // 各点の中心 (距離<0.02) だけ白く打つ。
        color += vec3f(1.0 - step(0.02, m_dist));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "4 cells voronoi pipeline",
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
