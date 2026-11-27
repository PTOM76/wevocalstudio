// 組み込みの EQ の processor（wevocal-lib の eqProcessor.ts）を Worker のシムで回し、帯の中心の正弦波が帯の dB だけ大きくなるか、0 dB では変わらないかを確かめる
import { beforeAll, describe, expect, it } from 'vitest'
import { EQ_PROCESSOR_NAME, EQ_PROCESSOR_SOURCE } from 'wevocal-lib'
import { installScope, loadProcessorSource, ProcessorRunner, QUANTUM } from 'wevocal-lib/stream'

const SR = 48000

/** f Hz の正弦波を通し、最後の 0.1 秒の振幅（最大の絶対値）を返す */
function gainAt(values: Record<string, number>, f: number) {
  const r = new ProcessorRunner(EQ_PROCESSOR_NAME, {})
  for (const [k, v] of Object.entries(values)) r.set(k, v)
  const blocks = Math.ceil((SR * 0.5) / QUANTUM)
  const tail = Math.ceil((SR * 0.1) / QUANTUM)
  let peak = 0
  const buf = new Float32Array(QUANTUM)
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < QUANTUM; i++) buf[i] = 0.1 * Math.sin((2 * Math.PI * f * (b * QUANTUM + i)) / SR)
    r.process(buf, buf)
    if (b >= blocks - tail) for (const v of r.outL) peak = Math.max(peak, Math.abs(v))
  }
  return 20 * Math.log10(peak / 0.1)
}

describe('EQ の processor', () => {
  beforeAll(() => {
    installScope(SR)
    loadProcessorSource(EQ_PROCESSOR_SOURCE)
  })

  it('10 帯の 1 kHz（b5）を +6 dB にすると、1 kHz が約 6 dB 大きくなる', () => {
    expect(gainAt({ b5: 6 }, 1000)).toBeCloseTo(6, 1)
  })

  it('31 帯の 1 kHz（b17）を -12 dB にすると、1 kHz が約 12 dB 小さくなる', () => {
    expect(gainAt({ bands: 1, b17: -12 }, 1000)).toBeCloseTo(-12, 1)
  })

  it('全部 0 dB なら変わらない', () => {
    expect(Math.abs(gainAt({}, 440))).toBeLessThan(0.01)
  })

  it('上限（±12 dB）を超える値は丸める', () => {
    expect(gainAt({ b5: 20 }, 1000)).toBeCloseTo(12, 1)
  })
})
