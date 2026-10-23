import { assetTypes, createAssetRegistry } from './assets';

const assets = createAssetRegistry(assetTypes);

/** Compatibility permits an explicit import; it does not establish a file's origin. */
export function isInternallySupportedPath(path: string): boolean {
  return !!assets.resolve(path) || /\.(?:md|html?|txt|csv|pdf|epub|docx|rtf|doc|png|jpe?g|gif|webp|bmp)$/i.test(path);
}
