//! WeVocal Studio の wasm。wevocal-lib のピッチ変更とピッチカーブ（WeVocalSynth と同じ処理方式）とテンポの解析を、Worker から呼べる C ABI で公開するだけ。

use std::cell::RefCell;
use wevocal_lib::{curve, formant, process_with_progress, segment, tempo, Algorithm, Formant};

thread_local! {
    static OUTPUT: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
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
        owned = Some(process_with_progress(&input, sample_rate, step, 1.0, algorithm, keep, &mut |_| {}));
        rest -= step;
    }
    let input: Vec<&[f32]> = match &owned {
        Some(o) => o.iter().map(|c| c.as_slice()).collect(),
        None => chans.to_vec(),
    };
    process_with_progress(&input, sample_rate, rest, stretch, algorithm, formant, &mut |_| {})
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
    formant::set_fast_math(true);
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
    formant::set_fast_math(true);
    let algorithm = Algorithm::from_id(algorithm);
    let mut out = curve::process(&chans, sample_rate, ratios, hop, algorithm, formant, &mut |_| {});
    if (stretch - 1.0).abs() > 1e-9 {
        let refs: Vec<&[f32]> = out.iter().map(|c| c.as_slice()).collect();
        out = process_with_progress(&refs, sample_rate, 0.0, stretch, algorithm, Formant::Follow, &mut |_| {});
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
