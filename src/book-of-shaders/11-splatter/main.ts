// The Book of Shaders — 11 ノイズ: インク飛沫 (ロールシャッハ / ink splatter)
// https://thebookofshaders.com/11/?lan=jp
// Gradient Noise by Inigo Quilez - iq/2013  https://www.shadertoy.com/view/XdXGW8
//
// 勾配ノイズ (11-gradient-noise) をそのまま絵作りに使う応用編。新しい数学はなく、
// 「ノイズで座標を歪める (domain warp)」+「smoothstep で閾値を切る」の組合せだけ。
//
// 1ピクセル st (0〜1, アスペクト補正済み) でのトレース (denotational に):
//
//   ① 座標を歪める:  st += noise(st*2.0)
//      自分のいる場所の noise 値ぶん、自分を斜めにずらす。まっすぐな格子で評価される
//      はずだった noise が、場所ごとに違う方向へ流される → 縁がにじんでインクが滲んだ形に。
//      t はにじみの強さ。t=0 なら歪みなし、大きいほど大きく流れる (時間で揺らすと動く)。
//
//   ② 大きな黒い染み:  color = smoothstep(0.18, 0.2, noise(st))
//      歪めた座標で noise を取り、0.18〜0.2 を境に 0/1 にパキッと二値化。
//      しきい値より高い領域だけ 1 (白) になり、大きな塊が浮かび上がる。
//
//   ③ 飛沫を足す:  color += smoothstep(0.15, 0.2, noise(st*10.0))
//      st*10 で 10倍細かいノイズを別に取り、同じく二値化して加算。
//      細かい点々 (飛び散ったインク) が ② の塊の上に重なる。
//
//   ④ 飛沫に穴をあける:  color -= smoothstep(0.35, 0.4, noise(st*10.0))
//      ③ と同じ細かいノイズの「より高い所」を引き算。点の中心がくり抜かれ、
//      ベタ塗りでなく粒立った質感になる。
//
//   ⑤ 反転して出力:  return 1.0 - color
//      ここまで color は「インクのある所ほど明るい」。1-color で白黒を反転し、
//      紙(白)の上に黒インク、という見た目にする。
//
// noise は -1〜1 を返す勾配ノイズ。smoothstep のしきい値 (0.18 など) はその範囲で効く。

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
    label: "book of shaders 11 - ink splatter",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 格子点 → ランダムな 2D ベクトル (-1〜1)。各格子点の "勾配 (斜面の向き)"。
      fn random2(p: vec2f) -> vec2f {
        let st = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(st) * 43758.5453123);
      }

      // Gradient Noise by Inigo Quilez - iq/2013。4隅で dot(勾配, 隅→自分の変位) を双線形補間。戻り値 -1〜1。
      fn noise(st: vec2f) -> f32 {
        let i = floor(st);
        let f = fract(st);
        let w = f * f * (3.0 - 2.0 * f); // smoothstep 重み (角を丸める)
        return mix(
          mix(dot(random2(i + vec2f(0.0, 0.0)), f - vec2f(0.0, 0.0)),
              dot(random2(i + vec2f(1.0, 0.0)), f - vec2f(1.0, 0.0)), w.x),
          mix(dot(random2(i + vec2f(0.0, 1.0)), f - vec2f(0.0, 1.0)),
              dot(random2(i + vec2f(1.0, 1.0)), f - vec2f(1.0, 1.0)), w.x),
          w.y
        );
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        // GLSL は y が下から上。WebGPU は上から下なので反転して本と合わせる。
        var st = position.xy / u.resolution;
        st.y = 1.0 - st.y;
        // 縦横比の補正 (本では st.x *= u_resolution.x/u_resolution.y)。
        st.x *= u.resolution.x / u.resolution.y;

        // ============================================================
        // 各行を // でコメントアウトすると、その効果だけ消える。
        // 1 つずつ無効化すると「どの行が何をしているか」が見える。
        //   ・① をコメントアウト → 歪みが消えてカクっとした塊になる
        //   ・③ をコメントアウト → 細かい飛沫が消える
        //   ・④ をコメントアウト → 飛沫の穴が消えてベタ塗りになる
        //   ・⑤ をコメントアウト → 白黒が反転 (黒地に白インク) する
        // ============================================================

        // にじみの強さ。本では t=1.0 固定。揺らしたいなら下行に差し替え:
        let t = 1.0;
        // let t = abs(1.0 - sin(u.time * 0.1)) * 5.0;

        // ① 座標をノイズで歪める (domain warp)。← コメントアウトで歪みが消える
        st += noise(st * 2.0) * t;

        // ② 大きな黒い染み (これが土台。消すと何も出ない)。
        var color = vec3f(1.0) * smoothstep(0.18, 0.2, noise(st));

        // ③ 細かい飛沫を足す。← コメントアウトで飛沫が消える
        color += smoothstep(0.15, 0.2, noise(st * 15.0));

        // ④ 飛沫に穴をあけて粒立たせる。← コメントアウトでベタ塗りに
        color -= smoothstep(0.35, 0.4, noise(st * 15.0));

        // ⑤ 白黒反転して「白い紙に黒インク」にする。← コメントアウトで下行を有効化すると反転前
        return vec4f(1.0 - color, 1.0);
        // return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "ink splatter pipeline",
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
