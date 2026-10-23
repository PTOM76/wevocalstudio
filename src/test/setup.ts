// テストの前に、ブラウザにしかない型の代わりを入れる（wevocal-lib の入口が WAM の SDK を読み込むため。音は鳴らさない）
class Stub {}
Object.assign(globalThis, { AudioWorkletNode: Stub, AudioWorklet: Stub, AudioNode: Stub, AudioContext: Stub, OfflineAudioContext: Stub })
