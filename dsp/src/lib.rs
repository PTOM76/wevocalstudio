//! WeVocal Studio の wasm。wevocal-lib のピッチ変更とピッチカーブ（WeVocalSynth と同じ処理方式）とテンポの解析を、Worker から呼べる C ABI で公開するだけ。

use std::cell::RefCell;
use wevocal_lib::{curve, formant, process_with_progress, segment, tempo, voices, Algorithm, Formant};

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    /// ホスト（Worker）が `env.report_progress` として渡す（WeVocalSynth と同じ）。0〜1
    fn report_progress(p: f64);
}

/// 進み具合を Worker に知らせる（ゲージに出す）
fn host_progress(p: f64) {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        report_progress(p)
    };
    #[cfg(not(target_arch = "wasm32"))]
    let _ = p;
}

thread_local! {
    static OUTPUT: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// 和音を 2 つの声に分け（試作。`by` は 0 = 高さ、1 = 音量）、フレーム数（= `frames`）を返す（WeVocalSynth と同じ）。
/// 結果は `output_ptr` で、A の全チャンネル、B の全チャンネルの順のプレーナー形式
///
/// # Safety
/// `input` は `frames * channels` 個の有効な f32 を指していること。
#[no_mangle]
pub unsafe extern "C" fn split_voices_planar(input: *const f32, frames: usize, channels: usize, sample_rate: f32, by: u32) -> usize {
    let all = std::slice::from_raw_parts(input, frames * channels);
    let chans: Vec<&[f32]> = all.chunks(frames.max(1)).take(channels).collect();
    let by = if by == 1 { voices::SplitBy::Volume } else { voices::SplitBy::Pitch };
    let (a, b) = voices::split(&chans, sample_rate, by, &mut host_progress);
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        for c in a.iter().chain(&b) {
            o.extend_from_slice(c);
        }
    });
    frames
}

/// wasm メモリ上に f32 を `len` 個確保し、そのポインタを返す。
#[no_mangle]
pub extern "C" fn alloc_f32(len: usize) -> *mut f32 {
    let mut v = vec![0.0f32; len];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// `alloc_f32` で確保したメモリを解放する。
///
/// # Safety
/// `ptr`/`len` は 1 回の `alloc_f32` 呼び出しで得たものであること。
#[no_mangle]
pub unsafe extern "C" fn free_f32(ptr: *mut f32, len: usize) {
    drop(Vec::from_raw_parts(ptr, len, len));
}

/// 一度に変えるピッチの上限（半音）。ピッチを上げる処理は途中で「上げる分だけ伸ばす」ので、
/// 大きく上げると途中の音が長くなりすぎてメモリが足りなくなる。超える分は、長さを変えずに何回かに分けて変える
const STEP_SEMITONES: f64 = 24.0;

fn process_steps(chans: &[&[f32]], sample_rate: f32, semitones: f64, stretch: f64, algorithm: Algorithm, formant: Formant) -> Vec<Vec<f32>> {
    let mut rest = semitones;
    let mut owned: Option<Vec<Vec<f32>>> = None;
    // 回の数（進み具合を回ごとに割る）
    let passes = ((semitones.abs() / STEP_SEMITONES).ceil().max(1.0)) as usize;
    let mut pass = 0usize;
    while rest.abs() > STEP_SEMITONES {
        let step = STEP_SEMITONES.copysign(rest);
        let input: Vec<&[f32]> = match &owned {
            Some(o) => o.iter().map(|c| c.as_slice()).collect(),
            None => chans.to_vec(),
        };
        // フォルマントをずらすのは最後の回だけ（途中は保つかどうかだけをそろえる）
        let keep = match formant {
            Formant::Shift(_) => Formant::Shift(0.0),
            Formant::Follow => Formant::Follow,
        };
        let base = pass as f64 / passes as f64;
        owned = Some(process_with_progress(&input, sample_rate, step, 1.0, algorithm, keep, &mut |p| host_progress(base + p / passes as f64)));
        rest -= step;
        pass += 1;
    }
    let input: Vec<&[f32]> = match &owned {
        Some(o) => o.iter().map(|c| c.as_slice()).collect(),
        None => chans.to_vec(),
    };
    let base = pass as f64 / passes as f64;
    process_with_progress(&input, sample_rate, rest, stretch, algorithm, formant, &mut |p| host_progress(base + p / passes as f64))
}

/// プレーナー形式の音声（`frames` サンプルのブロックが `channels` 個）のピッチと長さを変え、出力のフレーム数を返す。
/// 結果は `output_ptr` で取得する。引数は WeVocalSynth の `process_planar` と同じ。
///
/// # Safety
/// `input` は `frames * channels` 個の有効な f32 を指していること。
#[no_mangle]
pub unsafe extern "C" fn process_planar(
    input: *const f32,
    frames: usize,
    channels: usize,
    sample_rate: f32,
    semitones: f64,
    stretch: f64,
    algorithm: u32,
    preserve_formant: u32,
    formant_semitones: f64,
) -> usize {
    let all = std::slice::from_raw_parts(input, frames * channels);
    let chans: Vec<&[f32]> = all.chunks(frames.max(1)).take(channels).collect();
    let formant = if preserve_formant != 0 { Formant::Shift(formant_semitones) } else { Formant::Follow };
    let out = process_steps(&chans, sample_rate, semitones, stretch, Algorithm::from_id(algorithm), formant);
    let out_frames = out.first().map_or(0, |c| c.len());
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        for c in &out {
            o.extend_from_slice(c);
        }
    });
    out_frames
}

