// The Book of Shaders — 12 セルラーノイズ: タイル化 (cellular noise / Worley)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015)
//
// 前回 (12-cells-tile) で "空間のタイル化" をやった: 画面を格子に切り「各マスに乱数で点を 1 個」
// 置く。ただし自分のマスの点しか見ていなかったので、最短点が隣マスにある場合を取りこぼし、
// マスの境界で距離がカクッと不連続になる。この回はそこを直す: 最短点は必ず "自分 + 隣接 8 マス"
// の 3×3 のどれかに入る (点はマス内に居るから) ので、3×3 を全部見て本当の最短を取る。さらに点を
// 時間で動かす。これで境界がなめらかに繋がった本物のセルラーノイズ(Worley noise)になる。
// 肝は「全点でなく 3×3 だけ調べれば済む = 点が何個あっても定数コスト」という所。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st *= 3                              … 画面を 3×3 マスに拡大した座標。
//   i_st = floor(st)                     … 今いるマスの整数ID (= セルの "住所")。
//   f_st = fract(st)                     … マス内のローカル座標 0〜1。
//   m_dist = 1
//   for y,x ∈ {-1,0,1}:                  … 自分 + 周囲 8 マスの 3×3 を巡回。
//     neighbor = (x,y)                   … 隣マスへのオフセット。
//     point = random2(i_st + neighbor)   … そのマスの特徴点 (マスごとに固定の乱数, 0〜1)。
//     point = .5 + .5·sin(t + 2π·point)  … 時間で点をマス内をぐるぐる動かす (アニメ)。
//     diff  = neighbor + point - f_st    … ピクセル→点 のベクトル。neighbor を足して
//                                          隣マスの点も自分の座標系に並べ直すのがミソ。
//     m_dist = min(m_dist, length(diff)) … 一番近い点までの距離だけ残す。
//   color += m_dist                      … 距離場 (点に近いほど暗い窪み)。
//   color += 1 - step(.02, m_dist)       … 距離 < 0.02 だけ白 → セル中心の点を打つ。
//   color.r += step(.98, f_st.{x,y})     … マスの右/上端を赤に → 格子線を可視化。
//   (isoline はコメントアウト)
//
// uniform は resolution と time の 2 つ (この作例は u_mouse を使わない)。

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
    label: "book of shaders 12 - cellular noise (tiled)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 2D → 2D の擬似乱数。マスの住所 (整数座標) を入れると、そのマス固有の点 (0〜1) を返す。
      // 10 章の random と同じ「dot→sin→巨大倍→fract で折り畳む」ハッシュの 2 成分版。
      fn random2(p: vec2f) -> vec2f {
        return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)),
                               dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st.x *= u.resolution.x / u.resolution.y;  // 画面が正方形なら 1 倍 (縦横比補正)

        var color = vec3f(0.0);

        st *= 3.0;                  // 画面を 3×3 マスに拡大
        let i_st = floor(st);       // 今いるマスの整数ID (住所)
        let f_st = fract(st);       // マス内のローカル座標 0〜1

        var m_dist = 1.0;           // ここまでの最短距離
        for (var y = -1; y <= 1; y = y + 1) {
          for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));            // 隣マスへのオフセット
            var point = random2(i_st + neighbor);           // そのマスの特徴点 (固定乱数)
            point = 0.5 + 0.5 * sin(u.time + 6.2831 * point); // 時間でマス内をぐるぐる
            let diff = neighbor + point - f_st;             // ピクセル→点 のベクトル
            m_dist = min(m_dist, length(diff));             // 近ければ更新
          }
        }

        color += vec3f(m_dist);                             // 距離場
        color += vec3f(1.0 - step(0.02, m_dist));           // セル中心の点
        color.r += step(0.98, f_st.x) + step(0.98, f_st.y); // 格子線 (赤)

        // 等高線 (isoline): ↓コメントを外すと距離場に縞が乗る。
        // color -= vec3f(step(0.7, abs(sin(27.0 * m_dist))) * 0.5);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "cellular noise pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4; // 16 バイト (resolution vec2f + time f32 + padding)
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