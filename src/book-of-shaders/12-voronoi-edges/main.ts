// The Book of Shaders — 12 ボロノイ: セルの境界線までの距離 (Tissue / voronoi edges)
// https://thebookofshaders.com/12/?lan=jp  (Author @patriciogv - 2015 / 元ネタ iq 2013)
//
// これまでの 12-voronoi 系は「一番近い点までの距離 (m_dist)」か「どの点が縄張りの主か (m_point)」
// を見ていた。この回が測るのは第三の量:「一番近いセル境界線までの距離」。縄張りのベタ塗りでも
// 中心からの窪みでもなく、"壁までの距離" を出すと、細い境界線だけが光って細胞組織(Tissue)のような
// 網目になる。
//
// 境界線とは何か。2点 A,B のボロノイ境界は「A と B から等距離な点の集合」= AB の垂直二等分線。
// だからピクセル p から境界までの距離は、p を原点とした座標で
//     mr = (p→最近点A のベクトル),  r = (p→隣の点B のベクトル)
//     中点 m = 0.5*(mr+r),  法線 n = normalize(r-mr)
//     境界までの符号付き距離 = dot(m, n)      … 中点を「AB方向の単位ベクトル」に射影しただけ
// これを全隣接点 B について min すると「一番近い壁まで」が出る。これが iq の voronoi borders。
//
// なので 2 パス構成になる:
//   パス1 (3×3): ふつうのボロノイ。最近点 A を探し、そのベクトル mr とセル番地 mg を覚える。
//   パス2 (5×5): mg の周り 5×5 を見て、A と各 B の垂直二等分線までの距離を min。自分自身(mr==r)は
//                スキップ(法線が 0 になるため dot(mr-r,mr-r)>eps で弾く)。
// パス2 が 5×5 と広いのは、最近点の隣接セルが斜めに 2 マス先まで及ぶことがあるから(取りこぼし防止)。
//
// FP 的に言うと: パス1 は argmin で「勝者 A とその位置 mr」を畳み込む(12-voronoi と同じ)。パス2 は
// その mr を環境に持った別の畳み込みで、各 B に対し「垂直二等分線までの距離」という純関数を min で畳む。
// 出力は (境界距離, mr) の組。前者で線を、後者で中心の点を描く。
//
// ── 1ピクセル st でのトレース (denotational に) ───────────────────────────────
//   st = position/res, y反転                … 0〜1 座標 (本の下origin に合わせる)。
//   st = (st-.5)*.75+.5                      … 中央基準に 0.75 倍ズームアウト (周囲に余白)。
//   d  = dot(st-.5, st-.5)                   … 画面中心からの距離² 。
//   rnd = pow(d, .4)                         … 中心は小さく外周ほど大きい乱雑さ係数。
//   c  = voronoi(20*st, rnd):                … 20倍して 20×20 マスのボロノイを評価。
//     n=floor(x); f=fract(x)                 … セル番地とセル内座標。
//     [パス1 3×3] o=random2(n+g)*rnd; o=.5+.5sin(t+2πo)  … 各セルの点を時間で動かす(rndで位相を散らす)
//                 r=g+o-f; if dot(r,r)<md: md,mr,mg 更新  … 最近点 A を argmin で確定。
//     [パス2 5×5] g=mg+(i,j); 同様に r を作り
//                 if |mr-r|²>eps: md=min(md, dot(.5*(mr+r), normalize(r-mr)))  … 壁までの距離。
//     return (md=境界距離, mr)
//   color = mix(白, 黒, smoothstep(.01,.02,c.x))  … 境界距離が小さい所(=壁の上)だけ白い細線。
//   dd = length(c.yz)                        … 最近点までの距離 (= |mr|)。
//   color += 1 - smoothstep(0,.1,dd)         … セル中心 (dd小) に白いにじみドット。
//
// uniform は resolution と time の 2 つ。

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
    label: "book of shaders 12 - voronoi edges (Tissue)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 2D → 2D の擬似乱数。セルの番地 (整数座標) を入れると、そのセル固有の点 (0〜1) を返す。
      fn random2(p: vec2f) -> vec2f {
        return fract(sin(vec2f(dot(p, vec2f(127.1, 311.7)),
                               dot(p, vec2f(269.5, 183.3)))) * 43758.5453);
      }

      // iq の voronoi distance-to-borders。戻り値 = (最近セル境界までの距離, 最近点へのベクトル mr)。
      fn voronoi(x: vec2f, rnd: f32) -> vec3f {
        let n = floor(x);     // セル番地
        let f = fract(x);     // セル内座標 0〜1

        // ── パス1: ふつうのボロノイ。最近点 A を探す (argmin) ──
        var mg = vec2f(0.0);  // A が属するセルへのオフセット
        var mr = vec2f(0.0);  // ピクセル → A のベクトル
        var md = 8.0;         // 最短距離² (十分大きい初期値)
        for (var j = -1; j <= 1; j = j + 1) {
          for (var i = -1; i <= 1; i = i + 1) {
            let g = vec2f(f32(i), f32(j));
            var o = random2(n + g) * rnd;            // セル乱数 (rnd で位相を散らす)
            o = 0.5 + 0.5 * sin(u.time + 6.2831 * o); // 時間で点をセル内をぐるぐる
            let r = g + o - f;                        // ピクセル → その点
            let d = dot(r, r);                        // 距離² (sqrt 不要で比較)
            if (d < md) {
              md = d;
              mr = r;        // 最近点へのベクトル
              mg = g;        // そのセルのオフセット
            }
          }
        }

        // ── パス2: A と各隣接点 B の垂直二等分線 (=境界) までの距離を min ──
        md = 8.0;
        for (var j = -2; j <= 2; j = j + 1) {
          for (var i = -2; i <= 2; i = i + 1) {
            let g = mg + vec2f(f32(i), f32(j));       // mg を中心に 5×5
            var o = random2(n + g) * rnd;
            o = 0.5 + 0.5 * sin(u.time + 6.2831 * o);
            let r = g + o - f;                        // ピクセル → 点 B
            if (dot(mr - r, mr - r) > 0.00001) {      // 自分自身 (A) はスキップ
              // 中点 0.5*(mr+r) を AB 方向の単位ベクトルに射影 = 境界線までの距離
              md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
            }
          }
        }
        return vec3f(md, mr);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        st = (st - 0.5) * 0.75 + 0.5;             // 中央基準に 0.75 倍ズームアウト
        st.x *= u.resolution.x / u.resolution.y;  // 縦横比補正 (正方形なら 1 倍)

        var color = vec3f(0.0);

        let d = dot(st - 0.5, st - 0.5);          // 画面中心からの距離²
        let c = voronoi(20.0 * st, pow(d, 0.4));  // 外周ほど点が乱れるボロノイ (20×20 マス)

        // 境界線: c.x (壁までの距離) が小さい所だけ白い細線に。
        color = mix(vec3f(1.0), color, smoothstep(0.01, 0.02, c.x));

        // セル中心: 最近点までの距離 |mr| が小さい所に白いにじみドット。
        let dd = length(c.yz);
        color += vec3f(1.0) * (1.0 - smoothstep(0.0, 0.1, dd));

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "voronoi edges (Tissue) pipeline",
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
