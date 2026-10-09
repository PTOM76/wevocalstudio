//! WeVocal Studio の wasm。wevocal-lib のピッチ変更（WeVocalSynth と同じ処理方式）を、Worker から呼べる C ABI で公開するだけ。

use std::cell::RefCell;
use wevocal_lib::{formant, process_with_progress, Algorithm, Formant};

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
    let out = process_with_progress(&chans, sample_rate, semitones, stretch, Algorithm::from_id(algorithm), formant, &mut |_| {});
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
