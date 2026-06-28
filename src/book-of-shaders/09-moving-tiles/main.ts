// The Book of Shaders — 09 パターン: スライドするタイル (時間でずらす, アニメ)
// https://thebookofshaders.com/09/?lan=jp
//
// 09-brick は「場所 (段の偶奇) でずらす」静止パターンだった。今度は同じ "ずらし" の
// 量を時間 u.time で動かす。すると 1 列/1 行おきに逆方向へ滑り、スライドパズルのように
// タイルが入れ替わり続ける。"ずらし量" を定数→時間関数にしただけ、が主題。
//
// 時間の使い方 (フェーズで縦/横を交互に切替):
//   t = fract(time) は 0→1 を繰り返すノコギリ波。これを 1 サイクルとして:
//     t <= 0.5 … 縦に動かすフェーズ (st.y をずらす)
//     t >  0.5 … 横に動かすフェーズ (st.x をずらす)
//   ずらし量は fract(time)*2.0。各フェーズ内で 0→1 (実質) 滑り、半分で役割交代。
//
// なぜ "1 列おきに逆向き" になるか (1 ピクセル p で追う, 横フェーズの例):
//   st *= 10 後、st.y の整数部が「何段目か」。fract(st.y * 0.5) は段番号を 2 で畳んで
//   半分にした値 → 偶数段で [0,0.5)、奇数段で [0.5,1.0)。これが >0.5 かで段を 2 色に
//   分け、偶数段は st.x += 量 (右へ)、奇数段は st.x -= 量 (左へ)。隣の段が逆向きに
//   滑るので、互い違いに流れて見える。最後に fract で各マスを 0〜1 に畳む。
//
// 形 (circle) は畳んだ後のローカル座標を読むだけ。動いているのは "座標の畳み方" の方。

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
    label: "book of shaders 09 - moving tiles",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      // 時間でずらすタイル化: 拡大 → フェーズで縦/横を選び 1 列(行)おきに逆向きへ滑らせ
      // → fract で 0〜1 に畳む。ずらし量だけが時間関数になっている。
      fn movingTiles(stIn: vec2f, zoom: f32, speed: f32) -> vec2f {
        var st = stIn * zoom;
        let time = u.time * speed;
        let amt = fract(time) * 2.0; // 各フェーズでのずらし量 (0→2)

        if (fract(time) > 0.5) {
          // 横フェーズ: 段の偶奇で x を逆向きに
          if (fract(st.y * 0.5) > 0.5) {
            st.x += amt;
          } else {
            st.x -= amt;
          }
        } else {
          // 縦フェーズ: 列の偶奇で y を逆向きに
          if (fract(st.x * 0.5) > 0.5) {
            st.y += amt;
          } else {
            st.y -= amt;
          }
        }
        return fract(st);
      }

      // 円: 中心 0.5 からの距離で塗る (07 の circle と同系)。dot*3.14 で半径スケール調整、
      // smoothstep で縁をぼかす。返り値 1=円の内側。
      fn circle(st: vec2f, radius: f32) -> f32 {
        let pos = vec2f(0.5) - st;
        return smoothstep(1.0 - radius,
                          1.0 - radius + radius * 0.2,
                          1.0 - dot(pos, pos) * 3.14);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに
        st.x *= u.resolution.x / u.resolution.y; // アスペクト比補正 (マスを正方形に)

        st = movingTiles(st, 10.0, 0.5); // 10x10 に畳み、時間でスライド

        let color = vec3f(1.0 - circle(st, 0.3)); // 各マスに円 (反転して黒円・白地)

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "moving tiles pipeline",
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
