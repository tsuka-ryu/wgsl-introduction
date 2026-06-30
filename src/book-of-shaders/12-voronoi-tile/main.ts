// The Book of Shaders — 12 ボロノイ: タイル化した Simple Voronoi (3×3近傍 + アニメ)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015)
//
// 2 つの系譜がここで合流する:
//   - 12-cellular-noise … 3×3 タイルで「最短距離 m_dist」だけ残した = 距離場。
//   - 12-voronoi        … 全点を畳み込み「勝った点そのもの m_point」を残した = 縄張り分割。
// この回は両方を同じ 3×3 ループでやる: タイル化(=点が無限でも定数コスト)のまま、min ではなく
// argmin にして m_dist と m_point を同時に更新する。各ピクセルを「勝者点の位置」で塗ると、
// 同じ点に属するピクセル群が同色のベタ塗り領域になり、ボロノイ図(セル分割)が立ち上がる。
// 距離場が「点までの距離」なら、ボロノイは「どの点の縄張りか」。同じ畳み込みから両方取れる。
//
// FP 的に言うと: アキュムレータが「最短距離」から「(最短距離, その勝者点)」のペアに太った版を、
// タイル走査 (3×3) の上で回しているだけ。min では足りず if で両者を同時更新する所が前回と同じ。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st *= 5                              … 画面を 5×5 マスに拡大した座標。
//   i_st = floor(st)                     … 今いるマスの整数ID (= セルの "住所")。
//   f_st = fract(st)                     … マス内のローカル座標 0〜1。
//   m_dist = 10 ; m_point = (?)          … アキュムレータ:「最短距離」と「その勝者点」。
//   for y,x ∈ {-1,0,1}:                  … 自分 + 周囲 8 マスの 3×3 を巡回。
//     neighbor = (x,y)                   … 隣マスへのオフセット。
//     point = random2(i_st + neighbor)   … そのマスの特徴点 (マスごとに固定の乱数, 0〜1)。
//     point = .5 + .5·sin(t + 2π·point)  … 時間で点をマス内をぐるぐる動かす (アニメ)。
//     diff  = neighbor + point - f_st    … ピクセル→点 のベクトル。
//     if length(diff) < m_dist:          … より近い点が見つかったら…(argmin)
//        m_dist  = length(diff)          …   最短距離を更新し、
//        m_point = point                 …   その "縄張りの主" を覚える。
//   color += dot(m_point, (.3,.6))       … 縄張りの主の位置で色を決める → セルごとのベタ塗り。
//   color -= abs(sin(40·m_dist))·0.07    … 距離場に薄い等高線を重ねて凹凸を演出。
//   color += 1 - step(.05, m_dist)       … 距離 < 0.05 だけ白 → セル中心の点を打つ。
//   color.r += step(.98, f_st.{x,y})     … マスの右/上端を赤に → 格子線を可視化。
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
    label: "book of shaders 12 - simple voronoi (tiled)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 2D → 2D の擬似乱数。マスの住所 (整数座標) を入れると、そのマス固有の点 (0〜1) を返す。
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

        st *= 5.0;                  // 画面を 5×5 マスに拡大
        let i_st = floor(st);       // 今いるマスの整数ID (住所)
        let f_st = fract(st);       // マス内のローカル座標 0〜1

        var m_dist = 10.0;          // ここまでの最短距離 (十分大きい初期値)
        var m_point = vec2f(0.0);   // 最短だった点 = このピクセルの "縄張りの主"
        for (var y = -1; y <= 1; y = y + 1) {
          for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));            // 隣マスへのオフセット
            var point = random2(i_st + neighbor);           // そのマスの特徴点 (固定乱数)
            point = 0.5 + 0.5 * sin(u.time + 6.2831 * point); // 時間でマス内をぐるぐる
            let diff = neighbor + point - f_st;             // ピクセル→点 のベクトル
            let dist = length(diff);
            if (dist < m_dist) {
              m_dist = dist;
              m_point = point;                              // 縄張りの主を更新 (argmin)
            }
          }
        }

        // 縄張りの主の位置で色を決める → 同じ点に属するピクセルが同色のベタ塗りに = ボロノイセル
        color += vec3f(dot(m_point, vec2f(0.3, 0.6)));

        // 距離場に薄い等高線を重ねて凹凸を演出
        color -= vec3f(abs(sin(40.0 * m_dist)) * 0.07);

        color += vec3f(1.0 - step(0.05, m_dist));           // セル中心の点
        color.r += step(0.98, f_st.x) + step(0.98, f_st.y); // 格子線 (赤)

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "simple voronoi (tiled) pipeline",
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
