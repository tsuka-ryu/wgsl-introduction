// The Book of Shaders — 12 セルラーノイズ: 空間をタイル分割 (各セルに1点)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015)
//
// 前回 (12-cells-df) は画面全体に 4〜5 個の点を置き、全点との距離を測った。点を増やすと
// 「全ピクセル × 全点」で重くなる。そこで定番の手: 画面を格子 (タイル) に切り、各セルに点を 1 個だけ
// 置く。自分のセルの点までの距離を測れば、少ない計算で点をいくらでも増やせる。これが
// セルラーノイズ (cellular noise) の基本構造で、次に近セルも見ればボロノイ分割へ広がる。
//
// 10 章 random / 11 章 noise と同じ floor / fract の二段構え:
//   floor(st) = i_st … 「どのセルにいるか」セルの番地 (整数座標)。これを乱数の種にする。
//   fract(st) = f_st … 「セル内のどこにいるか」0〜1 のローカル座標。距離はこの中で測る。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st *= 3                       … 画面を 3×3 マスに分割 (タイルを 3 倍に縮めて敷き詰める)。
//   i_st = floor(st)              … 自分のセルの番地。
//   f_st = fract(st)              … セル内ローカル座標 (0〜1)。
//   point = random2(i_st)         … セルの番地から決まる、そのセル唯一の特徴点 (0〜1 の中)。
//   dist  = length(point - f_st)  … ローカル座標での、その点までの距離。
//   color = dist                  … 距離をそのまま明るさに → 点の周りが暗い窪み (距離場)。
//   + 中心ドット: 1-step(.02,dist) … dist<.02 のとき 1 → 各セルの特徴点を白い点で可視化。
//   + 格子線: step(.98, f_st.xy)   … セルの右端/上端だけ赤く → タイル境界を見せる (R チャンネル)。
//
// random2 は 0〜1 を返す版 (勾配ノイズの -1〜1 版とは別)。点はセル内 0〜1 に収まる。
//
// この shader は静止画 (uniform は resolution のみ)。WGSL 末尾の 2 行コメントを外すと
// 等高線を重ねたり、点を u.time でセル内を回遊させてアニメにできる (time uniform は配線済み)。

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
        time: f32,          // 静止版では未使用。下のアニメ版コメントを外すと使われる。
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 座標 → セル内のランダムな 2D 点 (0〜1)。2本の内積でハッシュし fract(sin(...)) を取る。
      fn random2(p: vec2f) -> vec2f {
        let st = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
        return fract(sin(st) * 43758.5453);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st.x *= u.resolution.x / u.resolution.y;  // 縦横比補正 (正方形なら 1 倍)

        var color = vec3f(0.0);

        // 画面を 3×3 のタイルに分割。
        st *= 3.0;

        let i_st = floor(st);  // セルの番地 (整数) … 乱数の種
        let f_st = fract(st);  // セル内ローカル座標 (0〜1)

        // セルの番地から決まる、そのセル唯一の特徴点 (0〜1 の中)。
        let point = random2(i_st);
        // アニメ版: 点をセル内で回遊させる (上の行をコメントアウトしてこちらを使う)。
        // let point = 0.5 + 0.5 * sin(u.time + 6.2831 * random2(i_st));

        let diff = point - f_st;
        let dist = length(diff);

        // 最短距離 (= 自セルの点までの距離) をそのまま明るさに → 点の周りが暗い窪み。
        color += vec3f(dist);

        // セル中心 (特徴点) を白いドットで可視化。dist<.02 のとき 1。
        color += vec3f(1.0 - step(0.02, dist));

        // タイル境界線: セルの右端/上端 (f_st>.98) だけ R チャンネルに加えて赤い格子に。
        color.r += step(0.98, f_st.x) + step(0.98, f_st.y);

        // 等高線 (isoline): dist を 27 倍して sin → 縞。外すと距離場に等高線が乗る。
        // color -= vec3f(step(0.7, abs(sin(27.0 * dist))) * 0.5);

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "cellular noise (tiled) pipeline",
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
