// The Book of Shaders — 10 ランダム: Truchet「10 PRINT」迷路 (乱数で向きを選ぶ)
// https://thebookofshaders.com/10/?lan=jp
//
// 10 章の集大成。これまでの部品が全部合流する:
//   - random(floor(st))  … マスごとの種 (10-mosaic で作ったモザイク)
//   - fract(st)          … マス内ローカル座標 (10-mosaic でわざと残しておいたやつ)
//   - 向きを乱数で選ぶ    … 09 の番地回転と同じ発想。ただし規則でなく "乱数" で振る
//
// 仕組み (denotational):
//   image = maze ∘ truchetPattern(・, random∘floor) ∘ fract ∘ (×10)
//   1. st*10 → floor=マス番地 ipos / fract=マス内 fpos に分ける
//   2. random(ipos) でマスの種 (0〜1) を引く
//   3. truchetPattern: 種を 4 区間に量子化し、その区間ごとに fpos を 4 通りに変換
//      (恒等 / x反転 / y反転 / 両反転) = 1 枚のタイルを 4 向きに回す/鏡映する
//   4. maze: 変換後ローカルに対角の帯 (smoothstep の差で太さ 0.1 の線) を描く
//
// なぜ "迷路" に見えるか (1 ピクセル p で):
//   対角線はタイルの 2 辺の中点どうしを結ぶ。隣のマスも辺の中点で線が必ず合うので、
//   向きがランダムに変わっても線が途切れずつながる → 10 PRINT 風の迷路。乱数 (③) が
//   各マスの向きを決め、形 (④) は不変。"乱数は向きの選択にだけ使う" のがミソ。
//
// 「10 PRINT」= Commodore 64 の 1 行プログラム PRINT CHR$(205.5+RND(1)) の再現。
// ランダムに「╱」か「╲」を並べるだけで迷路になる、という有名なジェネラティブ作品。

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
    label: "book of shaders 10 - truchet 10 print maze",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 擬似乱数ハッシュ (10-random と同じ): 座標 → 0〜1 の決定的な "乱数っぽい" 値。
      fn random(st: vec2f) -> f32 {
        return fract(sin(dot(st, vec2f(12.9898, 78.233))) * 43758.5453123);
      }

      // タイルの向きを種 index (0〜1) で 4 通りに振る。fpos を恒等/x反転/y反転/両反転に。
      // index を fract((index-0.5)*2) で広げてから 0.25 刻みの 4 区間に分ける。
      fn truchetPattern(stIn: vec2f, indexIn: f32) -> vec2f {
        let index = fract((indexIn - 0.5) * 2.0);
        var st = stIn;
        if (index > 0.75) {
          st = vec2f(1.0) - st;                 // 両反転 (180°)
        } else if (index > 0.5) {
          st = vec2f(1.0 - st.x, st.y);         // x 反転
        } else if (index > 0.25) {
          st = 1.0 - vec2f(1.0 - st.x, st.y);   // = (st.x, 1-st.y) y 反転
        }
        return st; // index <= 0.25 はそのまま (恒等)
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに
        st = st * 10.0;                      // 10x10 に拡大

        let ipos = floor(st);                // マス番地
        let fpos = fract(st);                // マス内ローカル 0〜1

        // マスの種で fpos を 4 向きのどれかに変換 (乱数で向きを選ぶ)。
        let tile = truchetPattern(fpos, random(ipos));

        // ▼ 迷路: 対角の帯。下側 smoothstep から上側を引いて太さ 0.1 の斜め線に。
        var color = smoothstep(tile.x - 0.1, tile.x, tile.y)
                  - smoothstep(tile.x, tile.x + 0.1, tile.y);

        // ▼ 別デザイン (どれか有効に切替) ▼
        // 円弧 (トルシェの円バージョン):
        // color = (step(length(tile), 0.6) - step(length(tile), 0.4))
        //       + (step(length(tile - vec2f(1.0)), 0.6) - step(length(tile - vec2f(1.0)), 0.4));
        // 三角形 (2 分割):
        // color = step(tile.x, tile.y);

        return vec4f(vec3f(color), 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "truchet pipeline",
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