/// ピッチカーブ（`ratios` は `hop` サンプルおきのピッチ比）でピッチを変え、`stretch` が 1 でなければそのあと伸縮する。
/// 出力のフレーム数を返し、結果は `output_ptr` で取得する（ピッチカーブは WeVocalSynth の `process_curve_planar` と同じ処理）
///
/// # Safety
/// `input` は `frames * channels` 個、`ratios` は `ratio_count` 個の有効な f32 を指していること。
#[no_mangle]
pub unsafe extern "C" fn process_curve_planar(
    input: *const f32,
    frames: usize,
    channels: usize,
    sample_rate: f32,
    ratios: *const f32,
    ratio_count: usize,
    hop: f64,
    algorithm: u32,
    preserve_formant: u32,
    formant_semitones: f64,
    stretch: f64,
) -> usize {
    let all = std::slice::from_raw_parts(input, frames * channels);
    let chans: Vec<&[f32]> = all.chunks(frames.max(1)).take(channels).collect();
    let ratios = std::slice::from_raw_parts(ratios, ratio_count);
    let formant = if preserve_formant != 0 { Formant::Shift(formant_semitones) } else { Formant::Follow };
    let algorithm = Algorithm::from_id(algorithm);
    let share = if (stretch - 1.0).abs() > 1e-9 { 0.7 } else { 1.0 };
    // 曲線の処理は 1 フレームのピッチ比を ±24 半音までしか受けないので、はみ出す分は先に全体を定数でずらし、残りを曲線に渡す
    let (lo, hi) = ratios.iter().fold((f32::MAX, f32::MIN), |(lo, hi), &r| (lo.min(r), hi.max(r)));
    let (lo_st, hi_st) = (12.0 * (lo as f64).log2(), 12.0 * (hi as f64).log2());
    // 範囲が ±24 に収まるなら何もしない。はみ出すときだけ、範囲の真ん中の分をずらす
    let pre = if lo > 0.0 && hi >= lo && (lo_st < -STEP_SEMITONES || hi_st > STEP_SEMITONES) { (lo_st + hi_st) / 2.0 } else { 0.0 };
    let shifted;
    let (chans, ratios_rest): (Vec<&[f32]>, Vec<f32>) = if pre == 0.0 {
        (chans, ratios.to_vec())
    } else {
        let keep = if preserve_formant != 0 { Formant::Shift(0.0) } else { Formant::Follow };
        shifted = process_steps(&chans, sample_rate, pre, 1.0, algorithm, keep);
        let div = 2f32.powf((pre / 12.0) as f32);
        (shifted.iter().map(|c| c.as_slice()).collect(), ratios.iter().map(|r| r / div).collect())
    };
    let mut out = curve::process(&chans, sample_rate, &ratios_rest, hop, algorithm, formant, &mut |p| host_progress(p * share));
    if (stretch - 1.0).abs() > 1e-9 {
        let refs: Vec<&[f32]> = out.iter().map(|c| c.as_slice()).collect();
        out = process_with_progress(&refs, sample_rate, 0.0, stretch, algorithm, Formant::Follow, &mut |p| host_progress(share + p * (1.0 - share)));
    }
    let out_frames = out.first().map_or(0, |c| c.len());
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        for c in &out {
            o.extend_from_slice(c);
        }
    });
    out_frames
}

