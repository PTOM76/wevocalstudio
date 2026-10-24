// 先に計算して鳴らす（anticipate.ts）の進み具合を、状態バーのゲージ（PevenMUI の jobs）に出す。設定の「先に計算した量を表示する」がオンのときだけ
import { startJob } from 'pevenmui'

type Job = ReturnType<typeof startJob>

/** ゲージの名前を作る（止めている間の準備か、再生中の先読みか。null なら出さない） */
export type GaugeLabel = (kind: 'warm' | 'ahead', track: string) => string

export class AntGauge {
  label: GaugeLabel | null = null
  private ahead = new Map<string, Job>()

  /** 止めている間の準備を始める。返すものの update で進み（0〜1）、end で終わりを知らせる */
  warm(tracks: string[]): Pick<Job, 'update' | 'end'> {
    // 前の準備は、新しい準備が始まった時点で終わり（古い方は作りかけのかたまりが終わるまで抜けないので、ゲージだけ先に消す）
    this.warming?.end()
    this.warming = null
    if (!this.label || !tracks.length) return { update() {}, end() {} }
    const job = startJob('anticipate', this.label('warm', tracks.join(', ')))
    this.warming = job
    return job
  }
  private warming: Job | null = null

  /** 再生中に、トラックの音が再生位置からどこまでできているか（0〜1。AHEAD に対する割合）を出す */
  setAhead(id: string, track: string, ratio: number) {
    if (!this.label) return this.clear(id)
    let job = this.ahead.get(id)
    if (!job) {
      job = startJob('anticipate', this.label('ahead', track))
      this.ahead.set(id, job)
    }
    job.update(Math.max(0, Math.min(1, ratio)))
  }

  /** トラックの先読みをやめた */
  clear(id: string) {
    this.ahead.get(id)?.end()
    this.ahead.delete(id)
  }

  /** 再生を止めた */
  clearAll() {
    for (const job of this.ahead.values()) job.end()
    this.ahead.clear()
  }
}
