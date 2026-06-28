// The Book of Shaders — 09 パターン: 番地回転の三角タイルを上下左右にスライド
// https://thebookofshaders.com/09/?lan=jp
//
// 09-rotate-tile-pattern (静止・三角形) を、09-moving-tiles の「上下左右スライド」で
// 動かしたもの。形 (三角形) も番地回転もそのまま、"動かし方" だけ差し替える。
//
// 向きは "マスの配置" で決める: マスの整数座標 (floor) をハッシュして 0..3 を引き、
// そのマスを丸ごと 90°刻みで回す。だから隣り合うマスで向きがバラバラに散る。
// (本家 rotateTilePattern は番地を "マス内の小数位置" から作るので全マス同じ 2x2
//  モチーフの繰り返しだった。ここは番地を floor=マス自体から作るのが違い。)
//
// 構造 (denotational):
//   image = step(x,y) ∘ (マス番地で回転) ∘ (movingTiles で時間スライドした座標)
//   - movingTiles: st を zoom 倍し、フェーズで縦/横に、列(段)の偶奇で逆向きに滑らせる
//                  (09-moving-tiles と同じ。ただし最後の fract はやめ、整数部=マス番地を残す)
//   - floor(g)=マス番地 ipos / fract(g)=マス内ローカル fpos に取り分ける
//   - hash(ipos) で 0..3 を引き、fpos を 90°×その値だけ回す
//   - step(x,y): 対角線で割る白黒の三角形
//
// 09-rotate-tile-anim との違い: あちらは sin で「回転」を往復させた。こちらは座標を
// 縦横に「平行移動」させる。同じ三角タイルでも、回す vs 滑らす で動きの質が変わる。
//
// 1 ピクセル p で: movingTiles が p の属するマスを時間で縦横にずらす → 滑った先のマス
// 番地 ipos が変わると hash が別の向きを返す → 三角がそのマス固有の向きで描かれる。
// マスが流れるたびに向きが入れ替わり、バラバラの三角がスクロールして見える。

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
    label: "book of shaders 09 - rotate tile pattern (moving)",
    code: /* wgsl */ `
      struct Uniforms {
        resolution: vec2f,
        time: f32,
      };
      @group(0) @binding(0) var<uniform> u: Uniforms;

      const PI = 3.14159265358979323846;

      // 中心 0.5 を軸にローカル座標を回転 (08-rotate と同じ)。
      fn rotate2D(stIn: vec2f, angle: f32) -> vec2f {
        let c = cos(angle);
        let s = sin(angle);
        let m = mat2x2f(c, -s, s, c);
        return m * (stIn - vec2f(0.5)) + vec2f(0.5);
      }

      // 09-moving-tiles と同じスライド: 拡大 → フェーズで縦/横、列(段)の偶奇で逆向きに
      // 滑らせる。ただし最後に fract せず "ずらした座標" を返す (呼び側で floor=マス番地 /
      // fract=マス内ローカル に取り分けたいため)。
      fn movingTiles(stIn: vec2f, zoom: f32, speed: f32) -> vec2f {
        var st = stIn * zoom;
        let time = u.time * speed;
        let amt = fract(time) * 2.0;

        if (fract(time) > 0.5) {
          if (fract(st.y * 0.5) > 0.5) { st.x += amt; } else { st.x -= amt; }
        } else {
          if (fract(st.x * 0.5) > 0.5) { st.y += amt; } else { st.y -= amt; }
        }
        return st;
      }

      // マスの整数座標 → 擬似ランダムな 0〜1 (定番の sin ハッシュ)。
      fn hash(p: vec2f) -> f32 {
        return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
      }

      @vertex fn vs(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
        let pos = array(vec2f(-1.0, 3.0), vec2f(3.0, -1.0), vec2f(-1.0, -1.0));
        return vec4f(pos[vertexIndex], 0.0, 1.0);
      }

      @fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
        var st = position.xy / u.resolution; // 0〜1 の画面座標
        st.y = 1.0 - st.y;                   // GL と同じく y を上向きに

        let g = movingTiles(st, 9.0, 0.5); // 9x9 を上下左右にスライド (整数部=マス番地)
        let ipos = floor(g);               // マス番地
        var fpos = fract(g);               // マス内ローカル 0〜1

        // マス番地をハッシュして 0..3 を引き、そのマスを 90°×idx 回す → 向きがバラバラに。
        let idx = floor(hash(ipos) * 4.0);
        fpos = rotate2D(fpos, PI * 0.5 * idx);

        let color = vec3f(step(fpos.x, fpos.y)); // 対角線で割る三角形

        return vec4f(color, 1.0);
      }
    `,
  });

  const pipeline = device.createRenderPipeline({
    label: "rotate tile moving pipeline",
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
