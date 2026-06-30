// The Book of Shaders — 12 メタボール (Metaballs / Author @patriciogv - 2015)
// https://thebookofshaders.com/12/?lan=jp
//
// 土台は 12-cellular-noise とまったく同じ: 画面を 5×5 のタイルに切り、各マスに乱数で点を 1 個
// 置き、時間で動かし、3×3 近傍を巡回して距離を測る。違いはたった 1 行、距離の合成のしかた:
//
//   セルラーノイズ : m_dist = min(m_dist, dist)        … 一番近い点までの距離だけ残す
//   メタボール     : m_dist = min(m_dist, m_dist*dist) … 近い点の距離を "掛けて" いく
//
// なぜ掛けると塊が融合するのか。点の近くでは dist < 1 なので、掛けるたび m_dist は小さくなる。
// 近い点が 1 個なら 1·d でほぼ d のまま、だが点が 2 個近いと d1·d2 と二重に小さくなり、谷が
// 深く・広がって隣の谷と地続きになる。これが「2 つの球が近づくと表面が繋がる」メタボールの
// 等値面そのもの。最後に step(0.06, m_dist) でしきい値を切ると、谷 (m_dist が小さい所) が黒、
// それ以外が白 → 黒いブヨブヨした塊が浮かぶ。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st *= 5                                … 画面を 5×5 マスに拡大した座標。
//   i_st = floor(st)                       … 今いるマスの整数ID (= セルの "住所")。
//   f_st = fract(st)                       … マス内のローカル座標 0〜1。
//   m_dist = 1
//   for y,x ∈ {-1,0,1}:                    … 自分 + 周囲 8 マスの 3×3 を巡回。
//     neighbor = (x,y)                     … 隣マスへのオフセット。
//     offset = random2(i_st + neighbor)    … そのマスの特徴点 (マスごとに固定の乱数, 0〜1)。
//     offset = .5 + .5·sin(t + 2π·offset)  … 時間で点をマス内をぐるぐる動かす (アニメ)。
//     pos  = neighbor + offset - f_st      … ピクセル→点 のベクトル (隣マスも同座標系へ)。
//     dist = length(pos)                   … その点までの距離。
//     m_dist = min(m_dist, m_dist*dist)    ★ 距離を掛けて谷を深める = メタボール合成。
//   color += step(0.06, m_dist)            … 谷 (< 0.06) は黒, それ以外は白で塊を切り出す。
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
    label: "book of shaders 12 - metaballs",
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

        var m_dist = 1.0;           // ここまでの合成距離
        for (var y = -1; y <= 1; y = y + 1) {
          for (var x = -1; x <= 1; x = x + 1) {
            let neighbor = vec2f(f32(x), f32(y));               // 隣マスへのオフセット
            var offset = random2(i_st + neighbor);              // そのマスの特徴点 (固定乱数)
            offset = 0.5 + 0.5 * sin(u.time + 6.2831 * offset); // 時間でマス内をぐるぐる
            let pos = neighbor + offset - f_st;                 // ピクセル→点 のベクトル
            let dist = length(pos);
            m_dist = min(m_dist, m_dist * dist);                // ★ 掛けて谷を深める (メタボール)
          }
        }

        color += vec3f(step(0.06, m_dist));   // 谷 (<0.06) は黒, それ以外は白 → 塊を切り出す

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "metaballs pipeline",
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