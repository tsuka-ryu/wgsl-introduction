// The Book of Shaders — 09 パターン: タータンチェック (白黒グレー+赤の参照に合わせる)
// https://thebookofshaders.com/09/?lan=jp
//
// タータンは「異なるパターンのレイヤーを重ねる」典型。5 層を重ねて作る:
//
//   レイヤー0: 全体回転            … 参照画像のように斜めに織られて見せる
//   レイヤー1: 縦糸 (warp) の縞    … 白黒グレーの sett を x 方向に並べる
//   レイヤー2: 横糸 (weft) の縞    … 同じ sett を y 方向に並べる
//   レイヤー3: 織り (twill)        … どちらの糸が上に出るかを 2/2 綾織りで切替
//   レイヤー4: 赤のオーバーチェック … 赤を "糸の色" として warp/weft に混ぜ、綾織りに
//                                    巻き込む。スレッド単位に量子化するので縁がギザギザに
//   レイヤー5: 糸の陰影            … 上の糸を明るく/下を暗く して織物の立体感
//
// sett のリズムは不均等: [大ブロック] と [細チェックの塊] が交互。これが参照画像の
// "均等でない格子" の正体 (大きな白/グレーの四角 + 周りの細かい黒白チェック)。
//
// なぜ "チェック" に見えるか (1 ピクセルで):
//   warp は x だけ、weft は y だけで決まる縞。重ねると格子になる。さらに各点で
//   twill マスクが「warp か weft か」を選ぶので、白糸×黒糸が交差する帯は細かく
//   白黒が交互に出て、遠目に中間グレーのチェックに見える = タータンの "にじんだ格子"。
//
// sett (色と幅の並び) はパレットの心臓。白・黒・グレーの左右対称な配色にした。

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
    label: "book of shaders 09 - original tartan plaid",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // sett: 1 リピート (0〜1) の中の "色の帯" を返す。白黒グレーの左右対称配色。
      // リズムは不均等: [大グレー] → [細チェック黒白×9] → [大白] → [細チェック×9] の繰り返し。
      // この "細かいチェックの塊 + 大きなブロック" の交互が、参照画像の不均等な格子の正体。
      // edges = 各帯の右端 (累積)、cols = その帯の色。t の属する帯の色を返す。
      fn settColor(t: f32) -> vec3f {
        let x = fract(t);
        let white = vec3f(0.93, 0.93, 0.93);
        let gray  = vec3f(0.55, 0.55, 0.55);
        let black = vec3f(0.06, 0.06, 0.06);

        // 大ブロック (黒/白/グレー) が主役。境目に細い黒白の guard を 3 本だけ挟む。
        var edges = array<f32, 17>(
          0.10,                       // 大グレー (端: 継ぎ目で大ブロックに)
          0.12, 0.14, 0.16,           // guard 細チェック
          0.32,                       // 大ブロック 黒
          0.34, 0.36, 0.38,           // guard
          0.62,                       // 大ブロック 白 (中央)
          0.64, 0.66, 0.68,           // guard
          0.84,                       // 大ブロック 黒
          0.86, 0.88, 0.90,           // guard
          1.0                         // 大グレー (端へ続く)
        );
        var cols = array<vec3f, 17>(
          gray,
          white, black, white,
          black,
          white, black, white,
          white,
          white, black, white,
          black,
          white, black, white,
          gray
        );

        for (var i = 0; i < 17; i = i + 1) {
          if (x < edges[i]) { return cols[i]; }
        }
        return gray;
      }

      fn rotate2d(st: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (st - vec2f(0.5)) + vec2f(0.5);
      }

      // 値 v から最寄りの整数までの距離 (0=整数線上, 0.5=ちょうど中間)。赤線の判定用。
      fn distToInt(v: f32) -> f32 {
        return abs(fract(v + 0.5) - 0.5);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;

        // レイヤー0: 全体を少し回して斜め織りに見せる (参照画像に合わせる)。
        st = rotate2d(st, -0.42);

        let repeats = 2.0; // 画面に sett を 2 回くり返す

        let threads = 170.0;
        let cx = i32(floor(st.x * threads));
        let cy = i32(floor(st.y * threads));

        // レイヤー1 & 2: 同じ sett を x と y に並べる (縦糸・横糸の縞)。
        var warp = settColor(st.x * repeats); // 縦糸: x だけで決まる
        var weft = settColor(st.y * repeats); // 横糸: y だけで決まる

        // レイヤー4: 赤のオーバーチェックを "糸の色" として warp/weft に混ぜる。
        // 線位置はスレッド単位に量子化 (糸の中心で判定) するので、線の縁が糸目に沿って
        // ギザギザになり、綾織りにも巻き込まれて織り込まれた赤線に見える。
        let red = vec3f(0.80, 0.10, 0.12);
        let lw = 0.015;                                      // 線の太さ (sett 座標, ≒1 糸)
        let qx = (f32(cx) + 0.5) / threads;                 // 糸の中心 x (st 座標)
        let qy = (f32(cy) + 0.5) / threads;                 // 糸の中心 y
        if (distToInt(qx * repeats + 0.5) < lw) { warp = red; } // この縦糸は赤糸
        if (distToInt(qy * repeats + 0.5) < lw) { weft = red; } // この横糸は赤糸

        // レイヤー3: 2/2 綾織り。糸の格子を作り、対角の位相でどちらが上かを切替。
        let d = cx - cy;
        let phase = ((d % 4) + 4) % 4;       // 0..3 (対角に進む)
        let warpOnTop = phase < 2;           // 2 本上→2 本下 の綾織り

        var color = select(weft, warp, warpOnTop); // 上に出た糸の色 (赤糸も同じ織りに従う)

        // レイヤー5: 織りの陰影。上の糸を明るく、下を少し暗く (千鳥に見えないよう控えめ)。
        color = color * select(0.88, 1.0, warpOnTop);

        // 仕上げ: 糸の隙間にうっすら影を入れて織物らしく。
        let g = fract(st * threads);
        let groove = smoothstep(0.0, 0.5, g.x) * smoothstep(1.0, 0.5, g.x)
                   * smoothstep(0.0, 0.5, g.y) * smoothstep(1.0, 0.5, g.y);
        color = color * (0.90 + 0.10 * groove);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "tartan pipeline",
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: presentationFormat }] },
  });

  const uniformBufferSize = 4 * 4;
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