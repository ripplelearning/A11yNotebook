import { assetTypes, createAssetRegistry } from './assets';

const assets = createAssetRegistry(assetTypes);

/** Compatibility permits an explicit import; it does not establish a file's origin. */
export function isInternallySupportedPath(path: string): boolean {
  return !!assets.resolve(path) || /\.(?:md|html?|txt|csv|pdf|epub|docx|rtf|doc|xlsx|ods|xls|pptx|odp|png|jpe?g|gif|webp|bmp|webm|mp3|wav|m4a|ogg|flac)$/i.test(path);
}
