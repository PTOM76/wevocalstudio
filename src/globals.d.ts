// ビルド時に入る値（版、コミット）の型
/** ビルド時に package.json の version が入る（PevenMUI の pevenApp） */
declare const __APP_VERSION__: string
/** ビルドしたコミットの短いハッシュ（git が使えなければ dev） */
declare const __APP_COMMIT__: string