/// モノラル音声のテンポを解析し、結果の値の個数を返す。結果は `output_ptr` で取得する（WeVocalSynth の `analyze_tempo` と同じ）:
/// [候補1の BPM, 強さ, 1拍目の位置（秒）, 候補2の BPM, …]（強い順）
///
/// # Safety
/// `input` は `frames` 個の有効な f32 を指していること。
#[no_mangle]
pub unsafe extern "C" fn analyze_tempo(input: *const f32, frames: usize, sample_rate: f32) -> usize {
    let x = std::slice::from_raw_parts(input, frames);
    let env = tempo::onset_envelope(x, sample_rate, &mut |_| {});
    let out: Vec<f32> = tempo::estimate(&env, &mut |_| {}).iter().flat_map(|c| [c.bpm as f32, c.strength as f32, c.offset as f32]).collect();
    let n = out.len();
    OUTPUT.with(|o| *o.borrow_mut() = out);
    n
}

/// フォルマント補正で速い対数と指数の近似を使うか（0 で標準の関数。設定の開発者向け。WeVocalSynth と同じ）
#[no_mangle]
pub extern "C" fn set_fast_math(on: u32) {
    formant::set_fast_math(on != 0);
}

/// 長い音を区間に分けて別々の Worker で作るときの、区間の数（WeVocalSynth と同じ wevocal-lib の segment）
#[no_mangle]
pub extern "C" fn segment_count(frames: usize, sample_rate: f32) -> usize {
    segment::plan(frames, sample_rate).len()
}

/// 区間 `k` の境界（`field`: 0 = start、1 = end、2 = ctx_start、3 = ctx_end。入力のサンプル位置）
#[no_mangle]
pub extern "C" fn segment_bound(frames: usize, sample_rate: f32, k: usize, field: u32) -> usize {
    let s = segment::plan(frames, sample_rate)[k];
    [s.start, s.end, s.ctx_start, s.ctx_end][field.min(3) as usize]
}

/// 区間ごとに作った音（区間の順、その中はチャンネルの順。長さは余白を含む範囲 × `stretch`）をつなぎ、出力のフレーム数を返す
///
/// # Safety
/// `input` は、区間ごとの長さの和 × `channels` 個の有効な f32 を指していること。
#[no_mangle]
pub unsafe extern "C" fn stitch_planar(input: *const f32, frames: usize, channels: usize, sample_rate: f32, stretch: f64) -> usize {
    let segs = segment::plan(frames, sample_rate);
    let lens: Vec<usize> = segs.iter().map(|s| ((s.ctx_end - s.ctx_start) as f64 * stretch).round() as usize).collect();
    let all = std::slice::from_raw_parts(input, lens.iter().sum::<usize>() * channels);
    let mut at = 0;
    let outs: Vec<Vec<Vec<f32>>> = lens
        .iter()
        .map(|&n| {
            (0..channels)
                .map(|_| {
                    let c = all[at..at + n].to_vec();
                    at += n;
                    c
                })
                .collect()
        })
        .collect();
    let out = segment::stitch(&segs, &outs, frames, stretch, sample_rate);
    let out_frames = out.first().map_or(0, |c| c.len());
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        for c in &out {
            o.extend_from_slice(c);
        }
    });
    out_frames
}

#[no_mangle]
pub extern "C" fn output_ptr() -> *const f32 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(x: &[f32]) -> f64 {
        (x.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / x.len().max(1) as f64).sqrt()
    }

    /// 定数のピッチ比を曲線の経路に通したときの音量（RMS）が、ずらし量で下がらないことを見る
    #[test]
    #[ignore = "遅いので手動で実行する（cargo test -- --ignored --nocapture）"]
    fn curve_rms_by_shift() {
        let sr = 44100.0f32;
        let n = (sr * 2.0) as usize;
        let sig: Vec<f32> = (0..n)
            .map(|i| {
                let t = i as f32 / sr;
                0.3 * (2.0 * std::f32::consts::PI * 220.0 * t).sin() + 0.15 * (2.0 * std::f32::consts::PI * 660.0 * t).sin()
            })
            .collect();
        let base = rms(&sig);
        for algo in [0u32, 1, 2] {
            for st in [0.0f32, 12.0, 13.0, 24.0, 25.0, 30.0] {
                let ratios = vec![2f32.powf(st / 12.0); 20];
                let out = unsafe {
                    process_curve_planar(sig.as_ptr(), n, 1, sr, ratios.as_ptr(), ratios.len(), 4410.0, algo, 0, 0.0, 1.0)
                };
                let o = OUTPUT.with(|o| o.borrow().clone());
                assert_eq!(o.len(), out);
                println!("algo {algo} +{st:>4}: len {out} rms {:.4} ({:.2} dB)", rms(&o), 20.0 * (rms(&o) / base).log10());
            }
        }
    }
}
